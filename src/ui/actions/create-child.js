// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const draw = require('../draw.js');
// const util = require('../util.js');
const SketchAction = require('./action.js');
const Move = require('./move.js');

class CreateChild extends SketchAction {
  constructor(
    sketch = null,
    constrAction = false,
    selColor = '#FFFF66'
  ){
    super();
    this.sketch = sketch;
    this.selColor = selColor;
    // action mode
    this.constrAction = constrAction;
  }
  getTargetPos(uictx){
    if(!this.sketch)
      return [];
    // check base target
    baseHit: {
      const curve = uictx.getHITTarget(false, true);
      if(!curve || curve.root() !== this.sketch)
        return [];
    }
    if(this.constrAction && uictx.ctrlKey){
      // constrained case
      return Move.getConstrainedTarget(
        uictx, this.sketch, true,
        10 / uictx.transform.k / this.sketch.transform.k
      );

    } else {
      // freehand case
      const pos = this.sketch.globalToLocal(uictx.getSketchPos());
      return [pos, null, pos.x, pos.y];
    }
  }
  isValidParent(skobj){
    return skobj && skobj instanceof sk.Sketch && skobj.isRoot();
  }
  start(uictx){
    // do we have a valid selection?
    if(!this.sketch || !this.isValidParent(this.sketch)) {
      // else we disambiguate by clearing the selection
      this.sketch = null;
      uictx.clearSelection();
    }
  }
  move(uictx){
    // front drawing context
    const ctx = uictx.getDrawingContext();
    
    // selection state
    if(!this.sketch){
      // special display of selection
      // so that the user knows which sketch will own the curve
      const skObj = uictx.getHITTarget();
      if(this.isValidParent(skObj)){
        draw.withinContext(ctx, skObj, () => {
          skObj.drawPath(ctx);
          ctx.fillStyle = this.selColor + '33';
          ctx.fill();
        });
      }
    }
  }

  createAction(/* uictx, sketchPos, curve, p1, p2 */){}

  stop(uictx /*, event */){
    if(this.sketch){
      // check base location
      const [sketchPos, curve, p1, p2] = this.getTargetPos(uictx);
      if(sketchPos){
        this.createAction(uictx, sketchPos, curve, p1, p2);

      } else {
        // invalid state or location
        // => reset sketch target (and selection)
        this.sketch = null;
        uictx.clearSelection();
        return;
      }

    } else {
      // update parent sketch
      uictx.updateSelection();
      // check new selection
      if(uictx.selectionSize() === 1){
        const skobj = uictx.firstSelection();
        // if a valid parent, use it
        if(this.isValidParent(skobj)){
          this.sketch = skobj;
        }
      }
    }
  }
}
module.exports = CreateChild;