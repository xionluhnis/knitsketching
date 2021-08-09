// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const draw = require('../draw.js');
const SketchAction = require('./action.js');

// colors
const selColor = '#66F';

class SegmentSelect extends SketchAction {
  constructor(callback){
    super();
    this.callback = callback;
  }
  start(uictx){
    // clear selection if any
    if(uictx.hasSelection())
      uictx.clearSelection();
  }

  drawSegment(uictx, curve, segIdx, color, width = 7){
    const ctx = uictx.getDrawingContext();
    draw.withinContext(ctx, curve, () => {
      ctx.strokeStyle = color;
      const prevWidth = ctx.lineWidth;
      if(width){
        ctx.lineWidth = draw.getConstantRadius(uictx.transform, width);
      }
      ctx.setLineDash([]);
      curve.drawSegment(ctx, segIdx);
      ctx.stroke();
      if(width){
        ctx.lineWidth = prevWidth;
      }
    });

    // draw length information
    draw.withinLabelViewport(ctx, uictx.transform, () => {
      draw.segmentLength(ctx, curve, segIdx, uictx.transform, color);
    }, true);
  }

  move(uictx){

    // draw current hit
    const [ curve, segIdx ] = uictx.getHITTarget(true);
    if(curve && segIdx !== -1){
      this.drawSegment(uictx, curve, segIdx, selColor, 10);
    }
  }

  stop(uictx){
    uictx.update();
  }

  click(uictx){
    const [curve, segIdx] = uictx.getHITTarget(true);
    if(curve && segIdx !== -1){
      if(this.callback){
        this.callback(curve, segIdx, uictx);
        // commit history
        uictx.commitHistory();
      }
    } // endif curve && index > 0
  }
}

module.exports = SketchAction.register('segment-select', SegmentSelect);