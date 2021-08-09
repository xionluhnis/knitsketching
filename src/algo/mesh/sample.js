// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const {
  T, U, V, K, LAYER, /* SKETCH, */ N4
} = require('./constants.js');
const { SampleNeighborhood, SampleEdge } = require('./nhood.js');
const C = require('../../sketch/constraint.js');

// constraint data
class ConstraintData {
  constructor(index, type, project, weight, dir, layerPos, layerDist){
    // pure constraint data
    this.index = index;
    this.type = type;
    this.project = project;
    this.weight = weight;
    // implied direction
    this.dir = dir;
    // layer information
    this.layerPos = layerPos;
    this.layerDist = layerDist;
    // delta time information
    this.dt = NaN;
  }

  isSeam(){ return this.type === C.SEAM; }
  isTimeIsoline(){ return this.type === C.ISOLINE; }

  updateDt(sample){
    if(!this.isTimeIsoline())
      return;

    // get curvature, flow and delta direction
    // necessary to infer delta time to constraint
    const k = sample.kappa();
    const uv = sample.flow();
    const delta = geom.axpby(
      1, this.layerPos,
      -1, sample.getLayerPos()
    );

    // XXX sketchToGrid does not keep x/y ratio!
    // this means that the time has non-uniform x/y ratio too!
    // we should take that skewness into account in getNHTime!
    // const sign = geom.dot(uv, delta) >= 0 ? 1 : -1;
    //this.dt = geom.length(delta) * sign;
    this.dt = k * geom.dot(uv, delta);
    // collapse to zero to have robust isolines on curved borders
    if(geom.approximately(this.dt, 0, 1e-1))
      this.dt = 0;
  }

  static fromData(data){
    return new ConstraintData(
      data.index, data.type, data.project, data.weight, data.dir,
      data.layerPos, data.layerDist
    );
  }
}

// ###########################################################################
// ##### Regular Sample ######################################################
// ###########################################################################

/**
 * Basic mesh sample with regular neighborhood
 */
class GridSample {
  constructor(layer, y, x){
    this.layer = layer;
    this.y = y;
    this.x = x;
    // data
    this.constraints = [];
    this.rindex = -1;
    // temporary data
    this.dt = NaN;
  }

  toData(){
    return {
      // location data
      layer: this.layer.index,
      y: this.y, x: this.x,
      // base data
      constraints: this.constraints,
      region: this.rindex
    };
  }

  loadData(data){
    this.constraints = data.constraints.map(cdata => {
      return ConstraintData.fromData(cdata);
    });
    this.rindex = data.region;
  }

  static fromData(layer, data){
    if(data.innerSamples)
      return IntermediateSample.fromData(layer, data);
    else
      return new GridSample(layer, data.y, data.x);
  }
  asIntermediateSample(){
    return new IntermediateSample(this.layer, this.y, this.x);
  }

