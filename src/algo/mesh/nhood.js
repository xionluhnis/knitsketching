// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const { SKETCH, LAYER, CW, CCW, NONE } = require('./constants.js');
/**
 * Return the ordered pair
 * 
 * @param {number} v1 first value
 * @param {number} v2 second value
 * @return {number[]} [vmin, vmax] to that vmin <= vmax
 */
function minmax(v1, v2){
  if(v1 <= v2)
    return [v1, v2];
  else
    return [v2, v1];
}

/**
 * Locate the inteprolation location between two points
 * for a given query value assuming linear interpolation in between.
 * 
 * @param {number} v query value
 * @param {number} v0 start value
 * @param {number} v1 end value
 * @return {number} the linear location (0 => at v0, 1 => at v1)
 */
function invLinear(v, v0, v1){
  return (v - v0) / (v1 - v0);
}

/**
 * Safe inverse linear operation that checks the range
 * 
 * @param {number} v query value
 * @param {number} v0 start value
 * @param {number} v1 end value
 * @return {number} the lienar location, or 0 if constant
 */
function safeInvLinear(v, v0, v1){
  if(geom.approximately(v0, v1))
    return 0.0; // special case
  else
    return invLinear(v, v0, v1);
}

/**
 * Bilinear interpolation for a single variable
 * given sample values around the [0;1]^2 region.
 * 
 * @param {number} dx the x component in [0;1]
 * @param {number} dy the y component in [0;1]
 * @param {number} v00 the (0,0) sample value
 * @param {number} v10 the (1,0) sample value
 * @param {number} v11 the (1,1) sample value
 * @param {number} v01 the (0,1) sample value
 * @return {number} the value of v at (dx,dy)
 */
function bilinear(dx, dy, v00, v10, v11, v01){
  // rule: vxy gets
  // - x factor (1-dx) for x=0
  // - x factor dx     for x=1
  // - y factor (1-dy) for y=0
  // - y factor dy     for y=1
  return (1 - dx) * (1 - dy) * v00
       +       dx * (1 - dy) * v10
       + (1 - dx) * dy       * v01
       + dx       * dy       * v11;
}

/**
 * Inverse bilinear interpolation given a fixed dy value
 * 
 * Given dy fixed, we solve for dx:
 *    v = (1-dx)(1-dy)v00
 *      +    dx (1-dy)v10
 *      + (1-dx)dy    v01
 *      +    dx dy    v11
 *      = dx[-(1-dy)v00 + (1-dy)v10 - dy v01 + dy v11] + [(1-dy)v00 + dy v01]
 * 
 *  Thus, we get
 *   dx = [v - (1-dy)v00 - dy v01] / [-(1-dy)v00 + (1-dy)v10 - dy v01 + dy v11]
 * 
 * @param {number} v query value
 * @param {number} dy the fixed dy value in [0;1]
 * @param {number} v00 the (0,0) sample value
 * @param {number} v10 the (1,0) sample value
 * @param {number} v11 the (1,1) sample value
 * @param {number} v01 the (0,1) sample value
 * @return {number} the dx value that generates v (if any) given dy
 */
function invBilinearDx(v, dy, v00, v10, v11, v01){
  const q = v - (1-dy) * v00 - dy * v01;
  const d = -(1-dy) * v00 + (1-dy) * v10 - dy * v01 + dy * v11;
  return q / d;
  // return ((1 - dy) * v00 + dy * v01 - v)
  //      / -(-dy * v11 - (1 - dy) * v10 + dy * v01 + (1 - dy) * v00);
}

/**
 * Inverse bilinear inteprolation given a fixed dx value
 * 
 * Given dx fixed, we solve for dy:
 *    v = (1-dx)(1-dy)v00
 *      +    dx (1-dy)v10
 *      + (1-dx)dy    v01
 *      +    dx dy    v11
 *      = dy[-(1-dx)v00 - dx v10 + (1-dx)v01 + dx v11] + [(1-dx)v00 + dx v10]
 * 
 *  Thus, we get
 *   dy = [v - (1-dx)v00 - dx v10] / [-(1-dx)v00 - dx v10 + (1-dx) v01 + dx v11]
 * 
 * @param {number} v query value
 * @param {number} dx the fixed dx value in [0;1]
 * @param {number} v00 the (0,0) sample value
 * @param {number} v10 the (1,0) sample value
 * @param {number} v11 the (1,1) sample value
 * @param {number} v01 the (0,1) sample value
 * @return {number} the dy value that generates v (if any) given dx
 */
