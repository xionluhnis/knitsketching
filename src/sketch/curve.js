// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const SketchObject = require('./object.js');
const geom = require('../geom.js');
const {
  LinearSegment, MirroredSegment, BezierSegment,
  autoSmoothBezier, catmullRomControls // catmullRomToBezier
} = require('./segment.js');
const Bezier = require('bezier-js');
const BezierUtil = Bezier.getUtils();
const { SEAM_AUTO, SEAM_MODES } = require('./seam.js');

// constants
// - degrees
const LINEAR      = 1;
const QUADRATIC   = 2;
const CUBIC       = 3;

// node types
const CORNER      = 'corner'; // default, with largest freedom
const SMOOTH      = 'smooth';
const SYMMETRIC   = 'symmetric';
const AUTOMATIC   = 'automatic';
const CR_UNIFORM  = 'cr0';
const CR_CENTER   = 'cr0.5';
const CR_CHORDAL  = 'cr1';

// control point
const START       = 'start';
const CTRL_START  = 'start';
const END         = 'end';
const CTRL_END    = 'end';
const OTHER_SIDE  = {
  [START]: END,
  [END]: START
};

// orientation
const CW  = -1;
const CCW = +1;

// automatic modes
const IS_AUTOMATIC = {
  [AUTOMATIC]: true,
  [CR_UNIFORM]: true,
  [CR_CENTER]: true,
  [CR_CHORDAL]: true
};

// alpha values
const CR_ALPHA = {
  [CR_UNIFORM]: 0,
  [CR_CENTER]: 0.5,
  [CR_CHORDAL]: 1
};

function normIndex(idx, len){
  if(idx < 0)
    idx += len;
  if(idx >= len)
    idx -= len;
  return idx;
}

class Curve extends SketchObject {
  constructor(open){
    super();
    this.points = [];
    this.ctrlPS = [];
    this.ctrlPE = [];
    this.ctrlModes = [];
    this.seamModes = [];
    this.open = open || false;
    // caching
    this.segments = [];
    this.cacheArea = 0;
    this.cacheCentroid = null;
    this.cacheExt = null;
    this.cachePoly = null;
  }

  get length(){ return this.points.length; }
  get segLength(){ return this.open ? this.length - 1 : this.length; }

  /**
   * Clear the cache when the transform changes
   */
  updateTransform(){
    this.clearCache();
  }

  /**
   * Clear the cache given a possibly indexed update.
   * This currently clears the entire segment cache to be easy.
   * It would be better to only clear the segments that have been invalidated
   * by the past update.
   *
   * @param index the index of change
   */
  clearCache(/* index */){
    this.segments = [];
    this.cacheArea = 0;
    this.cacheCentroid = null;
    this.cacheExt = null;
    this.cachePoly = null;
  }

  addPoint(pt, ctrlPS, ctrlPE, ctrlMode, seamMode){
    assert('x' in pt && 'y' in pt, 'Invalid point');
    const idx = this.points.length;
    this.points.push(pt);
    this.ctrlPS.push(ctrlPS ? ControlPoint.from(this, idx, CTRL_START, ctrlPS) : null);
    this.ctrlPE.push(ctrlPE ? ControlPoint.from(this, idx, CTRL_END, ctrlPE) : null);
    this.ctrlModes.push(ctrlMode || CORNER); // largest freedom
    this.seamModes.push(seamMode || SEAM_AUTO);
    this.clearCache();
  }

  insertPoint(index, pt, ctrlPS, ctrlPE, ctrlMode, seamMode){
    this.points.splice(index, 0, pt);
    this.ctrlPS.splice(index, 0, ctrlPS ? ControlPoint.from(this, index, CTRL_START, ctrlPS) : null);
    this.ctrlPE.splice(index, 0, ctrlPE ? ControlPoint.from(this, index, CTRL_END, ctrlPE) : null);
    this.ctrlModes.splice(index, 0, ctrlMode || CORNER);
    this.seamModes.splice(index, 0, seamMode || SEAM_AUTO);
    // update indices beyond
    for(let i = index + 1; i < this.length; ++i){
      // /!\ each control may not exist (linear / quadratic versions)
      if(this.ctrlPS[i])
        this.ctrlPS[i].index = i;
      if(this.ctrlPE[i])
        this.ctrlPE[i].index = i;
    }
    this.clearCache();
  }

  removePoint(index, noUpdate){
    assert(this.length > 3 || (this.open && this.length === 3),
      'Cannot remove that many points and stay a valid curve');
    index = normIndex(index, this.length);
    if(index == this.length - 1){
      // easy variant (no need to re-update controls)
      this.points.pop();
      this.ctrlPS.pop();
      this.ctrlPE.pop();
      this.ctrlModes.pop();
      this.seamModes.pop();

    } else {
      this.points.splice(index, 1);
      this.ctrlPS.splice(index, 1);
      this.ctrlPE.splice(index, 1);
      this.ctrlModes.splice(index, 1);
      this.seamModes.splice(index, 1);
      // update control point indices
      for(let i = index; i < this.length; ++i){
        if(this.ctrlPS[i])
          this.ctrlPS[i].index = i;
        if(this.ctrlPE[i])
          this.ctrlPE[i].index = i;
      }
    }
    // fix control invalid balance of control points
    const pcs = this.getControlPoint(index - 1, CTRL_START);
    const nce = this.getControlPoint(index + 0, CTRL_END);
    if(!pcs && nce){
      // transfer from END to START
      this.setControlPoint(index + 0, CTRL_END, null, true);
      this.setControlPoint(index - 1, CTRL_START, nce);
    }
    if(!noUpdate){
      this.updateControlPoints(index);
      this.updateControlPoints(index + 1);
    }
    this.clearCache();
  }

  getPoint(index){
    return this.points[normIndex(index, this.length)];
  }