  get sketch(){ return this.layer.sketch; }
  get mesh(){ return this.layer.parent; }
  get sampleId(){ return [this.layer.index, this.y, this.x].join(':'); }
  get vertexId(){ return this.sampleId; }
  get angleSum(){ return Math.PI * 2; }
  matches(sample){
    return this.layer === sample.layer
        && this.y === sample.y
        && this.x === sample.x;
  }
  isRegular(){ return this.constructor === GridSample; }
  isBorder(){ return false; }
  isCorner(){ return false; }
  isIntermediate(){ return false; }
  isWithinShape(){ return !this.isOnShapeBoundary(); }
  isOnShapeBoundary(){ return false; }
  isTimeRef(){
    return this.layer.tref.y === this.y
        && this.layer.tref.x === this.x;
  }
  time(){ return this.layer.fgrid.get(this.y, this.x, T); }
  setTime(t){ this.layer.fgrid.set(this.y, this.x, T, t); }
  kappa(){ return this.layer.fgrid.get(this.y, this.x, K); }
  setKappa(k){ this.layer.fgrid.set(this.y, this.x, K, k); }
  flow(rot = null){
    const index = this.layer.fgrid.index(this.y, this.x, U);
    const uv = {
      x: this.layer.fgrid.data[index + 0], // U
      y: this.layer.fgrid.data[index + 1]  // V
    };
    if(rot){
      return geom.rotateVector(uv, rot);
    } else {
      return uv;
    }
  }
  u(){ return this.layer.fgrid.get(this.y, this.x, U); }
  v(){ return this.layer.fgrid.get(this.y, this.x, V); }
  hasFlow(){
    const index = this.layer.fgrid.index(this.y, this.x, U);
    return this.layer.fgrid.data[index + 0] || this.layer.fgrid.data[index + 1];
  }
  setFlow(uv, scaleFactor = 1.0){
    this.layer.fgrid.set(this.y, this.x, U, scaleFactor * uv.x);
    this.layer.fgrid.set(this.y, this.x, V, scaleFactor * uv.y);
  }
  setDt(dt){ this.dt = dt; }
  getDt(){ return this.dt; }
  hasDt(){ return !Number.isNaN(this.dt); }
  getLayerPos(){ return { x: this.x, y: this.y }; }
  getSketchPos(){ return this.layer.gridToSketch({ x: this.x, y: this.y }); }
  getPos(ctx){
    assert(ctx, 'No context argument');
    if(ctx === LAYER)
      return this.getLayerPos();
    else
      return this.getSketchPos();
  }
  stress(){
    let s = 0, n = 0;
    // compute the average flow difference magnitude
    for(const [nsample, sample] of this.neighbors()){
      const uv = sample.flow();
      const nuv = nsample.flow();
      s += geom.length(
        geom.axpby(1, uv, -1, nuv)
      );
      ++n;
    }
    return n ? Math.max(0, Math.min(2,
      s / n
    )) : 0;
  }
  timeStretch(){
    const t = this.time();
    let dt = 0, n = 0;
    // compute the average delta ratio curr/expected
    // ts = 1 when exact (ideal)
    // ts < 1 when time is advancing slowly (time stretching)
    // ts > 1 when time is advancing quickly (time shrinking) 
    for(const [nsample] of this.neighbors()){
      const nt = nsample.time();
      dt += Math.abs(nt - t);
      ++n;
    }
    return dt ? 2 * dt / n : 1;
  }
  region(rlist = this.mesh.regions){
    if(this.rindex !== -1)
      return rlist[this.rindex];
    else
      return null;
  }
  reducedRegion(){
    const reg = this.region();
    return reg ? reg.reduction() : null;
  }
  setRegion(region){
    assert(region, 'Cannot assign an empty region');
    this.rindex = region.index;
  }
  clearRegion(){ this.rindex = -1; }
  addConstraint(constrIdx, segIdx, layerSupport = 1){
    // pre-compute flow/direction information
    const sketch = this.layer.sketch;
    const constr = sketch.constraints[constrIdx];
    assert(constr, 'Missing constraint');
    const curve = constr.target;
    const segment = curve.getSegment(segIdx);
    // get sample position in curve domain
    const p = this.getSketchPos();
    const p_seg = curve.parentToLocal(p);
    // project onto segment
    const q_seg = segment.project(p_seg);
    const alpha = q_seg.t;

    // get distance (in layer units)
    const q_layer = this.layer.sketchToGrid(curve.localToParent(q_seg));
    const layerDist  = geom.distBetween(this, q_layer);

    // compute weight
    if(layerDist > layerSupport)
      console.warn('Constraint is out of expected support', layerDist, layerSupport);
    const weight = Math.max(0,
      constr.weight * (1 - layerDist / layerSupport)
    );
    if(weight === 0)
      return; // do not add, since it does not contribute

    // mirroring works differently for border constraints
    // /!\ child constraints are typically double-mirrored, but borders NOT
    const borderMirrorX = constr.isBorder() && sketch.transform.mirrorX;
    
    // compute implied direction
    let dir;
    switch(constr.type){

      case C.DIRECTION:
        dir = geom.unitVector(segment.derivative(alpha));
        if(borderMirrorX)
          dir = geom.mirrorX(dir);
        if(constr.dir === C.BACKWARD)
          dir = geom.scale(dir, -1);
        break;

      case C.ISOLINE:
        dir = segment.normal(alpha);
        if(borderMirrorX)
          dir = geom.mirrorX(dir);
        if(constr.dir === C.BACKWARD)
          dir = geom.scale(dir, -1);
        break;

      case C.SEAM:
        // directional variants = source/sink
        // but they only work from borders!
        if(constr.dir && constr.isBorder()){
          assert(constr.target.segLength === 1,
            'Border constraint has multiple segments');
          // note: we use the mirrorX-corrected normal
          dir = segment.normal(alpha, true);

          // flow direction depends on constraint direction
          const isNormalInward = sketch.isInward();
          const isConstrInward = constr.dir === C.FORWARD;
          if(isNormalInward !== isConstrInward){
            // invert normal once
            dir = geom.scale(dir, -1);
            // note: no need for mirrorX because we use
            // global properties that are invariant:
            // - curve inwardness (already takes mirrorX into account)
            // - constraint direction (outward vs inward)
          }
        }
        break;
    }
    assert(!dir || (!isNaN(dir.x) && !isNaN(dir.y)),
      'Invalid constraint direction vector', dir);

    // whether we project
    const project = !constr.dir;

    // add constraint data
    this.constraints.push(new ConstraintData(
      constrIdx, constr.type, project, weight, dir, q_layer, layerDist
    ));
  }
  hasSeam(){
    return this.constraints.some(c => c.isSeam());
  }
  getSeamWeight(){
    return this.constraints.reduce((sum, cdata) => {
      return cdata.isSeam() ? sum + cdata.weight : sum;
    }, 0);
  }
  getDeltaSample(dy, dx){
    return this.layer.getSample(this.y + dy, this.x + dx);
  }
  dirTo(s, withDist = false){
    assert(s.layer === this.layer,
      'Should not compute direction across different layers');
    const len = geom.distBetween(this, s);
    const ilen = 1 / (len || 1);
    const d = {
      x: (s.x - this.x) * ilen,
      y: (s.y - this.y) * ilen
    };
    return withDist ? [d, len] : d;
  }
  deltaTo(s){
    assert(s.layer === this.layer,
      'Should not compute delta across different layers');
    return {
      x: s.x - this.x,
      y: s.y - this.y
    };
  }
  distToPoint(p, ctx){
    assert(!(p instanceof GridSample),
      'Argument must be a position, not a sample');
    return geom.distBetween(this.getPos(ctx), p);
  }
  *directNeighbors(withSource = false){
    // note: regular neighborhood
    //    => no need to check for crossing of seam links
    for(const { dx, dy } of N4){
      const sample = this.getDeltaSample(dy, dx);
      if(sample)
        yield withSource ? [ sample, this ] : sample;
    }
  }
  get multiplicity(){ return 1; }
  *family(withSelf = true){
    if(withSelf)
      yield this;
  }
  hasLinks(){ return this.multiplicity > 1; }
  isSelfLink(){ return false; }
  getVertex(){ return this; }
  isVertex(){ return this.getVertex() === this; }
  *neighbors(){
    for(const sample of this.family())
      yield *sample.directNeighbors(true);
  }
  findNeighbor(pred, withSource = false){
    for(const [nsample, source] of this.neighbors()){
      if(pred(nsample, source))
        return withSource ? [nsample, source] : nsample;
    }
    return withSource ? [] : null;
  }
  extendedNeighbors(maxK = 2){
    const neighbors = new Set();
    const stack = Array.from(this.directNeighbors(), node => {
      return { node, k: 1 };
    });
    while(stack.length){
      const { node, k } = stack.pop();
      // do not process a sample twice
      if(neighbors.has(node))
        continue;

      // should we check deeper?
      if(k < maxK){
        for(const n of node.directNeighbors())
          stack.push({ node: n, k: k + 1 });
      } // endif k < maxK
    } // endwhile #stack
    return neighbors;
  }
  *edges(){
    for(const [nsample, source] of this.neighbors()){
      yield new SampleEdge(source, nsample, 0);
    }
  }
  edgeTo(target){
    for(const [nsample, source] of this.neighbors()){
      if(nsample.matches(target))
        return new SampleEdge(source, nsample, 0);
    }
    return null;
  }
  isDirectNeighbor(sample){
    for(const n of this.directNeighbors()){
      if(n === sample)
        return true; // exact match required
    }
    return false;
  }
  isNeighbor(sample){
    for(const [n] of this.neighbors()){
      if(sample.matches(n))
        return true; // non-exact match possible (link samples!)
    }
    return false;
  }
  addNeighbor(){
    assert.error('Regular samples cannot add neighbor samples');
  }
  addNeighbors(...samples){
    for(const sample of samples)
      this.addNeighbor(sample);
  }
  *areaNeighborhoods(){
    for(const dy of [1, -1]){
      for(const dx of [1, -1])
        yield this.getDeltaNeighborhood(this, dy, dx);
    }
  }
  *sharedRegions(target){
    assert(target, 'Requires a neighbor sample');
    assert(target.layer === this.layer, 'Regions are within layers');
    // check if possibly sharing a neighboring region
    const dy = target.y - this.y;
    const dx = target.x - this.x;
    // rule out same sample target
    if(!dx && !dy)
      return;
    // look only at targets being an adjacent neighbor
    if(Math.abs(dy) <= 1 && Math.abs(dx) <= 1){
      if(dx === 0){
        yield this.getDeltaNeighborhood(this, dy, -1);
        yield this.getDeltaNeighborhood(this, dy, +1);

      } else if(dy === 0) {
        yield this.getDeltaNeighborhood(this, -1, dx);
        yield this.getDeltaNeighborhood(this, +1, dx);

      } else {
        yield this.getDeltaNeighborhood(this, dy, dx);
      }
    }
  }