function invBilinearDy(v, dx, v00, v10, v01, v11){
  const q = v - (1-dx) * v00 - dx * v10;
  const d = -(1-dx) * v00 - dx * v10 + (1-dx) * v01 + dx * v11;
  return q / d;
  // return ((1 - dx) * v00 + dx * v10 - v)
  //      / ((1 - dx) * v00 + dx * v10 - (1 - dx) * v01 - dx * v11);
}

function isBetween(val, v0, v1){
  if(v0 <= v1)
    return v0 <= val && val <= v1;
  else
    return v1 <= val && val <= v0;
}

class SampleNeighborhood {
  constructor(samples, q, weights = null){
    this.samples = samples;
    this.q = q;
    this.projQuery = q;
    const degree = this.samples.length;
    assert(degree > 0,
      'Neighborhood cannot be empty');
    assert(samples.every(s => s.layer === this.layer),
      'Neighborhood across layers!');

    // special case for query being base sample
    // => trivial neighborhood (and weights)
    if(q === samples[0]){
      weights = samples.map((_, idx) => idx === 0 ? 1 : 0);
    }

    // compute weights unless provided
    if(weights){
      // provided!
      this.projQuery = q;
      this.weights = weights;
      assert(this.weights.length === this.samples.length,
        'Invalid weight cardinality');

    } else {
      // compute sample weights
      if(degree === 1){
        this.weights = [ 1 ];
        this.projQuery = this.samples[0].getLayerPos();

      } else {
        const pts = this.samples.map(s => s.getLayerPos());
        if(degree === 2){
          // linear interpolation (with arbitrary locations)
          this.projQuery = geom.projToSegment(q, pts);
          const lambda = this.projQuery.t;
          this.weights = [1-lambda, lambda];

        } else if(degree === 3) { 
          // barycentric interpolation (with arbitrary locations)
          this.weights = geom.barycentricCoordinates(q, pts);

        } else if(degree === 4) {
          // bilinear interpolation (within [0;1]^2)
          // note: if not in [0;1]^2, the equation below does not hold
          // for the general case, a solution is described vvv
          // @see http://reedbeta.com/blog/quadrilateral-interpolation-part-2/

          this.weights = pts.map(p => {
            const fx = Math.min(1, Math.abs(p.x - q.x));
            const fy = Math.min(1, Math.abs(p.y - q.y));
            return (1 - fx) * (1 - fy);
          });

        } else {
          assert.error('Too many samples for interpolation', degree);
        }
      } // endif deg=1 else
    } // endif weights else

    // compute projection distance
    if(this.projQuery === q)
      this.projDist = 0;
    else
      this.projDist = geom.distBetween(q, this.projQuery);
    this.projected = this.projDist !== 0;
  }

