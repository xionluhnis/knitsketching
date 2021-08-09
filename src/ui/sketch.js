// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const d3 = require('d3');
const JSZip = require('jszip');
const assert = require('../assert.js');
const { colorInterp } = require('./colors.js');
const draw = require('./draw.js');
const env = require('../env.js');
const sk = require('../sketch.js');
const util = require('./util.js');
const StitchCanvas = require('./stitchcanvas.js');
const {
  updateMainText,
  clearUserText, appendUserText
} = require('./textui.js');

// - constants
// const origin = Object.freeze({ x: 0, y: 0 });

// - data
let layout = null;

function SketchLayout(container){
  this.canvas = util.createCanvas(container);
  this.backCanvas = util.createCanvas(container, true);
  this.stitchCanvas = new StitchCanvas(container);
  this.frontCanvas = util.createCanvas(container);
  this.hitCanvas = util.createHitCanvas(container);
  this.hitData = null; //  { data: [] };
  this.assertErrors = [];
  this.sides = ['front', 'back'];
  this.context = this.canvas.getContext('2d');
  this.backContext = this.backCanvas.getContext('2d');
  this.frontContext = this.frontCanvas.getContext('2d');
  this.hitContext = this.hitCanvas.getContext('2d', { alpha: false });
  this.width = this.canvas.clientWidth;
  this.height = this.canvas.clientHeight;
  this.transform = { x: 0, y: 0, k: 1 };
  this.visibleExtents = { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
  this.zoom = d3.zoom();
  /*
  this.zoom.filter(() => {
    return (!this.actionMode || this.moveMode) && !d3.event.button;
  });
  */
  this.zoom.scaleExtent(this.zoomExtents = [0.1, 50]);
  this.zoom.on('zoom', () => {
    this.update();
  });
  this.updateExtent();
  // apply zoom on canvas
  d3.select(this.canvas).call(this.zoom);

  // update con the sketch mode
  const modeSelect = document.getElementById('sketch-mode');
  const modes = [];
  for(const input of modeSelect.querySelectorAll('input[name=sketch-mode]')){
    const mode = input.value;
    modes.push(mode);
    input.addEventListener('click', () => {
      // update UI
      for(const m of modes)
        modeSelect.parentNode.classList.remove(m);
      modeSelect.parentNode.classList.add(mode);
      this.sketchMode = mode;
      modeSelect.dataset.value = mode;
      this.update();
    });
  }
  this.sketchMode = 'shape';

  // update on show options
  for(const elem of document.querySelectorAll('#dispLayer input')){
    const showOpt = elem.id;
    this[showOpt] = !!elem.checked;
    elem.addEventListener('click', () => {
      this[showOpt] = !!elem.checked;
      this.update();
    });
  }
  const showMesh = document.getElementById('showMesh');
  showMesh.addEventListener('change', () => {
    this.showMesh = showMesh.value;
    this.update();
  });
  this.showMesh = showMesh.value;

  this.initInteraction();
  this.initFlowUI();
  this.initScheduleUI();

  // build interaction logic
  this.startInteraction();
}

SketchLayout.prototype.enablePaning = function(){
  d3.select(this.canvas).call(this.zoom);
};

SketchLayout.prototype.disablePaning = function(){
  // @see https://stackoverflow.com/questions/13713528/how-to-disable-pan-for-d3-behavior-zoom
  d3.select(this.canvas)
    .on('mousedown.zoom', null)
    .on('dblclick.zoom', null);
    // .on('mousemove.zoom', null)
    // .on('mouseup.zoom', null)
    // .on('touchstart.zoom', null)
    // .on('touchmove.zoom', null)
    // .on('touchend.zoom', null);
};

// ###########################################################################
// ##### Queries #############################################################
// ###########################################################################

SketchLayout.prototype.getHITValue = function(x, y){
  let r, g, b;
  if(this.cacheHIT && this.hitData){
    const index = (y * this.hitData.width + x) * 4; // RGBA
    r = this.hitData.data[index + 0] || 0;
    g = this.hitData.data[index + 1] || 0;
    b = this.hitData.data[index + 2] || 0;
  } else {
    [r, g, b] = this.hitContext.getImageData(x, y, 1, 1).data;
  }
  assert(r <= 0xFF && g <= 0xFF && b <= 0xFF, 'Invalid pixel data', r, g, b);
  return ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF);
};

