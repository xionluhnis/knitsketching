// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchObject = require('./object.js');
const Transform = require('./transform.js');
const assert = require('../assert.js');
const SketchLayer = require('../algo/compiler/layers/base.js');
const geom = require('../geom.js');
const draw = require('../ui/draw.js');
const Sizing = require('../sizing.js');

// constants
const CRS_STITCH = 'course';
const SR_STITCH  = 'shortrow';
const ANY_STITCH = 'any';
const ANCHOR_STITCHES = [CRS_STITCH, SR_STITCH, ANY_STITCH];
const ANY_PASS   = 'any';
const INIT_PASS  = 'first';
const LAST_PASS  = 'second';
const ANCHOR_PASSES = [ANY_PASS, INIT_PASS, LAST_PASS];

class SketchAnchor extends SketchObject {
  constructor(){
    super();
    // properties
    this.stitchType = CRS_STITCH;
    this.passType   = ANY_PASS;

    // freehand   = (x,y) from transform
    // parametric = (target, segIdx, t) with identity transform
    this.target = null;
    this.p1 = 0;
    this.p2 = 0;

    // cache
    this.lastPos = null;

    // associated grids
    this.grids = [];
  }
  get layerData(){ return this.grids.flatMap(g => g.layerData); }
  hasTarget(){ return this.target != null; }
  hasInvalidTarget(){
    if(!this.target)
      return false;
    // check parenting
    if(this.target.root() !== this.root())
      return true; // invalid parenting
    // check if invalid pcurve
    if(this.target.type === 'pcurve')
      return !this.target.isComplete();
    // else we're valid
    return false;
  }
  isFree(){ return !this.hasTarget(); }
  isConstrained(){ return this.hasTarget(); }
  checkTarget(){
    assert(this.hasTarget(), 'Anchor has no target');
    return this;
  }
  checkFree(){
    assert(this.isFree(), 'Anchor is not free');
    return this;
  }
  get type(){ return 'anchor'; }
  get transform(){
    const { x, y } = this.getPosition();
    return new Transform(x, y, 1);
  }
  set transform(p){
    if(this.isFree()){
      // use displacement to change x/y
      this.setPosition(null, p.x, p.y);

    } else {
      // find closest parametric location within parent
      const minTarget = SketchAnchor.findTarget(this.parent, p);
      if(minTarget.length)
        this.setPosition(...minTarget);
    }
    // else, no valid change!
  }
  static findTarget(sketch, p){
    let minSqDist = Infinity;
    let minTarget = [];
    // search within parent and its children
    for(const curve of [sketch, ...sketch.children]){
      if(!curve.segLength)
        continue;
      for(let segIdx = 0; segIdx < curve.segLength; ++segIdx){
        const seg = curve.getSegment(segIdx);
        if(!seg)
          continue;
        const curveP = curve === this.parent ? p : curve.parentToLocal(p);
        const proj = seg.project(curveP);
        const skProj = curve === this.parent ? proj : curve.localToParent(proj);
        const sqDist = geom.sqDistBetween(skProj, p);
        if(sqDist < minSqDist){
          minSqDist = sqDist;
          minTarget = [curve, segIdx, proj.t];
        }
      }
    }
    return minTarget;
  }

  // generic position
  getPosition(cache = true){
    // check for invalid target
    if(this.hasInvalidTarget()){
      this.target = null;
      if(this.lastPos){
        this.p1 = this.lastPos.x;
        this.p2 = this.lastPos.y;
      } else {
        this.p1 = this.p2 = 0;
      }
      return { x: this.p1, y: this.p2 };
    }
    const cached = p => {
      if(cache)
        this.lastPos = Object.assign({}, p);
      return p;
    };
    // catch freehand variant
    if(!this.target)
      return cached({ x: this.p1, y: this.p2 });
    // parametric
    // => use target, segIdx and t
    const seg = this.target.getSegment(this.p1);
    if(!seg){
      // no segment => use cache
      assert(cache, 'No valid target segment');
      return Object.assign({}, this.lastPos);
    }
    const p = seg.get(this.p2);
    // parent or sibling? => different transforms
    if(this.target.isRoot()){
      // local transform is the identity
      assert(this.target === this.parent,
        'Anchor target is a root sketch, but not its parent');
      return cached(p);

    } else {
      // from target to parent
      assert(this.target.parent === this.parent,
        'Parents do not match');
      return cached(this.target.localToParent(p));
    }
  }
  setPosition(target, p1, p2){
    this.target = target || null;
    this.p1 = p1;
    this.p2 = p2;
    this.lastPos = this.getPosition(false);
    return this;
  }
  makeFree(){
    if(this.isFree())
      return this;
    return this.setPosition(null, this.lastPos.x, this.lastPos.y);
  }
  makeConstrained(){
    if(this.isConstrained())
      return this;
    const minTarget = SketchAnchor.findTarget(
      this.parent, { x: this.p1, y: this.p2 }
    );
    assert(minTarget.length, 'No valid parametric target found');
    return this.setPosition(...minTarget);
  }
  get centroid(){ return { x: 0, y: 0 }; }

