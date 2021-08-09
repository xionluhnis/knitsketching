// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const draw = require('../draw.js');
const Create = require('./create.js');

// constants
const selColor = '#6666FF66';

class CreateSubCurve extends Create {
  constructor(parentSketch = null){
    super();
    this.parentSketch = parentSketch;
  }
  start(uictx){
    if(this.curve)
      return;

    // do we have a selection?
    if(this.parentSketch){
      const hitCurve = uictx.getHITTarget();
      // check if location matches current parent sketch
      if(hitCurve && hitCurve.root() === this.parentSketch){
        // if unambiguous location, we create a new curve
        this.curve = sk.newCurve(uictx.getSketchPos(), true);
        // set parent sketch
        this.curve.setParent(this.parentSketch);
        // and let the implementation do other things to it
        this.createCurve(this.curve);

      } else {
        // else we disambiguate by clearing the selection
        this.sketch = null;
        uictx.clearSelection();
      }
    }
  }

  create(/* curve */){}

  isValidParent(skobj){
    return skobj && skobj instanceof sk.Sketch && skobj.isRoot();
  }

  get strokeColor(){ return '#000'; }
  get fillColor(){ return selColor; /* '#FFFF6666'; */ }

  move(uictx){
    // front drawing context
    const ctx = uictx.getDrawingContext();
    
    // selection state
    if(!this.curve){
      // special display of selection
      // so that the user knows which sketch will own the curve
      const skSel = this.parentSketch || uictx.firstSelection();
      if(this.isValidParent(skSel)){
        draw.withinContext(ctx, skSel, () => {
          skSel.drawPath(ctx);
          ctx.setLineDash([]);
          ctx.strokeStyle = this.strokeColor;
          ctx.stroke();
        });
      } else {
        const skObj = uictx.getHITTarget();
        if(this.isValidParent(skObj)){
          draw.withinContext(ctx, skObj, () => {
            skObj.drawPath(ctx);
            ctx.fillStyle = this.fillColor;
            ctx.fill();
          });
        }
      }

    } else {
      // else do the drawing of the created curve
      return super.move(uictx);
    }
  }

  stop(uictx, event){
    if(this.curve)
      return super.stop(uictx, event);
    else {
      uictx.updateSelection();
      // check new selection
      if(uictx.selectionSize() === 1){
        const skobj = uictx.firstSelection();
        // if a valid parent, use it
        if(this.isValidParent(skobj)){
          this.parentSketch = skobj;
        }
      }
    }
  }
  click(uictx, event){ return this.stop(uictx, event); }
}

module.exports = CreateSubCurve;