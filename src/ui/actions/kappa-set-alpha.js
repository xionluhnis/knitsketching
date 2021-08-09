// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const util = require('../util.js');
const SketchAction = require('./action.js');
const SelectKappa = require('./kappa-select.js');

class SetKappaAlpha extends SelectKappa {
  constructor(constr = null, returnTo = null){
    super(constr);
    this.returnTo = returnTo;
    assert(!returnTo || returnTo instanceof SketchAction,
      'ReturnTo argument must be a sketch action');
    // initial position
    this.startPos = constr ? constr.getPosition() : null;
  }

  start(uictx){
    // try to select a constraint if none yet
    if(!this.constr)
      this.constr = this.getKappa(uictx);
    // get start position if none yet
    if(this.constr && !this.startPos){
      // get initial position
      this.startPos = this.sketch.globalToLocal(uictx.getSketchPos());
    }
  }

  getAlpha(uictx){
    if(!this.constr)
      return 0;
    // current position in sketch
    const currPos = this.sketch.globalToLocal(uictx.getSketchPos());
    // if returning to another action
    // => we have a fixed start position = the constraint position
    if(this.returnTo)
      return util.distBetween(this.startPos, currPos);
    // else we're doing incremental changes
    // => use ratio of startPos radius to currPos radius as multiplier
    const basePos = this.constr.getPosition();
    const currR = util.distBetween(basePos, currPos);
    const initR = util.distBetween(basePos, this.startPos);
    const factor = currR / Math.max(initR, 1);
    return this.constr.alpha * factor;
  }

  move(uictx){
    if(this.constr && this.startPos){
      // draw change in radius
      
      SelectKappa.draw(uictx.getDrawingContext(), this.constr, {
        highlight: true, alpha: this.getAlpha(uictx)
      });

    } else {
      super.move(uictx);
    }
  }

  stop(uictx, event){
    if(this.constr && this.startPos){
      // apply influence change
      const alpha = this.getAlpha(uictx);
      this.constr.setInfluence(alpha);
      this.constr = null; // unselect
      this.startPos = null; // reset start position
      // update scene
      uictx.updateContent();
      // commit history
      uictx.commitHistory('set alpha');
      // return to callback if any
      if(this.returnTo)
        uictx.setAction(this.returnTo);

    } else {
      super.stop(uictx, event);
    }
  }
}

module.exports = SketchAction.register('kappa-set-alpha', SetKappaAlpha);