  // freehand parameters
  get x(){ return this.checkFree().p1; }
  set x(p1){ this.checkFree().p1 = p1; }
  get y(){ return this.checkFree().p2; }
  set y(p2){ this.checkFree().p2 = p2; }
  // parametric parameters
  get segIdx(){ return this.checkTarget().p1; }
  set segIdx(p1){ this.checkTarget().p1 = p1; }
  get t(){ return this.checkTarget().p2; }
  set t(p2){ this.checkTarget().p2 = p2; }

  serialize(opts = {}){
    return Object.assign(super.serialize(opts), {
      stitchType: this.stitchType,
      passType: this.passType,
      target: this.target ? this.target.id : null,
      p1: this.p1, p2: this.p2, lastPos: this.lastPos,
      grids: this.grids.map(g => g.serialize(opts))
    });
  }
  deserialize(data, map, useID){
    super.deserialize(data, map, useID);
    // load arguments and grids
    this.stitchType = data.stitchType || CRS_STITCH;
    this.passType   = data.passType || ANY_PASS;
    this.target = data.target !== null ? data.target : null;
    this.p1 = data.p1;
    this.p2 = data.p2;
    this.lastPos = data.lastPos;
    this.grids = data.grids.map(gData => {
      return new AnchoredGrid(
        this, gData
      ).deserialize(gData, map, useID);
    });
  }
  remap(map){
    super.remap(map);
    // remap anchor target if any
    if(this.hasTarget())
      this.target = map(this.target);
    // remap any grids
    for(const g of this.grids)
      g.remap(map);
  }
  hitTest(p){ return geom.length(p) <= 10; }
  setParent(parent){
    // if removing from parent
    // then remove constraint first
    if(!parent)
      this.makeFree();
    // then set parent
    super.setParent(parent);
  }

  addGrid(args = {}){
    const grid = new AnchoredGrid(this, args);
    this.grids.push(grid);
    return grid;
  }

  static drawPath(ctx, cx, cy, isFree = true){
    const r = 10 / ctx.getTransform().d; // sy = m22
    // center element
    ctx.beginPath();
    draw.plus(ctx, cx, cy, r/2);

    // rectangle
    if(isFree)
      draw.crect(ctx, cx, cy, r, r);
    else
      draw.octagon(ctx, cx, cy, r);
  }

  drawPath(ctx){
    SketchAnchor.drawPath(ctx, 0, 0, this.isFree());
  }

  draw(ctx, {
    drawLayers = true,
    transform: { k = 1 },
    previewLayers = true
  }){
    if(!drawLayers)
      return;
    this.drawPath(ctx);
    ctx.fillStyle = '#FFFFFF77';
    ctx.fill();
    ctx.lineWidth = 2 / k;
    ctx.strokeStyle = '#999';
    ctx.stroke();

    // preview
    if(!previewLayers)
      return;

    // XXX implement preview
    // if flowData available, then use proper alignment
  }

  getStitchFilter(sketches){
    const rootSketch  = this.root();
    const layerIdx = sketches.indexOf(rootSketch);
    assert(layerIdx !== -1, 'Invalid layer index');
    return stitch => {
      // 1 = test layer
      if(stitch.getLayerIndex() !== layerIdx)
        return false;
      // 2 = test pass type
      if((this.passType === INIT_PASS && stitch.pass === 0)
      || (this.passType === LAST_PASS && stitch.pass === 1))
        return false;
      // 3 = test short-row mode
      const sr = stitch.isShortRow();
      if((sr  && this.stitchType === CRS_STITCH)
      || (!sr && this.stitchType === SR_STITCH))
        return false;
      // valid candidate!
      return true;
    };
  }
  filterStitch(stitch){
    const filter = this.getStitchFilter(stitch.sketches);
    return filter(stitch);
  }
  getClosestStitch(stitchGraph){
    // fixed data
    const filter = this.getStitchFilter(stitchGraph.sketches);
    const anchorPos = this.getPosition();
    // find closest stitch that passes the filter test
    let closestDist = Infinity;
    let closestStitch = null;
    for(const stitch of stitchGraph.stitches()){
      if(!filter(stitch))
        continue; // skip
      const stitchPos = stitch.getPosition();
      const dist = geom.distBetween(stitchPos, anchorPos);
      if(dist < closestDist){
        closestDist = dist;
        closestStitch = stitch;
      }
    }
    return closestStitch;
  }
}