  setPoint(index, pt, noUpdate){
    index = normIndex(index, this.length);
    this.points[index] = pt;
    if(!noUpdate)
      this.updateControlPoints(index);
    this.clearCache();
  }

  isFree(/* index */){
    return true; // basic curves have free points
  }

  setControlPoint(index, which, p, noUpdate){
    index = normIndex(index, this.length);
    if(which == CTRL_START){
      assert(index >= 0 && index < this.ctrlPS.length, 'Invalid index or state');
      if(!p){
        // reduction to linear
        this.ctrlPS[index] = null;
        this.ctrlPE[(index + 1) % this.points.length] = null;
        // always use corner mode for linear
        // since that allows anything (non-linear) in neighbors
        this.setControlMode(index, CORNER);
        this.setControlMode(index + 1, CORNER);
      } else if(!this.ctrlPS[index]){
        // create new pointer
        this.ctrlPS[index] = ControlPoint.from(this, index, which, p);
        if(!noUpdate)
          this.updateControlPoints(index, which);
      } else {
        // just update position
        this.ctrlPS[index].set(p, noUpdate);
      }
    } else {
      assert(which == CTRL_END, 'Invalid which argument', which);
      assert(index >= 0 && index < this.ctrlPE.length, 'Invalid index or state');
      if(!p){
        // reduction to quadratic (or linear)
        this.ctrlPE[index] = null;
        this.setControlMode(index, CORNER, noUpdate);
      } else if(!this.ctrlPE[index]){
        // create new pointer
        this.ctrlPE[index] = ControlPoint.from(this, index, which, p);
        if(!noUpdate)
          this.updateControlPoints(index, which);
      } else {
        // just update position
        this.ctrlPE[index].set(p, noUpdate);
      }
    }
    this.clearCache();
  }

  getControlPoint(index, which){
    index = normIndex(index, this.length);
    if(which == CTRL_START){
      return this.ctrlPS[index];
    } else {
      assert(which == CTRL_END, 'Invalid which argument', which);
      return this.ctrlPE[index];
    }
  }

  getControlDirection(index, which){
    index = normIndex(index, this.length);
    const cp = this.getControlPoint(index, which);
    if(cp){
      return geom.unitVector(cp.relPos());
    } else {
      if(which == CTRL_START){
        return geom.unitVector(geom.axpby(1, this.getPoint(index + 1), -1, this.getPoint(index)));
      } else {
        return geom.unitVector(geom.axpby(1, this.getPoint(index - 1), -1, this.getPoint(index)));
      }
    }
  }

  setControlMode(index, mode, noUpdate){
    index = normIndex(index, this.length);
    assert(index >= 0 && index < this.ctrlModes.length, 'Invalid index or state');
    if(!mode)
      mode = CORNER; // defaults to largest freedom
    if(this.open && (index == 0 || index == this.length - 1))
      mode = CORNER; // first and last must be corner for open curves
    this.ctrlModes[index] = mode;
    if(mode != CORNER && !noUpdate){
      if(IS_AUTOMATIC[mode])
        this.updateControlPoints(index);
      else
        this.updateControlPoints(index, CTRL_START); // random choice
    }
    this.clearCache();
  }

  getControlMode(index){
    return this.ctrlModes[normIndex(index, this.length)];
  }

  setSeamMode(segIdx, mode = SEAM_AUTO){
    segIdx = normIndex(segIdx, this.segLength);
    assert(segIdx >= 0 && segIdx < this.segLength, 'Invalid segIdx');
    assert(SEAM_MODES.includes(mode),
      'Invalid seam mode', mode);
    this.seamModes[segIdx] = mode;
  }

  getSeamMode(segIdx){
    return this.seamModes[normIndex(segIdx, this.segLength)];
  }

  getDegree(index){
    index = normIndex(index, this.length);
    let d = 1; // linear or higher
    if(this.getControlPoint(index, CTRL_START))
      ++d; // quadratic or higher
    if(this.getControlPoint(index + 1, CTRL_END))
      ++d; // cubic
    return d;
  }

  updateControlPoints(index, which){
    assert(index !== undefined, 'Require index to start update');
    // two variants:
    // - update from control point (which !== undefined)
    // - update from point (both control points could move)
    if(which !== undefined){
      // update the opposing control point
      this.updateControlPair(index, which);
    } else {
      // update this point if auto-smooth
      this.updateAutoNode(index);
    }
  }