  getDeltaNeighborhood(q, dy, dx){
    assert(Math.abs(dx) === 1 && Math.abs(dy) === 1,
      'Invalid dx/dy', dx, dy);
    const samples = [ this ];
    for(const [dxi, dyi] of [
      [dx, 0],
      [dx, dy],
      [0, dy]
    ]){
      const samp = this.getDeltaSample(dyi, dxi);
      if(samp)
        samples.push(samp);
    }
    return new SampleNeighborhood(samples, q);
  }

  /**
   * Return a sample neighborhood associated with this sample for a given query point
   * The neighborhood from regular samples is either
   * - a four-sample neighborhood (bilinear interpolation)
   * - a three-sample neighborhood (barycentric interpolation)
   * 
   * @param {{x,y}} q the query point in layer coordinates
   */
  query(q){
    // four possible quadrants
    const dx = q.x >= this.x ? 1 : -1;
    const dy = q.y >= this.y ? 1 : -1;
    return this.getDeltaNeighborhood(q, dy, dx);
  }

  asNeighborhood(){
    return new SampleNeighborhood([this], this, [1]);
  }
}


// ###########################################################################
// ##### Intermediate Sample #################################################
// ###########################################################################


class IntermediateSample extends GridSample {
  constructor(layer, y, x){
    super(layer, y, x);

    // neighboring samples
    this.innerSamples = [];         // [{x,y}]
    this.interSamples = new Set();  // Set<IntermediateSample>
    this.borderSamples = new Set(); // Set<BorderSample>
  }

  // --- serialization -------------------------------------------------------
  toData(){
    return Object.assign(super.toData(), {
      innerSamples: this.innerSamples,
      interSamples: Array.from(this.interSamples, s => s.getLayerPos()),
      borderSamples: Array.from(this.borderSamples, s => s.dataIndex)
    });
  }
  static fromData(layer, data){
    assert(layer.index === data.layer, 'Layer index does not match');
    return new IntermediateSample(
      layer, data.y, data.x
    );
  }

  loadData(data){
    // load base data
    super.loadData(data);
    // this assumes that we can get access to boundary samples
    // in the whole grid, as well as all border samples
    this.innerSamples = data.innerSamples;
    this.interSamples = new Set(data.interSamples.map(({x,y}) => {
      return this.layer.getSample(y, x, true);
    }));
    this.borderSamples = new Set(data.borderSamples.map(dataIdx => {
      return this.layer.borderSamples[dataIdx];
    }));
  }

  // --- getters -------------------------------------------------------------
  matches(target){ return this === target; }
  isIntermediate(){ return true; }

  // --- neighbors -----------------------------------------------------------
  *directNeighbors(withSource = false){
    for(const p of this.innerSamples){
      const is = this.layer.getSample(p.y, p.x);
      yield withSource ? [is, this] : is;
    }
    for(const bs of this.interSamples)
      yield withSource ? [bs, this] : bs;
    for(const bs of this.borderSamples)
      yield withSource ? [bs, this] : bs;
  }
  addNeighbor(sample, andBack = true){
    if(sample.isBorder()){
      this.borderSamples.add(sample);
      if(andBack)
        sample.addNeighbor(this, false);

    } else if(sample.isIntermediate()){
      this.interSamples.add(sample);
      if(andBack)
        sample.addNeighbor(this, false);

    } else {
      // normalize to {x,y} (could be MeshSample or {x,y,...})
      const { x, y } = sample;
      // only add if not already in list
      if(!this.innerSamples.find(p => p.x === x && p.y === y)){
        this.innerSamples.push({ x, y });
      }
    }
  }
  isInnerNeighbor(sample){
    return this.innerSamples.some(({x,y}) => {
      return sample.x === x && sample.y === y;
    });
  }
  isIntermediateNeighbor(sample){
    return this.interSamples.has(sample);
  }
  isNonBorderNeighbor(sample){
    return this.isInnerNeighbor(sample)
        || this.isIntermediateNeighbor(sample);
  }