  get nhId(){ return this.samples.map(s => s.sampleId).join('/'); }
  get areaId(){
    return this.getSampleOrder().map(i => {
      return this.samples[i].sampleId;
    }).join('/');
  }
  get degree(){ return this.samples.length; }
  get baseSample(){ return this.samples[0]; }
  get layer(){ return this.samples[0].layer; }
  get sketch(){ return this.layer.sketch; }
  getSampleOrder(){
    // order samples lexicographically over (l, y, x)
    const order = this.samples.map((_, i) => i);
    order.sort((i1, i2) => {
      const s1 = this.samples[i1];
      const s2 = this.samples[i2];
      if(s1.layer !== s2.layer)
        return s1.layer.index - s2.layer.index;
      if(s1.y !== s2.y)
        return s1.y - s2.y;
      return s1.x - s2.x;
    });
    return order;
  }
  getOrderedSamples(){
    return this.samples.slice().sort((s1, s2) => {
      if(s1.layer !== s2.layer)
        return s1.layer.index - s2.layer.index;
      if(s1.y !== s2.y)
        return s1.y - s2.y;
      return s1.x - s2.x;
    });
  }
  isBorder(){ return this.baseSample.isBorder(); }
  fullBorder(){ return this.samples.every(s => s.isBorder()); }
  someBorder(){ return this.samples.some(s => s.isBorder()); }
  isArea(){ return this.samples.length > 2; }
  getLayerPos(){ return this.projQuery; }
  getSketchPos(){ return this.layer.gridToSketch(this.projQuery); }
  getPosition(ctx){
    if(ctx === SKETCH)
      return this.getSketchPos();
    else if(ctx === LAYER)
      return this.getLayerPos();
    else
      assert.error('Invalid context', ctx);
  }
  matches(nh, sameOrder = false){
    if(nh.degree !== this.degree)
      return false;
    // either test for direct sample match in same order
    // or test for match of order-normalized samples
    if(sameOrder)
      return nh.samples.every((s, i) => s.matches(this.samples[i]));
    else
      return nh.areaId === this.areaId;
  }
  normalized(){
    const order = this.getSampleOrder();
    const N = this.degree;
    const samples = new Array(N);
    const weights = new Array(N);
    // /!\ rotate, don't use disconnected sample order
    for(let i = 0, j = order[0]; i < N; ++i, j = (j + 1) % N){
      samples[i] = this.samples[j];
      weights[i] = this.weights[j];
    }
    return new SampleNeighborhood(samples, this.q, weights);
  }
  flipped(){
    const N = this.degree;
    const samples = new Array(N);
    const weights = new Array(N);
    // /!\ keep first sample, but use reverse rotation
    for(let i = 0, j = 0; i < N; ++i, j = (j + N - 1) % N){
      samples[i] = this.samples[j];
      weights[i] = this.weights[j];
    }
    return new SampleNeighborhood(samples, this.q, weights);
  }
  orientation(){
    const degree = this.degree;
    if(degree < 3)
      return NONE;
    // check polygon orientation
    // note: in layer space, so we don't have to take sketch
    // transformation into account, because
    //    layer space <=> screen space
    // => the mirroring is already undone
    // /!\ if we were using the sketch positions
    //     then we'd have to take the sketch mirroring into account!
    return Math.sign(geom.signedArea(this.samples));
  }
  oriented(orient = CCW){
    if(this.orientation() !== orient)
      return this.flipped();
    else
      return this;
  }
  *triangles(){
    assert(this.isArea(), 'Cannot get triangles of non-areas');
    if(this.degree === 3)
      yield this;
    else {
      assert(this.degree === 4, 'Unsupported degree');
      yield new SampleNeighborhood(
        this.samples.slice(0, 3),
        this.q
      );
      yield new SampleNeighborhood(
        [this.samples[3], this.samples[0], this.samples[2]],
        this.q
      );
    }
  }
  *samplePairs(){
    yield *geom.circularPairs(this.samples);
  }
  *halfEdges(){
    for(const [s, t] of this.samplePairs())
      yield new SampleEdge(s, t, 0);
  }
  *edges(){
    for(const [s, t] of this.samplePairs())
      yield new SampleEdge(s, t, 0).baseEdge();
  }
  contains(q){
    const eps = 1e-2;
    switch(this.degree){
      case 1:
        return geom.distBetween(q, this.baseSample.getLayerPos()) < eps;
      case 2:
        return geom.distToSegment(q, this.samples.map(s => {
          return s.getLayerPos();
        })) < eps;
      case 3:
        return geom.inTriangle(q, this.samples.map(s => {
          return s.getLayerPos();
        }));
      case 4: {
        const [p00, /*p10*/, p11, /*p01*/] = this.samples.map(s => {
          return s.getLayerPos();
        });
        return geom.between(q.x, p00.x, p11.x)
            && geom.between(q.y, p00.y, p11.y);
      }
      default:
        assert.error('Unsupported neighborhood degree', this.degree);
        return false;
    }
  }
  query(q, checkContains = true){
    if(checkContains && !this.contains(q))
      return null;
    return new SampleNeighborhood(this.samples, q);
  }

  getWeight(sampIdx = 0){
    assert(sampIdx >= 0 && sampIdx < this.weights.length,
      'Sample index out-of-bounds', sampIdx);
    return this.weights[sampIdx]; // for local distribution
  }

  interpolate(values){
    if(values.length === 1){
      return values[0];
    } else {
      return values.reduce((sum, value, idx) => {
        return sum + value * this.weights[idx];
      }, 0);
    }
  }
  interpolateFun(sampFun){
    return this.interpolate(this.samples.map(sampFun));
  }

