// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const draw = require('../draw.js');
const util = require('../util.js');
const SketchAction = require('./action.js');

class Scale extends SketchAction {
  constructor(returnTo = null){
    super();
    this.selection = [];
    this.startPos = null;
    this.startTransforms = [];
    // distance frame
    this.sketchZero = null;
    this.sketchZeroDist = 1;
    // callback
    this.returnTo = returnTo;
    assert(!returnTo || returnTo instanceof SketchAction,
      'ReturnTo argument must be a sketch action');
  }
  start(uictx){
    if(uictx.hasSelection()){
      this.selection = uictx.copySelection();
      this.startPos = uictx.getSketchPos();
      this.startTransforms = this.selection.map(s => {
        return s.transform.copy();
      });
      // with distance unit scale
      // compute scale by using centroid of last selection element
      this.sketchZero = uictx.lastSelection().globalCentroid();
      this.sketchZeroDist = util.distBetween(this.startPos, this.sketchZero);
    } else {
      this.selection = [];
    }
  }

  getDistRatioTo(pos){
    const scaleDist = util.distBetween(
      this.sketchZero, pos
    );
    return scaleDist / this.sketchZeroDist;
  }

  move(uictx){
    if(!this.selection.length)
      return;
    
    // draw context
    const ctx = uictx.getDrawingContext();

    // draw rescaled selection
    const ratio = this.getDistRatioTo(uictx.getSketchPos());
    const scale = util.toDecimal(ratio, 2);
    for(const skSel of this.selection){
      draw.withinContext(ctx, skSel, () => {
        // to centroid
        const centroid = skSel.centroid;
        ctx.translate(centroid.x, centroid.y);
        ctx.scale(scale, scale);
        ctx.translate(-centroid.x, -centroid.y);
        // draw path
        draw.drawCurvePath(ctx, skSel, true); // in context (through enter + translate)
        if(!skSel.open){
          ctx.fillStyle = '#FFFFFFAA';
          ctx.fill();
        }
        ctx.strokeStyle = '#AAA';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
      });
    }

    // draw highlight text => label space
    const transform = uictx.transform;
    draw.exitViewport(ctx);
    draw.withinLabelViewport(ctx, transform, () => {
      // draw highlight text
      draw.highlightText(
        ctx,
        util.toDecimalString(ratio, 2),
        this.sketchZero.x, this.sketchZero.y
      );
    });
    // back to viewport space
    draw.enterViewport(ctx, transform);
  }

  stop(uictx){
    if(!this.selection.length)
      return;
    // apply rescaling (unless dangerous)
    const ratio = this.getDistRatioTo(uictx.getSketchPos());
    if(isNaN(ratio) || ratio < 1e-1 || ratio > 1e2)
      return;
    for(const skSel of this.selection){
      const { x, y } = skSel.centroid;
      // rescale through center
      const xform = skSel.transform.translatedBy(x, y).scaledBy(ratio).translatedBy(-x, -y);
      skSel.setTransform(xform);
    }
    
    this.selection = [];
    uictx.updateContent();
    // commit history
    uictx.commitHistory();

    // callback
    if(this.returnTo){
      uictx.setAction(this.returnTo);
    }
  }
}

module.exports = SketchAction.register('scale', Scale, {
  shortcuts: ['s']
});
