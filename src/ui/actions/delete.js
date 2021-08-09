// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
// const assert = require('../../assert.js');
const sk = require('../../sketch.js');
const draw = require('../draw.js');
// const util = require('../util.js');
const SketchAction = require('./action.js');

// colors
const delColor = '#F66';
const parentColor = '#FF666666';

class Delete extends SketchAction {
  start(uictx){
    // clear selection if any
    if(uictx.hasSelection())
      uictx.clearSelection();
  }

  move(uictx){
    const ctx = uictx.getDrawingContext();

    // draw current hit
    const curve = uictx.getHITTarget();
    if(!curve)
      return;

    draw.withinContext(ctx, curve, () => {
      curve.drawPath(ctx);
      if(curve.open){
        ctx.strokeStyle = delColor;
        ctx.lineWidth = 15;
        ctx.setLineDash([]);
        ctx.stroke();
      } else {
        ctx.fillStyle = parentColor;
        ctx.fill();
      }
    });
  }

  stop(/* uictx */){}
  click(uictx){
    // delete object
    const skobj = uictx.getHITTarget();
    if(skobj){
      sk.deleteObject(skobj);
      uictx.updateContent();
      // commit history
      uictx.commitHistory('delete curve');
    }
  }
}

module.exports = SketchAction.register('delete', Delete, {
  shortcuts: ['d'],
  [SketchAction.OWN_SELECTION]: true
});
