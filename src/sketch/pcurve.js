// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const geom = require('../geom.js');
const SketchObject = require('./object.js');
// const { CTRL_START, CTRL_END } = require('./curve.js');
const Transform = require('./transform.js');
const {
  Bezier, segmentFrom,
  catmullRomStartControl,
  catmullRomEndControl,
  catmullRomToBezier,
  linearStartControl,
  linearEndControl
} = require('./segment.js');
const { SEAM_AUTO, SEAM_MODES } = require('./seam.js');

// constants
// - cubicType
const CATMULL_ROM     = 'cr';
const SIMPLE_SPLINE   = 'ss';
const NORMAL_SPLINE   = 'ns';
const TANGENT_SPLINE  = 'ts';
// - startCtrl | endCtrl
const LINEAR  = 'linear';
const NORMAL  = 'normal';
const TANGENT = 'tangent';
const ANGLE   = 'angle';

function normIndex(index, length){
  if(index < 0)
    index += length;
  if(index >= length)
    index -= length;
  return index;
}

class ParametricCurve extends SketchObject {
  constructor(degree = 1, samples = null, isSubCurve = false){
    super();
    this.degree   = degree;
    this.samples  = samples || Array.from({ length: degree + 1 });

    // additional parameters
    this.subCurve     = isSubCurve;
    this.tval         = 0.5;
    this.cubicType    = CATMULL_ROM;
    this.startCtrl    = LINEAR;
    this.startWeight  = 1/3;
    this.startInvert  = false;
    this.startSine    = 0;
    this.endCtrl      = LINEAR;
    this.endWeight    = 1/3;
    this.endInvert    = false;
    this.endSine      = 0;
    this.firstWeight  = 1/3;
    this.firstInvert  = false;
    this.secondWeight = 1/3;
    this.secondInvert = false;
    this.crAlpha      = 0.5;
    this.crFull       = true;
    this.d1           = 0;
    this.seamMode     = SEAM_AUTO;

    // checks
    assert(Array.isArray(this.samples),
      'Invalid samples argument');
    assert(this.samples.length === degree + 1,
      'Invalid samples given degree');
    if(this.subCurve){
      assert(this.degree === 1, 'Sub-curves must be of degree 1');
    }

    // cache
    this.segments = [];
  }

  get type(){ return 'pcurve'; }
  get numSamples(){
    if(this.isSimpleSpline())
      return 2; // special simplified cubics with two points
    else
      return this.degree + 1;
  }
  get length(){ return this.numSamples; }
  get segLength(){
    if(this.degree === 3){
      if(this.isSimpleSpline()
      || (this.isCR() && !this.crFull))
        return 1;
      else
        return 3;
    } else {
      return 1; // linear or quadratic
    }
    // return (this.minNumSamples - 1) / this.degree;
  }
  get open(){ return true; }
  get firstSample(){ return this.samples[0]; }
  get lastSample(){ return this.samples[this.samples.length - 1]; }
  copy(){ return new ParametricCurve(this.degree, this.samples); }
  clearCache(){ this.segments = []; }
  hasConstraint(){
    return this.parent && !!this.parent.getConstraint(this);
  }
  setSeamMode(segIdx, mode = SEAM_AUTO){
    assert(segIdx >= 0 && segIdx < this.segLength, 'Invalid segIdx');
    assert(SEAM_MODES.includes(mode),
      'Invalid seam mode', mode);
    this.seamMode = mode;
  }

  getSeamMode(/* segIdx */){ return this.seamMode; }

  // Curve interface
  getDegree(){ return this.degree; }
  isSimpleSpline(){
    return this.degree === 3 && this.cubicType === SIMPLE_SPLINE;
  }
  isCR(){ return this.degree === 3 && this.cubicType === CATMULL_ROM; }
  getGlobalPoint(index){
    index = normIndex(index, this.numSamples);
    const sample = this.samples[index];
    return sample ? sample.getPosition() : null;
  }
  getLocalPoint(index){
    const globalPoint = this.getGlobalPoint(index);
    if(!globalPoint)
      return null;
    return this.globalToLocal(globalPoint);
  }
  getPoint(index){ return this.getLocalPoint(index); }
  get points(){
    return this.samples.map((s, idx) => s ? this.getPoint(idx) : null);
  }
  get validPoints(){
    return this.samples.flatMap((s, idx) => {
      return s && s.isValid() ? [this.getPoint(idx)] : [];
    });
  }
  set transform(val){ val = null; }
  get transform(){
    if(this.parent && !this.subCurve){
      return this.parent.fullTransform.inverse();
    } else {
      return new Transform();
    }
  }
  localToGlobal(p){
    if(this.parent && this.subCurve)
      return this.parent.localToGlobal(p);
    else
      return p;
  }
  globalToLocal(p){
    if(this.parent && this.subCurve)
      return this.parent.globalToLocal(p);
    else
      return p;
  }
  get fullTransform(){
    if(this.parent && this.subCurve)
      return this.parent.fullTransform;
    else
      return new Transform();
  }
  get centroid(){ return geom.meanVector(this.validPoints); }