SketchLayout.prototype.getHITTarget = function(x, y, withIndex){
  const hitValue = this.getHITValue(x, y);
  for(const s of sk.allNCChildren()){
    const idx = s.getHITData(hitValue);
    // idx === -1 => did not hit this curve
    if(idx !== -1)
      return withIndex ? [s, -1] : s;
  }
  for(const s of sk.allCurves()){
    const idx = s.getHITData(hitValue);
    // idx === -1 => did not hit this curve
    if(idx !== -1)
      return withIndex ? [s, idx - 1] : s;
  }
  for(const s of sk.allImages()){
    const idx = s.getHITData(hitValue);
    // idx === -1 => did not hit this curve
    if(idx !== -1)
      return withIndex ? [s, -1] : s;
  }
  // special boundary cases
  if(hitValue){
    // search for target object manually, inner object firsts, top to bottom
    // /!\ note: this can only hit closed shapes!
    const transform = this.transform;
    const sketchX = (x - transform.x) / transform.k;
    const sketchY = (y - transform.y) / transform.k;
    const skObj = sk.getHITTarget({ x: sketchX, y: sketchY });
    if(skObj)
      return withIndex ? [skObj, -1] : skObj;
  }
  return withIndex ? [null, -1] : null;
};

SketchLayout.prototype.getHITLink = function(x, y){
  const [curve, segIdx] = this.getHITTarget(x, y, true);
  if(curve instanceof sk.Sketch)
    return segIdx !== -1 ? curve.getLink(segIdx) : null;
  return null;
};

SketchLayout.prototype.getHITConstraint = function(x, y){
  const [curve, segIdx] = this.getHITTarget(x, y, true);
  if(curve instanceof sk.Sketch){
    // sketch => border constraint
    // => segIdx should exist
    return segIdx !== -1 && !curve.parent ? curve.getConstraint(segIdx) : null;

  } else if(curve instanceof sk.Curve){
    // curve => child constraint
    // => segIdx does not matter for the constraint
    return curve.parent ? curve.parent.getConstraint(curve) : null;
  
  } else {
    return null;
  }
};

SketchLayout.prototype.isObjectVisible = function(sketch){
  const sbox = sketch.globalExtents();
  const vbox = this.visibleExtents;
  return util.bboxIntersect(sbox, vbox);
};

SketchLayout.prototype.isPointVisible = function(p){
  return util.bboxContains(this.visibleExtents, p);
};

SketchLayout.prototype.getPointVisibilityTest = function(sketch){
  const transform = sketch.fullTransform;
  const visibleExtents = util.extents([
    transform.unapplyFrom(this.visibleExtents.min),
    transform.unapplyFrom(this.visibleExtents.max)
  ]);
  return p => {
    return util.bboxContains(visibleExtents, p);
  };
};

// ###########################################################################
// ##### State Updates #######################################################
// ###########################################################################

SketchLayout.prototype.centerLayout = function(){
  const { min, max } = sk.extents();
  const center = {
    x: (min.x + max.x) * 0.5,
    y: (min.y + max.y) * 0.5
  };
  const width  = Math.max(200, max.x - min.x);
  const height = Math.max(200, max.y - min.y);
  // find appropriate zoom level
  const zoom = Math.max(
      0.2, Math.min(
      8,
      Math.min(this.canvas.width / width,
               this.canvas.height / height * 0.9)
  ));
  const newTransform = d3.zoomIdentity.translate(
    this.canvas.width / 2 - center.x * zoom,
    this.canvas.height / 2 - center.y * zoom
  ).scale(zoom);
  d3.select(this.canvas)
    .transition()
    .duration(750)
    .call(
        this.zoom.transform,
        newTransform
    );
};

SketchLayout.prototype.updateFromContent = function(){
  this.updateExtent();
  this.update();
};

/**
 * Update sides to visualize
 */
SketchLayout.prototype.updateSides = function(){
  this.sides = document.getElementById('sideMode').value.split('-');
  for(let side of this.sides)
    assert(['front', 'back'].includes(side), 'Invalid side', side);
  this.invertX = this.sides[0] == 'back';
};

/**
 * Update the pan/zoom extents
 */
SketchLayout.prototype.updateExtent = function(){
  const { min, max } = sk.extents();
  // let s = this.sides.length - 1;
  const w = Math.max(100, max.x - min.x);
  const h = Math.max(100, max.y - min.y);
  // locations
  // let dw = (w - this.width) / 2;
  // let dh = -(h - this.height) / 2;
  // extents = [ [left, top], [right, bottom] ]
  this.zoom.translateExtent(this.extents = [
    [ (min.x - w * 0.5), (min.y - h * 0.5) ],
    [ (max.x + w * 0.5),  (max.y + h * 0.5) ]
    // [ Math.min(min.x - w * 0.5, - 50),  Math.min(min.y - h * 0.5, -50) ],
    // [ Math.max(max.x + w * 0.5, 50),    Math.max(max.y + h * 0.5, 50) ]
  ]);
  // unbind previous behaviour
  // d3.select(this.canvas).on('.zoom', null);
  // create new zoom behaviour
  // d3.select(this.canvas).call(this.zoom);
};

