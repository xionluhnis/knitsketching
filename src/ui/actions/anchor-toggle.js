// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const draw = require('../draw.js');
// const util = require('../util.js');
const SketchAction = require('./action.js');

// create color
const selColor = '#6666FF';

class ToggleAnchor extends SketchAction {
  start(uictx){
    // clear selection if any
    if(uictx.hasSelection())
      uictx.clearSelection();
  }

  move(uictx){
    const ctx = uictx.getDrawingContext();

    // draw current hit
    const anchor = uictx.getHITTarget();
    if(!anchor || !(anchor instanceof sk.SketchAnchor))
      return;

    draw.withinContext(ctx, anchor, () => {
      anchor.drawPath(ctx);
      ctx.fillStyle = selColor;
      ctx.fill();
    });
  }

  stop(/* uictx */){}
  click(uictx){
    // delete object
    const skobj = uictx.getHITTarget();
    if(skobj && skobj instanceof sk.SketchAnchor){
      if(skobj.isFree())
        skobj.makeConstrained();
      else
        skobj.makeFree();
      uictx.updateContent();
      // commit history
      uictx.commitHistory('delete curve');
    }
  }
}

module.exports = SketchAction.register('anchor-toggle', ToggleAnchor);
