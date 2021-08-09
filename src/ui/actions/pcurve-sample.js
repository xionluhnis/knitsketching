// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const draw = require('../draw.js');
const geom = require('../../geom.js');
const SketchAction = require('./action.js');

// constants
const baseColor = '#FFFFFF99';
const selColor = '#6666FF66';
const Splits = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21, 25, 26];
const ReturnTrue = () => true;

// global constant
let splitIndex = Splits.indexOf(11);

class PCurveSample extends SketchAction {
  constructor(isValid = ReturnTrue, callback = () => {}){
    super();

    // input
    this.isValid = isValid || ReturnTrue;

    // callback
    this.callback = callback;
  }

  get splitCount(){
    return Splits[splitIndex];
  }

  getSplitT(index){
    assert(index >= 0 && index < this.splitCount,
      'Invalid split index', index);
    return index / (this.splitCount - 1);
  }

  getChar(event){
    return event.key || String.fromCharCode(event.charCode);
  }

  input(uictx, event){
    const char = this.getChar(event);
    switch(char){

      case '+':
        splitIndex = Math.min(Splits.length - 1, splitIndex + 1);
        break;

      case '-':
        splitIndex = Math.max(0, this.splitIndex - 1);
        break;

      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '8':
        splitIndex = Splits.indexOf(char - '0');
        break;

      default:
        // allow shortcuts to take over
        uictx.reject();
        return;
    }
    uictx.updateAction();
  }

  start(uictx){
    // XXX if last action was closing a pcurve
    //     then we may want to start a new one with same parent?
    if(uictx.hasSelection())
    uictx.clearSelection();
  }

  drawSample(ctx, p, radius, fillStyle, strokeStyle = '#999'){
    ctx.beginPath();
    ctx.moveTo(p.x + radius, p.y);
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fillStyle;
    ctx.fill();
    ctx.setLineDash([]);
    ctx.strokeStyle = strokeStyle;
    ctx.stroke();
  }

  move(uictx){
    const ctx = uictx.getDrawingContext();

    // highlight current segment
    const [curve, segIdx] = uictx.getHITTarget(true, true);
    // check there is a curve
    if(!curve || segIdx === -1)
      return;
    // check it's valid
    if(!this.isValid(curve))
      return;

    // drawing
    const radius = draw.getConstantRadius(uictx.transform);
    const curvePos = curve.globalToLocal(uictx.getSketchPos());
    draw.withinContext(ctx, curve, () => {
      curve.drawSegment(ctx, segIdx);
      ctx.strokeStyle = selColor;
      ctx.stroke();

      // draw possible samples
      const segment = curve.getSegment(segIdx);
      if(!segment)
        return; // does not exist anymore?
      for(let i = 0; i < this.splitCount; ++i){
        const t = this.getSplitT(i);
        const p = segment.get(t);
        const selected = geom.distBetween(p, curvePos) <= radius;
        this.drawSample(ctx, p, radius, selected ? selColor : baseColor);
      }
    });
  }

  stop(uictx){
    uictx.update();
  }

  click(uictx){
    // find matching sample
    const [curve, segIdx] = uictx.getHITTarget(true, true);
    // check there is a curve
    if(!curve || segIdx === -1)
      return;
    // check it's valid
    if(!this.isValid(curve))
      return;

    // drawing
    const radius = draw.getConstantRadius(uictx.transform);
    const curvePos = curve.globalToLocal(uictx.getSketchPos());
    const segment = curve.getSegment(segIdx);
    for(let i = 0; i < this.splitCount; ++i){
      const t = this.getSplitT(i);
      const p = segment.get(t);
      if(geom.distBetween(p, curvePos) <= radius){
        this.callback(curve, segIdx, t);
        // commit history
        uictx.commitHistory();
        return;
      }
    }
  }
}

module.exports = SketchAction.register('pcurve-sample', PCurveSample);