SketchLayout.prototype.updateVisibleExtents = function(){
  const transform = sk.Transform.from(this.transform);
  const w = this.canvas.clientWidth;
  const h = this.canvas.clientHeight;
  this.visibleExtents = {
    min: transform.unapplyFrom({ x: 0, y: 0 }),
    max: transform.unapplyFrom({ x: w, y: h })
  };
};

/**
 * Update the layout rendering
 */
SketchLayout.prototype.update = function() {
  // update size
  let w = this.canvas.clientWidth;
  let h = this.canvas.clientHeight;
  if(h === 0){
    h = this.canvas.parentNode.clientHeight;
  }
  for(const cvs of [
    this, this.canvas, this.stitchCanvas,
    this.backCanvas, this.frontCanvas, this.hitCanvas
  ]){
    if(cvs.width != w)
      cvs.width = w;
    if(cvs.height != h)
      cvs.height = h;
  }

  // get transform for pan/zoom
  const transform = d3.zoomTransform(this.canvas);
  this.transform = transform;

  // update visible extents
  this.updateVisibleExtents();

  // draw highlight first
  this.drawHighlight();
  // draw main content then
  this.drawContent();

  // draw hit data
  // /!\ not necessary when things change rapidly
  // => do that indirectly
  if(this.hitTimeout)
    clearTimeout(this.hitTimeout);
  this.hitTimeout = setTimeout(() => {
    this.hitTimeout = 0;
    this.drawHIT();
  }, 1000/60);
};

/**
 * Update the current highlight selection
 */
SketchLayout.prototype.updateHighlight = function(){
  // get target
  const hitCurve = this.getHITTarget(this.mouseX, this.mouseY);
  // console.log('HIT(' + this.mouseX + ',' + this.mouseY + ') = ', hitCurve);
  if(!hitCurve){
    // clear highlight and update if it was not empty before
    if(this.highlight.length){
      this.highlight = [];
      this.highlightMap = {};
      this.drawHighlight();
      return true;
    }
  } else {
    // update if the target differ
    if(!this.highlightMap[hitCurve.id]){
      this.highlight = [ hitCurve ];
      this.highlightMap = { [hitCurve.id]: true };
      this.drawHighlight();
      return true;
    }
  }
  return false;
};

SketchLayout.prototype.removeFromHighlight = function(target, redraw) {
  if(this.highlightMap[target.id]){
    this.highlight.splice(this.highlight.indexOf(target));
    this.highlightMap[target.id] = false;
  }
  if(this.selectionMap[target.id]){
    this.selection.splice(this.selection.indexOf(target));
    this.selectionMap[target.id] = false;
  }
  if(redraw)
    this.drawHighlight();
};

SketchLayout.prototype.clearHighlight = function(update = true){
  this.highlight = [];
  this.highlightMap = {};
  if(update)
    this.update();
};

/**
 * Clear the current selection and update
 */
SketchLayout.prototype.clearSelection = function(update = true){
  this.selection = [];
  this.selectionMap = {};
  if(update)
    this.update();
};

/**
 * Update the current selection.
 * Shift keeps the previous selection into account.
 *
 * @param event the MouseEvent that triggered the seleciton
 */
SketchLayout.prototype.updateSelection = function(
  target = this.getHITTarget(this.mouseX, this.mouseY)
){
  if(!target){
    // clear selection if any
    if(this.selection.length){
      this.clearSelection();
    } else {
      this.drawHighlight();
    }
  } else {
    // shift for multiple
    if(this.shiftKey){
      // toggle add/remove
      if(this.selectionMap[target.id]){
        // remove
        this.selection.splice(this.selection.indexOf(target), 1);
        this.selectionMap[target.id] = false;
      } else {
        // add
        this.selection.push(target);
        this.selectionMap[target.id] = true;
      }
    } else {
      // reset to current
      this.selection = [ target ];
      this.selectionMap = { [target.id]: true };
    }

    // if target is now in the selection,
    // move it to the top in terms of layering
    if(this.selectionMap[target.id]){
      const changed = sk.moveToFront(target);
      if(changed){
        this.update();
        return; // no need to re-draw the highlights (part of update)
      }
    }
    this.drawHighlight();
  }
};

// ###########################################################################
// ##### Drawing Highlights ##################################################
// ###########################################################################