  updateAutoNode(index, spread = true){
    index = normIndex(index, this.length);
    if(index < 0)
      index += this.points.length;
    if(index == this.points.length)
      index = 0;
    // if not automatic, skip
    const cmode = this.getControlMode(index);
    if(![AUTOMATIC, CR_UNIFORM, CR_CENTER, CR_CHORDAL].includes(cmode))
      return;

    // neighboring nodes
    const prev = this.getPoint(index - 1);
    const curr = this.getPoint(index);
    const next = this.getPoint(index + 1);
    // action depends on mode
    let cs, ce;
    switch(cmode){

      // prev-curr-next
      case AUTOMATIC: {
        // get controls
        [cs, ce] = autoSmoothBezier(prev, curr, next);
      } break;

      case CR_UNIFORM:
      case CR_CENTER:
      case CR_CHORDAL: {
        // check if full segment has same mode
        const alpha = CR_ALPHA[cmode];
        ({ cs, ce } = catmullRomControls(prev, curr, next, alpha));
        /*
        segment-based:

        const nmode = this.getControlMode(index + 1);
        if(nmode === cmode){
          const alpha = CR_ALPHA[cmode];
          const p0 = this.getPoint(index - 1);
          const p1 = this.getPoint(index + 0);
          const p2 = this.getPoint(index + 1);
          const p3 = this.getPoint(index + 2);
          
          // get controls
          const [cs, ce] = catmullRomToBezier(p0, p1, p2, p3, alpha);

          // no need to make prev and next segment cubic
          // = only setting controls of current segment
          this.setControlPoint(index + 0, CTRL_START, cs, true);
          this.setControlPoint(index + 1, CTRL_END,   ce, true);
        }
        // else we cannot compute valid controls
        // because the mode requires a full segment coverage

        // spread to neighbors
        if(spread){
          // i-3 i-2 [i-1 (i) i+1 i+2] i+3
          this.updateAutoNode(index - 3, false);
          this.updateAutoNode(index - 2, false);
          this.updateAutoNode(index - 1, false);
          this.updateAutoNode(index + 1, false);
          this.updateAutoNode(index + 2, false);
          this.updateAutoNode(index + 3, false);
        }
        */
      } break;

      default:
        assert.error('Unsupported control mode', cmode);
        return;
    }
    assert(cs && ce, 'Missing controls');

    //
    // /!\ if not cubic, this procedure makes it cubic
    // /!\ the order of setting things matters because of sketch links
    // = always set start side before end side of segments
    //

    // ensure neighboring points have control points on each side of this one
    // while setting control points of this auto-smooth node using formula
    // 1) previous start control point
    if(!this.getControlPoint(index - 1, CTRL_START)){
      const mid = geom.axpby(0.5, prev, 0.5, curr);
      this.setControlMode(index - 1, CORNER);
      this.setControlPoint(index - 1, CTRL_START, mid);
    }
    // 2) set control points of this automatic node
    this.setControlPoint(index, CTRL_START, cs, true);
    this.setControlPoint(index, CTRL_END,   ce, true);

    // 3) next end control point
    if(!this.getControlPoint(index + 1, CTRL_END)){
      const mid = geom.axpby(0.5, curr, 0.5, next);
      this.setControlMode(index + 1, CORNER);
      this.setControlPoint(index + 1, CTRL_END, mid);
    }

    // spread to neighbors
    if(spread){
      // i-2 [i-1 (i) i+1] i+2
      // this.updateAutoNode(index - 2, false);
      this.updateAutoNode(index - 1, false);
      this.updateAutoNode(index + 1, false);
      // this.updateAutoNode(index + 2, false);
    }
  }

  updateControlPair(index, from){
    index = normIndex(index, this.length);
    const degree = this.getDegree(index);
    // /!\ what about quadratic vs cubic curves?
    switch(this.getControlMode(index)){

      case SYMMETRIC:
        // controls must be symmetric
        if(degree === CUBIC){
          // only apply for cubic curves
          const p = this.getPoint(index);
          const cp1 = this.getControlPoint(index, from);
          const cp2 = geom.reflectPoint(cp1, p);
          this.setControlPoint(index, OTHER_SIDE[from], cp2, true);

        } else {
          this.setControlMode(index, CORNER, true);
        }
        return;

      case CR_UNIFORM:
      case CR_CENTER:
      case CR_CHORDAL:
      case AUTOMATIC:
        // switch to smooth
        this.setControlMode(index, SMOOTH, true);

        /* falls through */
      case SMOOTH:
        // controls must be on same line with point
        if(degree === CUBIC){
          const p = this.getPoint(index);
          const cp1 = this.getControlPoint(index, from);
          // get delta from cp1
          const fromCP1 = geom.axpby(1, p, -1, cp1);
          // generate cp2 using delta and original length
          const len2 = geom.distBetween(
            p,
            this.getControlPoint(index, OTHER_SIDE[from])
          );
          const cp2 = geom.axpby(1, p, len2, geom.unitVector(fromCP1));
          this.setControlPoint(index, OTHER_SIDE[from], cp2, true);
          
        } else {
          this.setControlMode(index, CORNER, true);
        }
        break;

      default:
        break;
    }
  }

  divideSegment(index, t = 0.5){
    index = normIndex(index, this.length);
    assert(t >= 0 && t <= 1, 'T value must be in (0;1)', t);

    // record initial degree
    const degree = this.getDegree(index);

    // split current segment at given t
    const segment = this.getSegment(index);
    const { left, right } = segment.split(t);
    const newPt = left.points[left.points.length - 1];

    // add new point
    if(index == this.length - 1){
      this.addPoint(newPt);
    } else {
      this.insertPoint(index + 1, newPt);
    }

    // update controls
    switch(degree){
      case QUADRATIC:
        this.setControlMode(index + 0, CORNER, true);
        this.setControlMode(index + 1, CORNER, true);
        this.setControlPoint(index + 0, CTRL_START, left.points[1], true);
        this.setControlPoint(index + 1, CTRL_START, right.points[1], true);
        break;

      case CUBIC:
        this.setControlMode(index + 1, CORNER, true); // temporary
        this.setControlPoint(index + 0, CTRL_START, left.points[1], true);
        this.setControlPoint(index + 1, CTRL_END,   left.points[2], true);
        this.setControlPoint(index + 1, CTRL_START, right.points[1], true);
        this.setControlPoint(index + 2, CTRL_END,   right.points[2], true);
        // set control to automatic for new point?
        // => smoothest setting
        // this.setControlMode(index + 1, AUTOMATIC, true);
        break;
    }
    
    // update control points
    this.updateControlPoints(index);
    this.updateControlPoints(index + 1);
    this.updateControlPoints(index + 2);
  }

  divideSegments(...indices){
    // sort in descending order
    // so that next indices are still valid
    indices.sort((a, b) => b - a);
    for(let i of indices){
      this.divideSegment(i);
    }
  }

