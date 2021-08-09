// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const d3 = require('d3');
const env = require('../env.js');
const { getTraces } = require('../algo/schedule.js');
const {
  Knitout, Block, simulateBlocks
} = require('../knitout.js');
const colors = require('./colors.js');
const draw = require('./draw.js');
const util = require('./util.js');
const { getDeviceInfo } = require('../carriers.js');

// constants
const maxDrawDuration = 15;
const minDrawFreq = 60;
const { FRONT, BACK } = Knitout;
const RACK_EXPLICIT = 'explicit';
const RACK_SEMI     = 'semi';
const RACK_IMPLICIT = 'implicit';
const RACK_MODES = [RACK_EXPLICIT, RACK_SEMI, RACK_IMPLICIT];
// colors
const DROP_COLOR = '#FF9999';
const AMISS_COLOR = '#FF66AA';
const XFER_COLOR = '#3366FF';
const RACK_COLOR = DROP_COLOR;

// - data
let layout = null;

function KnitoutLayout(container){
  this.canvas = util.createCanvas(container);
  this.context = this.canvas.getContext('2d');
  this.width = this.canvas.clientWidth;
  this.height = this.canvas.clientHeight;
  this.lastDrawTime = 0;
  this.redrawTimeout = -1;
  this.finalTimeout = -1;
  this.zoom = d3.zoom();
  this.zoom.filter(() => {
    return !d3.event.button
        && !d3.event.ctrlKey
        && !d3.event.shiftKey;
  });
  this.zoom.scaleExtent([0.05, 8]);
  this.zoom.on('zoom', () => this.throttledUpdate());
  this.knitout = new Knitout();
  this.allBlocks = [];
  this.blocks = [];
  this.allStates = [];
  this.states = [];
  this.trace  = null; // for flow and sketch information
  this.needleExtents = {
    min: 0, max: 0
  };
  this.viewport = {
    top: -Infinity,
    bottom: +Infinity,
    left: -Infinity,
    right: +Infinity
  };

  // scale
  this.needleSpace = 10;
  this.blockSpace  = 10;
  this.bedSpaceX   = 5;
  this.bedSpaceY   = 8;

  // side update
  this.sides = util.getSides().map(s => s.charAt(0)) || ['f', 'b'];
  util.addSidesListener(sides => {
    assert(Array.isArray(sides), 'Invalid sides list', sides);
    this.sides = sides.map(s => s.charAt(0));
    this.updateSides();
  });
  this.updateSides(true);

  // update extents and start zoom
  this.updateExtent();
  // apply zoom on canvas
  d3.select(this.canvas).call(this.zoom);


  // racking mode update
  this.rackingMode = RACK_EXPLICIT;
  for(const input of document.querySelectorAll('#toolbar input[name=rack-mode]')){
    const mode = input.id.replace('rack-', '');
    assert(RACK_MODES.includes(mode), 'Unsupported racking mode', mode, RACK_MODES);
    input.addEventListener('click', () => {
      this.rackingMode = mode;
      this.updateRacking();
    });
    if(input.checked)
      this.rackingMode = mode; // initial mode
  }
  this.updateRacking(true);

  // carrier visualization modes
  this.carrierRange = true;
  document.getElementById('carrierRange').addEventListener('click', event => {
    this.carrierRange = event.target.checked;
    this.update();
  });

  // LOD
  this.lod = -1; // auto
  document.getElementById('knitout-lod').addEventListener('change', event => {
    this.lod = parseInt(event.target.value);
    this.update();
  });

  // mouse information
  this.canvas.addEventListener('mousedown', event => {
    this.startX = event.offsetX;
    this.startY = event.offsetY;
    this.startBedSpaceX = this.bedSpaceX;
    this.startBedSpaceY = this.bedSpaceY;
    this.updatePointer(event);
  });
  this.canvas.addEventListener('mousemove', event => {
    this.clientX = event.clientX;
    this.clientY = event.clientY;
    this.mouseX  = event.offsetX;
    this.mouseY  = event.offsetY;
    this.updatePointer(event);
    this.updateInfo(event);
    // update bed projection
    if(event.buttons && event.shiftKey){
      this.updateBedSpace(
        this.mouseX - this.startX,
        this.mouseY - this.startY
      );
    }
  });
  this.canvas.addEventListener('dblclick', event => {
    if(event.shiftKey){
      this.resetBedSpace();
    }
  });
  this.canvas.addEventListener('mouseout', () => {
    this.tooltip();
  });
  this.canvas.addEventListener('wheel', event => {
    if(!event.ctrlKey && event.shiftKey){
      const delta = Math.sign(event.deltaY);
      if(delta){
        const transform = d3.zoomTransform(this.canvas);
        const newTransform = transform.translate(0,
          -delta * 7 * this.blockSpace / transform.k
        );
        d3.select(this.canvas).call(
          this.zoom.transform, newTransform
        );
      }
    }
  });

  // tooltip
  this.tooltipContainer = util.createElement('div', ['tooltip', 'hidden']);
  container.appendChild(this.tooltipContainer);
}

// ###########################################################################
// ##### State Updates #######################################################
// ###########################################################################

KnitoutLayout.prototype.updatePointer = function(event){
  const { x, y } = this.unproject(event.offsetX, event.offsetY);
  this.sceneX = x;
  this.sceneY = y;
  this.rowValue = this.getRowIndex(y);
  this.rowIndex = Math.round(this.rowValue);
  this.rowIndices = new Set([
    Math.floor(this.rowValue), Math.ceil(this.rowValue)
  ].filter(r => r >= 0 && r < this.blocks.length));
};

KnitoutLayout.prototype.updateInfo = function(/* event */){
  /* XXX figure out information to show and implement it
  if(!event.ctrlKey){
    this.canvas.style.cursor = 'grab';
    this.tooltip();
    return;
  }
  // search for close-by direct action
  for(const rowIdx of this.rowIndices){

  }
  // this.tooltip('htmlText', true);
  this.canvas.style.cursor = 'help';
  */
};