SketchLayout.prototype.drawHighlight = function(){
  const ctx = this.backContext;
  const transform = this.transform;
  const r = draw.getConstantRadius(transform, 1);

  // draw back highlights

  // clear background
  if(this.showBG){
    ctx.fillStyle = '#F0F0FF';
    ctx.fillRect(0, 0, this.width, this.height);
  } else {
    ctx.clearRect(0, 0, this.width, this.height);
  }

  // apply transformation to contexts
  draw.withinViewport(ctx, transform, () => {

    // draw extents
    const [[left, top], [right, bottom]] = this.extents || [[-10, -10], [10, 10]];
    if(this.showBG){
      ctx.fillStyle = '#EEF';
      ctx.fillRect(left, top, right - left, bottom - top);
    }
    ctx.strokeStyle = '#DDF';
    ctx.setLineDash([r*5, r*5]);
    ctx.lineWidth = r*7;
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.setLineDash([]);

    // draw sketch selection
    for(let c of this.selection){
      draw.withinContext(ctx, c, () => {
        c.drawPath(ctx);
        if(!c.open){
          ctx.fillStyle = '#FFFFFF';
          ctx.fill();
        }
        ctx.lineWidth = r*7;
        //ctx.setLineDash([r*5, r*5]);
        ctx.strokeStyle = '#3F5FFF';
        ctx.stroke();
      });
    }
    // draw sketch highlights
    for(let c of this.highlight){
      draw.withinContext(ctx, c, () => {
        c.drawPath(ctx);
        if(!this.selectionMap[c.id] && !c.open){
          ctx.fillStyle = '#FFFFFFCC';
          ctx.fill();
        }
        if(c.open){
          ctx.lineWidth = r*15;
        } else {
          ctx.lineWidth = r*7;
        }
        ctx.strokeStyle = '#CFFF5CCC';
        ctx.stroke();
        if(c.open){
          ctx.lineWidth = r*7;
          ctx.strokeStyle = '#FFF';
          ctx.stroke();
        }
      });
    }
  });

  // draw labels
  this.drawLabels(ctx);

  // draw front layer
  this.drawFront();
};

SketchLayout.prototype.drawFront = function(){
  // clear front drawing
  const frontCtx = this.frontContext;
  frontCtx.clearRect(0, 0, this.width, this.height);

  // draw length data
  this.drawSegmentLengths(frontCtx);

  // display context information
  clearUserText();
  baseText: {
    appendUserText(...[
      'Extents:',
      '\tW ' + Math.round(this.extents[1][0] - this.extents[0][0]),
      '\tH ' + Math.round(this.extents[1][1] - this.extents[0][1]),
      'Zoom: ' + Math.round(this.transform.k * 100)
    ].reverse());
  }

  // draw near-mouse information and action
  draw.withinViewport(frontCtx, this.transform, () => {

    // show data under cursor
    if(this.sketchMode == 'schedule'
    || this.sketchMode === 'seam'
    || this.sketchMode === 'layer'){
      this.drawCurrentStitches(frontCtx);

    } else if(this.showFlow || this.sketchMode == 'flow'){
      this.drawCurrentFlow(frontCtx);
    }

    // draw actions in front
    this.drawAction();
  });

  // draw states
  this.drawState(frontCtx);
};

SketchLayout.prototype.drawState = function(ctx){
  let some = this.drawFlowState(ctx);
  some |= this.drawScheduleState(ctx);
};

SketchLayout.prototype.drawLabels = function(ctx){
  if(!this.showLabels)
    return;
  const transform = this.transform;

  draw.withinLabelViewport(ctx, transform, () => {
    for(const c of sk.allSketches()){
      // label location
      const { min, max } = c.globalExtents();
      const top = (min.y - 25) * transform.k;
      const left = (min.x + max.x) * 0.5 * transform.k;
      // link
      const { x: cx, y: cy } = c.globalCentroid();
      ctx.beginPath(); // XXX how do we take c.transform into account?
      ctx.moveTo(left, top);
      ctx.lineTo(cx * transform.k, cy * transform.k);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = '#FFF';
      ctx.stroke();
      ctx.setLineDash([]);
  
      // create label for c
      draw.label(ctx, c.label, { x: left, y: top }, this.highlightMap[c.id]);
    }
  });
};

SketchLayout.prototype.drawSegmentLengths = function(ctx){
  if(!this.showLength)
    return;
  const transform = this.transform;
  draw.withinLabelViewport(ctx, transform, () => {
    for(const c of sk.allRootSketches()){
      for(let segIdx = 0; segIdx < c.segLength; ++segIdx){
        draw.segmentLength(ctx, c, segIdx, transform);
      }
    } // enfor c of root sketches
  });
};