  isCubicStart(segIdx){
    assert(!isNaN(segIdx), 'Argument must be an integer', segIdx);
    return segIdx === 0;
  }
  isCubicEnd(segIdx){
    assert(!isNaN(segIdx), 'Argument must be an integer', segIdx);
    return segIdx === this.segLength - 1;
  }

  getSegmentPointIndices(segIdx){
    // check that the samples are all ready
    // /!\ this also checks for validity
    // => no self-referencing anywhere in the dependency graph
    if(!this.isComplete())
      return [];

    // linear+quad => single segment
    if(this.segLength === 1)
      return this.samples.map((_, idx) => idx);

    // cubic => start + mid(s) + end
    if(this.isCubicStart(segIdx)){
      return [0, 1, 2];

    } else if(this.isCubicEnd(segIdx)){
      return [3, 2, 1].map(i => this.samples.length - i);

    } else {
      const indices = [];
      for(let i = 0; i <= this.degree; ++i){
        // groups of 4, all shifted by one
        // /!\ groups are overlapping because we only
        // generate segments for samples 1+2 out of [0,1,2,3]
        indices.push(segIdx - 1 + i);
      }
      return indices;
    }
  }

  getSegmentPoints(segIdx){
    const indices = this.getSegmentPointIndices(segIdx);
    return indices.map(idx => this.samples[idx].getPosition());
  }

  getSegment(segIdx){
    // check cache first
    // if(this.segments[index])
    //  return this.segments[index];

    // get associated points
    const sampIndices = this.getSegmentPointIndices(segIdx);
    if(!sampIndices.length)
      return null;
    const points = sampIndices.map(idx => this.samples[idx].getPosition());

    // create segment (and cache it)
    let path;
    switch(this.degree){

      case 1:
        if(this.subCurve){
          assert(this.samples[0].curve === this.samples[1].curve,
            'Sub-curve samples must be of the same curve');
          assert(this.samples[0].segIdx === this.samples[1].segIdx,
            'Sub-curve samples must be of the same segment');
          const [s0, s1] = this.samples;
          // return segment split from curve directly!
          let t0 = s0.sampT;
          let t1 = s1.sampT;
          if(t0 > t1)
            [t0, t1] = [t1, t0]; // inversion to have t0 <= t1
          return s0.getSegment().split(t0, t1);

        } else {
          path = points;
        }
        break;

      case 2:
        path = Bezier.quadraticFromPoints(
          points[0], points[1], points[2], this.tval
        ).points;
        break;

      case 3:
        path = this.getCubicPath(segIdx, points, sampIndices);
        break;
    }
    this.segments[segIdx] = segmentFrom(path, this.transform.mirrorX);
    return this.segments[segIdx];
  }
  getSegmentLength(segIdx){
    const seg = this.getSegment(segIdx);
    return seg ? seg.length() : -1;
  }

  getCubicStartCtrl(ps, pm /*, pe */){
    const invFactor = this.startInvert ? -1 : 1;
    switch(this.startCtrl){

      case LINEAR:
        return linearStartControl(
          ps, pm, this.startWeight
        );

      case NORMAL:
        return geom.axpby(
          1, ps, 
          this.startWeight * geom.distBetween(ps, pm) * invFactor,
          this.firstSample.getInnerNormal()
        );

      case TANGENT:
        return geom.axpby(
          1, ps,
          this.startWeight * geom.distBetween(ps, pm) * invFactor, 
          this.firstSample.getTangent()
        );

      case ANGLE: {
        const sin = this.startSine;
        const cos = Math.sqrt(1 - sin * sin); // c^2+s^2=1 => c=+/-sqrt(1-s^2)
        const ang = geom.axpby(
          cos, this.firstSample.getInnerNormal(),
          sin, this.firstSample.getTangent()
        );
        return geom.axpby(
          1, ps,
          this.startWeight * geom.distBetween(ps, pm) * invFactor,
          ang
        );
      }

      default:
        assert.error('Unsupported control type', this.startCtrl);
        return { x: NaN, y: NaN };
    }
  }

