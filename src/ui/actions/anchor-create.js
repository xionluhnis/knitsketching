// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const { SketchAnchor } = sk;
const draw = require('../draw.js');
const SketchAction = require('./action.js');
const CreateChild = require('./create-child.js');

class CreateAnchor extends CreateChild {
  constructor(sketch = null){
    super(sketch, true); // only trigger createAction for valid selection
  }
  move(uictx){
    if(!this.sketch)
      return super.move(uictx);
    // front drawing context
    const ctx = uictx.getDrawingContext();
    const [sketchPos] = this.getTargetPos(uictx);
    if(!sketchPos)
      return; // nothing
    // const r = draw.getConstantRadius(uictx.transform, 10);
    draw.withinContext(ctx, this.sketch, () => {
      SketchAnchor.drawPath(
        ctx, sketchPos.x, sketchPos.y, !uictx.ctrlKey
      );
      ctx.strokeStyle = '#000';
      ctx.stroke();
      ctx.fillStyle = this.selColor + '66';
      ctx.fill();
    });
  }

  createAction(uictx, sketchPos, curve, p1, p2){
    // create kappa constraint
    const anchor = new SketchAnchor();
    anchor.setParent(this.sketch);
    anchor.setPosition(curve, p1, p2);
    uictx.commitHistory('create anchor');
    uictx.updateContent();
  }

  click(/* uictx, event */){ /* disabled click */ }
}

module.exports = SketchAction.register('anchor-create', CreateAnchor);