  setSegmentMode(i1, i2, mode){
    assert(Math.abs((this.length + i2 - i1) % this.length) == 1, 'Invalid segment indices');
    if(i2 < i1 && i2 !== 0)
      [i2, i1] = [i1, i2]; // invert pair
    // now, i1 is the starting point
    // and  i2 is the ending point
    const currDegree = this.getDegree(i1);
    if(currDegree == mode)
      return; // nothing to do

    // set both sides to corner cases
    this.setControlMode(i1, CORNER);
    this.setControlMode(i2, CORNER);

    // update control points to match new degree
    switch(mode){

      // switch to linear (easy)
      case LINEAR:
        // remove control points
        this.setControlPoint(i1, CTRL_START, null);
        this.setControlPoint(i2, CTRL_END, null);
        break;

      // switch to quadratic
      case QUADRATIC: {
        const segment = this.getSegment(i1);
        const quad = Bezier.quadraticFromPoints(this.getPoint(i1), segment.get(0.5), this.getPoint(i2));
        this.setControlPoint(i1, CTRL_START, quad.points[1]);
        this.setControlPoint(i2, CTRL_END, null);
      } break;

      // switch to cubic
      case CUBIC: {
        const segment = this.getSegment(i1);
        let cp1, cp2;
        if(currDegree == 1){
          cp1 = segment.get(1/3);
          cp2 = segment.get(2/3);
        } else {
          assert(currDegree == 2, 'Invalid degree', currDegree);
          const cubic = Bezier.cubicFromPoints(this.getPoint(i1), segment.get(0.5), this.getPoint(i2));
          cp1 = cubic.points[1];
          cp2 = cubic.points[2];
        }
        this.setControlPoint(i1, CTRL_START,  cp1);
        this.setControlPoint(i2, CTRL_END,    cp2);
      } break;

      default:
        assert.error('Invalid mode', mode);
    }
  }

  getSegment(index){
    index = normIndex(index, this.length);
    if(this.segments[index])
      return this.segments[index];
    // create segment and put in cache
    let segment;
    switch(this.getDegree(index)){

      case LINEAR:
        segment = new LinearSegment(this.getPoint(index), this.getPoint(index + 1));
        break;

      case QUADRATIC:
        segment = new BezierSegment([
          this.getPoint(index),
          this.getControlPoint(index, CTRL_START),
          this.getPoint(index + 1)
        ]);
        break;

      case CUBIC:
        segment = new BezierSegment([
          this.getPoint(index),
          this.getControlPoint(index, CTRL_START),
          this.getControlPoint(index + 1, CTRL_END),
          this.getPoint(index + 1)
        ]);
        break;

      default:
        assert.error('Invalid degree');
        return null;
    }
    // if mirrored curve, wrap segment
    // => add (..., normalize) variants of functions
    //    to allow corrected results without projecting into shape space
    if(this.transform.mirrorX){
      segment = new MirroredSegment(segment);
    }

    // store segment in cache before returning it
    this.segments[index] = segment;
    return segment;
  }

  getSegmentLength(index){
    return this.getSegment(index).length() * this.fullScale;
  }

  setSegmentPoint(index, pos, t, d1){
    if(t < 0.05){
      // console.warn('t too small, modifying start point of segment');
      this.setPoint(index, pos);
      return;
    } else if(t > 0.95){
      // console.warn('t too large, modifying end point of segment');
      this.setPoint(index + 1, pos);
      return;
    }
    index = normIndex(index, this.length);
    const i1 = index;
    const i2 = normIndex(i1 + 1, this.length);
    // upgrade linear to cubic, keep rest
    if(this.getDegree(index) === LINEAR){
      this.setSegmentMode(i1, i2, CUBIC);
    }
    // set both sides to corner cases
    this.setControlMode(i1, CORNER);
    this.setControlMode(i2, CORNER);

    // check we are not already too close
    const segment = this.getSegment(index);
    const currPos = segment.get(t);
    if(geom.distBetween(currPos, pos) < 1e-3)
      return; // nothing to do, close enough!
    
    // else we must change the control points have that segment
    // match the given point at the given parameter t

    // depends on the degree
    const d = this.getDegree(index);
    assert(d > 1, 'Invalid degree');
    const ps = this.points[i1];
    const pe = this.points[i2];

    // 1) Quadratic case
    if(d === QUADRATIC){
      const quadBezier = Bezier.quadraticFromPoints(ps, pos, pe, t);
      const cp = quadBezier.points[1];
      this.setControlPoint(index, CTRL_START, cp);

    } else {
      // 2) Cubic case
      assert(d === CUBIC, 'Invalid degree', d);
      if(!d1){
        const ut = BezierUtil.projectionratio(t, d);
        const C = geom.axpby(ut, ps, 1-ut, pe);
        d1 = geom.distBetween(C, pos);
      }
      const cubicBezier = Bezier.cubicFromPoints(ps, pos, pe, t, d1);
      const c1 = cubicBezier.points[1];
      const c2 = cubicBezier.points[2];
      this.setControlPoint(i1, CTRL_START, c1);
      this.setControlPoint(i2, CTRL_END,   c2);
    }
  }

  get type(){
    return 'curve';
  }

  getClosestSegment(pos, withData = false){
    let closestSeg  = -1;
    let closestProj = null;
    let closestDist = Infinity;
    for(let segIdx = 0; segIdx < this.segLength; ++segIdx){
      const segment = this.getSegment(segIdx);
      const proj = segment.project(pos);
      const dist = geom.distBetween(proj, pos);
      if(dist < closestDist){
        closestSeg  = segIdx;
        closestProj = proj;
        closestDist = dist;
      } // endif dist < closestDist
    } // endfor segIdx < segLength
    return !withData ? closestSeg : {
      segIdx: closestSeg,
      proj:   closestProj,
      dist:   closestDist
    };
  }

  getNearbySegments(pos, radius, withData = false){
    const sqRadius = radius * radius;
    const list = [];
    let closestSqDist = Infinity;
    let closestIndex  = -1;
    for(let segIdx = 0; segIdx < this.segLength; ++segIdx){
      const segment = this.getSegment(segIdx);
      const proj = segment.project(pos);
      const sqDist = geom.sqDistBetween(pos, proj);
      if(geom.below(sqDist, sqRadius)){
        if(withData){
          list.push({ segIdx, proj, closest: false });

          // if closest, then record
          if(sqDist < closestSqDist){
            closestSqDist = sqDist;
            closestIndex  = list.length - 1;
          }
        } else {
          list.push(segIdx);
        }
      }
    }
    if(withData && closestIndex !== -1){
      list[closestIndex].closest = true; // mark closest
    }
    return list;
  }