SketchLayout.prototype.drawProgress = function(ctx, progress, message){
  // draw progress bar on top-right
  const m = 10;
  const dm = 2;
  const w = this.canvas.clientWidth;
  const h = 16;
  // background
  ctx.beginPath();
  ctx.rect(w/2 - m, m, w/2, h);
  ctx.fillStyle = '#FFFFFF66';
  ctx.fill();
  // progress
  const c1 = progress >= 0.5 ? 0xFFFF00 : 0xFF0000;
  const c2 = progress >= 0.5 ? 0x00FF00 : 0xFFFF00;
  ctx.beginPath();
  ctx.rect(w/2 - m + dm, m + dm, (w-2*dm)/2 * progress, h - dm * 2);
  ctx.fillStyle = colorInterp(c1, c2, progress >= 0.5 ? (progress - 0.5) * 0.5 : progress * 2);
  ctx.fill();
  // frame
  ctx.beginPath();
  ctx.rect(w/2 - m, m, w/2, h);
  ctx.strokeStyle = '#FFF';
  ctx.lineWidth = 1;
  ctx.stroke();

  // message on top
  if(message){
    ctx.font = '16px Arial';
    ctx.fillStyle = '#000';
    ctx.fillText(message, w/2 + m, m + h*3/4 + dm);
  }
};


/**
 * Draw the whole layout
 */
SketchLayout.prototype.drawContent = function() {
  const ctx = this.context;
  const transform = this.transform;
  // const zoom = this.transform.k;
  // const showStitches = zoom >= 0.5;
  // const showYarn  = zoom >= 2;
  // const showInstr = zoom >= 4;

  // clear background
  ctx.clearRect(0, 0, this.width, this.height);

  // draw warning/error messages
  // in global context (no translate / zoom)
  if(this.flowData
  && this.flowData.meshes
  && this.flowData.meshes.length)
    updateMainText(...this.flowData.meshes.map(mesh => mesh.issues()));

  // into viewport
  draw.withinViewport(ctx, transform, () => {

    // XXX replace this hard-coded with generic scene graph drawing!

    // draw images
    this.drawImages();

    // draw sketches
    this.drawSketches();

    // draw pcurves
    this.drawPCurves();
  });

  // draw stitches
  this.drawStitches();
};

/**
 * Draw the HIT data
 */
SketchLayout.prototype.drawHIT = function() {
  const ctx = this.hitContext;
  const transform = this.transform;

  // clear background
  ctx.fillStyle = '#00FFFF';
  ctx.fillRect(0, 0, this.width, this.height);

  // apply transformation to context
  draw.enterViewport(ctx, transform);

  // draw root images before sketches
  // = they are in the background
  for(let img of sk.allRootImages()){
    draw.withinContext(ctx, img, () => {
      ctx.fillStyle = img.hitColor;
      ctx.fillRect(0, 0, img.width, img.height);
    });
  }

  // draw backgrounds and edges
  for(const s of sk.allSketches(true)){
    // transform context
    const stack = s.getContextStack();
    draw.enterContext(ctx, stack);

    // draw background with base HIT value
    draw.drawCurvePath(ctx, s, true);
    const hColor = s.hitColor;
    ctx.fillStyle = hColor;
    ctx.fill();

    // draw each segment with a specific mask
    for(let i = 0; i < s.length; ++i){
      ctx.lineWidth = draw.getConstantRadius(transform, 15);
      ctx.strokeStyle = s.getHITColor(i + 1); // hColor | (i + 1 << HIT_SEGMENT_SHIFT);
      draw.drawCurveSegment(ctx, s, i, true);
      ctx.stroke();
      // ctx.lineWidth = this.getConstantRadius(15);
    }

    // draw each non-sketch child with its own hit mask
    // but draw none in linking mode (we need access to sketch borders!)
    if(this.sketchMode !== 'linking'){
      for(const child of s.children){
        // skip sketches, since those are handled by the outer loop
        if(child instanceof sk.Sketch)
          continue;
        if(child instanceof sk.PCurve
        && (!child.isValid() || !child.isComplete()))
          continue; // skip drawing incomplete pcurves
  
        // draw child as a whole object
        draw.enterContext(ctx, [child]);
        if(child.open || child instanceof sk.PCurve){
          // draw each segment only
          for(let segIdx = 0; segIdx < child.segLength; ++segIdx){
            child.drawSegment(ctx, segIdx);
            ctx.lineWidth = draw.getConstantRadius(transform, 15);
            ctx.strokeStyle = child.getHITColor(segIdx + 1);
            ctx.setLineDash([]);
            ctx.stroke();
          }
        } else {
          child.drawPath(ctx);
          ctx.fillStyle = child.hitColor;
          ctx.fill();
        }
        draw.exitContext(ctx, [child]);
      }
    }

    // exit context
    draw.exitContext(ctx, stack);
  }

  // restore previous transformation
  draw.exitViewport(ctx);

  // cache hit data
  if(this.cacheHIT && this.hitCanvas.width && this.hitCanvas.height){
    this.hitData = this.hitContext.getImageData(0, 0, this.hitCanvas.width, this.hitCanvas.height);
  } else {
    this.hitData = null;
  }
};