// alignments
const LEFT = 'left';
const RIGHT = 'right';
const CENTER = 'center';
const TOP = 'top';
const BOTTOM = 'bottom';
const ALIGN_X = [LEFT, CENTER, RIGHT];
const ALIGN_Y = [BOTTOM, CENTER, TOP];
const COURSE_AXIS = 'course';
const WALE_AXIS = 'wale';

class AnchoredGrid {
  constructor(anchor, {
    width = '10 stitches', height = '10 stitches',
    xAlign = LEFT, yAlign = BOTTOM, baseAxis = WALE_AXIS
  }){
    this.anchor = anchor;
    // grid properties
    this.width  = width;
    this.height = height;
    this.xAlign = xAlign;
    this.yAlign = yAlign;
    this.baseAxis = baseAxis;
    this.checkTypes();

    // underlying layers
    this.layerData = [];
  }
  get type(){ return 'anchorgrid'; }
  root(){ return this.anchor.root(); }
  checkTypes(){
    assert(AnchoredGrid.isValidInput(this.width, true),
      'Invalid width value or units', this.width);
      assert(AnchoredGrid.isValidInput(this.height),
      'Invalid height value or units', this.height);
    assert(ALIGN_X.includes(this.xAlign),
      'Invalid width alignment', this.xAlign);
    assert(ALIGN_Y.includes(this.yAlign),
      'Invalid height alignment', this.yAlign);
  }
  static isValidInput(str){
    if(typeof str !== 'string')
      return false;
    const u = Sizing.parse(str);
    if(!u || u.value <= 0)
      return false;
    return u.matches('mm', 'stitch', 'course', '%');
  }
  serialize(opts = {}){
    // potentially skip layer data
    const layerData = opts.noLayerData ? [] : this.layerData;
    return {
      anchor: this.anchor.id, type: this.type,
      width: this.width, height: this.height,
      xAlign: this.xAlign, yAlign: this.yAlign,
      baseAxis: this.baseAxis,
      layerData: layerData.map(ld => ld.serialize(opts))
    };
  }
  deserialize(data, map, useID){
    for(const name of [
      'width', 'height',
      'xAlign', 'yAlign',
      'baseAxis'
    ]){
      if(name in data)
        this[name] = data[name];  
    }
    this.layerData = data.layerData.map(ld => {
      return SketchLayer.fromData(this, ld, map, useID);
    });
    return this;
  }
  remap(map){
    for(const ld of this.layerData)
      ld.remap(map);
  }
  delete(){
    const idx = this.anchor.grids.indexOf(this);
    assert(idx !== -1, 'Grid is not in its anchor parent');
    this.anchor.grids.splice(idx);
    this.anchor = null; // disconnect
  }

  getStitchGrid(prog, withStitch = false){
    // create singleton stitch program at anchor
    const stitch = this.anchor.getClosestStitch(prog.graph);
    const indices = stitch ? [stitch.index] : [];
    
    // generate aligned stitch grid
    const xAlign = ALIGN_X.indexOf(this.xAlign) - 1;
    const yAlign = ALIGN_Y.indexOf(this.yAlign) - 1;
    const grid = prog.withIndices(indices).stitchGrid(
      this.width, this.height, {
        xAlign, yAlign, revY: true, baseAxis: this.baseAxis
      }
    );
    return withStitch ? [grid, stitch] : grid;
  }
}

module.exports = Object.assign(SketchAnchor, {
  // classes
  Grid: AnchoredGrid,
  // anchor types
  ANCHOR_STITCHES,
  ANCHOR_PASSES,
  // alignments
  ALIGN_X,
  ALIGN_Y,
  // axes
  WALE_AXIS,
  COURSE_AXIS,
  AXES: [WALE_AXIS, COURSE_AXIS]
});