  copy(newCurve) {
    newCurve = super.copy(newCurve || new Curve());
    newCurve.points = this.points.map(({x,y}) => ({x,y}));
    newCurve.ctrlPS = this.ctrlPS.map((cp, index) => cp ? ControlPoint.from(newCurve, index, CTRL_START, cp.pos()) : cp);
    newCurve.ctrlPE = this.ctrlPE.map((cp, index) => cp ? ControlPoint.from(newCurve, index, CTRL_END, cp.pos()) : cp);
    newCurve.ctrlModes = this.ctrlModes.slice();
    newCurve.seamModes = this.seamModes.slice();
    newCurve.open = !!this.open;
    return newCurve;
  }

  serialize(opts){
    return Object.assign(super.serialize(opts), {
      points: this.points.map(p => Object.assign({}, p)),
      ctrlPS: this.ctrlPS.map(cp => cp ? cp.pos() : null),
      ctrlPE: this.ctrlPE.map(cp => cp ? cp.pos() : null),
      ctrlModes: this.ctrlModes.slice(),
      seamModes: this.seamModes.slice(),
      open: !!this.open
    });
  }
  deserialize(data, map, useID) {
    super.deserialize(data, map, useID);
    // /!\ we MUST not use the data directly, because it can end up
    // in the history snapshots (for the first one that gets loaded)
    // which then creates references in the first history snapshot
    // and we don't get proper undo/redo as a result

    // create point copies (to avoid reference issues in history)
    assert(Array.isArray(data.points), 'Invalid point array');
    this.points = data.points.map(p => Object.assign({}, p));
    // create control points
    assert(Array.isArray(data.ctrlPS), 'Invalid start control point array');
    this.ctrlPS = data.ctrlPS.map((cp, index) => cp ? ControlPoint.from(this, index, CTRL_START, cp) : null);
    assert(Array.isArray(data.ctrlPE), 'Invalid end control point array');
    this.ctrlPE = data.ctrlPE.map((cp, index) => cp ? ControlPoint.from(this, index, CTRL_END, cp) : null);
    assert(Array.isArray(data.ctrlModes), 'Invalid control mode array');
    this.ctrlModes = data.ctrlModes.slice();
    // create default seam modes if necessary
    if(data.seamModes)
      this.seamModes = data.seamModes.slice();
    else
      this.seamModes = data.ctrlModes.map(() => SEAM_AUTO);
    // openness
    this.open = !!data.open;
    // check cardinalities match
    assert(this.length === this.ctrlPS.length
        && this.length === this.ctrlPE.length
        && this.length === this.ctrlModes.length
        && this.length === this.seamModes.length,
      'Cardinality is uneven');
  }

  startX(){ return this.points[0].x; }
  startY(){ return this.points[0].y; }
  lastX(){ return this.points[this.points.length - 1].x; }
  lastY(){ return this.points[this.points.length - 1].y; }

  extents(currExt){
    // get curve extents
    if(!this.cacheExt) {
      // compute local extents
      // and store in cache
      const p0 = Object.assign({}, this.points[0]);
      this.cacheExt = this.points.reduce(({ min, max }, p, index) => {
        // in case linear or end of curve, we only consider the point
        if(this.getDegree(index) === LINEAR
        || (index == this.length - 1 && this.open)){
          return {
            min: {
              x: Math.min(min.x, p.x),
              y: Math.min(min.y, p.y)
            },
            max: {
              x: Math.max(max.x, p.x),
              y: Math.max(max.y, p.y)
            }
          };
        } else {
          // consider full segment (quad or cubic)
          const { x, y } = this.getSegment(index).bbox();
          // /!\ segment bbox uses struture { x: { min, max} y: { min, max } }
          // because of bezier.js
          return {
            min: {
              x: Math.min(min.x, x.min),
              y: Math.min(min.y, y.min)
            },
            max: {
              x: Math.max(max.x, x.max),
              y: Math.max(max.y, y.max)
            }
          };
        }
      }, {
        min: p0, max: p0
      });
    }
    // use cache
    const ext = this.cacheExt;
    if(currExt){
      // combine extents with argument
      return {
        min: {
          x: Math.min(ext.min.x, currExt.min.x),
          y: Math.min(ext.min.y, currExt.min.y)
        },
        max: {
          x: Math.max(ext.max.x, currExt.max.x),
          y: Math.max(ext.max.y, currExt.max.y)
        }
      };
    } else {
      // create copy (so the cache does not get modified)
      return {
        min: Object.assign({}, ext.min),
        max: Object.assign({}, ext.max)
      };
    }
  }

  getPolygon(){
    if(!this.cachePoly){
      // create approximation polygon
      const poly = this.cachePoly = [];
      if(this.open)
        poly.push(this.getPoint(0));
      for(let segIdx = 0; segIdx < this.segLength; ++segIdx){
        const seg = this.getSegment(segIdx);
        if(this.getDegree(segIdx) > LINEAR){
          // add LUT past first point
          const lut = seg.getLUT(32);
          for(let i = 1; i < lut.length; ++i)
            poly.push(lut[i]);
        } else {
          // just add end point for linear cases
          poly.push(seg.get(1));
        }
      } 
    }
    return this.cachePoly;
  }

  hitTest(p){
    if(this.open)
      return false; // cannot be trigger hit test if open
    if(!this.withinExtents(p))
      return false; // not within bbox
    // else, check if within reduced polygon
    const poly = this.getPolygon();
    return geom.polyContains(poly, p);
  }

  /**
   * Simplified signed area of 1st order polygon underlying the points
   *
   * /!\ This is not the actual area since our curve may be 2nd or 3rd order!
   */
  get signedArea(){
    // recompute signed area if not cached
    if(!this.cacheArea){
      this.cacheArea = geom.signedArea(this.points);
    }
    return this.cacheArea;
  }