KnitoutLayout.prototype.resetBedSpace = function(){
  this.needleSpace = 10;
  this.blockSpace = this.sides.length * this.needleSpace;
  this.bedSpaceX   = 5;
  this.bedSpaceY   = 8;
  this.startBedSpaceX = this.bedSpaceX;
  this.startBedSpaceY = this.bedSpaceY;
  this.throttledUpdate();
};

KnitoutLayout.prototype.updateBedSpace = function(dx, dy){
  if(!dx && !dy)
    return; // no change here
  this.bedSpaceX = Math.max(-10, Math.min(10,
    this.startBedSpaceX + dx
  ));
  this.bedSpaceY = Math.max(5, Math.min(16,
    this.startBedSpaceY + dy
  ));
  // this.needleSpace = Math.abs(this.bedSpaceX * 2);
  // this.blockSpace  = Math.abs(this.bedSpaceY + 2);
  this.throttledUpdate();
};

KnitoutLayout.prototype.centerLayout = function(){
  const { min, max } = this.needleExtents;
  const height = this.blocks.length;
  const width = max - min + 1;
  const middle = (min + max) * 0.5;
  // find appropriate zoom level
  const zoom = Math.max(
      0.05, Math.min(
      8,
      Math.min(this.canvas.width / (width * this.needleSpace),
               this.canvas.height / (height * this.blockSpace) * 0.9)
  ));
  const newTransform = d3.zoomIdentity.translate(
    this.canvas.width / 2  - middle * this.needleSpace * zoom,
    this.canvas.height / 2 + height * this.blockSpace / 2 * zoom
  ).scale(zoom);
  d3.select(this.canvas)
    .transition()
    .duration(750)
    .call(
        this.zoom.transform,
        newTransform
    );
};

KnitoutLayout.prototype.updateFromContent = function(){
  this.updateExtent();
  this.update(true);
};

KnitoutLayout.prototype.updateSides = function(noUpdate = false){
  this.invertX = this.sides[0] === BACK;
  this.blockSpace = this.sides.length * this.needleSpace;
  if(!noUpdate)
    this.update(true);
};

KnitoutLayout.prototype.updateRacking = function(noUpdate = false){
  if(this.rackingMode === RACK_EXPLICIT){
    this.blocks = this.allBlocks;
    this.states = this.allStates;
  } else {
    assert(this.rackingMode === RACK_SEMI
        || this.rackingMode === RACK_IMPLICIT, 'Unsupported racking mode', this.rackingMode);
    let excludeList; // list of operations to exclude
    if(this.rackingMode === RACK_SEMI){
      excludeList = [ Knitout.RACK ];
    } else {
      assert(this.rackingMode === RACK_IMPLICIT, 'Unsupported racking mode');
      excludeList = [
        Knitout.RACK, Knitout.XFER, Knitout.DROP, Knitout.AMISS
      ];
    }
    const keeps = this.allBlocks.map(blk => {
      return !excludeList.includes(blk.opcode());
    });
    this.blocks = this.allBlocks.flatMap((blk, i) => {
      return keeps[i] ? [ blk.copy() ] : [];
    });
    for(let i = 0; i < this.blocks.length; ++i)
      this.blocks[i].index = i;
    // filter states
    this.states = this.allStates.filter((s, i) => {
      return keeps[i];
    });
  }
  if(!noUpdate)
    this.update(true);
};

/**
 * Update the pan/zoom extents
 */
KnitoutLayout.prototype.updateExtent = function(){
  let minOffset = 0;
  let maxOffset = 0;
  for(const b of this.blocks){
    const { min, max } = b.getNeedleOffsetRange();
    minOffset = Math.min(minOffset, min);
    maxOffset = Math.max(maxOffset, max);
  }
  this.needleExtents = {
    min: minOffset,
    max: maxOffset
  };
  const l = this.getX(minOffset);
  const r = this.getX(maxOffset);
  const w = Math.abs(this.getDX(maxOffset - minOffset));
  const h = Math.abs(this.getDY(this.blocks.length));
  // extents = [ [left, top], [right, bottom] ]
  this.zoom.translateExtent([
    [ Math.min(l - w * 0.5, -50),  Math.min(-h * 1.5, -50) ],
    [ Math.max(r + w * 0.5, 50),    Math.max(h * 0.5, 50) ]
  ]);
};

/**
 * Update the Knitout information.
 * This triggers:
 *
 * 1. Computation of layout blocks
 * 2. Update of the extents
 * 3. Redrawing of the layout
 *
 * @param data the new Knitout file
 * @param reset whether to recenter the layout
 */
KnitoutLayout.prototype.updateData = function(knitout, reset, trace){
  this.knitout = knitout;
  this.trace = trace;
  this.allBlocks = Block.getBlocksFrom(knitout);
  this.allStates = simulateBlocks(this.allBlocks, idx => {
    // return traced stitch if any associated
    if(this.trace){
      const meta = this.knitout.getMetadata(idx);
      if(meta >= 0)
        return this.trace.getTracedStitchAt(meta);
    }
    return null;
  });
  this.updateRacking(true);
  this.updateExtent();
  if(reset)
    this.centerLayout();
  this.update();
};

KnitoutLayout.prototype.throttledUpdate = function(){
  if(Date.now() - this.lastDrawTime > minDrawFreq){
    this.update();
    // console.log('z update');
  } else {
    // console.log('z postpone');
    clearTimeout(this.redrawTimeout);
    this.redrawTimeout = setTimeout(() => {
      this.update();
    }, minDrawFreq);
  }
};

/**
 * Update the layout rendering
 */
