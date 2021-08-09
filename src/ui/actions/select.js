// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
// const assert = require('../../assert.js');
const SketchAction = require('./action.js');

class Select extends SketchAction {
  start(uictx, event){
    // switch to MOVE or SCALE depending on keys
    // - ctrl => scale
    // - else => move
    //
    // but only if there is a selection
    if(!uictx.hasSelection())
      return;

    // switch to a different action if clicking on the selection
    const curve = uictx.getHITTarget();
    for(const c of uictx.selection()){
      if(c === curve){
        // temporary action with action callback
        uictx.setActionMode(
          uictx.ctrlKey ? 'scale' : 'move',
          this // returnTo = this
        );
        return SketchAction.triggerHook(uictx, SketchAction.START, event);
      }
    }
  }
  close(uictx){
    if(uictx.hasSelection()){
      uictx.clearSelection();
    }
  }

  // empty implementation (to avoid catching itself)
  click(uictx){
    const curve = uictx.getHITTarget();
    if(curve){
      uictx.updateSelection(curve);
    } else {
      uictx.clearSelection();
    }
  }

  // special catching
  caught(uictx, hook, currAction){
    if(this.matches(currAction)
    || this.matches(uictx.lastAction))
      return uictx.reject(); // skip catching

    // do not catch click/dblclick when there is a target
    if(hook === SketchAction.CLICK){
      if(uictx.getHITTarget())
        return uictx.reject(); // skip catching since there is a selection
    } else if(hook === SketchAction.DBLCLICK){
      if(uictx.getHITTarget())
        return uictx.reject(); // skip catching since there is a selection
    } else if(hook === SketchAction.INPUT){
      return uictx.reject(); // skip catching input
    }
    
    // if we catch a missed action,
    // then we can enforce that we go back into select mode
    uictx.setAction(this, true); // we can reuse this action
  }
}

module.exports = SketchAction.register('select', Select, {
  shortcuts: [ ' ' ]
});