  /**
   * Simplified area of 1st order polygon
   *
   * @return the area of the 1st order polygon spanned by this curve's points
   */
  get area(){
    return Math.abs(this.signedArea);
  }

  /**
   * Orientation of the closed curve
   *
   * Assumes the axis orientation from canvas:
   * (0,0) at top-left
   * (h,w) at bottom-right
   *
   * Takes into account the mirrorX transform since that flips the orientation.
   *
   * @see https://stackoverflow.com/questions/1165647/how-to-determine-if-a-list-of-polygon-points-are-in-clockwise-order/
   */
  get orientation(){ return this.mirrorSign * this.localOrientation; }
  get mirrorSign(){ return this.transform.mirrorX ? -1 : 1; }
  get localOrientation(){ return Math.sign(this.signedArea); }

  isCCW(){ return this.orientation === CCW; }
  isCW(){  return this.orientation === CW; }
  isOutward(){ return this.orientation == CCW; }
  isInward(){ return this.orientation == CW; }

  get label(){
    return '#' + this.id + ' | ' + (this.name.length ? this.name : 'sketch');
  }

  get centroid() {
    if(!this.cacheCentroid){
      // compute local centroid and store in cache
      const ratio = 1.0 / Math.max(1, this.points.length);
      this.cacheCentroid = this.points.reduce(({ x, y }, pt) => {
        return {
          x: x + pt.x * ratio,
          y: y + pt.y * ratio
        };
      }, { x: 0, y: 0 });
    }
    // return copy of cache
    return Object.assign({}, this.cacheCentroid);
  }

  /**
   * Shift points of curve while applying the opposite
   * shift in the transform so that no point changes.
   *
   * This is useful to select the scaling center within
   * the local context, necessary for mirroring
   *
   * @param p { x, y } shift to apply
   * @param alpha factor (typically 1 or -1) to the shift
   */
  shiftAll({ x, y }, alpha){
    // update points
    for(let i = 0; i < this.length; ++i){
      this.points[i].x += alpha * x;
      this.points[i].y += alpha * y;
      // /!\ control information is relative to point
      // so we don't have to update it (since it did not change)
    }
    // update transform
    this.setTransform(this.transform.translatedBy(-alpha * x, -alpha * y));
  }

  /**
   * Apply the curve's scale to its data
   * and reset the transform to unit scale.
   *
   * The goal is to end up with the same geometric curve
   * while using a unit scale, which is easier to work with.
   *
   * @param recursive whether to apply the scale to the children
   */
  applyScale(recursive){
    const k = this.transform.k;
    if(k == 1)
      return; // nothing to do
    for(let i = 0; i < this.length; ++i){
      this.points[i].x *= k;
      this.points[i].y *= k;
      // control information must also be scaled
      const cs = this.ctrlPS[i];
      if(cs){
        cs.dx *= k;
        cs.dy *= k;
      }
      const ce = this.ctrlPE[i];
      if(ce){
        ce.dx *= k;
        ce.dy *= k;
      }
    }
    // apply on children
    for(let c of this.children){
      // transfer scale to child
      c.setTransform(c.transform.prescaledBy(k)); //  = Transform.scaling(k).combineWith(c.transform);
      // if recursive, apply scale of child
      if(recursive && c.applyScale)
        c.applyScale(recursive);
    }
    // applied on this
    this.transform.k = 1;
    this.updateTransform();
  }

  get perimeter() {
    // XXX cache
    let sum = 0;
    for(let i = 1; i < this.points.length; ++i){
      const p1 = this.points[i-1];
      const p2 = this.points[i+0];
      sum += geom.distBetween(p1, p2);
    }
    return sum;
  }

  /**
   * Draw the path corresponding to this curve on a rendering context
   *
   * @param ctx the rendering context
   */
  drawPath(ctx){
    ctx.beginPath();
    ctx.moveTo(this.startX(), this.startY());
    for(let i = 0, N = this.open ? this.length - 1 : this.length; i < N; ++i){
      // const { x: sx, y: sy } = curve.getPoint(i);
      // ctx.moveTo(sx, sy);
      // note: we should not use moveTo each time, else we get bezier arcs
      // @see https://stackoverflow.com/questions/25129081/canvas-fill-doesnt-work-as-expected-when-used-with-spline-lines
      const { x: ex, y: ey } = this.getPoint(i + 1);
      const deg = this.getDegree(i);
      switch(deg){
        case 1:
          ctx.lineTo(ex, ey);
          break;
        case 2: {
          const { x: csx, y: csy } = this.getControlPoint(i, CTRL_START);
          ctx.quadraticCurveTo(csx, csy, ex, ey);
        } break;
        case 3: {
          const { x: csx, y: csy } = this.getControlPoint(i, CTRL_START);
          const { x: cex, y: cey } = this.getControlPoint(i+1, CTRL_END);
          ctx.bezierCurveTo(csx, csy, cex, cey, ex, ey);
        } break;
      }
    }
    if(!this.open)
      ctx.closePath();
  }

  /**
   * Draw a segment of this curve on a given rendering context
   *
   * @param ctx the rendering context
   * @param i the segment's index
   */
  drawSegment(ctx, i){
    ctx.beginPath();
    const { x: sx, y: sy } = this.getPoint(i);
    ctx.moveTo(sx, sy);
    const { x: ex, y: ey } = this.getPoint(i + 1);
    const deg = this.getDegree(i);
    switch(deg){
      case 1:
        ctx.lineTo(ex, ey);
        break;
      case 2: {
        const { x: csx, y: csy } = this.getControlPoint(i, CTRL_START);
        ctx.quadraticCurveTo(csx, csy, ex, ey);
      } break;
      case 3: {
        const { x: csx, y: csy } = this.getControlPoint(i, CTRL_START);
        const { x: cex, y: cey } = this.getControlPoint(i+1, CTRL_END);
        ctx.bezierCurveTo(csx, csy, cex, cey, ex, ey);
      } break;
    }
  }

