// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../../assert.js');
// modules
const geom = require('../../geom.js');
const Curve = require('../../sketch/curve.js');
const SketchAction = require('./action.js');
const NodeEdit = require('./node-edit.js');

class Symmetrize extends NodeEdit {
  constructor(curve = null, axis = null){
    super(curve, '#66F');
    this.axis = axis;
  }

  static deltaPairs(points, di){
    const pairs = [];
    const N = points.length;
    const l0 = 0;
    const r0 = (l0 + di) % N;
    const set = new Set();
    const store = (l, r) => {
      if(set.has(l) || set.has(r))
        return false;
      // else we add it to the pair list, and set both indices as visited
      pairs.push([l, r]);
      set.add(l);
      set.add(r);
      return true;
    };
    store(l0, r0);
    // compute pairs in both directions
    for(const step of [1, -1]){
      let l = l0, r = r0;
      // compute pairs
      while(true){
        // do one step
        const nl = (l + step + N) % N;
        const nr = (r - step + N) % N;
        if(store(nl, nr)){
          l = nl;
          r = nr;
        } else {
          // we generated that pair already
          // time to stop!
          break;
        }
      }
    }
    // should have visited all points
    assert(set.size === points.length, 'Counts are invalid');
    return pairs;
  }

  static circularMatch(points, userAxis = null){
    let bestPairs = null;
    let bestErr = Infinity;
    for(let di = 0; di < points.length; ++di){
      // measure error using di as pair generator
      const pairs = Symmetrize.deltaPairs(points, di);
      const [center, axis] = Symmetrize.getAxisData(
        points, pairs, userAxis
      );
      const err = pairs.reduce((sum, [il, ir]) => {
        const pl = points[il];
        const pr = points[ir];
        const plr = geom.reflectPointAcrossLine(pr, [center, axis]);
        return sum + geom.distBetween(pl, plr);
      }, 0);
      if(err < bestErr){
        bestErr = err;
        bestPairs = pairs;
      }
    }
    return bestPairs;
  }

  static trivialMatch(points){
    const pairs = [];
    for(let i = 0, j = points.length - 1; i <= j ; ++i, --j){
      pairs.push([i, j]);
    }
    return pairs;
  }

  static getAxisData(points, pairs, axis = null){
    const left = geom.meanVector(pairs.map(([il]) => points[il]));
    const right = geom.meanVector(pairs.map(([,ir]) => points[ir]));
    const center = geom.axpby(0.5, left, 0.5, right);
    if(!axis){    
      const diff = geom.axpby(
        1, left, -1, right
      );
      axis = geom.rightNormal(diff);
    }

    // make axis unitary
    const len = geom.length(axis);
    if(len < 1e-3){
      return [center, null]; // not a safe action

    } else {
      return [center, geom.scale(axis, 1/len)];
    }
  }

  nodeAction(uictx, indices){
    if(indices.length < 2)
      return;
    const points = indices.map(idx => this.curve.getPoint(idx));
    let pairs;
    if(this.curve.open)
      pairs = Symmetrize.trivialMatch(points);
    else
      pairs = Symmetrize.circularMatch(points, this.axis);
    
    // make all points corner points
    for(const idx of indices){
      this.curve.setControlMode(idx, Curve.CORNER);
    }

    // compute the center, and best axis if none given
    const [center, axis] = Symmetrize.getAxisData(
      points, pairs, this.axis
    );
    if(!axis)
      return; // not a safe action

    // symmetrize all pairs
    const symmetrize = (pl, pr) => {
      const plr = geom.reflectPointAcrossLine(pr, [center, axis]);
      const plm = geom.axpby(0.5, pl, 0.5, plr);
      const prm = geom.reflectPointAcrossLine(plm, [center, axis]);
      return [plm, prm];
    };
    for(const [il, ir] of pairs){
      const pl = points[il];
      const pr = points[ir];
      const [plm, prm] = symmetrize(pl, pr);
      this.curve.setPoint(indices[il], plm);
      this.curve.setPoint(indices[ir], prm);
      // take care of control points!
      for(const [wl, wr] of [
        [Curve.CTRL_START, Curve.CTRL_END],
        [Curve.CTRL_END, Curve.CTRL_START]
      ]){
        const cpl = this.curve.getControlPoint(indices[il], wl);
        const cpr = this.curve.getControlPoint(indices[ir], wr);
        if(cpl && cpr){
          const [cplm, cprm] = symmetrize(cpl.pos(), cpr.pos());
          this.curve.setControlPoint(indices[il], wl, cplm);
          this.curve.setControlPoint(indices[ir], wr, cprm);

        } else if(cpl){
          const cprm = geom.reflectPointAcrossLine(cpl.pos(), [center, axis]);
          this.curve.setControlPoint(indices[ir], wr, cprm);

        } else if(cpr){
          const cplm = geom.reflectPointAcrossLine(cpr.pos(), [center, axis]);
          this.curve.setControlPoint(indices[il], wl, cplm);
        }
        // else, nothing to do
      }
    } // endfor [il, ir] of pairs
  }
}

module.exports = SketchAction.register('symmetry', Symmetrize);