SketchLayout.prototype.drawImages = function(){
  const ctx = this.context;
  for(const image of sk.allRootImages()){
    if(!this.isObjectVisible(image))
      continue;
    draw.withinContext(ctx, image, () => {
      ctx.globalAlpha = image.opacity;
      ctx.drawImage(image.img, 0, 0, image.width, image.height);
    });
  }
};

SketchLayout.prototype.drawSketches = function(){
  const shapeOrLink = this.sketchMode === 'shape'
                   || this.sketchMode === 'linking';
  const showSeams = this.sketchMode === 'seam' && this.showSeams;
  const ctx = this.context;
  const r = draw.getConstantRadius(this.transform, 1);
  for(const sketch of sk.allSketches(true)){
    // skip sketch if not visible
    if(!this.isObjectVisible(sketch))
      continue;
    draw.enterContext(ctx, sketch);
    // draw within context
    draw.drawCurvePath(ctx, sketch, true);
    // note: fill first because overlapping with stroke
    ctx.fillStyle = '#FFFFFF99';
    ctx.fill();
    ctx.lineWidth = 2*r;
    if(!showSeams){
      ctx.strokeStyle = shapeOrLink ? '#000' : '#ccc';
      ctx.stroke();
    }

    // draw again over open segments twice
    // once to have a lighter base
    // a second time to create a dash pattern
    for(let i = 0; i < sketch.segLength; ++i){
      if(!sketch.getLink(i)){
        draw.drawCurveSegment(ctx, sketch, i, true);
        ctx.strokeStyle = shapeOrLink ? '#AAA' : '#EEE';
        ctx.stroke();
        ctx.setLineDash([r*10, r*10]);
        ctx.lineWidth = 2.1 * r;
        ctx.strokeStyle = '#FFF';
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 2*r;
      }
    }
    if(showSeams)
      this.drawSeams(ctx, sketch);

    // draw flow
    if(!sketch.parent && this.showFlow){
      this.drawFlow(ctx, sketch);
    }

    // draw flow constraints
    if(this.showFlow
    || this.sketchMode === 'kappa'
    || this.sketchMode === 'flow'
    || this.sketchMode === 'schedule'){
      if(this.showKappaConstraints){
        for(const kappa of sketch.kappas)
          this.drawKappaConstraint(ctx, kappa, true);
      }
      if(this.showFlowConstraints){
        for(const constr of sketch.constraints)
          this.drawFlowConstraint(ctx, constr, true);
      }
    }

    // out of sketch context
    draw.exitContext(ctx, sketch);

    // draw residual curve children
    for(const skobj of sketch.children){
      // generic method for drawing
      if(skobj.draw){
        draw.withinContext(ctx, skobj, () => {
          skobj.draw(ctx, this);
        });
        continue;
      }
      // exclude all but unconstrained curves
      if(!(skobj instanceof sk.Curve)
      || sketch.getConstraint(skobj))
        continue;
      draw.withinContext(ctx, skobj, () => {
        if(showSeams)
          this.drawSeams(ctx, skobj);
        else
          this.drawScaffold(ctx, skobj);
      });
    }

    // potentially draw links
    if(this.showLinks){
      // draw links
      const xform = sketch.fullTransform;
      const k = this.transform.k;
      draw.withinLabelViewport(ctx, this.transform, () => {
        for(let i = 0; i < sketch.length; ++i){
          const link = sketch.getLink(i);
          if(!link)
            continue;
          const seg = sketch.getSegment(i);
          const midpoint = seg.get(0.5);
          const { x, y } = xform.applyTo(midpoint);
          draw.centeredText(
            ctx, link.label, x * k, y * k, '#FFF', '#999'
          );
        }
      }, true); // from within viewport
    }

  }
};

