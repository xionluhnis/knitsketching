// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const draw = require('../draw.js');
const SketchAction = require('./action.js');
const Link = require('../../sketch/link.js');

class LinkEdit extends SketchAction {
  constructor(){
    super();

    // target
    // - current
    this.startSketch  = null;
    this.startSegIdx  = -1;
    this.prevSketch   = null;
    this.prevSegIdx   = -1;
  }

  storeTarget(){
    // remember (only if a border)
    if(this.startSegIdx !== -1){
      this.prevSketch   = this.startSketch;
      this.prevSegIdx   = this.startSegIdx;
    }
    // renew
    this.startSketch  = null;
    this.startSegIdx  = -1;
  }

  resetTarget(){
    // forget all
    this.startSketch = this.prevSketch = null;
    this.startSegIdx = this.prevSegIdx = -1;
  }

  start(uictx){
    // clear selection if any
    if(uictx.hasSelection())
      uictx.clearSelection();

    // get target, and keep in memory
    // to validate at release
    const [sketch, segIdx] = uictx.getHITTarget(true);
    if(sketch && sketch instanceof sk.Sketch){
      this.startSketch = sketch;
      this.startSegIdx = segIdx;

    } else {
      this.resetTarget();
    }

    // /!\ note: we need a target even for unlinking
    // because then we want to allow the user to release a click!
  }

  isParentSketch(sketch){
    return this.prevSketch && this.prevSketch.parent === sketch;
  }

  checkTarget(sketch, segIdx){
    if(!this.prevSketch || !sketch || segIdx === -1)
      return {};
    return Link.check(this.prevSketch, this.prevSegIdx, sketch, segIdx);
  }

  drawLink(uictx, sketch, segIdx, color, dash = []){
    const ctx = uictx.getDrawingContext();
    if(segIdx >= 0){
      const prevWidth = ctx.lineWidth;
      ctx.lineWidth = draw.getConstantRadius(uictx.transform);
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      draw.drawCurveSegment(ctx, sketch, segIdx);
      ctx.stroke();

      // reset width
      ctx.lineWidth = prevWidth;

      // draw length information
      draw.withinLabelViewport(ctx, uictx.transform, () => {
        draw.segmentLength(ctx, sketch, segIdx, uictx.transform, color);
      }, true);

    } else {
      ctx.fillStyle = color;
      draw.drawCurvePath(ctx, sketch);
      ctx.fill();
    }
  }

  abort(){
    // clear action target
    this.resetTarget();
  }
}

module.exports = LinkEdit;