  hasValue(sampFun, value){
    switch(this.degree){

      case 1:
        return sampFun(this.baseSample) === value;

      case 2:
        return isBetween(
          value,
          sampFun(this.samples[0]),
          sampFun(this.samples[1])
        );

      default: {
        const values = this.samples.map(sampFun);
        const { min, max } = geom.minmax(values);
        return isBetween(value, min, max);
      }
    }
  }
  hasTime(t){
    return this.hasValue(s => s.time(), t);
  }

  getValueEdges(sampFun, value){
    assert(!isNaN(value), 'Value is not a number', value);
    const edges = [];
    switch(this.degree){

      case 1: {
        const v0 = sampFun(this.baseSample);
        // search in sample's edges
        // /!\ this can go across links and layers
        //  => the source may be distinct from the base sample
        for(const [target, source] of this.baseSample.neighbors()){
          const vn = sampFun(target);
          if(isBetween(value, v0, vn)){
          // if(geom.between(value, v0, vn)){
            const alpha = safeInvLinear(value, v0, vn);
            edges.push(new SampleEdge(source, target, alpha, sampFun, value));
          }
        }
      } break;

      case 2: {
        // if within edge, return it
        // else, nothing
        const source = this.baseSample;
        const target = this.samples[1];
        const v0 = sampFun(source);
        const vn = sampFun(target);
        if(isBetween(value, v0, vn)){
        // if(geom.between(value, v0, vn)){
          const alpha = safeInvLinear(value, v0, vn);
          edges.push(new SampleEdge(source, target, alpha, sampFun, value));
        }
      } break;

      case 3: {
        // barycentric => check all three edges
        for(let i = 0; i < 3; ++i){
          const source = this.samples[i];
          const target = this.samples[i === 2 ? 0 : i + 1];
          const v0 = sampFun(source);
          const v1 = sampFun(target);
          if(isBetween(value, v0, v1)){
          // if(geom.between(value, v0, v1)){
            const alpha = safeInvLinear(value, v0, v1);
            edges.push(new SampleEdge(source, target, alpha, sampFun, value));
          }
        }
      } break;

      case 4: {
        // special case with inverse bilinear sampling on edges
        const [v00, v10, v11, v01] = this.samples.map(sampFun);
        const [s00, s10, s11, s01] = this.samples;
        // four edges to check
        // /!\ since using edges, no need to compute
        // inverse bilinear, as we can just use simple inverse linear
        // given that either dx or dy has value in {0,1}.
        for(const [v0, v1, s0, s1] of [
          [v00, v01, s00, s01],
          [v10, v11, s10, s11],
          [v00, v10, s00, s10],
          [v01, v11, s01, s11]
        ]){
          if(isBetween(value, v0, v1)){
          // if(geom.between(value, v0, v1)){
            const alpha = safeInvLinear(value, v0, v1);
            // note: the precision of alpha is less than value
            // ... roughly half in bits (i.e. +/- 1e-4 instead of 1e-7)
            //assert(geom.between(alpha, 0, 1, 1e-4),
            //  'Invalid invLinear', alpha);
            edges.push(new SampleEdge(s0, s1, alpha, sampFun, value));
          }
        }
      } break;

      default:
        assert.error('Unsupported neighborhood degree', this.degree);
        break;
    } // endswitch
    return edges;
  }

  getTimeEdges(t){ return this.getValueEdges(s => s.time(), t); }
  time(){ return this.interpolateFun(s => s.time()); }
  kappa(){ return this.interpolateFun(s => s.kappa()); }
  flow(){
    return {
      x: this.interpolateFun(s => s.u()),
      y: this.interpolateFun(s => s.v())
    };
  }
  stress(){ return this.interpolateFun(s => s.stress()); }
  timeStretch(){ return this.interpolateFun(s => s.timeStretch()); }
}

function hasLowerID(s1, s2){
  if(s1.layer.index < s2.layer.index)
    return true;
  if(s1.layer.index > s2.layer.index)
    return false;
  if(s1.y < s2.y)
    return true;
  if(s1.y > s2.y)
    return false;
  return s1.x < s2.x;
}