SketchLayout.prototype.drawSeams = function(ctx, curve, subCurve = false){
  const skBorder = !curve.open;
  const r = draw.getConstantRadius(this.transform, 1);
  for(let i = 0; i < curve.segLength; ++i){
    const sm = curve.getSeamMode(i);
    if(subCurve && sm <= 0)
      continue;
    draw.drawCurveSegment(ctx, curve, i, true);
    ctx.lineWidth = 3 * r;
    ctx.strokeStyle = [
      '#eee', skBorder ? '#666' : '#bbb', '#000'
    ][sm + 1];
    ctx.stroke();
    if(sm > 0){
      draw.drawCurveSegment(ctx, curve, i, true);
      ctx.lineWidth = 6*r;
      ctx.strokeStyle = '#000';
      ctx.setLineDash([r*2, r*8]);
      ctx.stroke();
      ctx.lineWidth = 2*r;
      ctx.setLineDash([]);
    }
  }
};

SketchLayout.prototype.drawPCurves = function(){
  if(!this.showPCurves)
    return; // skip
  const ctx = this.context;
  if(this.sketchMode === 'seam'){
    for(const pcurve of sk.allPCurves()){
      if(!this.isObjectVisible(pcurve))
        continue;
      draw.withinContext(ctx, pcurve, () => {
        this.drawSeams(ctx, pcurve, !!pcurve.subCurve);
      });
    }

  } else {
    for(const pcurve of sk.allPCurves()){
      // only for non-constraints when showing constraints
      if(!this.isObjectVisible(pcurve)
      || (pcurve.hasConstraint() && this.showFlowConstraints))
        continue;
      draw.withinContext(ctx, pcurve, () => {
        this.drawScaffold(ctx, pcurve);
      });
    }
  }
};

SketchLayout.prototype.drawScaffold = function(ctx, curve){
  const r = draw.getConstantRadius(this.transform, 3);
  // draw scaffold curve
  draw.drawCurvePath(ctx, curve, true);
  ctx.lineWidth = r;
  ctx.setLineDash([2*r, 2*r]);
  ctx.strokeStyle = '#999';
  ctx.stroke();
};

SketchLayout.prototype.drawStitches = function(){
  this.stitchCanvas.draw(this);
};

// ###########################################################################
// ##### Extensions ##########################################################
// ###########################################################################

Object.assign(SketchLayout.prototype, require('./sketch-actions.js')); // mouse interactions
Object.assign(SketchLayout.prototype, require('./sketch-flow.js')); // flow visualization
Object.assign(SketchLayout.prototype, require('./sketch-schedule.js')); // schedule visualization
Object.assign(SketchLayout.prototype, require('./sketch-menu.js')); // context menu

// ###########################################################################
// ##### Exports #############################################################
// ###########################################################################

function initSketch(){
  if(layout)
    return;
  const output = document.getElementById('output-sketch');
  layout = new SketchLayout(output);
  // initial zoom stuff
  setTimeout(() => {
    layout.centerLayout();
  }, 500);

  // create UI for saving stitches
  /*
  const outputStitches = document.getElementById('output_stitches');
  outputStitches.addEventListener('click', event => {

    const str = getStitchFile();
    if(!str || !str.length){
      event.preventDefault();
      return;
    }
    util.exportFile('sketch.st', str, { link: outputStitches });
  });
  const outputKnitout = document.getElementById('output_knitout');
  outputKnitout.addEventListener('click', event => {
    if(!exportKnitoutData(outputKnitout)){
      event.preventDefault();
      return;
    }
  });
  */
}

function loadSketch(file, callback, reset = true){
  const reader = new FileReader();
  reader.onload = function(event){
    let data = event.target.result;
    if(!data){
      if(callback)
        callback();
      return;
    }

    try {
      // parse data as JSON
      if(typeof data === 'string')
        data = JSON.parse(data);

      // try loading SVG data
      if('sketch' in data){
        env.load(data, false, reset);
      } else {
        env.loadSketch(data, reset);
      }

    } catch(err){
      console.log(err);
    }

    // update content
    layout.updateFromContent();

    if(callback)
      callback();
  };
  reader.readAsText(file);
}

function loadSVG(file, callback){
  const reader = new FileReader();
  reader.onload = function(event){
    const data = event.target.result;
    if(!data){
      if(callback)
        callback();
      return;
    }

    try {
      // try loading SVG data
      sk.loadCurvesFromSVG(data);

    } catch(err){
      console.log(err);
    }

    // update content
    layout.updateFromContent();

    if(callback)
      callback();
  };
  reader.readAsText(file);
}

function getStitchData(){
  if(!layout)
    return [];
  const traces = layout.scheduleData.traces;
  if(!traces || !traces.length)
    return [];
  const list = [];
  for(const trace of traces){
    for(let idx = 0; idx < trace.length; ++idx){
      list.push(trace.getEntry(idx));
    }
  }
  return list;
}