  /**
   * Create a curve from a SVG path string
   *
   * /!\ Currently support most path commands, except the arc ones.
   * @see https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d
   *
   * @param path the string representing the curve path
   * @return the new curve
   */
  static fromString(path){
    // @see https://developer.mozilla.org/en-US/docs/Web/SVG/Attribute/d
    const curve = new Curve();
    curve.open = true; // open by default!
    let pos = { x: 0, y: 0 };
    const copyPos = () => {
      pos = { x: pos.x, y: pos.y };
      return pos;
    };
    const usePos = () => {
      const p = copyPos();
      copyPos(); // second copy for future
      return p;
    };
    // path tokens
    const tokens = path.replace(/ +/g, ' ')
                       .replace(/ +,/g, ',')
                       .replace(/, +/g, ',').split(' ');
    let mode = null;
    for(let i = 0; i < tokens.length; ++i){
      const tkn = tokens[i];
      // skip empty tokens
      if(tkn == ' ' || !tkn.length)
        continue;
      if(tkn.toLowerCase() == 'z'){
        // closing
        assert(i == tokens.length - 1, 'Closing as intermediate command');
        curve.open = false;

      } else if('MmLlHhVvCcSsQqTtAa'.includes(tkn.charAt(0))){
        // switching mode
        mode = tkn.charAt(0);
        assert(tkn.length === 1, 'Invalid multi-character mode?');

      } else {
        // command arguments depend on mode
        const isAbsolute = mode.toUpperCase() == mode;
        const hasNextToken = i < tokens.length - 1;
        const hasNextNextToken = i < tokens.length - 2;
        switch(mode.toLowerCase()){

          // moveto
          case 'm': {
            const [x, y] = tkn.split(',').map(n => parseFloat(n));
            if(isAbsolute)
              pos = { x, y };
            else {
              pos.x += x;
              pos.y += y;
            }
            // switch mode to implicit lineto
            mode = isAbsolute ? 'L' : 'l';
          } break;

          // lineto
          case 'l': {
            const [x, y] = tkn.split(',').map(n => parseFloat(n));
            if(!curve.points.length){
              curve.addPoint(usePos()); // previous point become first point
            }
            if(isAbsolute){
              pos = { x, y };
            } else {
              copyPos();
              pos.x += x;
              pos.y += y;
            }
            curve.addPoint(usePos()); // new point from lineto
          } break;

          // horizontal line
          case 'h': {
            const h = parseFloat(tkn);
            if(!curve.points.length){
              curve.addPoint(usePos()); // previous point become first point
            }
            if(isAbsolute){
              pos.x = h;
            } else {
              pos.x += h;
            }
            curve.addPoint(usePos());
          } break;

          // vertical line
          case 'v': {
            const v = parseFloat(tkn);
            if(!curve.points.length){
              curve.addPoint(usePos());
            }
            if(isAbsolute){
              pos.y = v;
            } else {
              pos.y += v;
            }
            curve.addPoint(usePos());
          } break;

          // cubic bezier
          case 'c': {
            assert(hasNextToken && hasNextNextToken, 'Invalid sequence');
            let [csx, csy] = tkn.split(',').map(n => parseFloat(n));
            let [cex, cey] = tokens[i+1].split(',').map(n => parseFloat(n));
            const [x, y] = tokens[i+2].split(',').map(n => parseFloat(n));
            if(!curve.points.length){
              curve.addPoint(usePos());
            }
            if(isAbsolute){
              pos = { x, y };
            } else {
              csx += pos.x;
              csy += pos.y;
              cex += pos.x;
              cey += pos.y;
              // /!\ order is important!
              // control points are relative to starting point (previous point)
              pos.x += x;
              pos.y += y;
            }
            // add starting control point (with current starting point)
            curve.setControlPoint(-1, CTRL_START, { x: csx, y: csy });
            // add ending point
            curve.addPoint(usePos());
            // add ending control point (located with ending point)
            curve.setControlPoint(-1, CTRL_END,   { x: cex, y: cey });

            // increment
            i += 2;
          } break;

          // smooth cubic bezier
          case 's': {
            assert(hasNextToken, 'Invalid sequence');
            let [cex, cey] = tkn.split(',').map(n => parseFloat(n));
            const [x, y] = tokens[i+1].split(',').map(n => parseFloat(n));
            if(!curve.points.length){
              curve.addPoint(usePos());
            }
            // compute starting control point
            // - if previously cubic = a reflection of the previous end control point around the starting point
            // - else = same as starting point
            const ctrlPE = this.getControlPoint(-1, CTRL_END);
            let csx, csy;
            if(ctrlPE){
              // reflection of previous ending control point around the current starting point
              csx = pos.x + (pos.x - ctrlPE.x);
              csy = pos.y + (pos.y - ctrlPE.y);
            } else {
              // same as starting point
              csx = pos.x;
              csy = pos.y;
            }
            // add starting control point (with current starting point)
            curve.setControlPoint(-1, CTRL_START, { x: csx, y: csy });
            // specify symmetric mode
            curve.setControlMode(-1, SYMMETRIC);

            // compute end point and control point
            if(isAbsolute){
              pos = { x, y };
            } else {
              cex += pos.x;
              cey += pos.y;
              pos.x += x;
              pos.y += y;
            }
            // add ending point
            curve.addPoint(usePos());
            // add ending control point (located with ending point)
            curve.setControlPoint(-1, CTRL_END,   { x: cex, y: cey });

            // increment
            i += 1;
          } break;

          // quadratic bezier
          case 'q': {
            assert(hasNextToken, 'Invalid sequence');
            let [csx, csy] = tkn.split(',').map(n => parseFloat(n));
            const [x, y] = tokens[i+1].split(',').map(n => parseFloat(n));
            if(!curve.points.length){
              curve.addPoint(usePos());
            }
            if(isAbsolute){
              pos = { x, y };
            } else {
              csx += pos.x;
              csy += pos.y;
              // /!\ order is important!
              // control points are relative to starting point (previous point)
              pos.x += x;
              pos.y += y;
            }
            // add starting control point (with current starting point)
            curve.setControlPoint(-1, CTRL_START, { x: csx, y: csy });
            // add ending point
            curve.addPoint(usePos());

            // increment
            i += 1;
          } break;

          // smooth quadratic bezier
          case 't': {
            const [x, y] = tkn.split(',').map(n => parseFloat(n));
            if(!curve.points.length){
              curve.addPoint(usePos());
            }
            // compute starting control point
            // - if previously quadratic = a reflection of the previous start control point around the current starting point
            // - else = same as current starting point
            const ctrlPS = this.getControlPoint(-2, CTRL_START);
            const ctrlPE = this.getControlPoint(-2, CTRL_END);
            let csx, csy;
            // /!\ previous ctrlPS but not ctrlPE (else cubic!)
            if(ctrlPS && !ctrlPE){
              // reflection of previous ending control point around the current starting point
              csx = pos.x + (pos.x - ctrlPS.x);
              csy = pos.y + (pos.y - ctrlPS.y);
            } else {
              // same as starting point
              csx = pos.x;
              csy = pos.y;
            }
            // add starting control point (with current starting point)
            curve.setControlPoint(-1, CTRL_START, { x: csx, y: csy });
            // specify symmetric mode
            curve.setControlMode(-1, SYMMETRIC);

            // compute end point
            if(isAbsolute){
              pos = { x, y };
            } else {
              pos.x += x;
              pos.y += y;
            }
            // add ending point
            curve.addPoint(usePos());
          } break;

        }
      }
    }
    const ps = curve.getPoint(0);
    const pe = curve.getPoint(-1);
    // closed surface may need merging of last and first points
    if(curve.length > 3
    && !curve.open
    && geom.distBetween(ps, pe) <= 1e-3
    && !curve.getControlPoint(0, CTRL_END)
    && !curve.getControlPoint(-1, CTRL_START)){
      // merge last and first
      const ce = curve.getControlPoint(-1, CTRL_END);
      curve.setControlPoint(0, CTRL_END, ce, true);
      curve.removePoint(-1);
    }
    return curve;
  }