class SampleEdge extends SampleNeighborhood {
  constructor(source, target, alpha, sampFun = null, value = NaN){
    super(
      [source, target],
      geom.axpby(1 - alpha, source, alpha, target),
      [1 - alpha, alpha]
    );

    // edge value
    this.alpha = alpha;
    this.sampFun = sampFun;
    this.value = value;

    // caches
    this.heStr = undefined;
    this.twin = undefined; // not cached by default
    this.base = undefined;
  }

  static from(src, trg, t){
    assert(src.layer === trg.layer, 'Samples must be in same layer');
    const ts = src.time();
    const tt = trg.time();
    if(isBetween(t, ts, tt)){
    // if(geom.between(t, ts, tt)){
      const alpha = safeInvLinear(t, ts, tt);
      return new SampleEdge(src, trg, alpha, s => s.time(), t);
    } else {
      return null; // not valid
    }
  }
  at(t){ return SampleEdge.from(this.source, this.target, t); }
  dt(){ return this.target.time() - this.source.time(); }

  get source(){ return this.samples[0]; }
  get target(){ return this.samples[1]; }
  get halfEdgeId(){
    if(!this.heStr){
      const [src, trg] = this.samples;
      if(hasLowerID(src, trg)){
        this.heStr = src.sampleId + '/' + trg.sampleId;

      } else {
        this.heStr = trg.sampleId + '/' + src.sampleId;
      }
    }
    return this.heStr;
  }
  get edgeId(){ return this.baseEdge().halfEdgeId; }
  hasConstantValue(){
    return this.hasSourceValue() && this.hasTargetValue();
  }
  hasSourceValue(){ return this.sampFun(this.source) === this.value; }
  hasTargetValue(){ return this.sampFun(this.target) === this.value; }
  valueSamples(){
    if(this.hasConstantValue())
      return [this.source, this.target];
    else if(this.hasSourceValue())
      return [this.source];
    else if(this.hasTargetValue())
      return [this.target];
    else
      return [];
  }
  isValueSample(){
    const hasSource = this.hasSourceValue();
    const hasTarget = this.hasTargetValue();
    return hasSource !== hasTarget;
  }
  reverseEdge(){
    return new SampleEdge(
      this.samples[1],
      this.samples[0],
      1 - this.alpha,
      this.sampFun,
      this.value
    );
  }
  matches(e){
    if(!e || !(e instanceof SampleEdge))
      return false;
    if(this.source.matches(e.source))
      return this.target.matches(e.target);
    else
      return this.source.matches(e.target)
          && this.target.matches(e.source);
  }
  includes(s){
    return this.source.matches(s) || this.target.matches(s);
  }
  twinEdge(){
    // if not cached, compute it
    if(this.twin === undefined){
      // can only have a twin edge
      // if both the source and target have links
      if((this.source.hasLinks() || this.source.isSelfLink())
      && (this.target.hasLinks() || this.target.isSelfLink())){
        // search for twin edge (there may not be any!)
        // /!\ directLinkSamples iterates on self-links by default
        for(const ls of this.source.directLinkSamples()){
          for(const lt of this.target.directLinkSamples()){
            // note: we need to check for edge openings
            if((ls.prevSample === lt && !ls.isPrevEdgeOpen)
            || (ls.nextSample === lt && !ls.isNextEdgeOpen)){
              // found twin edge!
              this.twin = new SampleEdge(
                ls, lt, this.alpha, this.sampFun, this.value
              ).reverseEdge(); // reverse direction
              return this.twin;
            } // endif
          } // endfor lt of target.directLinkSamples
        } // endfor ls of source.directLinkSamples
      }
      // else no link => no twin edge

      // cache the lack of twin edge
      this.twin = null; // !== undefined
    }
    return this.twin; // use cache
  }
  baseEdge(){
    // use cache if available
    if(this.base){
      return this.base;
    }
    // else compute cache and return it
    const twin = this.twinEdge();
    if(twin){
      // layer order
      if(twin.layer.index < this.layer.index)
        this.base = twin;
      else if(twin.layer.index > this.layer.index)
        this.base = this;
      else {
        // same layer => use index along border
        // min dataIndex order
        const twinMinIdx = Math.min(
          twin.source.dataIndex, twin.target.dataIndex
        );
        const thisMinIdx = Math.min(
          this.source.dataIndex, this.target.dataIndex
        );
        if(twinMinIdx < thisMinIdx)
          this.base = twin;
        else if(twinMinIdx > thisMinIdx)
          this.base = this;
        else {
          // max dataIndex order (very rare!)
          // note: for this to happen, we must have two edges
          // across the 0 data-index
          // => (N-1, 0) and (0, 1)
          const twinMaxIdx = Math.max(
            twin.source.dataIndex, twin.target.dataIndex
          );
          const thisMaxIdx = Math.max(
            this.source.dataIndex, this.target.dataIndex
          );
          if(twinMaxIdx < thisMaxIdx)
            this.base = twin;
          else if(twinMaxIdx > thisMaxIdx)
            this.base = this;
          else
            assert.error('Twin cannot be equal');
          // note; the error should not happen since N>2
          // for sketch borders (they are closed polygons!)
        } // endif dataIndex order
      } // endif layer order
    } else {
      this.base = this; // no twin available!
    } // endif twin else
    return this.base;
  }
  projectFrom(p, ctx = LAYER){
    if(ctx === LAYER){
      return geom.projToSegment(p, [
        this.source, this.target
      ]);
    } else {
      assert(ctx === SKETCH, 'Invalid context');
      return geom.projToSegment(p, [
        this.source.getSketchPos(),
        this.target.getSketchPos()
      ]);
    }
  }
  *selfAndTwin(){
    yield this;
    const twin = this.twinEdge();
    if(twin)
      yield twin;
  }