function getStitchFile(){
  // knit uses stitch connection for ins/ous
  // miss uses the location before as previous wale
  // XXX what about tuck?
  const data = getStitchData();
  if(!data.length){
    return null;
  }
  // else, generate blob and assign to link
  // so that press triggers download
  const stitchIndex = new Map();
  for(let i = 0; i < data.length; ++i){
    const { stitch, flags } = data[i];
    const key = stitch.index + (flags & sk.Trace.TWICE ? 'b' : 'a');
    stitchIndex.set(key, i);
  }
  const lines = data.map(({ stitch, dir, flags }) => {
    // yarn, action, dir, in0, in1, ou0, ou1, x, y, z
    const pre = stitch.getPrevWales();
    const post = stitch.getNextWales();
    const pos = stitch.getPosition();
    const second = (flags & sk.Trace.TWICE) !== 0;

    // find action code
    let act;
     // different case depending on pass
     if(!second){
       // first pass
       if(pre.length === 0){
         act = 's'; // start
       } else if(pre.length === 2){
         act = 'd'; // decrease
       } else {
         act = 'k'; // default knit
       }
     } else {
       // second pass
       if(post.length === 0){
         act = 'e'; // end
       } else if(post.length === 2){
         act = 'i'; // increase
       } else {
         act = 'k'; // default knit
       }
     }
    const d = (dir & sk.Trace.INVERSE) ? 'a' : 'c';
    // get neighbors, in ordered way
    const ins = [-1, -1];
    const ous = [-1, -1];
    if(!second){
      for(let i = 0; i < pre.length; ++i)
        ins[i] = stitchIndex.get(pre[i].index + 'b');
      if(pre.length > 1)
        ins.sort((a, b) => a - b);
      ous[0] = stitchIndex.get(stitch.index + 'b');
    } else {
      ins[0] = stitchIndex.get(stitch.index + 'a');
      for(let i = 0; i < post.length; ++i)
        ous[i] = stitchIndex.get(post[i].index + 'a');
      if(post.length > 1)
        ous.sort((a, b) => a - b);
    }
    assert(ins.some(i => i !== -1) || ous.some(i => i !== -1),
      'Stitch has no wale at all?');
    return [0, act, d, ins[0], ins[1], ous[0], ous[1], pos.x, pos.y, stitch.getLayerIndex()].join(' ');
  });
  return lines.join('\n');
}

function exportSingleKnitout(k, linkSrc){
  util.exportFile('sketch.k', k.toString(), { link: linkSrc });
}

function exportJointKnitout(ks, linkSrc){
  util.exportFile('sketches.k', ks[0].toJointString(...ks.slice(1)), { link: linkSrc });
}

function exportKnitoutsZip(ks){
  const zip = new JSZip();
  for(let i = 0; i < ks.length; ++i)
    zip.file('sketch_' + i + 'k', ks[i].toString());
  zip.generateAsync({ type: 'blob' }).then(content => {
    // no link source, since asynchronous click
    util.exportFile('sketches_k.zip', content, {});
  });
}

function exportKnitoutData(linkSrc){
  if(!layout)
    return false;
  const knitouts = layout.scheduleData.knitouts;
  if(!knitouts || !knitouts.length)
    return false;
  // three cases: single output, or multiple outputs
  if(knitouts.length === 1){
    exportSingleKnitout(knitouts[0], linkSrc);
  } else if(document.getElementById('kzip').checked) {
    exportKnitoutsZip(knitouts, linkSrc);
  } else {
    exportJointKnitout(knitouts, linkSrc);
  }
  return true;
}

let centerTimeout = -1;
function updateSketch(center){
  if(!layout)
    return;
  layout.clearHighlight();
  layout.clearSelection();
  layout.updateFromContent();
  if(center){
    // initial zoom stuff
    clearTimeout(centerTimeout);
    centerTimeout = setTimeout(() => {
      layout.centerLayout();
    }, 500);
  }
  // pipeline triggers
  if(layout.updatingFlow)
    sk.updateFlow();
}

function setLayoutAction(action, ...args){
  if(!layout)
    return;
  if(typeof action === 'string'){
    layout.setActionMode(action, ...args);
  } else {
    layout.setAction(action, ...args);
  }
}

function resetLayoutAction(){
  if(!layout)
    return;
  layout.resetAction();
}

function refreshLayout(updateContent = false){
  if(!layout)
    return;
  if(updateContent)
    layout.updateFromContent();
  else
    layout.update();
}

module.exports = {
  initSketch,
  loadSketch,
  loadSVG,
  exportKnitoutData,
  updateSketch,
  getStitchFile,
  getStitchData,
  setLayoutAction,
  resetLayoutAction,
  refreshLayout
};