  // --- neighborhoods -------------------------------------------------------
  *sharedRegions(target){
    assert(target, 'Requires a neighbor sample');
    assert(target.layer === this.layer, 'Regions are within layers');
    // assert(target.layer === this.layer, 'Regions are within layers');
    // check if possibly sharing a neighboring region
    if(this.matches(target))
      return;
    
    // three cases, depending on target type:
    // 1) regular target
    //  = delta neighborhoods
    // 2) intermediate target
    //  = shared triangles + potential shared quads
    // 3) border target
    //  = shared border triangles
    if(target.isIntermediate()){
      // intermediate case (2)

      const dx = target.x - this.x;
      const dy = target.y - this.y;
      const list = [];
      // - delta neighborhoods
      if(dx && dy){
        // using diagonal as single delta region
        const nh = this.getDeltaNeighborhood(this, dy, dx);
        if(nh.isArea())
          yield nh;

      } else {
        assert(dx || dy, 'One of both must be non-zero');

        // testing both sides of the non-zero delta
        const d = dx ? [[dx, -1], [dx, 1]] : [[-1, dy], [1, dy]];
        for(const [dxi, dyi] of d){
          const nh = this.getDeltaNeighborhood(this, dyi, dxi);
          if(nh.isArea())
            yield nh;
          // else it's not a region
        }
      }

      // - shared border(s)
      for(const bn of this.borderSamples){
        if(bn.isIntermediateNeighbor(target)){
          yield new SampleNeighborhood([
            this, target, bn
          ], this);
        }
      }
      return list;

    } else {
      // regular case (1) or border case (3)
      // => delegate to the target sample
      yield *target.sharedRegions(this);
    }
  }
  getDeltaNeighborhood(q, dy, dx){
    const samples = [
      [0, 0],
      [dx, 0],
      [dx, dy],
      [0, dy]
    ].flatMap(([dxi, dyi]) => {
      const sample = this.getDeltaSample(dyi, dxi);
      return sample ? [ sample ] : []; // only keep valid grid samples

    }).filter((sample, idx, arr) => {
      // Filter pass 1
      // This filters out off-diagonals that are not connected to source
      // and diagonals that are not connected to off-diagonals

      // keep samples that form a useful delta-connection
      // - idx=0 (source=this)
      // - connected to source (this)
      if(idx === 0 || this.isNonBorderNeighbor(sample))
        return true;
      // else only keep if connected to both previous and next samples
      return sample.isDirectNeighbor(arr[idx-1])
          && sample.isDirectNeighbor(arr[(idx+1)%arr.length]);

    }).filter((sample, idx, arr) => {
      // Filter pass 2
      // This filters out discontinuity
      // => remains either a continuous neighborhood or the source alone
      if(idx === 0)
        return true;
      // except for source, all need to be neighbor of each other
      return sample.isDirectNeighbor(arr[idx-1])
          && sample.isDirectNeighbor(arr[(idx+1)%arr.length]);
    });
    return new SampleNeighborhood(samples, q);
  }
  *intermediateBorderNeighborhoods(){
    // this-intermediate-border neighborhoods
    for(const boundSample of this.interSamples){
      for(const borderSample of this.borderSamples){
        if(borderSample.isIntermediateNeighbor(boundSample)){
          yield new SampleNeighborhood([this, boundSample, borderSample], this);
        }
      } // endfor borderSample
    } // endfor boundSample
  }
  *borderBorderNeighborhoods(){
    // this-border-border neighborhoods
   for(const ni of this.borderSamples){
     for(const nj of this.borderSamples){
        if(ni === nj)
          break; // no need to iterate further
        // else nj < ni
        if(ni.nextSample === nj
        || ni.prevSample === nj
        || ni.borderSamples.has(nj))
          yield new SampleNeighborhood([this, ni, nj], this);
     }
   }
  }
  *areaNeighborhoods(){
    // go over delta neighborhoods
    for(const dy of [1, -1]){
      for(const dx of [1, -1]){
        const nh = this.getDeltaNeighborhood(this, dy, dx);
        if(nh && nh.isArea())
          yield nh;
      }
    }

    // this-boundary-border neighborhoods
    yield *this.intermediateBorderNeighborhoods();
    
    // this-border-border neighborhoods
    yield *this.borderBorderNeighborhoods();
  }

  query(q, spread = true){
    // cases:
    // 1) The query is close to our sample point
    // => use direct value at sample
    // 2) The query is very close to an edge
    // => use projection on edge with linear interpolant
    // 3) The query is within an area neighborhood
    // => use that neighborhood
    // 4) The query is outside the sketch
    // => delegate to closest border sample, or recursively search for it

    // check for case (1)
    const p0 = this.getLayerPos();
    const eps = 1e-2;
    if(geom.distBetween(p0, q) < eps)
      return new SampleNeighborhood([ this ], q);

    // check for case (2), and record distance for (4)
    const ns = Array.from(this.directNeighbors());
    const ps = ns.map(n => n.getLayerPos());
    let closestSegment;
    let closestDist = Infinity;
    for(let i = 0; i < ns.length; ++i){
      const pt = ps[i];
      const dist = geom.distToSegment(q, [p0, pt]);
      if(dist < eps){
        return new SampleNeighborhood([ this, ns[i] ], q);

      } else if(dist < closestDist){
        closestSegment = [ this, ns[i] ];
        closestDist = dist;
      }
    }

    // check for case (3)
    for(const nh of this.areaNeighborhoods()){
      if(nh.contains(q))
        return nh.query(q, false); // no need to check for containment
    }

    // delegate to (4)
    if(closestSegment){
      const n1 = closestSegment[1];
      if(n1.isBorder()){
        return n1.query(q);

      } else if(n1.isIntermediate() && spread) {
        return n1.query(q, false);

      } else {
        return null; // this should not happen
      }
    }
  }
}


// ###########################################################################
// ##### Border Sample #######################################################
// ###########################################################################


class BorderSample extends GridSample {
  constructor(layer, y, x, segIndex, alphas, dataIndex, deltaIndex){
    super(layer, y, x);
    // linear data index
    this.dataIndex  = dataIndex;  // absolute index
    this.deltaIndex = deltaIndex; // relative index (within segment block)
    // border data
    assert(segIndex.length && segIndex.length === alphas.length,
      'Invalid segment arguments: either empty or non-matching');
    this.segIndex = segIndex; // [number]
    this.alphas   = alphas;   // [number]

    // local neighborhood
    this.nextSample     = null; // BorderSample
    this.nextSampleLink = null; // BorderSample
    this.nextLinkIndex  = -1;
    this.prevSample     = null; // BorderSample
    this.prevSampleLink = null; // BorderSample
    this.prevLinkIndex  = -1;
    this.interSamples   = new Set(); // Set<IntermediateSample>
    this.borderSamples  = new Set(); // Set<BorderSample>

    // link neighborhood [direct..., indirect...]
    this.links        = []; // [Link]
    this.linkAlphas   = []; // [0|1]
    this.linkSamples  = []; // [BorderSample]
    this.rotations    = []; // [{x,y}]
    this.directLinkCount = 0;

    // edge and vertex topology
    this.isPrevEdgeOpen = false;
    this.isNextEdgeOpen = false;
    this.isVertexOpen = false;

    // properties
    this._innerNormal = null; // {x,y}
    this._angleSum    = -1.0; // number
    this.vertexSample = this; // BorderSample

    // special annotations
    this.selfLink = false;
  }

