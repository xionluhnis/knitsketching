// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const util = require('../util.js');
const SketchAction = require('./action.js');

class Create extends SketchAction {
  constructor(curve = null){
    super();
    this.curve = curve;
  }

  start(uictx){
    if(!this.curve)
      this.curve = sk.newSketch(uictx.getSketchPos());
  }

  getLastPos(){
    return Object.assign({},
      this.curve.points[this.curve.points.length - 1]
    );
  }

  move(uictx){
    if(!this.curve)
      return;

    // drawing context
    const ctx = uictx.getDrawingContext();

    // draw current curve up to last potential future point
    ctx.beginPath();
    ctx.moveTo(this.curve.startX(), this.curve.startY());
    for(const { x, y } of this.curve.points){
      ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    // ending
    const lastPt = this.getLastPos();
    const freePt = uictx.getSketchPos();
    const newPt = uictx.ctrlKey ? util.alignPoint(freePt, lastPt) : freePt;

    // pending point
    ctx.beginPath();
    ctx.moveTo(lastPt.x, lastPt.y);
    ctx.lineTo(newPt.x, newPt.y);
    ctx.setLineDash([1, 1]);
    ctx.strokeStyle = '#666';
    ctx.stroke();
  }

  stop(uictx){
    if(!this.curve)
      return;
    // ending
    const lastPt = this.getLastPos();
    const freePt = uictx.getSketchPos();
    const newPt = this.ctrlKey ? util.alignPoint(freePt, lastPt) : freePt;
    // add actual point
    // unless close to last one
    const distToLast = util.distBetween(newPt, lastPt);
    if(distToLast > 1e-2)
      this.curve.addPoint(newPt);
    
    // commit history if valid curve
    const minPoints = this.curve.open ? 2 : 3;
    if(this.curve.length >= minPoints)
      uictx.commitHistory('create point');
  }

  finishCurve(uictx){
    if(!this.curve)
      return;
    // if curve is invalid (less than 3 points)
    // then we should remove it (else we won't be able later)
    const minPoints = this.curve.open ? 2 : 3;
    if(this.curve.length < minPoints){
      sk.deleteCurve(this.curve);
    }
    // remove sketch from action
    // /!\ important else we may create copies / close multiple times
    this.curve = null;
    // data changed
    uictx.updateContent();
  }

  close(uictx){
    if(!this.curve){
      uictx.reject();
    } else {
      this.finishCurve(uictx);
    }
  }

  // aliasses
  click(uictx){ this.start(uictx); }
  abort(uictx){ this.finishCurve(uictx); }
  dblclick(uictx){ this.finishCurve(uictx); }
}

module.exports = SketchAction.register('create', Create);