  getSideRegions(srcFace = null){
    const list = [];

    // compute adjacent area neighborhoods (deg=3,4) of edge
    let numSides = 0;
    let numSources = 0;
    for(const src of this.selfAndTwin()){
      ++numSources;
      for(const nh of src.source.sharedRegions(src.target)){
        ++numSides;
        if(srcFace && srcFace.matches(nh)) // srcEdge.nhId === nh.nhId)
          continue; // skip src-matching nh
        list.push([nh, src]);
      }
    }

    // check the quantity of shared regions
    // - 1 if a border edge without link (1 source)
    // - 2 otherwise (1 or 2 sources)
    assert((numSides === 1 && numSources === 1) || numSides === 2,
      'Invalid number of side regions and/or sources',
      numSides, list.length, numSources);
    return list;
  }

  distTo(that, ctx = SKETCH){
    assert(that instanceof SampleEdge, 'Invalid argument type');
    assert(that.layer === this.layer,
      'Cannot compute the distance between two edges across layers');
    assert(!this.hasConstantValue(),
      'Cannot compute distance from a constant edge');
    assert(!that.hasConstantValue(),
      'Cannot compute distance to a constant edge');
    if(ctx === SKETCH){
      return geom.distBetween(
        this.getSketchPos(), that.getSketchPos()
      );
    } else {
      return geom.distBetween(
        this.getLayerPos(), that.getLayerPos()
      );
    }
  }
  length(ctx = LAYER){
    if(ctx === LAYER)
      return geom.distBetween(this.source, this.target);
    else {
      return geom.distBetween(
        this.source.getSketchPos(),
        this.target.getSketchPos()
      );
    }
  }
  avgLength(ctx = LAYER){
    let len = 0.0;
    let num = 0;
    for(const e of this.selfAndTwin()){
      len += e.length(ctx);
      ++num;
    }
    assert(num > 0, 'No edge?');
    return len / num;
  }
  maxLength(ctx = LAYER){
    let len = 0.0;
    for(const e of this.selfAndTwin())
      len = Math.max(len, e.length(ctx));
    return len;
  }
  minLength(ctx = LAYER){
    let len = 0.0;
    for(const e of this.selfAndTwin())
      len = Math.min(len, e.length(ctx));
    return len;
  }

