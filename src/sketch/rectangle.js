// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchObject = require('./object.js');
const Transform = require('./transform.js');
const geom = require('../geom.js');
const assert = require('../assert.js');
const SketchLayer = require('../algo/compiler/layers/base.js');

class SketchRectangle extends SketchObject {
  constructor(){
    super();
    // properties
    this.width   = 10;
    this.height  = 10;
    this.angle   = 0;
    // layers
    this.layerData = [];
  }
  get type(){ return 'rectangle'; }
  get length(){ return 3; }
  get segLength(){ return 0; }
  /*
  get width(){ return this.img.width; }
  set width(w){ this.img.width = w; }
  get height(){ return this.img.height; }
  set height(h){ this.img.height = h; }
  */
  get origin(){ return { x: 0, y: 0 }; }
  get cosa(){ return Math.cos(this.angle); }
  get sina(){ return Math.sin(this.angle); }
  normIndex(idx){
    if(idx < 0)
      idx += this.length;
    if(idx >= this.length)
      idx -= this.length;
    return idx;
  }
  rotate({ x = 0, y = 0 }){
    const { cosa, sina } = this;
    return geom.rotatePoint({ x, y } , { cosa, sina });
  }
  rotateAll(ps){
    assert(Array.isArray(ps), 'Invalid argument, must be an array');
    const { cosa, sina } = this;
    return ps.map(({ x = 0, y = 0 }) => {
      return geom.rotatePoint({ x, y } , { cosa, sina });
    });
  }
  get tl(){ return this.origin; }
  get tr(){ return this.rotate({ x: this.width }); }
  get bl(){ return this.rotate({ y: this.height }); }
  get br(){ return this.rotate({ x: this.width, y: this.height }); }
  get unrotatedPoints(){
    return [
      { x: 0, y: 0 },
      { x: this.width, y: 0 },
      { x: 0, y: this.height }
    ];
  }
  get points(){ return this.rotateAll(this.unrotatedPoints); }
  get extPoints(){
    return this.rotateAll([
      { x: 0, y: 0 },
      { x: this.width, y: 0 },
      { x: this.width, y: this.height },
      { x: 0, y: this.height }
    ]);
  }
  getPoint(index){
    index = this.normIndex(index);
    return this.rotate(this.unrotatedPoints[index]);
  }
  setPoint(index, p){
    index = this.normIndex(index);
    // parameter remapping
    switch(index){
      // translation
      case 0:
        this.setTransform(this.transform.translatedBy(p.x, p.y));
        break;

      // angle and width/height
      case 1:
      case 2: {
        const len = Math.max(1, geom.length(p));
        const drot = [0, -Math.PI / 2][index-1];
        // set new angle
        this.angle = Math.atan2(p.y, p.x) + drot;
        // rescale width and height
        if(index === 1)
          this.width = len;
        else
          this.height = len;
      } break;

      default:
        assert.error('Invalid point index');
        break;
    }
  }
  setFromTriangle(...tri){
    const {
      shift, angle, width, height
    } = SketchRectangle.fromTriangle(...tri);
    this.angle = angle;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.setTransform(shift);
  }
  static getBaseOrder(p0, p1, p, scale = -1){
    let maxArea = -Infinity;
    let maxPair = null;
    for(const [pl, pr] of [
      [p0, p1], [p1, p0]
    ]){
      const sA = scale * geom.signedArea([pl, pr, p]);
      if(sA > maxArea){
        maxArea = sA;
        maxPair = [pl, pr];
      }
    }
    return maxPair;
  }
  static fromTriangle(p0, p1, p2){
    assert(p0 && p1 && p2, 'Missing or invalid argument');
    // get proper tl/br selection from [d0,d1] or [d1,d0]
    // by measuring where p falls
    [p0, p1] = SketchRectangle.getBaseOrder(p0, p1, p2);
    const d01 = geom.axpby(1, p1, -1, p0);
    const dlen = geom.length(d01);
    const width = Math.max(1, dlen);
    const dir = dlen > 1e-2 ? geom.scale(d01, 1/dlen) : { x: 1, y: 0 };
    const height = Math.max(1,
      geom.distToLine(p2, [p0, dir])
    );
    const angle = Math.atan2(d01.y, d01.x) || 0;
    return {
      shift: Transform.from(p0), angle, width, height
    };
  }
  serialize(opts = {}){
    const layerData = opts.noLayerData ? [] : this.layerData;
    return Object.assign(super.serialize(opts), {
      width: this.width,
      height: this.height,
      angle: this.angle,
      layerData: layerData.map(ld => ld.serialize(opts))
    });
  }
  deserialize(data, map, useID){
    super.deserialize(data, map, useID);
    // load image-specific data
    this.width = data.width;
    this.height = data.height;
    this.angle = data.angle;
    assert(this.width > 0
        && this.height > 0
        && typeof this.angle === 'number',
      'Invalid rectangle parameters');
    this.layerData = data.layerData.map(ld => {
      return SketchLayer.fromData(this, ld, map, useID);
    });
  }
  remap(map){
    for(const ld of this.layerData)
      ld.remap(map);
  }
  static fromJSON(data, map, useID){
    const img = new SketchRectangle();
    img.deserialize(data, map, useID);
    return img;
  }

  static drawPath(ctx, angle, width, height, shift = null){
    // enclose rotation (and possible shift) in a canvas state
    ctx.save();
    if(shift)
      ctx.translate(shift.x, shift.y);
    ctx.rotate(angle);
    rotated: {
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
    }
    ctx.restore();
  }
  drawPath(ctx){
    SketchRectangle.drawPath(
      ctx, this.angle, this.width, this.height
    );
  }
  draw(ctx, {
    drawLayers = true,
    transform: { k = 1 },
    previewLayers = true
  }){
    if(!drawLayers)
      return;
    this.drawPath(ctx);
    ctx.fillStyle = '#EFEFEF77';
    ctx.fill();
    ctx.lineWidth = 2 / k;
    ctx.strokeStyle = '#999';
    ctx.stroke();

    // preview
    if(!previewLayers)
      return;
  }
  get centroid(){ return geom.scale(this.br, 0.5); }
  extents(currExt){ return geom.extents(this.extPoints, currExt); }
  hitTest(p){ return geom.polyContains(this.extPoints, p); }
  query(p, fromParent = false){
    if(fromParent)
      p = this.parentToLocal(p);
    // const u = geom.rotatePoint(p, { angle: -this.angle });
    const dx = this.tr;
    const dy = this.bl;
    return geom.projToBasis(
      p,
      geom.scale(dx, 1/this.width/this.width),
      geom.scale(dy, 1/this.height/this.height)
    );
  }
}

module.exports = SketchRectangle;