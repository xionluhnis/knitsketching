// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const sk = require('../../sketch.js');
const draw = require('../draw.js');
const SketchAction = require('./action.js');

class FlowType extends SketchAction {
  constructor(){
    super();
    // target
    this.targetCurve = null;
    this.targetIndex = -1;
    // press/release state
    this.startPos = null;
  }

  static getUserSelection(){
    const el = document.querySelector('#constraint-type input:checked');
    if(!el)
      assert.error('No user selection');
    return el.id;
  }

  static getTypeAndDir(){
    const label = FlowType.getUserSelection().substr(5);
    switch(label){
      case 'direction':  return [sk.Sketch.DIRECTION, undefined, label];
      case 'isoline':    return [sk.Sketch.ISOLINE, undefined, label];
      case 'seam':       return [sk.Sketch.SEAM,  0, label];
      case 'source':     return [sk.Sketch.SEAM,  1, label];
      case 'sink':       return [sk.Sketch.SEAM, -1, label];
      default: return [];
    }
  }
  static getFlowType(){
    return FlowType.getTypeAndDir()[0];
  }
  static getFlowDir(){
    return FlowType.getTypeAndDir()[1];
  }
  static getBorderColor(){
    const [type, dir] = FlowType.getTypeAndDir();
    return sk.FlowConstraint.colorOf(type, dir);
  }

  start(uictx){
    // clear selection if any
    if(uictx.hasSelection())
      uictx.clearSelection();
    
    // catch potential curve
    [this.targetCurve, this.targetIndex] = uictx.getHITTarget(true);
    this.startPos = uictx.getSketchPos();
  }

  move(uictx){
    const ctx = uictx.getDrawingContext();
    const [curve, segIdx] = uictx.getHITTarget(true);

    // highlight:
    // - constraint curves
    // - sketch borders (that could become constraints)
    if(!curve)
      return;
    const borderColor = FlowType.getBorderColor();
    // highlighting a potential border constraint
    if(curve instanceof sk.Sketch){
      if(!curve.parent && segIdx !== -1){
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = draw.getConstantRadius(uictx.transform, 7);
        ctx.setLineDash([]); // 7, 3]);
        draw.drawCurveSegment(ctx, curve, segIdx);
        ctx.stroke();
      }
    } else {
      // highlighting a previously created curve constraint
      if(!curve.parent)
        return;
      const constr = curve.parent.getConstraint(curve);
      if(constr){
        ctx.strokeStyle = borderColor + 'CC';
        ctx.lineWidth = draw.getConstantRadius(uictx.transform, 7);
        ctx.setLineDash([]);
        draw.drawCurvePath(ctx, curve);
        ctx.stroke();
      }
    }
  }

  stop(uictx){
    // check whether we have the same curve as initially
    // => let user reject upon release by dragging the mouse out
    const [curve, segIdx] = uictx.getHITTarget(true);
    if(!curve
    || curve !== this.targetCurve
    || this.targetIndex !== segIdx){
      this.targetCurve = null;
      this.targetIndex = -1;
      return;
    }

    // get flow and direction
    const [flowType, flowDir, label] = FlowType.getTypeAndDir();

    // check curve type
    if(curve instanceof sk.Sketch){
      const sketch = curve.root();
      assert(sketch instanceof sk.Sketch, 'Non-sketch containing sketch');
      // look for segment to transform into constraint
      if(segIdx !== -1){
        // get t value
        const segment = curve.getSegment(segIdx);
        const segPos = curve.globalToLocal(uictx.getSketchPos());
        const segT = segment.project(segPos).t;
        const constr = curve.getBorderConstraint(segIdx, segT);
        if(constr){
          // update current constraint
          if(constr.type === flowType && flowDir === undefined)
            constr.toggleDir(); // toggle direction
          else {
            constr.setType(flowType, flowDir); // update type
          }

        } else {
          // we create a new border constraint
          // /!\ may use a sub-range of t in [0;1]
          // depending on start pos and current pos
          const startPos = curve.globalToLocal(this.startPos);
          const startT = segment.project(startPos).t;
          let t0 = 0;
          let t1 = 1;
          if(Math.abs(startT - segT) > 0.2){
            // create customized sub-curve
            t0 = Math.min(startT, segT);
            t1 = Math.max(startT, segT);
          }
          // create pcurve as constraint
          const pcurve = sk.newSegmentPCurve(curve, segIdx, t0, t1);
          sketch.setConstraint(pcurve, flowType, flowDir);
        }
      } // endif segIdx !== -1
      // else no constraint to create

    } else if(curve.parent) {
      // get sketch parent
      const sketch = curve.parent;
      assert(sketch instanceof sk.Sketch, 'Invalid curve parenting');

      // check if it matches a constraint
      const constr = sketch.getConstraint(curve);
      if(constr){
        if(constr.type == flowType && flowDir === undefined)
          constr.toggleDir();
        else
          constr.setType(flowType, flowDir);

      } else if(curve instanceof sk.PCurve) {
        // make a constraint from this construction curve
        sketch.setConstraint(curve, flowType, flowDir);
      }
    }
    // else, no valid sketch to create constraints for

    // update layout (change in constraint type/dir)
    uictx.update();
    // commit history
    uictx.commitHistory(label);
  }

  abort(){
    this.targetCurve = null;
    this.targetIndex = -1;
  }
}

module.exports = SketchAction.register('flow-set', FlowType, {
  [SketchAction.OWN_SELECTION]: true
});