  *orientationTrianglesTo(that){
    assert(that.layer === this.layer,
      'Orientation cannot be computed across layers');
    assert(that instanceof SampleEdge,
      'Argument is not a sample edge');
    const thisConst = this.hasConstantValue();
    const thatConst = that.hasConstantValue();
    // check for degenerate case = two constant edges
    if(thisConst && thatConst){
      console.warn('Both edges have constant value');
      return;
    }
    // get list of same-layer triangles for orientation tests
    // where each triangle has
    // - one value point of this edge
    // - one distinct value point of that edge
    // - one non-value *sample* of either edge
    //
    // note: special case if one edge is constant
    if(thisConst || thatConst){
      // /!\ the constant edge must be oriented correctly
      // <=> from source to target
      let nonConst;
      let s0, s1;
      if(thisConst){
        nonConst = that;
        s0 = this.source;
        s1 = this.target;
      } else {
        nonConst = this;
        s0 = that.source;
        s1 = that.target;
      }
      // /!\ the non-constant edge must share a sample
      // with the constant edge (else they are not directly related)
      if(nonConst.source === s0
      || nonConst.source === s1
      ){
        yield [s0, s1, nonConst.target];

      } else if(nonConst.target === s0
             || nonConst.target === s1
      ){
        yield [s0, s1, nonConst.source];

      } else {
        assert.error(
          'Non-constant edge does not share sample with constant one');
        return;
      }

    } else {
      // up to four potential triangles
      const [p0, p1] = [this.q, that.q];
      // filter out degenerate samples (same as p0 or p1)
      if(this.hasSourceValue())
        yield [p0, p1, this.target]; // /!\ cannot have target value
      else if(this.hasTargetValue())
        yield [p0, p1, this.source]; // /!\ cannot have source value
      else {
        yield [p0, p1, this.source];
        yield [p0, p1, this.target];
      }
      if(that.hasSourceValue())
        yield [p0, p1, that.target]; // /!\ cannot have target value
      else if(that.hasTargetValue())
        yield [p0, p1, that.source]; // /!\ cannot have source value
      else {
        yield [p0, p1, that.source];
        yield [p0, p1, that.target];
      }
    }
  }

  orientationTo(that){
    const counts = {
      [CW]: 0,
      [CCW]: 0,
      [NONE]: 0
    };
    const val = this.value;
    // /!\ no need: const mirrorSign = this.layer.sketch.mirrorSign;
    for(const tri of this.orientationTrianglesTo(that)){
      assert(tri[2].layer, 'Triangle last point is not a sample');
      const nval = this.sampFun(tri[2]);
      const sA = geom.signedArea(tri);
      if(geom.approximately(sA, 0.0)){
        counts[NONE]++; // degenerate triangle
        continue;
      }
      // note: triangle is computed in layer coordinates
      // => no need to account for sketch inversion
      //    because layer coordinates area always in screen space
      const triOrient = Math.sign(sA);
      // CCW orientation assumption:
      // 1. CCW triangle based on edge + sample forward in time
      // 2. CW triangle based on edge + sample backward in time
      const orient = triOrient * Math.sign(nval - val);
      counts[orient]++;
    }
    // use voting result to decide on orientation
    if(counts[CW] > counts[CCW])
      return CW;
    else if(counts[CCW] > counts[CW])
      return CCW;
    else {
      console.warn('No clear orientation for edge data');
      return NONE;
    }
  }

  /**
   * Find a shared sample with another sample edge,
   * modulo the linking class equivalence.
   * 
   * @param {SampleEdge} that the other sample edge
   * @return {SampleEdge?} any matching sample, or null
   */
  getSharedSampleWith(that){
    return this.samples.find(s => {
      return that.samples.some(ns => s.matches(ns));
    });
  }

  *traverseFan(center, backward = false){
    assert(center.isBorder() && this.includes(center),
      'Fan center sample is invalid');
    const start = this.samples.find(s => !s.matches(center));
    const sides = this.getSideRegions();
    const sideNum = Math.min(sides.length - 1, backward ? 1 : 0);
    let face = sides[sideNum][0];
    let pastEdge = center.edgeTo(start);
    let iter = 0;
    while(face){
      assert(face.samples.length === 3, 'Should be a triangle fan');
      const currSample = face.samples.find(s => {
        return !s.matches(center) && !s.matches(pastEdge.target);
      });
      assert(currSample, 'Missing new sample');
      const edge = center.edgeTo(currSample);
      yield edge;
      // if we reached the start sample, then we're done
      if(start.matches(currSample))
        break;
      // else we get the next side's face
      face = (edge.getSideRegions(face)[0] || [])[0];
      pastEdge = edge;
      // debug iter
      if(++iter > 100){
        assert.error('Do we really have more than 100 neighbors?');
        return;
      }
    }
  }
}

module.exports = {
  SampleNeighborhood, SampleEdge,
  // interpolation functions
  bilinear,
  invLinear,
  safeInvLinear,
  invBilinearDx,
  invBilinearDy,
  // helpers
  minmax,
  // constants
  SKETCH, LAYER
};