KnitoutLayout.prototype.update = function(highQuality = false) {
  // remove any redraw timeout
  clearTimeout(this.redrawTimeout);
  clearTimeout(this.finalTimeout);
  this.lastDrawTime = Date.now();
  if(!highQuality){
    this.finalTimeout = setTimeout(() => {
      this.update(true); // post redraw with noTrace=true
    }, minDrawFreq * 2);
  }
  // update size
  const w = this.canvas.clientWidth;
  let h = this.canvas.clientHeight;
  if(h === 0){
    h = this.canvas.parentNode.clientHeight;
  }
  if(w != this.width || h != this.height){
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
  }

  // get transform for pan/zoom
  const transform = d3.zoomTransform(this.canvas);
  this.transform = transform;

  // update viewport information
  const { x: left, y: top } = this.unproject(0, 0);
  const { x: right, y: bottom } = this.unproject(this.width, this.height);
  let minOffset = Infinity, maxOffset = -Infinity;
  for(let off = this.needleExtents.min; off <= this.needleExtents.max; ++off){
    if(this.isOffsetHidden(off))
      continue;
    minOffset = Math.min(off, minOffset);
    maxOffset = Math.max(off, maxOffset);
  }
  this.viewport = {
    // boundaries in data space
    top, bottom, left, right,
    // offsets boundaries
    minOffset, maxOffset,
    leftOffset:   this.invertX ? maxOffset : minOffset,
    rightOffset:  this.invertX ? minOffset : maxOffset
  };

  // clear background
  this.context.save();
  this.context.fillStyle = '#FFF0F0'; //  + (highQuality ? 'FF' : 'CC'); // temporal blur
  this.context.fillRect(0, 0, this.width, this.height);

  // draw warning/error messages
  // this.drawPreText(transform.k);

  // apply transformation to contexts
  this.context.translate(transform.x, transform.y);
  this.context.scale(transform.k, transform.k);

  // draw actual layout
  this.draw(transform.k, highQuality);

  // restore previous transformation
  this.context.restore();

  // draw extra static text information on top
  // this.drawPostText(transform.k);
};

// ###########################################################################
// ##### Transformations #####################################################
// ###########################################################################

KnitoutLayout.prototype.getDY = function(dt){
  return -dt * this.blockSpace;
};
KnitoutLayout.prototype.getY = function(time, side = 0){
  return -time * this.blockSpace - side * this.bedSpaceY;
};
KnitoutLayout.prototype.getRowIndex = function(y, side = 0){
  return -(y + side * this.bedSpaceY) / this.blockSpace;
};
KnitoutLayout.prototype.getDX = function(offset){
  return this.invertX ? -offset * this.needleSpace : offset * this.needleSpace;
};
KnitoutLayout.prototype.getX = function(index, side = 0, racking = 0){
  if(this.invertX){
    // should map needleExtents.min to nedleExtents.max and back
    const { min, max } = this.needleExtents;
    // min -> max
    // max -> min
    const off = index - min;
    // max - off =>
    //   i = min => max - min + min = max
    //   i = max => max - max + min = min
    index = max - off;
  }
  if(racking && this.rackingMode === RACK_EXPLICIT && this.sides[side] === BACK){
    if(this.invertX)
      index -= racking;
    else
      index += racking;
  }
  if(this.sides.length > 1)
    return index * this.needleSpace + side * this.bedSpaceX;
  else
    return index * this.needleSpace;
};

KnitoutLayout.prototype.getPosition = function(time, index, side = 0, racking = 0){
  return { x: this.getX(index, side, racking), y: this.getY(time, side) };
};
/**
 * From mouse coordinates to bed index and time
 */
KnitoutLayout.prototype.getMouseIndexAndTime = function(mouseX, mouseY){
  // const transform = d3.zoomTransform(this.canvas);
  const transform = this.transform;
  const mouseIndex = (mouseX - transform.x) / transform.k / this.needleSpace;
  const mouseTime = -(mouseY - transform.y) / transform.k / this.blockSpace;
  return { mouseIndex, mouseTime };
};

KnitoutLayout.prototype.project = function(x, y){
  const transform = d3.zoomTransform(this.canvas);
  return { x: x * transform.k + transform.x, y: y * transform.k + transform.y };
};

KnitoutLayout.prototype.unproject = function(sx, sy){
  const transform = this.transform;
  return {
    x: (sx - transform.x) / transform.k,
    y: (sy - transform.y) / transform.k
  };
};

KnitoutLayout.prototype.isOffsetHidden = function(offset, side = 0, racking = 0){
  const px = this.getX(offset, side, racking);
  return px < this.viewport.left || px > this.viewport.right;
  // const sx = px * this.transform.k + this.transform.x;
  // return sx < 0 || sx > this.width;
};

KnitoutLayout.prototype.isBlockHidden = function(blkIndex, side = 0){
  const py = this.getY(blkIndex, side);
  return py < this.viewport.top || py > this.viewport.bottom;
  // const sy = py * this.transform.k + this.transform.y;
  // return sy < 0 || sy > this.height;
};

KnitoutLayout.prototype.isHidden = function(px, py, radius){
  if(radius){
    return this.isHidden(px - radius, py - radius)
        && this.isHidden(px - radius, py + radius)
        && this.isHidden(px + radius, py - radius)
        && this.isHidden(px + radius, py + radius);
  }
  return px < this.viewport.left
      || px > this.viewport.right
      || py < this.viewport.top
      || py > this.viewport.bottom;
  /*
  const screenPos = this.project(px, py);
  return screenPos.x < 0
      || screenPos.y < 0
      || screenPos.x > this.width
      || screenPos.y > this.height;
  */
};

// ###########################################################################
// ##### Drawing #############################################################
// ###########################################################################

KnitoutLayout.prototype.getLOD = function(zoom, hq){
  let lod;
  if(this.lod === -1)
    lod = zoom >= 3 ? 2 : zoom >= 1 ? 1 : 0;
  else
    lod = this.lod;
  // downgrade one level when not high-quality
  return Math.max(0, lod + (hq ? 0 : -1));
};