  // --- serialization -------------------------------------------------------
  toData(){
    return Object.assign(super.toData(), {
      layer: this.layer.index,
      y: this.y, x: this.x,
      segIndex: this.segIndex,
      alphas: this.alphas,
      dataIndex: this.dataIndex,
      deltaIndex: this.deltaIndex,
      // border samples
      interSamples: Array.from(this.interSamples, s => s.getLayerPos()),
      borderSamples: Array.from(this.borderSamples, s => s.dataIndex),
      // topology opening
      isPrevEdgeOpen: this.isPrevEdgeOpen,
      isNextEdgeOpen: this.isNextEdgeOpen,
      isVertexOpen: this.isVertexOpen
    });
  }
  static fromData(layer, data){
    assert(layer.index === data.layer, 'Layer index does not match');
    return new BorderSample(
      layer, data.y, data.x,
      data.segIndex, data.alphas,
      data.dataIndex, data.deltaIndex
    );
  }
  loadData(data){
    // load base data (constraints, region)
    super.loadData(data);
    // load border data
    this.borderSamples = new Set(data.borderSamples.map(dataIdx => {
      return this.layer.borderSamples[dataIdx];
    }));
    this.interSamples = new Set(data.interSamples.map(({ x, y }) => {
      return this.layer.getSample(y, x);
    }));
    // load topology data
    for(const name of [
      'isPrevEdgeOpen', 'isNextEdgeOpen', 'isVertexOpen'
    ]){
      assert(name in data, 'Topology data missing', name, data);
      this[name] = data[name];
    }
  }

