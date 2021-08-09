// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const Bezier = require('bezier-js');
const sk = require('../../sketch.js');
const env = require('../../env.js');
const draw = require('../draw.js');
const util = require('../util.js');
const geom = util.geom;
const SegmentSelect = require('./segment-select.js');
const SketchAction = require('./action.js');

// constants
const selColor = '#66F';
const highColor = '#FF6';

//
// ---------------------------------------------------------------------------
//

const dt = 1e-3;

function closeEnough(l1, l2){
  return Math.abs(l1 - l2) <= dt;
}

function getLength(p1, cs, ce, p2){
  return new Bezier(p1, cs, ce, p2).length();
}

function getLoss(p1, cs, ce, p2, length){
  const len = getLength(p1, cs, ce, p2);
  return (len - length) * (len - length);
}

/*
function dxargs(args, idx, step){
  args = args.slice();
  args[idx] = geom.dx(args[idx], step);
  return args;
}
function dyargs(args, idx, step){
  args = args.slice();
  args[idx] = geom.dy(args[idx], step);
  return args;
}

function getGrad(fun, args, argIdx, step){
  const range = 2 * step;
  return {
    x: (fun(...dxargs(args, argIdx, step)) - fun(...dxargs(args, argIdx, -step))) / range,
    y: (fun(...dyargs(args, argIdx, step)) - fun(...dyargs(args, argIdx, -step))) / range
  };
}
*/

function getGradCe(p1, cs, ce, p2, length){
  const h = 2 * dt;
  return {
    x: (getLoss(p1, cs, geom.dx(ce, dt), p2, length) - getLoss(p1, cs, geom.dx(ce, -dt), p2, length)) / h,
    y: (getLoss(p1, cs, geom.dy(ce, dt), p2, length) - getLoss(p1, cs, geom.dy(ce, -dt), p2, length)) / h,
  };
}

function getGradCs(p1, cs, ce, p2, length){
  const h = 2 * dt;
  return {
    x: (getLoss(p1, geom.dx(cs, dt), ce, p2, length) - getLoss(p1, geom.dx(cs, -dt), ce, p2, length)) / h,
    y: (getLoss(p1, geom.dy(cs, dt), ce, p2, length) - getLoss(p1, geom.dy(cs, -dt), ce, p2, length)) / h,
  };
}

function getGradCsAndCe(p1, cs, ce, p2, length){
  return [
    getGradCs(p1, cs, ce, p2, length),
    getGradCe(p1, cs, ce, p2, length)
  ];
}

function solveForBothControlPoints(p1, cs, ce, p2, length){
  // try default value
  let currLen = getLength(p1, cs, ce, p2);
  if(closeEnough(currLen, length)){
    return { cs, ce };
  }
  // else we need to optimize for both cs and ce
  if(env.verbose)
    console.log("optimizing for both cs and ce");

  const max_iters = 1000;
  let iter = 0;
  for(; iter < max_iters && !closeEnough(currLen, length); ++iter) {
    const [gradCs, gradCe] = getGradCsAndCe(p1, cs, ce, p2, length);
    cs = geom.axpby(1, cs, -1, gradCs);
    ce = geom.axpby(1, ce, -1, gradCe);
    // measure length again
    currLen = getLength(p1, cs, ce, p2);
  }
  if(env.verbose){
    if(iter < max_iters){
      console.log("found solution", currLen);
    } else {
      console.log("over max iters", currLen, length);
    }
  }
  return { cs, ce };
}

function solveForOtherControlPoint(p1, cs, ce, p2, length, which){
  // try default value
  let currLen = getLength(p1, cs, ce, p2);
  if(closeEnough(currLen, length)){
    return { cs, ce };
  }
  const max_iters = 500;
  let iter = 0;
  if(which == sk.Curve.CTRL_START){
    // solving for ce, while cs is fixed
    if(env.verbose)
      console.log("solving for ce, while cs is fixed?");
    for(; iter < max_iters && !closeEnough(currLen, length); ++iter) {
      const gradCe = getGradCe(p1, cs, ce, p2, length);
      ce = geom.axpby(1, ce, -1, gradCe);
      // measure length again
      currLen = getLength(p1, cs, ce, p2);
    }
    
  } else {
    // solving for cs, while ce is fixed
    if(env.verbose)
      console.log("solving for cs, while ce is fixed?");
    for(; iter < max_iters && !closeEnough(currLen, length); ++iter) {
      const gradCs = getGradCs(p1, cs, ce, p2, length);
      cs = geom.axpby(1, cs, -1, gradCs);
      // measure length again
      currLen = getLength(p1, cs, ce, p2);
    }
  }
  if(env.verbose){
    if(iter < max_iters){
      console.log("found solution", currLen);
    } else {
      console.log("over max iters", currLen, length);
    }
  }
  return { cs, ce };
}

//
// ---------------------------------------------------------------------------
//

class SegmentSetLength extends SegmentSelect {
  constructor(curve = null, segIdx = -1, targetLength = -1){
    super(); // no callback!

    // selection
    this.curve = curve;
    this.segIdx = segIdx;
    this.targetLength = targetLength;
    // current action
    this.startSide = null;
  }

  resetTarget(){
    this.curve = null;
    this.segIdx = -1;
    this.targetLength = -1;
    this.startSide = null;
  }

  canEdit(curve = this.curve){
    return curve && curve instanceof sk.Curve;
  }