KnitoutLayout.prototype.draw = function(zoom, hq = false){
  const lod = this.getLOD(zoom, hq);
  const ctx = this.context;
  // const k = this.knitout;
  const { min, max } = this.needleExtents;
  const height = this.blocks.length;

  // draw row background
  if(lod > 0){
    const minRow = Math.max(0,
      Math.floor(this.getRowIndex(this.viewport.bottom))
    );
    const maxRow = Math.min(this.blocks.length - 1,
      Math.ceil(this.getRowIndex(this.viewport.top))
    );
    for(let rowIdx = minRow; rowIdx <= maxRow; ++rowIdx){
      this.drawRowBackground(ctx, rowIdx);
    }
  }

  // draw needle grid
  for(let s = 0; s < this.sides.length; ++s){
    ctx.beginPath();
    ctx.lineWidth = 2;
    const bot = this.getY(0, s);
    const top = this.getY(height, s);
    for(let i = min; i <= max; ++i){
      const x = this.getX(i, s);
      ctx.moveTo(x, bot);
      ctx.lineTo(x, top);
    }
    if(s){
      ctx.strokeStyle = '#00000011';
    } else {
      ctx.strokeStyle = '#00000022';
    }
    ctx.stroke();
  }

  // draw blocks one after the other
  for(const block of this.blocks){
    // skip block if out of the viewport
    if(this.isBlockHidden(block.index))
      continue;

    // draw flow from previous to current bed
    if(!this.isBlockHidden(block.index - 1))
      this.drawFlow(ctx, block, lod);

    // draw bed occupancy
    this.drawBedOccupancy(ctx, block, lod);

    // draw direction annotation
    this.drawDirection(ctx, block, lod);

    // draw carriers end location
    this.drawCarriers(ctx, block, lod);

    // type of block
    const op = block.opcode();

    // type-based drawings
    if(block.length === 1){
      // special cases
      switch(block.opcode()){

        case Knitout.NOOP:
          this.drawNoop(ctx, block, lod);
          break;

        case Knitout.IN:
        case Knitout.INHOOK:
          this.drawYarnIn(ctx, block, lod);
          break;

        case Knitout.RELEASEHOOK:
          this.drawYarnRelease(ctx, block, lod);
          break;

        case Knitout.OUTHOOK:
        case Knitout.OUT:
          this.drawYarnOut(ctx, block, lod);
          break;

        case Knitout.RACK:
          this.drawRacking(ctx, block, lod);
          break;

        case Knitout.PAUSE:
          this.drawPause(ctx, block, lod);
          break;

        default:
          if(Knitout.OP_HAS_NEEDLE[op]){
            this.drawActions(ctx, block, lod);
          }
          break;
      }
    } else if(block.length > 1){
      // generic action drawing
      if(Knitout.OP_HAS_NEEDLE[op])
        this.drawActions(ctx, block, lod);
    }

    // abort if too much time taken (and NOT in high quality mode)
    // and try redrawing later
    // XXX is this actually safe? may not!
    if(!hq){
      if(Date.now() - this.lastDrawTime > maxDrawDuration){
        this.redrawTimeout = setTimeout(() => {
          this.update();
        }, minDrawFreq);
        break;
      }
    }
  } // endfor i < length
  const duration = Date.now() - this.lastDrawTime;
  return duration;
};

KnitoutLayout.prototype.drawRowBackground = function(ctx, rowIdx){
  if(rowIdx % 2)
    return; // use background color
  // interleaved background
  const rowY = this.getY(rowIdx, this.sides.length > 1 ? 0.5 : 0);
  const h = this.blockSpace;
  ctx.beginPath();
  ctx.rect(
    this.viewport.left, rowY - h * 0.5,
    this.viewport.right - this.viewport.left, h
  );
  // red/blue = '#FFEDEA' / '#FAEFFF'
  // bg/white = '#fff0f0' / '#FFFAFA'
  ctx.fillStyle = '#FFF6F6';
  ctx.fill();
};

KnitoutLayout.prototype.drawDirection = function(ctx, block /* , lod */){
  // interleaved background
  const rowY = this.getY(block.index, this.sides.length > 1 ? 0.5 : 0);
  const h = this.blockSpace;
  const dir = block.direction;
  if(dir === Knitout.NONE){
    const op = block.opcode();
    let label = '';
    let color;
    switch(op){
      case Knitout.RACK:
        label = 'R';
        color = RACK_COLOR;
        break;

      case Knitout.DROP:
      case Knitout.AMISS:
      case Knitout.XFER:
        label = 'X';
        color = XFER_COLOR;
        break;

      default:
        return; // do not show anything
    }
    assert(label.length, 'Invalid state', label, op, block);

    // sizing
    const font = this.sides.length > 1 ? '16px Arial' : '8px Arial';
    const dfy = this.sides.length > 1 ? 5.5 : 2.5;

    // draw label on both sides
    const cy = rowY + dfy;
    draw.highlightText(ctx, label, this.viewport.left + 15, cy, color + '99', color, font);
    draw.highlightText(ctx, label, this.viewport.right - 15, cy, color + '99', color, font);

  } else {

    // side direction depends on side
    const sdir = this.invertX ? Knitout.OTHER_DIR[dir] : dir;

    // arrow
    const px = sdir === Knitout.RIGHT ? this.viewport.left : this.viewport.right;
    ctx.beginPath();
    const cy = rowY;
    // with alpha:
    // left = '#9944FF44' => '#E4C2F4'
    // right = '#FF996644' => '#FFD9CB'
    ctx.fillStyle = dir === Knitout.RIGHT ? '#FF996644' : '#9944FF44'; // color is based on base direction
    ctx.moveTo(px, cy - h / 2);
    ctx.lineTo(px + sdir * 20, cy - h / 2);
    ctx.lineTo(px + sdir * 30, cy);
    ctx.lineTo(px + sdir * 20, cy + h / 2);
    ctx.lineTo(px, cy + h / 2);
    // ctx.lineTo(px, cy - h / 2);
    ctx.closePath();
    ctx.fill();
  }
};

