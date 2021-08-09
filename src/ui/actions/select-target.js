// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const draw = require('../draw.js');
const SketchAction = require('./action.js');


class SelectTarget extends SketchAction {
  constructor(callback, filter = () => true, selColor = '#6666FF66'){
    super();
    this.callback = callback;
    this.filter = filter;
    this.selColor = selColor;
  }
  get commitLabel(){ return 'select target'; }

  start(uictx){
    if(uictx.hasSelection())
      uictx.clearSelection();
  }

  isValidTarget(skobj){
    return skobj && this.filter(skobj);
  }

  move(uictx){
    const ctx = uictx.getDrawingContext();

    // draw current hit, if valid
    const object = uictx.getHITTarget();
    if(!this.isValidTarget(object))
      return;
    draw.withinContext(ctx, object, () => {
      object.drawPath(ctx);
      ctx.fillStyle = this.selColor;
      ctx.fill();
    });
  }

  stop(uictx){
    uictx.update();
  }

  click(uictx){
    // delete object
    const object = uictx.getHITTarget();
    if(this.isValidTarget(object)
    && this.callback){
      this.callback(object);
      // commit history
      uictx.commitHistory(this.commitLabel);
    }
  }
}

module.exports = SketchAction.register('select-target', SelectTarget);