  start(uictx){
    // clear selection if any
    if(uictx.hasSelection())
      uictx.clearSelection();
    
    // check state
    if(this.curve) {
      // check whether we are pressing on a control point
      // => specify which
      const curvePos = this.curve.globalToLocal(uictx.getSketchPos());
      // adaptive radius
      const radius = draw.getConstantRadius(uictx.transform);
      this.startSide = null;
      for(let [w, cp] of [
        [sk.Curve.CTRL_START, this.curve.getControlPoint(this.segIdx + 0, sk.Curve.CTRL_START)],
        [sk.Curve.CTRL_END,   this.curve.getControlPoint(this.segIdx + 1, sk.Curve.CTRL_END)]
      ]){
        // distance to mouse
        const mouseDist = util.distBetween(cp, curvePos);
        if(mouseDist <= radius){
          this.startSide = w;
          break;
        }
      } // endfor [w, cp]
    } // endif else
  }

  move(uictx){
    // until a curve is selected
    // we are just in segment selection mode
    if(!this.curve)
      return super.move(uictx);

    // we have a curve!
    const ctx = uictx.getDrawingContext();

    // are we dragging a control point?
    // if so, then update other control point!
    const { curve, segIdx, startSide } = this;
    const curvePos = curve.globalToLocal(uictx.getSketchPos());
    if(startSide){
      // solve for other side, while fixing starting side
      const c1 = curve.getPoint(segIdx + 0);
      const c2 = curve.getPoint(segIdx + 1);
      const cs0 = curve.getControlPoint(segIdx + 0, sk.Curve.CTRL_START).pos();
      const ce0 = curve.getControlPoint(segIdx + 1, sk.Curve.CTRL_END).pos();
      // solve for both control points to match the length
      const result = solveForOtherControlPoint(
        Object.assign({}, c1), // copy for safety
        startSide == sk.Curve.CTRL_START ? Object.assign({}, curvePos) : cs0,
        startSide == sk.Curve.CTRL_END ? Object.assign({}, curvePos) : ce0,
        Object.assign({}, c2), // copy for safety
        this.targetLength,
        startSide
      );
      // check whether doable or not
      if(result){
        const { cs, ce } = result;
        // update control points
        curve.setControlPoint(segIdx + 0, sk.Curve.CTRL_START, cs);
        curve.setControlPoint(segIdx + 1, sk.Curve.CTRL_END, ce);
        
        // redraw segment if updated
        this.drawSegment(uictx, curve, segIdx, highColor);
      }
    }

    // draw things
    draw.withinContext(ctx, curve, () => {

      // draw control points
      const ps = curve.getPoint(segIdx);
      const pe = curve.getPoint(segIdx + 1);
      const cs = curve.getControlPoint(segIdx,   sk.Curve.CTRL_START).pos();
      const ce = curve.getControlPoint(segIdx + 1, sk.Curve.CTRL_END).pos();
      const radius = draw.getConstantRadius(uictx.transform);
      for(let [pt, cp, selected] of [
        [ps, cs, startSide == sk.Curve.CTRL_START],
        [pe, ce, startSide == sk.Curve.CTRL_END]
      ]){
        let color;
        if(selected)
          color = selColor;
        else if(geom.distBetween(curvePos, cp) <= radius)
          color = highColor;
        else
          color = '#FFFFFFAA';
        
        // draw control handle
        ctx.beginPath();
        ctx.moveTo(pt.x, pt.y);
        ctx.lineTo(cp.x, cp.y);
        ctx.setLineDash([1, 1]);
        ctx.strokeStyle = '#AAA';
        ctx.stroke();

        // draw control point
        ctx.beginPath();
        ctx.moveTo(cp.x + radius, cp.y);
        ctx.arc(cp.x, cp.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#999';
        ctx.stroke();
      } // endfor [pt, cp]
    });
  }

  stop(uictx){

    // if we had a curve/segIdx selection, either
    //  1) we stop dragging a point => nothing special, or
    //  2) we clicked somewhere else => deselect curve/segIdx
    if(this.curve){
      if(!this.startSide){
        // de-selecting
        this.resetTarget();
      }
      this.startSide = null; // no more pressing!
      uictx.updateContent();
      // commit history
      uictx.commitHistory('segment-set-len control');
      return;
    }

    // try selecting a new segment
    const [curve, segIdx] = uictx.getHITTarget(true);
    if(curve && segIdx != -1 && this.canEdit(curve)){
      const len = curve.getSegmentLength(segIdx);
      const minLen = geom.distBetween(
        curve.getPoint(segIdx),
        curve.getPoint(segIdx + 1)
      );
      util.askForNumber('Length', len, {
        integer: false, min: minLen, max: Infinity
      }).then(length => {
        // set targets
        this.curve = curve;
        this.segIdx = segIdx;
        this.targetLength = length;
        this.startSide = null;

        // set curve to cubic corner mode
        curve.setSegmentMode(segIdx, segIdx + 1, sk.Curve.CUBIC);
        curve.setControlMode(segIdx + 0, sk.Curve.CORNER);
        curve.setControlMode(segIdx + 1, sk.Curve.CORNER);
        const c1 = curve.getPoint(segIdx + 0);
        const c2 = curve.getPoint(segIdx + 1);
        const cs0 = curve.getControlPoint(segIdx + 0, sk.Curve.CTRL_START).pos();
        const ce0 = curve.getControlPoint(segIdx + 1, sk.Curve.CTRL_END).pos();

        // solve for both control points to match the length
        const { cs, ce } = solveForBothControlPoints(
          Object.assign({}, c1), // copy for safety
          cs0, ce0,
          Object.assign({}, c2), // copy for safety
          length
        );

        // update curve
        curve.setControlPoint(segIdx + 0, sk.Curve.CTRL_START, cs);
        curve.setControlPoint(segIdx + 1, sk.Curve.CTRL_END, ce);
        uictx.updateContent();
        // commit history
        uictx.commitHistory('segment-set-len init');
      }).catch(util.noop);
    }
  }

  abort(){
    this.resetTarget();
  }
}

SketchAction.register('segment-len-set', SegmentSetLength);