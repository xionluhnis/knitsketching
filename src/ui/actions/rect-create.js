// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const sk = require('../../sketch.js');
const { SketchRectangle } = sk;
const draw = require('../draw.js');
const SketchAction = require('./action.js');
const CreateChild = require('./create-child.js');

class CreateRectangle extends CreateChild {
  constructor(sketch = null){
    super(sketch, false);
    // points (needs 3)
    this.points = [];
  }
  move(uictx){
    if(!this.sketch)
      return super.move(uictx);
    // front drawing context
    const ctx = uictx.getDrawingContext();
    const [p] = this.getTargetPos(uictx);
    if(!p)
      return; // nothing, but should not happen
    // three cases depending on point count
    const r = draw.getConstantRadius(uictx.transform, 5);
    draw.withinContext(ctx, this.sketch, () => {
      switch(this.points.length){

        case 0:
          ctx.beginPath();
          draw.circle(ctx, p.x, p.y, r);
          ctx.strokeStyle = '#000';
          ctx.stroke();
          ctx.fillStyle = this.selColor + '66';
          ctx.fill();
          break;

        case 1:
          // initial circle
          ctx.beginPath();
          draw.circle(ctx, this.points[0].x, this.points[0].y, r);
          ctx.fillStyle = this.selColor + '66';
          ctx.fill();
          // diagonal segment
          ctx.beginPath();
          ctx.moveTo(this.points[0].x, this.points[0].y);
          ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = '#000';
          ctx.stroke();
          break;

        case 2: {
          // full rectangle from three points
          const {
            shift, angle, width, height
          } = SketchRectangle.fromTriangle(...this.points, p);
          ctx.beginPath();
          SketchRectangle.drawPath(ctx, angle, width, height, shift);
          ctx.strokeStyle = '#000';
          ctx.stroke();
          ctx.fillStyle = this.selColor + '66';
          ctx.fill();

          // initial circle
          ctx.beginPath();
          draw.circle(ctx, this.points[0].x, this.points[0].y, r);
          ctx.fillStyle = this.selColor + '66';
          ctx.fill();
          
        } break;

        default:
          assert.error('Invalid point count');
      }
    });
  }

  createAction(uictx, p){
    if(this.points.length < 2){
      this.points.push(p);
      uictx.updateContent();

    } else {
      // create rectangle
      assert(this.points.length === 2,
        'Invalid point count');
      const rect = new SketchRectangle();
      rect.setParent(this.sketch);
      rect.setFromTriangle(...this.points, p);
      this.points = []; // clear list of points
      uictx.commitHistory('create rect');
      uictx.updateContent();
    }
  }

  close(uictx){
    if(this.points.length){
      this.points.pop(); // remove last point
    } else if(uictx.selectionSize()){
      uictx.clearSelection();
      this.sketch = null;
    } else {
      uictx.reject();
    }
    uictx.updateContent();
  }
}

module.exports = SketchAction.register('rect-create', CreateRectangle);