  getCubicEndCtrl(pm, pe){
    const invFactor = this.endInvert ? -1 : 1;
    switch(this.endCtrl){

      case LINEAR:
        return linearEndControl(
          pm, pe, this.endWeight
        );

      case NORMAL:
        return geom.axpby(
          1, pe,
          this.endWeight * geom.distBetween(pm, pe) * invFactor,
          this.lastSample.getInnerNormal()
        );

      case TANGENT:
        return geom.axpby(
          1, pe,
          this.endWeight * geom.distBetween(pm, pe) * invFactor,
          this.lastSample.getTangent()
        );

      case ANGLE: {
        const sin = this.endSine;
        const cos = Math.sqrt(1 - sin * sin); // c^2+s^2=1 => c=+/-sqrt(1-s^2)
        const ang = geom.axpby(
          cos, this.lastSample.getInnerNormal(),
          sin, this.lastSample.getTangent()
        );
        return geom.axpby(
          1, pe,
          this.endWeight * geom.distBetween(pm, pe) * invFactor,
          ang
        );
      }

      default:
        assert.error('Unsupported control type', this.endCtrl);
        return { x: NaN, y: NaN };
    }
  }

  getCubicPath(segIdx, points, sampIndices){
    if(!points)
      points = this.getSegmentPoints(segIdx);
    if(this.segLength > 1){
      const avgDist = (ps, pm, pe) => {
        return 0.5 * geom.distBetween(ps, pm) + 0.5 * geom.distBetween(pm, pe);
      };
      // three cases
      // - start segment
      // - mid segment
      // - end segment
      if(this.isCubicStart(segIdx)){
        assert(points.length === 3,
          'Invalid start points', points.length);
        const [ps, pm, pe] = points;
        const ce = catmullRomEndControl(
          ps, pm, pe,
          geom.distBetween(ps, pm),
          geom.distBetween(pm, pe),
          this.crAlpha
        );
        return [
          ps,
          this.getCubicStartCtrl(ps, pm, pe),
          ce,
          pm
        ];

      } else if(this.isCubicEnd(segIdx)){
        assert(points.length === 3,
          'Invalid end points', points.length);
        const [ps, pm, pe] = points;
        const cs = catmullRomStartControl(
          ps, pm, pe,
          geom.distBetween(ps, pm),
          geom.distBetween(pm, pe),
          this.crAlpha
        );
        return [
          pm,
          cs,
          this.getCubicEndCtrl(pm, pe),
          pe
        ];

      } else {
        // mid segment
        assert(points.length === 4,
          'Invalid mid points', points.length);
        let cs, ce;
        switch(this.cubicType){
          
          case CATMULL_ROM:
            [cs, ce] = catmullRomToBezier(...points, this.crAlpha);
            break;

          case TANGENT_SPLINE:
          case NORMAL_SPLINE: {
            const invFactor0  = this.firstInvert ? -1 : 1;
            const invFactor1  = this.secondInvert ? -1 : 1;
            const midIndex0   = sampIndices[1];
            const midIndex1   = sampIndices[2];
            const [pp, p0, p1, pn] = points;
            let d0, d1;
            if(this.cubicType === TANGENT_SPLINE){
              d0 = geom.unitVector(this.samples[midIndex0].getTangent());
              d1 = geom.unitVector(this.samples[midIndex1].getTangent());
            } else {
              d0 = this.samples[midIndex0].getNormal();
              d1 = this.samples[midIndex1].getNormal();
            }
            cs = geom.axpby(
              1, p0,
              invFactor0 * this.firstWeight * avgDist(pp, p0, p1), d0
            );
            ce = geom.axpby(
              1, p1,
              -invFactor1 * this.secondWeight * avgDist(p0, p1, pn), d1
            );
          } break;

          default:
            assert.error('Unsupported cubic type', this.cubicType);
            cs = ce = { x: NaN, y: NaN };
            break;
        }
        return [
          points[1],
          cs, ce,
          points[2]
        ];
      } // endif else (mid-segment)
    } else if(this.isCR()){
      assert(!this.crFull,
        'CR curve with single segment cannot be full');
      assert(points.length === 4,
        'CR curves use 4 points', points.length);

      const [cs, ce] = catmullRomToBezier(...points, this.crAlpha);
      return [
        points[1],
        cs, ce,
        points[2]
      ];

    } else {
      assert(this.isSimpleSpline(),
        'Invalid cubic type', this.cubicType);
      assert(points.length === 2,
        'Simple cubic splines use 2 samples', points.length);
      const [ps, pe] = points;
      return [
        ps,
        this.getCubicStartCtrl(ps, pe),
        this.getCubicEndCtrl(ps, pe),
        pe
      ];
    }
  }