  // --- data preparation ----------------------------------------------------
  initialize(){

    // check we have an associated segment
    assert(this.segIndex.length, 'No segment on border?');

    // set next/prev samples
    this.nextSample = this.getSegmentNeighbor(1);
    this.prevSample = this.getSegmentNeighbor(-1);

    const layerLevel = this.layer.level;
    for(let i = 0; i < this.segIndex.length; ++i){
      const segIdx = this.segIndex[i];
      // i) link
      const link = this.layer.sketch.getLink(segIdx);
      if(!link)
        continue; // no link for that segment

      // ii) linked layer
      const llayer = this.layer.parent.getLayer(link.target, layerLevel);

      // iii) sample
      const t = this.alphas[i];
      assert(t >= 0 && t <= 1, 'Invalid time value', t);
      const lt = link.linkedTime(t);
      const lsample = llayer.getBorderSample(link.targetIndex, lt);
      assert(lsample, 'Invalid link sample');

      // iv) check for self-link
      if(lsample === this){
        // we do not consider this sample to have any link
        // since it's a link to itself => no rotation or double storage
        this.selfLink = true;
        break;
      }

      // v) rotation and actual storage
      this.links.push(link);
      this.linkAlphas.push(t);
      this.linkSamples.push(lsample);
      this.rotations.push(link.getRotation(t));
    }

    /*
    // make links uniques
    // = in case a corner matches another corner identically
    for(let i = 0; i < this.links.length;){
      const lsamp  = this.linkSamples[i];
      const lrot   = this.rotations[i];
      let isSame = lsamp === this; // to remove same-sketch self links
      if(isSame)
        this.selfLink = true; // special case
      for(let j = 0; j < i && !isSame; ++j){
        if(lsamp.matches(this.linkSamples[j])
        && geom.approximately(this.rotations[j].x, lrot.x)
        && geom.approximately(this.rotations[j].y, lrot.y)){
          // it's basically the same link to epsilon precision
          isSame = true;
          // /!\ if same sample, but different
          // rotations (beyond epsilon precision), then we want to keep
          // the two versions because they lead to different flows
          // that should be merged
          // = sharp corner on this side 
        }
      }
      if(isSame){
        // => we can remove the new (i) link
        // /!\ j links are past links (below i)
        this.links.splice(i, 1);
        this.linkAlphas.splice(i, 1);
        this.linkSamples.splice(i, 1);
        this.rotations.splice(i, 1);

      } else {
        // check next link
        ++i;
      }
    }
    */
    this.directLinkCount = this.links.length;
    // update vertex sample
    if(!this.isVertexOpen)
      this.vertexSample = this.getVertexSample();
  }
  getVertexSample(){
    return this.linkSamples.reduce((v, s) => {
      if(v.sampleId <= s.sampleId)
        return v;
      else
        return s;
    }, this);
  }
  getVertex(){ return this.vertexSample; }
  getLinkMap(checkRelated = false){
    const linkMap = new Map([[this, []]]); // Map<trg, [src, idx]>
    const queue = [ this ];
    while(queue.length){
      const sample = queue.pop();
      for(let i = 0; i < sample.directLinkCount; ++i){
        const lsample = sample.linkSamples[i];
        // visit samples only once
        if(linkMap.has(lsample))
          continue; // already visited
        
        // may not cross link if unrelated
        const alpha = sample.linkAlphas[i];
        if(checkRelated && !sample.links[i].hasTransmission(alpha))
          continue; // unrelated through transmission

        // register sample
        linkMap.set(lsample, [sample, i]);

        // push for visit if it has other links
        if(lsample.links.length > 1)
          queue.push(lsample);
        // else there's no point visiting it
      }
    }
    return linkMap;
  }
  crossInitialize(){
    // cross-initialization only matters when we have direct links
    if(!this.directLinkCount)
      return;
    
    // compute indirect set of links
    const linkMap = this.getLinkMap();
    // scenarios:
    // 1) two links, no indirect link (i.e. same link sample for both)
    // => #linkMap=#links=2
    // 2) one link, no indirect link
    // => #linkMap=#links+1=2
    // 3) anything else, with indirect link(s)
    // => #linkMap>#links+1
    assert(linkMap.size >= this.links.length,
      'Did not traverse some link samples?');

    // actual cross-initialization
    // /!\ this assumes that the neighborhood rotations
    //     are independent of the traversal order
    if(linkMap.size > this.links.length + 1){
      // go over linked samples
      for(const [linkSample, [srcSample, i]] of linkMap.entries()){
        if(linkSample === this
        || srcSample === this)
          continue; // can skip ourselves and direct links
        // else we have an undirect link
        this.links.push(srcSample.links[i]);
        this.linkAlphas.push(srcSample.linkAlphas[i]);
        this.linkSamples.push(linkSample);
        // compute rotation
        let rot = geom.zeroRotationVector();
        let [preSample, preIdx] = [srcSample, i];
        for(let iter = 0; preSample && iter < 100; ++iter){
          rot = geom.rotateVector(rot, srcSample.rotations[preIdx]);
          [preSample, preIdx] = linkMap.get(srcSample);
        }
        assert(preSample, 'Could not resolve rotation, too many steps!');
        this.rotations.push(rot);
      }
      // update vertex sample
      this.vertexSample = this.getVertexSample();
    }

    // set same-link prev/next samples
    for(let i = 0; i < this.directLinkCount; ++i){
      const lsample = this.linkSamples[i];
      for(const bsample of lsample.segmentNeighbors()){
        if(this.nextSample.matches(bsample)){
          this.nextSampleLink = bsample;

        } else if(this.prevSample.matches(bsample)) {
          this.prevSampleLink = bsample;
        }
      } // endfor bsample
      // link indexing
      const linkIdx = this.links[i].index;
      if(this.nextSample.segIndex.includes(linkIdx))
        this.nextLinkIndex = i;
      if(this.prevSample.segIndex.includes(linkIdx))
        this.prevLinkIndex = i;
    } // endfor lsample

    // we need a link index for each sample link
    assert((!this.nextSampleLink && this.nextLinkIndex === -1)
        || (this.nextSampleLink && this.nextLinkIndex !== -1),
      'Next sample link does not match next link index state');
    assert((!this.prevSampleLink && this.prevLinkIndex === -1)
        || (this.prevSampleLink && this.prevLinkIndex !== -1),
      'Prev sample link does not match prev link index state');

    // at linked corners, both link indices must be different
    if(this.isCorner()){
      assert(this.prevLinkIndex !== this.nextLinkIndex
          || this.isSelfLink(),
        'Linked corner with same link index on both sides');
    }
  }
  markSourcesAndSinks(){
    // open the edge and vertex topology
    // where the flow forms a source / sink
    if(!this.hasLinks())
      return; // nothing to open
    
    // for each adjacent side, check whether the sample
    // is a respective flow source / sink on the side edge
    const t = this.time();
    const uv = this.flow();
    if(this.prevSampleLink
    && !this.prevSample.isSelfLink()
    && this.prevSample.time() === t){
      const ls = this.linkSamples[this.prevLinkIndex];
      const rot = this.rotations[this.prevLinkIndex];
      const luv = ls.flow();
      // rotate flow for comparison
      const luv_rot = geom.rotateVector(luv, rot);
      this.isPrevEdgeOpen = geom.dot(uv, luv_rot) < -Math.SQRT1_2;
    }
    // else
    //   this.isPrevEdgeOpen = !this.prevSampleLink;

    if(this.nextSampleLink
    && !this.nextSample.isSelfLink()
    && this.nextSample.time() === t){
      const ls = this.linkSamples[this.nextLinkIndex];
      const rot = this.rotations[this.nextLinkIndex];
      const luv = ls.flow();
      // rotate flow for comparison
      const luv_rot = geom.rotateVector(luv, rot);
      this.isNextEdgeOpen = geom.dot(uv, luv_rot) < -Math.SQRT1_2;
    }
    // else
    //   this.isNextEdgeOpen = !this.nextSampleLink;

    // vertex opening
    this.isVertexOpen = this.isPrevEdgeOpen && this.isNextEdgeOpen;
    if(this.isVertexOpen)
      this.vertexSample = this; // not using a link sample
  }
  addNeighbor(sample, andBack = true){
    if(sample.isIntermediate()){
      this.interSamples.add(sample);
      if(andBack)
        sample.addNeighbor(this, false);

    } else if(sample.isBorder()){
      // skip prev/next samples
      if(this.getSegmentNeighbor(+1) === sample
      || this.getSegmentNeighbor(-1) === sample)
        return; // implicitly defined
      this.borderSamples.add(sample);
      if(andBack)
        sample.addNeighbor(this, false);

    } else {
      assert.error('Invalid sample as neighbor', sample);
    }
  }

  // --- data storage --------------------------------------------------------
  time(){ return this.layer.bdata.get(this.dataIndex, T); }
  setTime(t, propagate = false){
    this.layer.bdata.set(this.dataIndex, T, t);
    // update time of all linked samples
    if(propagate){
      for(const lsample of this.linkSamples)
        lsample.setTime(t, false);
    }
  }
  kappa(){ return this.layer.bdata.get(this.dataIndex, K); }
  setKappa(k, propagate = false){
    this.layer.bdata.set(this.dataIndex, K, k);
    if(propagate){
      for(const lsample of this.linkSamples)
        lsample.setKappa(k, false);
    }
  }
  setDt(dt, propagate = true){
    super.setDt(dt);
    if(propagate){
      for(const lsample of this.linkSamples)
        lsample.setDt(dt, false);
    }
  }
  flow(rot = null){
    const uv = {
      x: this.u(), // U
      y: this.v()  // V
    };
    if(rot){
      return geom.rotateVector(uv, rot);
    } else {
      return uv;
    }
  }
  u(){ return this.layer.bdata.get(this.dataIndex, U); }
  v(){ return this.layer.bdata.get(this.dataIndex, V); }
  hasFlow(){ return this.u() || this.v(); }
  setFlow(uv, scaleFactor = 1.0){
    this.layer.bdata.set(this.dataIndex, U, scaleFactor * uv.x);
    this.layer.bdata.set(this.dataIndex, V, scaleFactor * uv.y);
  }
  setRegion(region){
    assert(region, 'Cannot assign an empty region');
    for(const sample of this.family())
      sample.rindex = region.index;
  }
  clearRegion(){
    for(const sample of this.family())
      sample.rindex = -1;
  }