KnitoutLayout.prototype.drawNoop = function(ctx, block /*, lod */){
  const ptr = block.pointer();
  const comment = this.knitout.getComment(ptr);
  this.drawLabelLine(ctx, this.getY(block.index), comment);
};

KnitoutLayout.prototype.drawPause = function(ctx, block){
  const ptr = block.pointer();
  const comment = this.knitout.getComment(ptr) || '';
  const extra = comment.length ? ' (' + comment + ') ' : ' ';
  this.drawLabelLine(ctx, this.getY(block.index), '-- pause' + extra + '--');
};

KnitoutLayout.prototype.drawLabelLine = function(ctx, cy, text){
  // draw separator line
  const l = this.viewport.left; // - this.transform.x / this.transform.k;
  const r = this.viewport.right; // (this.width - this.transform.x) / this.transform.k;
  ctx.beginPath();
  ctx.moveTo(l, cy);
  ctx.lineTo(r, cy);
  ctx.strokeStyle = '#FFF';
  ctx.stroke();
  if(text && text.length){
    const cx = (this.viewport.left + this.viewport.right) * 0.5; // (this.width / 2 - this.transform.x) / this.transform.k;
    draw.centeredText(ctx, text, cx, cy + this.blockSpace / 2);
  }
};

KnitoutLayout.prototype.drawCarriers = function(ctx, block, lod){
  if(!this.carrierRange || lod < 1 || block.index <= 0)
    return;
  // show carrier range
  const by = this.getY(block.index);
  const cy = by - (this.sides.length > 1 ? this.bedSpaceY * 0.5 : 0);
  const h = this.blockSpace / 2;
  const dy = h / Math.max(1, block.carriers.length - 1);
  const dx = this.sides.length > 1 ? this.bedSpaceX * 0.5 : 0;
  const labelFuns = [];
  // const prevState = this.states[block.index - 1];
  const currState = this.states[block.index];
  for(let i = 0; i < block.carriers.length; ++i){
    const cname = block.carriers[i];
    const [n, cdir] = currState.mapCarrier(cname, c => {
      return [c.needle, c.side];
    }, []);
    if(!n || !Number.isFinite(n.offset))
      continue; // carrier disappears in this block
    const d = this.invertX ? -cdir : cdir;
    const cx = this.getX(n.offset) + dx;
    const y = cy + (block.carriers.length === 1 ? 0 : h * 0.5 - dy * i);
    // draw approximate direction
    ctx.beginPath();
    // ctx.strokeStyle = this.getYarnColor(cname);
    ctx.fillStyle = this.getYarnColor(cname) + '66';
    draw.arrowTriangle(ctx, { x: cx, y }, { x: d, y: 0 }, h);
    // ctx.stroke();
    ctx.fill();
    // draw staggered name on arrow branch
    labelFuns.push(() => {
      draw.highlightText(ctx, cname,
        cx + d * h * 2 + (i % 2) * 10 - h * 0.5,
        y + 4,
        null, null, '12px Arial'
      );
    });
  }
  for(const labelFun of labelFuns)
    labelFun();
};

KnitoutLayout.prototype.getYarnColor = function(cname){
  return getDeviceInfo(cname, 'color', '#FF0000');
};

KnitoutLayout.prototype.drawYarnFun = function(ctx, block, drawFun){
  const cy = this.getY(block.index);
  const h = this.blockSpace / 2;
  const dy = h / Math.max(1, block.carriers.length - 1);
  const r = this.viewport.right;
  const labelFuns = [];
  for(let i = 0; i < block.carriers.length; ++i){
    const cname = block.carriers[i];
    ctx.beginPath();
    ctx.strokeStyle = this.getYarnColor(cname);
    const y = cy + (block.carriers.length === 1 ? 0 : h * 0.5 - dy * i);
    drawFun(r, y, h);
    // draw staggered name on arrow branch
    labelFuns.push(() => {
      draw.highlightText(ctx, cname, r - 20 + (i % 2) * 10, y + 4, null, null, '12px Arial');
    });
  }
  for(const labelFun of labelFuns)
    labelFun();
};

KnitoutLayout.prototype.drawYarnIn = function(ctx, block /*, lod */){
  this.drawYarnFun(ctx, block, (r, y, h) => {
    ctx.moveTo(r, y);
    ctx.lineTo(r - 30, y);
    draw.arrowHead(ctx, { x: r - 30, y }, { x: 1, y: 0 }, h);
    ctx.stroke();
  });
};

KnitoutLayout.prototype.drawYarnRelease = function(ctx, block /*, lod */){
  this.drawYarnFun(ctx, block, (r, y, h) => {
    ctx.moveTo(r, y);
    ctx.lineTo(r - 30, y);
    draw.arrowHead(ctx, { x: r - 30, y }, { x: 1, y: 0 }, h);
    draw.arrowHead(ctx, { x: r - 30, y }, { x: -1, y: 0 }, h);
    ctx.stroke();
  });
};

KnitoutLayout.prototype.drawYarnOut = function(ctx, block /*, lod */){
  this.drawYarnFun(ctx, block, (r, y, h) => {
    ctx.moveTo(r - 30, y);
    ctx.lineTo(r, y);
    draw.arrowHead(ctx, { x: r, y }, { x: -1, y: 0 }, h);
    ctx.stroke();
  });
};

KnitoutLayout.prototype.isNeedleVisible = function(n, racking = 0){
  const side = n.side.charAt(0);
  const s = this.sides[0] === side ? 0 : 1; // the index within this.sides
  return this.sides.includes(side)
      && !this.isOffsetHidden(n.offset, s, racking);
};