  extents(){
    // use inferred segment
    const segment = this.getSegment(0);
    if(!segment){
      return {
        min: { x: 0, y: 0 },
        max: { x: 0, y: 0 }
      };
    }
    // else we use the segment bbox
    // XXX go over all segments!
    const bbox = segment.bbox();
    return {
      min: { x: bbox.x.min, y: bbox.y.min },
      max: { x: bbox.x.max, y: bbox.y.max }
    };
  }

  setDegree(deg){
    assert([1, 2, 3].includes(deg), 'Invalid degree', deg);
    assert(!this.subCurve || deg === 1, 'Sub-curve must have degree 1', deg);
    this.degree = deg;
    // adjust number of samples
    this.updateSampleList();
  }

  updateSampleList(){
    const numSamples = this.numSamples;
    // 1. Remove excess
    while(this.samples.length > numSamples){
      this.samples.splice(this.samples.length - 2, 1);
    }
    // 2. Add missing
    while(this.samples.length < numSamples){
      this.samples.splice(this.samples.length - 1, 0, null);
    }
  }

  setSample(index, curve, segIdx, sampT){
    assert(index >= 0 && index < this.samples.length, 'Invalid index', index);
    // clear cache
    this.clearCache();
    // check that there is no loop
    if(curve instanceof ParametricCurve){
      // if there is, then fail at sample setting
      if(curve.canReach(this))
        return false; // do not create loop!
    }
    this.samples[index] = new CurveSample(curve, segIdx, sampT);
    return true; // we're good!
  }

  reachSet(set = new Set()){
    for(const sample of this.samples){
      if(!sample)
        continue; // skip empty samples
      if(set.has(sample.curve))
        continue; // skip if already traversed
      else if(sample.curve instanceof ParametricCurve){
        set.add(sample.curve);
        // recursive call, with accumulator
        sample.curve.reachSet(set);
      }
    }
    return set;
  }
  canReach(pcurve, rejectSet = new Set(), depth = 0){
    assert(depth < 32, 'Potential stack overflow', depth);
    // early failure
    if(rejectSet.has(this))
      return false;
    // else not yet visited => visit all samples
    for(const sample of this.samples){
      if(sample && sample.curve instanceof ParametricCurve){
        if(pcurve === sample.curve || sample.curve.canReach(pcurve, rejectSet, depth + 1))
          return true;
      }
    }
    // add ourself to rejection set
    // so that we don't try here again
    rejectSet.add(this);
    return false;
  }
  isReferencingSelf(pcurve){
    return pcurve instanceof ParametricCurve
        && pcurve.canReach(this);
  }
  hasParameterLoop(){ return this.canReach(this); }
  isValid(){
    return !this.hasParameterLoop()
        && (!this.subCurve || this.isValidSubCurve());
  }
  isValidSubCurve(){
    return this.subCurve
        && this.firstSample && this.lastSample
        && this.firstSample.curve === this.lastSample.curve
        && this.firstSample.segIdx === this.lastSample.segIdx;
  }
  isComplete(){
    return this.isValid()
        && this.samples.every(samp => samp && samp.isReady());
  }
  isSampleValid(index){
    if(this.subCurve && !this.isValidSubCurve())
      return false;
    index = normIndex(index, this.length);
    const samp = this.samples[index];
    return samp && samp.curve
        && !this.isReferencingSelf(samp.curve)
        && samp.isReady();
  }
  unrefCurve(curve){
    if(!curve)
      return false;
    let unref = false;
    for(let i = 0; i < this.numSamples; ++i){
      if(this.samples[i] && this.samples[i].curve === curve){
        // if unreferencing a subCurve, just transfer samples
        if(curve.subCurve && curve.firstSample){
          // transfer to underlying curve
          const s0 = curve.firstSample;
          const s1 = curve.lastSample;
          assert(s0.curve === s1.curve
              && s0.segIdx === s1.segIdx,
            'Invalid subCurve samples');
          const [t0, t1] = [s0.sampT, s1.sampT].sort((a,b) => a-b);
          // transfer
          this.samples[i].curve = s0.curve;
          this.samples[i].segIdx = s0.segIdx;
          this.samples[i].sampT = t0 + (t1 - t0) * this.samples[i].sampT;

        } else {
          // remove sample
          this.samples[i] = null;
          unref = true;
        }
      }
    }
    return unref;
  }
  updateReferences(curve, ptIdx, mode){
    for(let i = 0; i < this.numSamples; ++i){
      const sample = this.samples[i];
      // update samples that point to that curve
      if(!sample || sample.curve !== curve)
        continue; // no need to worry about this one

      // check segment index
      if(sample.segIdx === ptIdx){
        // break sample
        this.samples[i] = null;

      } else if(sample.segIdx > ptIdx) {
        if(mode === 'add')
          sample.segIdx += 1;
        else if(mode === 'remove')
          sample.segIdx -= 1;
        else
          assert.error('Unsupported reference update mode', mode);
      }
    }
  }