  // --- getters -------------------------------------------------------------
  get sampleId(){ return [this.layer.index, 'b' + this.dataIndex].join(':'); }
  get vertexId(){ return this.vertexSample.sampleId; }
  isBorder(){ return true; }
  matches(target){
    return this === target // self
        || this.isLinkSample(target); // linked version
  }
  isSelfLink(){ return this.selfLink; }
  isLinkSample(target){ return this.linkSamples.includes(target); }
  isDirectLinkSample(target){
    const i = this.linkSamples.indexOf(target);
    return i !== -1 && i < this.directLinkCount;
  }
  isIntermediateNeighbor(target){
    return this.interSamples.has(target);
  }
  isCorner(){ return this.segIndex.length > 1; }
  isOnShapeBoundary(checkAcrossLinks = true){
    // corner or not
    if(!this.isCorner()){
      // not a corner => on boundary if no link
      return !this.hasLinks();

    } else {
      // at a corner
      // => on boundary if an edge from it is on the boundary
      if(this.selfLink)
        return false; // self-link corners are all within the shape
      if(this.segIndex.some(segIdx => !this.sketch.getLink(segIdx)))
        return true; // one side segment has no link => boundary!
      if(checkAcrossLinks)
        return this.linkSamples.some(ls => ls.isOnShapeBoundary(false));
      else
        return false;
    }
  }
  *shapeBoundaryNeighbors(checkThisOnBoundary = true){
    // should we consider only vertices?
    const vertexNeighbors = this.multiplicity > 1;
    // /!\ only meaningful if this sample is on the shape boundary
    assert(!checkThisOnBoundary || this.isOnShapeBoundary(),
      'Shape boundary neighbors from within the shape');
    let count = 0;
    for(const sample of this.family()){
      // check next sample along border
      if((!vertexNeighbors || sample.nextSample.isVertex())
      && sample.nextSample.isOnShapeBoundary()){
        ++count;
        yield sample.nextSample;
      }
      // check prev sample along border
      if((!vertexNeighbors || sample.prevSample.isVertex())
      && sample.prevSample.isOnShapeBoundary()){
        ++count;
        yield sample.prevSample;
      }
    }
    // assuming this sample is on the manifold boundary, then
    // we should have yielded at least one neighbor, at most two
    assert(count === 1 || count === 2,
      'There should be one or two shape boundary neighbors');
  }

  isBorderExtremum(){
    const t = this.time();
    const [dt0, dt1] = Array.from(this.segmentNeighbors(), b => {
      return t - b.time();
    });
    // XXX should we really use geom.approximately here?
    return geom.approximately(dt0, 0)
        || geom.approximately(dt1, 0)
        || Math.sign(dt0) === Math.sign(dt1);
  }
  
  isCritical(){
    // two scenarios:
    // 1) we're on the manifold shape boundary
    // 2) we're within the manifold shape
    if(this.isOnShapeBoundary()){
      // check if local time extremum along the boundary neighbors
      const t = this.time();
      const [dt0, dt1] = Array.from(this.shapeBoundaryNeighbors(false), bs => {
        return t - bs.time();
      });
      // /!\ dti is t - t(i)
      if(dt0 === 0 || dt1 === 0){
        // if some neighbor has the same time
        // then it's clearly a critical region (time extremum)
        // /!\ it may be inside or at the boundaries, so we
        //     better have some pruning strategy
        return true;

      } else {
        // if both have the same sign,
        // then we're at a local maximum or minimum
        // else we're not
        return Math.sign(dt0) === Math.sign(dt1);
      }

    } else {
      // when within the shape, we consider ourselves critical
      // <=> local extremum with flow conflicts

      // 1) Check for flow conflict
      // checking for source / sink location in the flow sense
      // = check any link sample conflict with this sample
      let hasConflict = false;
      const uv = this.flow();
      for(let i = 0; i < this.linkSamples.length && !hasConflict; ++i){
        const lsample = this.linkSamples[i];
        const luv = lsample.flow(this.rotations[i]);
        // consider "conflicted"
        // <=> the deviation angle is larger than pi/2
        if(geom.dot(uv, luv) < 0){
          hasConflict = true;
        }
      }
      // if no conflict, then we're not in a critical region
      if(!hasConflict)
        return false;
      
      // checking for topological time split / merge
      // = local maximum or minimum among all border neighbors
      const t0 = this.time();
      const signs = new Set();
      for(const sample of this.family()){
        for(const bsample of [sample.nextSample, sample.prevSample]){
          const ti = bsample.time();
          signs.add(Math.sign(t0 - ti));
        }
      }
      assert(1 <= signs.size && signs.size <= 3,
        'Invalid number of states', signs.size);
      // if one neighbor has dt=0
      // then there is a local extremum region
      if(signs.has(0))
        return true;
      
      // if only one non-zero sign, then it's a time extremum
      if(signs.size === 1)
        return true;

      // else, could we still have a topological split / merge?
      // XXX unclear whether we've caught all cases here
      return false;
    }
  }
  get innerNormal(){
    if(!this._innerNormal)
      this._innerNormal = this.getInnerNormal();
    return this._innerNormal;
  }
  getInnerNormal(index = -1){
    const sketch = this.layer.sketch;
    if(this.segIndex.length === 1)
      index = 0;
    if(index !== -1){
      const segIdx = this.segIndex[index];
      const seg = sketch.getSegment(segIdx);
      const alpha = this.alphas[index];
      const n = seg.normal(alpha, true);
      if(sketch.isInward())
        return n;
      else
        return geom.scale(n, -1);

    } else {
      // two scenarios:
      // 1) The average normal is well defined
      // => we can use that directly
      // 2) It is not (the normals cancel each others)
      // => use previous tangent, based on sketch orientation
      const avg = geom.meanVector(this.segIndex.map((_, i) => {
        return this.getInnerNormal(i);
      }));
      const len = geom.length(avg);
      if(len > 1e-3){
        return geom.scale(avg, 1 / len); // safe to normalize
      }
      // else it's not safe => use tangent information
      const alpha = sketch.isCCW() ? 1 : 0;
      const segIdx = this.alphas.indexOf(alpha);
      assert(segIdx !== -1, 'Missing segment index');
      const seg = sketch.getSegment(segIdx);
      return seg.tangent(alpha, true);
    }
  }
  getNormalFlowSign(){
    const uv = this.flow();
    const n = this.getInnerNormal();
    return Math.sign(geom.dot(uv, n));
  }
  get angleSum(){
    if(this._angleSum < 0.0)
      this._angleSum = this.getAngleSum();
    return this._angleSum;
  }
  getAngleSum(){
    let sum = 0.0;
    for(const f of this.areaNeighborhoods()){
      const lA = geom.distBetween(f.samples[0], f.samples[1]);
      const lB = geom.distBetween(f.samples[0], f.samples[2]);
      const lOpp = geom.distBetween(f.samples[1], f.samples[2]);
      const q = (lA * lA + lB * lB - lOpp * lOpp) / (2 * lA * lB);
      const angle = Math.acos(
        Math.max(-1, Math.min(1, q)) // clamp to within [-1;+1]
      );
      sum += angle;
    }
    return sum;
  }