  /**
   * Create the path data string representing this curve.
   *
   * @see Curve.fromString(path)
   * @return a string representing this curve
   */
  pathString(){
    let data = 'M ' + this.startX() + ',' + this.startY() + ' ';
    let mode = LINEAR;
    for(let i = 0, N = this.segLength; i < N; ++i){
      const { x, y } = this.getPoint(i + 1);
      const d = this.getDegree(i);
      if(mode != d){
        mode = d;
        switch(d){
          case LINEAR:    data += 'L '; break;
          case QUADRATIC: data += 'Q '; break;
          case CUBIC:     data += 'C '; break;
          default:          data += '? '; break; // this is for debugging
        }
      }
      if(d != LINEAR) {
        const { x: csx, y: csy } = this.getControlPoint(i, CTRL_START);
        data += csx + ',' + csy + ' ';
        if(d == CUBIC){
          const { x: cex, y: cey } = this.getControlPoint(i + 1, CTRL_END);
          data += cex + ',' + cey + ' ';
        }
      }
      data += x + ',' + y + ' ';
    }
    if(!this.open)
      data += 'Z';
    else
      data = data.slice(0, data.length - 1); // remove last unnecessary white space
    return data;
  }
}

/**
 * Curve control point
 *
 * Control points are relative to their corresponding main point.
 * Thus moving a point doesn't change the control point content,
 * unless that point is auto-smooth in which case it does recompute
 * the control point location given the neighboring point locations.
 *
 * @param parent the actual curve
 * @param index the control index within the parent
 * @param side the control side within the parent
 * @param dx the relative x location
 * @param dy the relative y location
 */
class ControlPoint {
  constructor(parent, index, side, dx, dy){
    this.parent = parent;
    this.index  = index;
    this.side   = side;
    this.dx = dx || 0;
    this.dy = dy || 0;
  }

  static from(curve, index, side, { x, y }){
    const { x: x0, y: y0 } = curve.points[index];
    return new ControlPoint(curve, index, side, x - x0, y - y0);
    // /!\ must not update yet since not assigned!
  }

  set({ x, y }, noUpdate){
    const p = this.parent.points[this.index];
    this.dx = x - p.x;
    this.dy = y - p.y;
    if(!noUpdate)
      this.parent.updateControlPoints(this.index, this.side);
  }

  setRel({ x, y }, noUpdate){
    this.dx = x;
    this.dy = y;
    if(!noUpdate)
      this.parent.updateControlPoints(this.index, this.side);
  }

  get x(){
    return this.parent.points[this.index].x + this.dx;
  }

  get y(){
    return this.parent.points[this.index].y + this.dy;
  }

  pos(){
    const { x, y } = this.parent.points[this.index];
    return {
      x: x + this.dx,
      y: y + this.dy
    };
  }

  relPos(){
    return { x: this.dx, y: this.dy };
  }

  copy(newParent){
    return ControlPoint(newParent || this.parent, this.index, this.side, this.dx, this.dy);
  }
}

module.exports = Object.assign(Curve, {
  // degrees
  LINEAR, QUADRATIC, CUBIC,
  // node types
  CORNER, SMOOTH, SYMMETRIC, AUTOMATIC,
  CR_UNIFORM, CR_CENTER, CR_CHORDAL,
  CR_ALPHA,
  // control points
  START, CTRL_START, END, CTRL_END,
  OTHER_SIDE,
  // automatic types
  IS_AUTOMATIC,
  // orientations
  CW, CCW
});