KnitoutLayout.prototype.drawYarnPath = function(ctx, block, lod, s){
  if(lod <= 0)
    return; // no yarn visible at all
  if(s > 0 && lod < 2)
    return; // not visible at this level
  const alpha = s ? '99' : '';
  const nidx = 2;
  const h = this.blockSpace / 2;
  const racking = block.racking;
  const dy = h / Math.max(1, block.carriers.length - 1);
  // bed states
  const currState = this.states[block.index];
  const prevState = this.states[block.index - 1];
  // first action needle
  const opc = block.opcode();
  const n0 = block.firstNeedle();
  // for each carrier
  for(let i = 0; i < block.carriers.length; ++i){
    const cname = block.carriers[i];
    const dyi = block.carriers.length === 1 ? 0 : h * 0.5 - dy * i;
    // draw sides separately (for alpha)
      
    ctx.beginPath();
    ctx.strokeStyle = this.getYarnColor(cname) + alpha;
    ctx.lineJoin = draw.adaptiveLineJoin(lod);
    // previous needle and its location
    let pn;
    let pv = false;
    let pcy, px;
    if(n0 && opc !== Knitout.MISS){
      // knit/tuck or split
      // => get loop and look for previous previous loops
      const loops = currState.getNeedleLoops(n0);
      pastNeedleLoop:
      for(const loop of loops){
        if(!loop.cs.includes(cname)
        || !loop.previous.length)
          continue; // not related to this yarn carrier, or no past
        // found previous locations
        for(const ploop of loop.previous){
          pn = prevState.getLoopNeedle(ploop);
          if(pn){
            break pastNeedleLoop;
          }
        } // endfor ploop of loop.previous
      } // endfor loop of loops
      if(pn){
        const ns = pn.side.charAt(0) === this.sides[0] ? 0 : 1;
        pcy = this.getY(block.index - 1, ns) + dyi;
        px = this.getX(pn.offset, ns, racking);
        const thisSide = ns === s;
        pv = thisSide && this.isNeedleVisible(pn, racking);
        ctx.moveTo(px, pcy);
      } // endif pn
    } // endif n0 && not starting with a miss
    for(const entry of block.actions){
      const n = entry[nidx];
      assert(n instanceof Knitout.Needle, 'No needle found', entry);
      const ns = n.side.charAt(0) === this.sides[0] ? 0 : 1;
      const cy = this.getY(block.index, ns) + dyi;
      const x = this.getX(n.offset, ns, racking);
      const thisSide = ns === s;
      const cv = thisSide && this.isNeedleVisible(n, racking);

      // draw action depends on prev/curr visibility
      if(pv){
        if(cv){
          // full path
          ctx.lineTo(x, cy);

        } else {
          // first-half of path
          ctx.lineTo((px + x) * 0.5, (pcy + cy) * 0.5);
          ctx.moveTo(x, cy);
        }
      } else if(pn && cv){
        // second half of path
        ctx.moveTo((px + x) * 0.5, (pcy + cy) * 0.5);
        ctx.lineTo(x, cy);

      } else {
        // no path
        ctx.moveTo(x, cy);
      }

      // remember past needle location
      pn = n;
      pcy = cy;
      px = x;
      pv = cv;
    }
    ctx.stroke();
  } // endfor 0 <= i < #carriers
};

KnitoutLayout.prototype.drawActions = function(ctx, block, lod){
  // constants
  const r = this.needleSpace / 3;

  // Actions with direction + carriers:
  // - knit d n cs
  // - tuck d n cs
  // - miss d n cs
  // - split d n n2 cs
  //
  // Actions without:
  // - drop n
  // - amiss n
  // - xfer n n2
  //
  const bop = block.opcode();
  const racking = block.racking;
  const withCarriers = Knitout.OP_HAS_CARRIERS[bop];
  const nidx = withCarriers ? 2 : 1;
  const prevState = this.states[block.index - 1];
  // action pass (from back to front)
  for(let s = this.sides.length - 1; s >= 0; --s){
    const alpha = s ? '99' : '';
    if(withCarriers){
      // yarn path drawn in between the two sides
      if(s === 0){
        // back yarn first
        if(this.sides.length > 1)
          this.drawYarnPath(ctx, block, lod, 1);
        // front yarn second
        this.drawYarnPath(ctx, block, lod, 0);
      }
      ctx.beginPath(); // single path for carriers
    }
    ctx.lineJoin = draw.adaptiveLineJoin(lod);
    for(const entry of block.actions){
      const n = entry[nidx];
      const n2 = entry[nidx + 1] instanceof Knitout.Needle ? entry[nidx + 1] : null;
      assert(n instanceof Knitout.Needle, 'No needle found', entry);

      // only consider visible needle actions
      if(!this.isNeedleVisible(n, racking) // first needle is not visible
      && (!n2 || !this.isNeedleVisible(n2, racking)) // no second needle, or that one is not visible either
      ){
        continue;
      }
      // /!\ n.side cannot be on a slider for real actions
      //     but it may for actions without carrier (e.g. transfer)
      const op = entry[0];
      const ns = n.side.charAt(0) === this.sides[0] ? 0 : 1;
      if(ns !== s
      && (!n2 || this.sides.length === 2) // two needles => one is visible
      ){
        // /!\ note: we accept two-needle actions from the wrong side if showing only one side
        //     since these are still involving the other side => should visualize
        continue; // wrong pass
      }
      const cy = this.getY(block.index, s);
      const x = this.getX(n.offset, s, racking);
      switch(op){

        // actions with direction (and carriers)
        case Knitout.KNIT: draw.adaptiveKnit(ctx, x, cy, r, lod); break;
        case Knitout.TUCK: draw.adaptiveTuck(ctx, x, cy, r, lod); break;
        case Knitout.MISS: draw.adaptiveMiss(ctx, x, cy, r, lod); break;
        case Knitout.SPLIT: {
          // draw potentially two needles (second smaller)
          const n2 = entry[3];
          assert(n2 instanceof Knitout.Needle, 'Invalid split operation');

          // check whether we should show the second needle
          // which is always on the other side
          if(this.isNeedleVisible(n2, racking)){
            const ns2 = n2.side.charAt(0) === this.sides[0] ? 0 : 1;
            const x2 = this.getX(n2.offset, ns2, racking);
            const y2 = this.getY(block.index, ns2);
            draw.adaptiveKnit(ctx, x2, y2, r * 0.6, lod);
          }
          // also check for first needle, since it may not be visible (in case n2 was)
          if(this.isNeedleVisible(n, racking))
            draw.adaptiveKnit(ctx, x, cy, r, lod);
        } break;

        // actions without carrier or direction
        case Knitout.DROP: {
          const alfa = prevState.isEmpty(n) ? '33' : alpha;
          ctx.beginPath();
          ctx.strokeStyle = DROP_COLOR + alfa;
          draw.adaptiveDrop(ctx, x, cy, r, lod);
          ctx.stroke();
        } break;
        case Knitout.AMISS: {
          ctx.beginPath();
          ctx.strokeStyle = AMISS_COLOR + alpha;
          draw.adaptiveAmiss(ctx, x, cy, r, lod);
          ctx.stroke();
        } break;
        case Knitout.XFER: {
          const alfa = prevState.isEmpty(n) ? '33' : alpha;
          ctx.beginPath();
          ctx.strokeStyle = XFER_COLOR + alfa;
          // get side index of second needle
          const ns2 = n2.side.charAt(0) === this.sides[0] ? 0 : 1;
          // two cases depending on whether two-sided or not
          if(this.sides.length > 1){
            // two-sided case
            // => we need the second needle
            const x2 = this.getX(n2.offset, ns2, racking);
            const y2 = this.getY(block.index, ns2);
            // draw full arrow connection
            draw.arrowLine(ctx, { x, y: cy }, { x: x2, y: y2 }, r, 'middle');

          } else {
            // single-sided case
            let xs, dy;
            if(ns === 0){
              // from the visible side
              // => show at source
              xs = x;
              dy = -1;
            } else {
              assert(ns === 1, 'Invalid state', ns);
              // from the wrong side
              // => show at destination
              xs = this.getX(n2.offset, ns2, racking);
              dy = 1;
            }
            draw.arrow(ctx, { x: xs, y: cy }, { x: 0, y: dy }, r);
          }
          ctx.stroke();
        } break;

      }
    }
    if(withCarriers){
      ctx.strokeStyle = '#000000' + alpha;
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF' + alpha;
      ctx.fill();
    }
  }
};