  // --- neighbors -----------------------------------------------------------
  getSegmentNeighbor(offset){
    const borderSamples = this.layer.borderSamples;
    const N = borderSamples.length;
    return borderSamples[(this.dataIndex + offset + N) % N];
  }
  *segmentNeighbors(withSource = false){
    if(withSource){
      yield [ this.nextSample, this ];
      yield [ this.prevSample, this ];
    } else {
      yield this.nextSample;
      yield this.prevSample;
    }
  }
  *directNeighbors(withSource = false){
    // go over border samples
    yield *this.segmentNeighbors(withSource);

    // go over inner samples
    for(const is of this.interSamples){
      // const sample = this.layer.getSample(y, x);
      yield withSource ? [ is, this ] : is;
    }

    // go over extra border samples
    for(const bs of this.borderSamples){
      yield withSource ? [ bs, this ] : bs;
    }
  }
  get multiplicity(){ return this.linkSamples.length + 1; }
  *family(withSelf = true){
    if(withSelf)
      yield this;
    // go over links, but do not yield any double-direct sample
    for(let i = 0; i < this.linkSamples.length; ++i)
      if(this.linkSamples[i] !== this.linkSamples[i-1])
        yield this.linkSamples[i];
  }
  *directLinkSamples(selfLinks = true){
    for(let i = 0; i < this.directLinkCount; ++i)
      yield this.linkSamples[i];
    if(selfLinks && this.selfLink)
      yield this;
  }

  // --- neighborhoods -------------------------------------------------------
  *sharedRegions(target){
    assert(target, 'Requires a neighbor sample');
    assert(target.layer === this.layer, 'Regions are within layers');
    // check if possibly sharing a neighboring region
    if(target === this)
      return; // only works with non-same target
    
    // /!\ we can assume that the target is a direct neighbor
    // => we are looking for a triangle from the direct neighbors
    //    that has that target as direct neighbor too
    for(const nsample of this.directNeighbors()){
      if(nsample.isDirectNeighbor(target))
        yield new SampleNeighborhood([this, target, nsample], this);
    }
  }
  *areaNeighborhoods(acrossLinks = true){
    // across-layers regions
    if(acrossLinks){
      for(const lsample of this.linkSamples)
        yield *lsample.areaNeighborhoods(false);
    }

    // within-layer regions
    const nsamples = Array.from(this.directNeighbors());
    for(let i = 0; i < nsamples.length; ++i){
      const ni = nsamples[i];
      for(let j = i + 1; j < nsamples.length; ++j){
        const nj = nsamples[j];
        if(ni.isDirectNeighbor(nj)){
          yield new SampleNeighborhood([
            this, ni, nj
          ], this);
        }
      } // endfor i < j < #nsamples
    } // endfor i < #nsamples
  }
  
  /**
   * Return a sample neighborhood based on this sample, for a given query point.
   * 
   * @param {{x,y}} q query point in layer coordinates
   * @return {SampleNeighborhood} the sample neighborhood for data queries
   */
  query(q){
    // three cases:
    // 1) The query is very close to our sample point
    // => use direct value at sample
    // 2) The query is very close to an edge (a) or outside the sketch (b)
    // => project to nearest border segment and use linear interpolant
    // 3) The query is inside the sketch
    // => find enclosing triangle and use barycentric inteprolation

    // check for case (1)
    const p0 = this.getLayerPos();
    const eps = 1e-2;
    if(geom.distBetween(p0, q) < eps)
      return new SampleNeighborhood([ this ], q);

    // check for case (2.a), and record distance for (2.b)
    const ns = Array.from(this.directNeighbors());
    const ps = ns.map(n => n.getLayerPos());
    let closestSegment;
    let closestDist = Infinity;
    for(let i = 0; i < ns.length; ++i){
      const pt = ps[i];
      const dist = geom.distToSegment(q, [p0, pt]);
      if(dist < eps){
        return new SampleNeighborhood([ this, ns[i] ], q);

      } else if(dist < closestDist){
        closestSegment = [ this, ns[i] ];
        closestDist = dist;
      }
    }

    // check for case (3) by checking triangles
    // Note: to find triangle, we know one sample, so we can just
    // test all potential combinations of the two others that are neighbors
    for(let i = 0; i < ns.length; ++i){
      const ni = ns[i];
      const pi = ps[i];
      for(let j = i + 1; j < ps.length; ++j){
        const nj = ns[j];
        if(!ni.isDirectNeighbor(nj))
          continue; // not a valid triangle
        const pj = ps[j];
        // check whether query is in triangle
        if(!geom.inTriangle(q, [p0, pi, pj]))
          continue; // skip since not in triangle
        
        return new SampleNeighborhood([this, ni, nj], q);
      }
    }
    
    // no good local solution
    if(closestSegment){
      // use side that is closest first
      closestSegment.sort((s1, s2) => {
        return geom.sqDistBetween(s1, q) - geom.sqDistBetween(s2, q);
      });
      return new SampleNeighborhood(closestSegment, q);
    } else {
      return null;
    }
  }
}

module.exports = {
  ConstraintData,
  GridSample, IntermediateSample, BorderSample,
  SampleNeighborhood, SampleEdge
};