  /**
   * Draw the path corresponding to this curve on a rendering context
   *
   * @param ctx the rendering context
   */
  drawPath(ctx){
    ctx.beginPath();
    init: {
      const seg = this.getSegment(0);
      if(seg){
        const { x: startX, y: startY } = seg.points[0];
        ctx.moveTo(startX, startY);
      } else
        return;
    }
    for(let i = 0; i < this.segLength; ++i){
      // const { x: sx, y: sy } = curve.getPoint(i);
      // ctx.moveTo(sx, sy);
      // note: we should not use moveTo each time, else we get bezier arcs
      // @see https://stackoverflow.com/questions/25129081/canvas-fill-doesnt-work-as-expected-when-used-with-spline-lines
      const seg = this.getSegment(i);
      if(!seg)
        return;
      const { x: ex, y: ey } = seg.points[seg.points.length - 1];
      switch(seg.points.length - 1){
        case 1:
          ctx.lineTo(ex, ey);
          break;
        case 2: {
          const { x: csx, y: csy } = seg.points[1];
          ctx.quadraticCurveTo(csx, csy, ex, ey);
        } break;
        case 3: {
          const { x: csx, y: csy } = seg.points[1];
          const { x: cex, y: cey } = seg.points[2];
          ctx.bezierCurveTo(csx, csy, cex, cey, ex, ey);
        } break;
      }
    }
    //if(!this.open)
    //  ctx.closePath();
  }

  /**
   * Draws a segment of this curve
   * 
   * @param {any} ctx drawing context
   * @param {number} segIdx segment index
   */
  drawSegment(ctx, segIdx){
    ctx.beginPath();
    const seg = this.getSegment(segIdx);
    if(!seg)
      return;
    const { x: sx, y: sy } = seg.points[0];
    ctx.moveTo(sx, sy);
    const { x: ex, y: ey } = seg.points[seg.points.length - 1];
    switch(seg.points.length - 1){
      case 1:
        ctx.lineTo(ex, ey);
        break;
      case 2: {
        const { x: csx, y: csy } = seg.points[1];
        ctx.quadraticCurveTo(csx, csy, ex, ey);
      } break;
      case 3: {
        const { x: csx, y: csy } = seg.points[1];
        const { x: cex, y: cey } = seg.points[2];
        ctx.bezierCurveTo(csx, csy, cex, cey, ex, ey);
      } break;
    }
  }

  /**
   * Create the path data string representing the resolved curve
   *
   * @see Curve::pathString()
   * @return a string representing this curve when resolved
   */
  pathString(){
    let data;
    init: {
      const seg = this.getSegment(0);
      if(seg){
        const { x: startX, y: startY } = seg.points[0];
        data = 'M ' + startX + ',' + startY + ' ';
      } else {
        return 'M 0 0'; // incomplete curve
      }
    }
    let degree = 1;
    for(let i = 0, N = this.segLength; i < N; ++i){
      const seg = this.getSegment(i);
      if(!seg)
        break; // incomplete curve
      const d = seg.points.length - 1;
      if(degree !== d){
        degree = d;
        switch(d){
          case 1:   data += 'L '; break;
          case 2:   data += 'Q '; break;
          case 3:   data += 'C '; break;
          default:  data += '? '; break; // this is for debugging
        }
      }
      for(let j = 1; j < seg.points.length; ++j){
        const p = seg.points[j];
        data += p.x + ',' + p.y + ' ';
      }
    }
    if(!this.open)
      data += 'Z'; // curve closing
    else {
      // remove last unnecessary white space
      data = data.slice(0, data.length - 1);
    }
    return data;
  }