KnitoutLayout.prototype.drawRacking = function(ctx, block /*, lod */){
  // draw bed extents
  const s = this.sides.length === 1 || this.sides[0] === BACK ? 0 : 1;
  const y = this.getY(block.index, s);
  const preRacking = block.racking;
  const newRacking = block.actions[0][1];
  const shift = newRacking - preRacking;
  extents: {
    const h = this.blockSpace * 0.3;
    const l = this.getX(this.needleExtents.min, s) + this.getDX(newRacking);
    const r = this.getX(this.needleExtents.max, s) + this.getDX(newRacking);
    ctx.beginPath();
    ctx.fillStyle = RACK_COLOR + '44';
    draw.rect(ctx, l, y - h, r - l, 2 * h);
    ctx.fill();
  }

  // only show the racking arrow if the back bed is visible
  // if(!this.sides.includes(BACK))
    // return;

  // if the shift is non-zero, we show it with arrow(s)
  if(shift === 0)
    return; // that's unexpected ...
  const offsetWidth = Math.abs(shift);
  const h = this.needleSpace / 3;
  const margin = 4;
  ctx.beginPath();
  ctx.strokeStyle = RACK_COLOR;
  if(this.viewport.rightOffset < this.viewport.leftOffset){
    // show single racking, independent from offsets
    const l = this.viewport.left + 50;
    const r = l + this.getDX(offsetWidth);
    const xs = shift > 0 ? l : r;
    const xe = shift > 0 ? r : l;
    draw.arrowLine(ctx, { x: xs, y }, { x: xe, y }, h, 'middle');

  } else {
    // show on the left side
    left: {
      const l = this.getX(this.viewport.leftOffset + 3);
      const r = l + this.getDX(offsetWidth);
      const xs = shift > 0 ? l : r;
      const xe = shift > 0 ? r : l;
      draw.arrowLine(ctx, { x: xs, y }, { x: xe, y }, h, 'middle');
    }

    // show on the right side, if not in conflict
    if(this.viewport.leftOffset + offsetWidth + margin < this.viewport.rightOffset){
      const r = this.getX(this.viewport.rightOffset - 2);
      const l = r - this.getDX(offsetWidth);
      const xs = shift > 0 ? l : r;
      const xe = shift > 0 ? r : l;
      draw.arrowLine(ctx, { x: xs, y }, { x: xe, y }, h, 'middle');
    }
  }
  ctx.stroke();
};

KnitoutLayout.prototype.drawBedOccupancy = function(ctx, block, lod){
  if(lod < 1)
    return; // skip if very coarse
  const state = this.states[block.index];
  const r = this.needleSpace / 6;
  const racking = block.endRacking();
  for(const [side, nb] of state.beds){
    const s = side.charAt(0) === this.sides[0] ? 0 : 1;
    if(s >= this.sides.length)
      continue; // skip other side if not visible

    const cy = this.getY(block.index, s);
    // visualize ocuppied needles (with number of loops)
    for(const offset of nb.offsetKeys()){
      if(this.isOffsetHidden(offset, s, racking))
        continue;
      const cx = this.getX(offset, s, racking);
      ctx.beginPath();
      if(side.length === 1){
        // normal bed side
        ctx.fillStyle = '#ccc';
        ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
      } else {
        // slider bed side
        ctx.strokeStyle = '#aaa';
        ctx.strokeRect(cx - r, cy - r, 2 * r, 2 * r);
      }
    } // endfor offset of nb.offsetKeys()
  } // endfor [side, nb] of state.beds
};

KnitoutLayout.prototype.drawFlow = function(ctx, block, lod){
  if(lod < 1)
    return; // skip if not detailed
  const currState = this.states[block.index];
  const prevState = this.states[block.index - 1];
  if(!prevState)
    return; // no flow

  // two passes:
  // - for action loops (LOD 1+)
  // - for other loops  (LOD 2+)

  // active loops
  ctx.beginPath();
  ctx.strokeStyle = colors.waleColor() + 'CC';
  ctx.setLineDash([]);
  const cy0 = this.getY(block.index);
  const racking = block.endRacking();
  for(const [actIdx, action] of block.actions.entries()){
    const opc = action[0];
    if(opc !== Knitout.KNIT && opc !== Knitout.SPLIT)
      continue; // no useful active past
    for(const n of block.needlesOf(actIdx)){
      if(n.side !== this.sides[0])
        continue; // does not match side
      if(this.isOffsetHidden(n.offset, 0, racking))
        continue; // is hidden
      // get corresponding loop
      const loops = currState.getNeedleLoops(n);
      assert(loops.length === 1,
        'Actions produce at most one loop per needle');
      const loop = loops[0];
      if(!loop)
        continue;

      // visualize the past of an active loop
      const pns = [];
      if(loop.data){
        // flow through stitch wales
        for(const pts of loop.data.getPrevWales()){
          // find previous loop
          const n = prevState.findLoopNeedle(ploop => {
            return ploop.data && pts.matches(ploop.data);
          });
          if(n)
            pns.push(n);
        } // endfor pts
      }
      if(true /* !pns.length */){
        // flow comes directly from loop connectivity
        for(const prevLoop of loop.parents){
          const n = prevState.getLoopNeedle(prevLoop);
          if(n)
            pns.push(n);
        }
      }

      const cx0 = this.getX(n.offset, 0, racking);
      for(const pn of pns){
        ctx.moveTo(cx0, cy0);
        // side of previous loop
        const s = pn.side.charAt(0) === this.sides[0] ? 0 : 1;
        // target
        const cx1 = this.getX(pn.offset, s, racking);
        const cy1 = this.getY(block.index - 1, s);
        ctx.lineTo(cx1, cy1);
      }
    } // endfor n of action's needles
  } // endfor [actIdx, action] of block.actions.entries()
  ctx.stroke();

  // passive / suspended loops
    if(lod < 2)
      return;
  const dw = this.trace ? 5 : 3;
  ctx.beginPath();
  ctx.setLineDash([dw, dw]);
  for(const [side, nb] of currState.beds){
    // only draw flow for the first side
    if(side !== this.sides[0])
      continue;
    // visualize flow (depends on loop formation)
    for(const [offset, loops] of nb.offsetEntries()){
      if(this.isOffsetHidden(offset, 0, racking))
        continue;
      const cx0 = this.getX(offset, 0, racking);
      // potential tracing for each loop
      for(const loop of loops){
        // visualize suspended cases
        if(!prevState.hasLoop(loop))
          continue; // not suspended

        // flow for loop transfer (or no-transfer)
        const pn = prevState.getLoopNeedle(loop);
        ctx.moveTo(cx0, cy0);
        const s = pn.side.charAt(0) === this.sides[0] ? 0 : 1;
        const cx1 = this.getX(pn.offset, s, racking);
        const cy1 = this.getY(block.index - 1, s);
        ctx.lineTo(cx1, cy1);
      } // endfor loop of loops
    } // endfor [offset, loops] of nb
  } // endfor [side, nb]
  ctx.stroke();
  ctx.setLineDash([]);
};

// ###########################################################################
// ##### Tooltip #############################################################
// ###########################################################################

KnitoutLayout.prototype.tooltip = function(message, html){
  const t = this.tooltipContainer;

  // clear current tooltip
  t.classList.add('hidden');

  // clear content
  while(t.firstChild)
    t.removeChild(t.firstChild);

  // clear pending timeout
  const timeout = t.getAttribute('data-timeout');
  clearTimeout(timeout);

  // potentially trigger new tooltip
  if(message){
    this.showTooltip(message, html);
    // timeout = setTimeout(() => {
      // this.showTooltip(message, html);
    // }, );
    // t.setAttribute('data-timeout', timeout);
  }
};

KnitoutLayout.prototype.showTooltip = function(message, html){
  const t = this.tooltipContainer;
  if(html)
    t.innerHTML = message;
  else
    t.textContent = message;

  // make visible near mouse
  t.classList.remove('hidden');
  const width = t.offsetWidth + 4;
  const height = t.offsetHeight + 4;
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;
  const margin = 20;

  // positioning
  if((winWidth - this.clientX) < width + margin){
    t.style.left = (winWidth - width - margin) + 'px';
  } else {
    t.style.left = (this.clientX + margin) + 'px';
  }
  if((winHeight - this.clientY) < height + margin){
    t.style.top = (winHeight - height - margin) + 'px';
  } else {
    t.style.top = (this.clientY + margin) + 'px';
  }
};

// ###########################################################################
// ##### Exports #############################################################
// ###########################################################################

function drawKnitout(knitout, reset, trace = null){
  initKnitoutLayout();
  layout.updateData(knitout, reset, trace);
}

function initKnitoutLayout(){
  if(!layout){
    const canvas = document.getElementById('output-knitout');
    layout = new KnitoutLayout(canvas);
    // initial zoom stuff
    setTimeout(() => {
      layout.centerLayout();
    }, 500);

    // update upon outputs change
    env.addOutputListener(outputs => {
      const { source, index } = env.getSelectedOutput();
      /*
      let index = 0;
      if(outputs.length > 1){
        // select part depending on editor choice
        const target = document.getElementById('knitout_target').value;
        if(target.indexOf('_') != -1){
          index = parseInt(target.split('_')[1]) || 0;
        }
      }
      */
      const traces = source === 'Sketch' ? getTraces() || [] : [];
      layout.updateData(outputs[index], true, traces[index]);
    });
  }
}

function refreshKnitoutLayout(){
  if(!layout.canvas.width){
    layout.updateFromContent();
  }
}

module.exports = {
  initKnitoutLayout,
  refreshKnitoutLayout,
  drawKnitout,

  FRONT, BACK
};