  serialize(opts){
    const data = super.serialize(opts);
    // simple types
    for(const key of [
      "degree", "subCurve", "tval", "cubicType",
      "startCtrl", "startWeight", "startInvert", "startSine",
      "endCtrl", "endWeight", "endInvert", "endSine",
      "firstWeight", "firstInvert", "secondWeight", "secondInvert",
      "crAlpha", "crFull", "d1", "seamMode"]){
      data[key] = this[key];
    }
    // special types
    data.samples = this.samples.map(samp => {
      return samp ? samp.toJSON() : null;
    });
    return data;
  }

  deserialize(data, map, useID){
    super.deserialize(data, map, useID);
    // simple types
    for(const key of [
      "degree", "subCurve", "tval", "cubicType",
      "startCtrl", "startWeight", "startInvert", "startSine",
      "endCtrl", "endWeight", "endInvert", "endSine",
      "firstWeight", "firstInvert", "secondWeight", "secondInvert",
      "crAlpha", "crFull", "d1", "seamMode"]){
      if(key in data && key in this)
        this[key] = data[key];
    }
    // special types
    assert(Array.isArray(data.samples)
      && data.samples.length === this.numSamples,
      'Invalid sample field type or size');
    this.samples = data.samples.map(s => {
      return s ? new CurveSample(s.curve, s.segIdx, s.sampT) : null;
    });
    return this;
  }

  remap(map){
    super.remap(map);
    // remap existing samples
    for(const sample of this.samples){
      if(!sample)
        continue;
      sample.curve = map(sample.curve);
    }
  }

  static createSample(curve, segIdx, sampIdx, sampCount = 2){
    return new CurveSample(curve, segIdx, sampIdx, sampCount);
  }

  static fromCurveSegment(curve, segIdx, t0 = 0, t1 = 1){
    assert(t0 <= t1, 't0 must be smaller or equal to t1', t0, t1);
    const pcurve = new ParametricCurve();
    pcurve.subCurve = true;
    pcurve.setSample(0, curve, segIdx, t0);
    pcurve.setSample(1, curve, segIdx, t1);
    return pcurve;
  }
}

class CurveSample {
  constructor(curve, segIdx, sampT){
    this.curve  = curve;
    this.segIdx = segIdx;
    this.sampT  = sampT;
  }

  toJSON(){
    return {
      curve: this.curve.id,
      segIdx: this.segIdx,
      sampT: this.sampT
    };
  }

  isValid(){
    return this.curve && this.segIdx < this.curve.length;
  }
  isReady(){
    if(!this.isValid())
      return false;
    if(this.curve instanceof ParametricCurve)
      return this.curve.isComplete();
    else
      return true;
  }
  matchesSegment(curve, segIdx){
    return this.curve === curve
        && this.segIdx === segIdx;
  }
  getSegment(){
    return this.curve.getSegment(this.segIdx);
  }
  getLocalPosition(){
    return this.getSegment().get(this.sampT);
  }
  getPosition(){
    // note: calling this assumes we know there is NO loop
    // else it's a dangerous call!
    const localPos = this.getLocalPosition();
    return this.curve.localToGlobal(localPos);
  }
  getNormal(){
    return this.getSegment().normal(this.sampT, true);
  }
  getInnerNormal(){
    const n = this.getNormal();
    if(!this.curve.open){
      return this.curve.isInward() ? n : geom.scale(n, -1);
    } else {
      return n;
    }
  }
  getTangent(){
    const segment = this.curve.getSegment(this.segIdx);
    return geom.unitVector(segment.derivative(this.sampT, true));
  }

  toString(){
    return this.curve.name + '#' + this.curve.id + '/' + this.segIdx + '@' + this.sampT;
  }
}

module.exports = Object.assign(ParametricCurve, {
  // cubic types
  CATMULL_ROM,
  SIMPLE_SPLINE,
  NORMAL_SPLINE,
  TANGENT_SPLINE,
  // endpoint types
  LINEAR,
  NORMAL,
  TANGENT,
  ANGLE
});