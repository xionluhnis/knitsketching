// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const Timer = require('../../timer.js');
const geom = require('../../geom.js');
const CoursePath = require('../mesh/coursepath.js');
const StitchSampler = require('./stitchsampler.js');
const SNBranchBound = require('./branchbound.js');
const LocalSolver = require('./localsolver.js');
const wales = require('./wales.js');
const { SeamLayerData } = require('../../sketch/seam.js');
const SketchLayer = require('../compiler/sketchlayer.js');
const rand = require('../../random.js');

// short-row alignment
const SR_TOP = 'top';
const SR_MIDDLE = 'middle';
const SR_BOTTOM = 'bottom';

function SamplingAlgorithm(mesh, {
  waleDist, courseDist,
  sketchScale      = 1,
  waleAccWeight    = 1,
  courseAccWeight  = 1,
  globalSimpWeight = 0.0,
  localSimpWeight  = 0.0,
  srSimpWeight     = 0.0,
  srSimpPower      = 2,
  srAlignment      = SR_BOTTOM,
  ssAlignment      = 'none',
  ssDepth          = 3,
  ssThreshold      = 0.5,
  subdivSR         = 'even',
  distWeight       = 1,
  seamWeight       = 1,
  seamSupport      = 1,
  subdivSeam       = 'rdiag',
  flowWeight       = 0,
  shapingFactor    = 2,
  globalShaping    = false,
  globalAliasing   = 2, // trivial+basic aliasing
  globalBudget     = 1,
  localBudget      = 1,
  shortRowMode     = 'none',
  uniformBranching = false,
  evenInterfaces   = false,
  bindingBranches  = 1,
  flatLayouts      = 'all',
  useFlatFlipping  = false,
  mixedShaping     = false,
  localScaling     = false,
  minWaleDiff      = false,
  subdiv           = 1,
  debugWasm = false,
  verbose = false
}){
  // double the wale distance
  // note: waleDist is for the wale distance during tracing
  // and double tracing implies we want twice the distance
  // between wales in the stitch graph!
  waleDist *= 2.0;

  // for subdivision, we sample at a coarser scale, so the subdivided
  // stitches match the user specified distance => expand now
  waleDist *= subdiv;
  courseDist *= subdiv;

  // input
  this.mesh = mesh;
  this.waleDist = waleDist;
  this.courseDist = courseDist;
  this.maxDist = Math.max(waleDist, courseDist);
  this.subdiv = subdiv;
  this.subdivSeam = subdivSeam;
  this.subdivSR = subdivSR;
  this.srAlignment = srAlignment;
  this.bindingBranches = bindingBranches;
  this.flatLayouts = flatLayouts;
  this.useFlatFlipping = useFlatFlipping;
  this.mixedShaping = mixedShaping;
  this.minWaleDiff = minWaleDiff;
  this.verbose = verbose;
  // general optimization weights
  this.waleAccWeight = waleAccWeight;
  this.courseAccWeight = courseAccWeight;
  this.shapingFactor = shapingFactor;
  this.distWeight = distWeight;
  this.seamWeight = seamWeight;
  this.flowWeight = flowWeight;
  // seam support (in ratio of courseDist)
  this.seamCrsSupport = (
    seamSupport * this.mesh.layers[0].eta // convert from sample to px
  ) / this.courseDist; // convert from px to number of coarse course distances

  // output
  this.coarseSampler = new StitchSampler(
    mesh.layers.map(layer => layer.sketch),
    { courseDist, waleDist, sketchScale } // coarse distances
  );
  if(subdiv > 1)
    this.sampler = this.coarseSampler.createSubdiv(subdiv);
  else
    this.sampler = this.coarseSampler;

  // state
  this.inited = false;
  // - graph data
  this.regionGraph  = mesh.getRegionGraph();
  // - global algorithm
  this.globalBB = new SNBranchBound({
    waleDist, courseDist, shapingFactor,
    courseAccWeight, waleAccWeight,
    simplicityWeight: globalSimpWeight, aliasingLevel: globalAliasing,
    globalShaping, uniformBranching, evenInterfaces,
    timeBudget: globalBudget,
    debugWasm, verbose
  });
  this.simpNodes = new Set();
  this.edgeToCrs = new Map(); // Map<RegionEdge, idx>
  // - local data
  this.localSolvers = this.regionGraph.nodes.flatMap((n, i) => {
    if(n.isInterface())
      return []; // no local region to worry about
    // else it's a simple region => need a local solver
    return [ new LocalSolver(this.regionGraph, i, {
      waleDist, courseDist, shapingFactor, courseAccWeight, waleAccWeight,
      simplicityWeight: localSimpWeight, timeBudget: localBudget,
      localScaling, shortRowMode, srSimpWeight, srSimpPower,
      ssAlignment, ssDepth, ssThreshold,
      debugWasm, verbose
    }) ];
  });
  this.localIndex = 0;
  // - all stitches (last relaxation)
  this.courses    = [];
  this.sdCourses  = subdiv > 1 ? [] : this.courses;
  this.crsPaths   = [];
  this.crsPairs   = []; // [srcIdx, trgIdx, srcSR[]]
  this.sdCrsPairs = subdiv > 1 ? [] : this.crsPairs;
  this.crsLinks   = [];
  this.stitches   = [];
  this.relaxStep  = 0;
  this.crsPairIdx = 0;
  this.sdPairIdx  = 0;
  this.srPairIdx  = 0;
  this.penaltyCache = new Map(); // Map<str, number>
  this.geoPathCache = new Map(); // Map<str, {ls,ps,lt,pt,dpath,dist}>
  this.stitchSeamDists = new Float32Array(0);
  this.numFullCourses = 0;

  // debug
  this.timer = Timer.create();
}

/**
 * 
 * @param {Sketch[]} sketches list of updated sketches
 * @param {Function} remap mapping from id to sketch object
 * @param {Object[]} seamsData the serialized seam layers
 * @param {Object} params the updated parameters
 */
SamplingAlgorithm.prototype.updateSeamData = function(
  sketches, remap, seamsData, params
){
  const param = (name, def) => {
    if(name in params)
      return params[name];
    else
      return def;
  };
  // reset timer
  this.timer.clear();
  // update things
  sketch: {
    // children curves may have changed (add/remove/edit)
    for(let i = 0; i < this.mesh.layers.length; ++i){
      const layer = this.mesh.layers[i];
      const sketch = sketches.find(s => s.id === layer.sketch.id);
      assert(sketch, 'A sketch is missing');
      layer.sketch = sketch;
      this.sampler.sketches[i] = this.coarseSampler.sketches[i] = sketch;
    }
  }
  seams: {
    // reset completely
    for(let i = 0; i < this.mesh.layers.length; ++i){
      const layer = this.mesh.layers[i];
      const seamLayer = SeamLayerData.fromData(layer, seamsData[i]);
      seamLayer.remapData(remap);
      this.mesh.seamLayers[i] = seamLayer;
    }
  }
  distrib: {
    this.relaxStep = 0;
    this.crsPairIdx = 0;
  }
  // subdivide+split:
  if(this.subdiv > 1){
    // recover initial state without wales
    for(let cpi = 0; cpi < this.crsPairs.length; ++cpi){
      const [src, trg] = this.crsPairs[cpi];
      for(const s of this.sdCourses[src])
        s.clearNextWales();
      for(const s of this.sdCourses[trg])
        s.clearPrevWales();
    }
    // remove short-row stitches
    this.sampler.clearShortRows();
    // remove subdivision courses
    const baseNC = this.courses.length;
    this.sdCourses.splice(baseNC, this.sdCourses.length - baseNC);
    this.sampler.clearCourses(baseNC);
    this.sdCrsPairs = [];
    this.sdPairIdx = 0;
    this.srPairIdx = 0;
  }
  // split:
  else {
    // recover initial wales
    for(let cpi = 0; cpi < this.crsPairs.length
                  && cpi < this.srPairIdx; ++cpi){
      const [src, trg] = this.crsPairs[cpi];
      const srcCrs = this.courses[src];
      const pairs = [];
      for(const s of srcCrs){
        let nwss = s.getNextWales();
        let gid;
        let sr;
        while(nwss.length) {
          [gid, sr] = nwss[0].getGroupData();
          assert(nwss.length === 1 || !sr,
            'Invalid short-rows structure');
          if(sr){
            nwss[0].clearPrevWales();
            nwss = nwss[0].getNextWales();
            assert(nwss.length, 'Short-row to nothing');

          } else {
            assert(gid === trg, 'The target group does not match');
            break;
          }
        } // endwhile #nws
        if(nwss.length){
          for(const nws of nwss){
            assert(!nws.isShortRow(),
              'Target stitch is a short-row');
            pairs.push([s, nws]);
          } // endfor nws of nwss
        } // endif #nwss
      } // endfor s of srcCrs

      // clear wales from target stitches
      const trgCrs = this.courses[trg];
      for(const s of trgCrs)
        s.clearPrevWales();

      // redistribute wales between pairs
      // /!\ the first pair may be a second input from a decrease
      //     if they happen across the boundaries of the traversal
      // => check for that special case
      if(!pairs.length)
        continue;
      if(pairs.length === 1){
        const [s, t] = pairs[0];
        s.setNextWale(t);
        continue;
      }
      // else, we have at least two pairs
      // => check for case of increase across sides
      if(pairs[0][1] === pairs[pairs.length-1][1]){
        const p = pairs.shift();
        pairs.push(p);
      }
      for(const [s, t] of pairs){
        assert(!s.isShortRow(), 'Source stitch on a short-row');
        assert(!t.isShortRow(), 'Target stitch on a short-row');
        s.setNextWale(t);
      }
    }
    // remove short-rows
    this.srPairIdx = 0;
    this.coarseSampler.clearShortRows();
  }
  cache: {
    this.penaltyCache.clear();
    this.stitchSeamDists = new Float32Array(this.coarseSampler.length);
    this.stitchSeamDists.fill(NaN);
  }
  params: {
    this.mixedShaping = param('mixedShaping', false);
    this.distWeight   = param('distWeight', 1);
    this.seamWeight   = param('seamWeight', 1);
    this.seamSupport  = param('seamSupport', 1);
    this.flowWeight   = param('flowWeight', 0);
    this.seamCrsSupport = (
      this.seamSupport * this.mesh.layers[0].eta // convert from sample to px
    ) / this.courseDist; // convert from px to number of coarse course distances
  }
  this.timer.measure('reset');
};

/**
 * Returns the mesh layer of a stitch
 *
 * @param { Stitch } stitch the stitch
 * @return { MeshLayer } the corresponding mesh layer
 */
SamplingAlgorithm.prototype.layerOf = function(stitch){
  return this.mesh.layers[stitch.getLayerIndex()];
};
SamplingAlgorithm.prototype.lposOf = function(stitch){
  const pos = stitch.getPosition();
  return {
    layer: this.layerOf(stitch), x: pos.x, y: pos.y
  };
};

/**
 * Compute the progress ratio
 *
 * 6 stages:
 * - global solve
 * - local solve
 * - instantiate
 * - distribute
 * - subdivide
 * - split
 * 
 * @return a progress within [0;1]
 */
SamplingAlgorithm.prototype.progress = function(){
  // depends on stage
  // global => [0;1/6)
  if(!this.globalBB.done())
    return this.globalBB.progress() / 6;
  // local => [1/6;2/6)
  if(this.localIndex < this.localSolvers.length){
    const solver = this.localSolvers[this.localIndex];
    let p = solver.progress();
    return (1 + (this.localIndex + p) / this.localSolvers.length) / 6;
  }
  // instantiate => [2/6;3/6)
  if(!this.coarseSampler.length)
    return 2/6;
  else if(this.coarseSampler.length < this.coarseSampler.capacity)
    return (2 + this.coarseSampler.length / this.coarseSampler.capacity) / 6;
  // distrib => [3/6;4/6)
  if(this.crsPairIdx < this.crsPairs.length)
    return (3 + this.crsPairIdx / this.crsPairs.length) / 6;
  // subdiv => [4/6;5/6)
  if(this.sdPairIdx < this.crsPairs.length)
    return (4 + (this.sdPairIdx + 1) / (this.crsPairs.length + 1)) / 6;
  // split => [5/6;6/6]
  return (5 + this.srPairIdx / this.sdCrsPairs.length) / 6; 
};

/**
 * Initialize the sampling algorithm
 */
SamplingAlgorithm.prototype.init = function(){
  // only init once
  if(this.inited)
    return true;

  // Prepare the data for the global sampling algorithm
  this.globalBB.initFromGraph(this.regionGraph);
  return true;
};

SamplingAlgorithm.prototype.globalSample = function(){
  const done = this.globalBB.iterate();
  // measure time of completion
  if(done){
    this.timer.measure('global');

    // log verbose information
    if(this.verbose)
      this.globalBB.debug('G');

    // initialize local solvers with start/end values
    for(let i = 0, r = 0; i < this.globalBB.nodes.length; ++i){
      const node = this.globalBB.nodes[i];
      if(node.simple){
        const localSolver = this.localSolvers[r++];
        // get boundary data
        const snStart = node.inp.reduce((sum, idx) => {
          return sum + this.globalBB.sn[idx];
        }, 0);
        const snEnd   = node.out.reduce((sum, idx) => {
          return sum + this.globalBB.sn[idx];
        }, 0);

        // extract edges
        assert(node.inp.length === 1
            && node.out.length === 1, 'Simple region is not so simple');
        const edgeStart = this.regionGraph.edges[node.inp[0]];
        const edgeEnd   = this.regionGraph.edges[node.out[0]];

        // initialize local solver with global solution
        localSolver.initialize({ 
          snStart, edgeStart,
          snEnd, edgeEnd
        });
      }
    }
  }
  return done;
};

SamplingAlgorithm.prototype.localSample = function(){
  if(this.localIndex >= this.localSolvers.length)
    return true; // skip, since we're done

  const solver = this.localSolvers[this.localIndex];
  // do iteration
  // XXX switch to parallel asynchronous workers
  const done = solver.iterate();
  // if solver is done, switch to next local solver
  let fullyDone = false;
  if(done){
    // log verbose information
    if(this.verbose)
      solver.debug('L' + this.localIndex);

    // switch to next solver
    ++this.localIndex;
    // fully done if none available
    fullyDone = this.localIndex >= this.localSolvers.length;
  }
  // when fully done, measure time of completion
  if(fullyDone){
    this.timer.measure('local');
  }
  return fullyDone;
};

SamplingAlgorithm.prototype.createGlobalCourse = function(edge, N){
  // get course path
  const crsPath = edge.getCoursePath();
  assert(crsPath, 'No valid course path found');
  const reg = this.regionGraph.nodeIndex.get(edge.areaSide);
  assert(typeof reg === 'number', 'Invalid edge area region');
  this.createCourse(crsPath, reg, N);
};

SamplingAlgorithm.prototype.createLocalCourse = function(node, isoline, N){
  assert(isoline.chains.length === 1,
    'Local isoline has multiple chains');
  const crsPath = CoursePath.from(isoline, [0]);
  const reg = this.regionGraph.nodeIndex.get(node);
  assert(typeof reg === 'number', 'Invalid area region');
  this.createCourse(crsPath, reg, N);
};

SamplingAlgorithm.prototype.buildCourse = function(
  sampler, crsPath, reg, N
){
  assert(crsPath.isCCW(),
    'Courses must be in CCW orientation');
  // start the creation of the course in its sampler
  const t = crsPath.isoline.time;
  const crs = [];
  sampler.startCourse(t, reg);

  // create course
  for(const [layer, pos, alpha] of crsPath.sampleStitches(N)){
    const lastStitch = crs[crs.length - 1];
    // create stitch
    const stitch = sampler.createStitch(layer.index, pos, {
      alpha
    });
    crs.push(stitch);
    // set course connections with typed direction
    if(lastStitch)
      lastStitch.setNextCourse(stitch);
  }
  // create final circular course connection if necessary
  if(crsPath.isCircular() && crs.length > 1){
    crs[crs.length-1].setNextCourse(crs[0]);
  }
  return crs;
};

SamplingAlgorithm.prototype.createCourse = function(crsPath, reg, N){
  // orient course path CCW
  crsPath.makeCCW();

  // build new course and register
  this.courses.push(
    this.buildCourse(this.coarseSampler, crsPath, reg, N)
  );
  if(this.subdiv > 1){
    // finer course
    this.sdCourses.push(
      this.buildCourse(this.sampler, crsPath, reg, N * this.subdiv)
    );
  }
  this.crsPaths.push(crsPath);
};

SamplingAlgorithm.prototype.instantiate = function(){
  // if sampler non-empty, we're done
  if(this.coarseSampler.length)
    return true;

  // allocate stitches while merging edges that can be merged trivially
  assert(this.mesh, 'Invalid mesh list');
  let numStitches = 0;
  const edgeIndex = new Map();
  const simpNodes = this.simpNodes;
  for(const [i, n] of this.globalBB.sn.entries()){
    const edge = this.regionGraph.edges[i];
    const node = edge.interface();
    const [inp, out] = this.regionGraph.getNodeEdges(node);
    const edges = inp.concat(out);
    // check for special case
    if(inp.length === 1
    && out.length === 1){
      const oedge = edges.find(e => e !== edge);
      assert(oedge, 'Missing edge');
      // XXX should somehow take care of partial course coverage
      //     at interfaces that do partial cast-on/off
      if(edgeIndex.has(oedge)
      && oedge.isoline === edge.isoline){
        const idx = edgeIndex.get(oedge);
        const on = this.globalBB.sn[idx];
        if(on === n){
          // same isoline + same number of stitches
          // => can merge index into single course
          edgeIndex.set(edge, idx);
          simpNodes.add(node);

          // => no need for new stitches
          continue;
        }
      }
    }
    numStitches += n;
    edgeIndex.set(edge, i);
  }
  for(const localSolver of this.localSolvers){
    for(const n of localSolver.bestState.sn)
      numStitches += n;
  }
  this.coarseSampler.allocate(numStitches);
  if(this.subdiv > 1)
    this.sampler.allocate(numStitches * this.subdiv * this.subdiv);
  if(this.verbose)
    console.log('Allocated ' + numStitches + ' stitches');

  // create all stitches course-by-course
  // - stitches on global edges
  const edgeToCrs = this.edgeToCrs; // new Map(); // Map<RegionEdge, idx>
  for(const [i, n] of this.globalBB.sn.entries()){
    // register edge
    const edge = this.regionGraph.edges[i];
    const ei = edgeIndex.get(edge);
    if(ei === i){
      // normal edge
      edgeToCrs.set(edge, this.courses.length);

      // create actual course
      this.createGlobalCourse(edge, n);

    } else {
      // no need to create a course
      // but we create the necessary aliasing entry
      const oedge = this.regionGraph.edges[ei];
      const crsIdx = edgeToCrs.get(oedge);
      assert(typeof crsIdx === 'number', 'Missing edge data');
      edgeToCrs.set(edge, crsIdx);
    }
  }

  // - stitches on local courses
  const getSR = (crsIdx, srSolver) => {
    return this.sdCourses[crsIdx].map(s => {
      return srSolver.getShortRows(s.getAlpha());
    });
  };
  for(const solver of this.localSolvers){
    const state = solver.bestState;
    let lastIdx = edgeToCrs.get(solver.edgeStart);
    assert(typeof lastIdx === 'number',
      'Missing local start isoline');
    for(const [i, n] of state.sn.entries()){
      // create course pair
      const idx = this.courses.length;
      this.crsLinks.push([]); // allocate pair links
      this.createLocalCourse(solver.region, state.isolines[i], n);
      // store course pair information
      this.crsPairs.push([
        lastIdx, idx,
        getSR(lastIdx, state.srSolvers[i])
      ]);
      lastIdx = idx;
    }
    // last pair
    const idx = edgeToCrs.get(solver.edgeEnd);
    assert(typeof idx === 'number',
      'Missing local end isoline');
    this.crsPairs.push([
      lastIdx, idx,
      getSR(lastIdx, state.srSolvers[state.srSolvers.length - 1])
    ]);
  }

  // measure instantiation time
  this.timer.measure('inst');

  // create fixed pairing across blue node sides except for non-trivial cases
  // note: blue nodes that have two sides associated with a same isoline
  // do NOT require any pairing, they're good by default
  for(const [idx, node] of this.regionGraph.nodes.entries()){
    if(!node.isInterface())
      continue; // only consider interface nodes
    const [inp,out] = this.regionGraph.getNodeEdges(idx);
    if(!inp.length
    || !out.length
    || simpNodes.has(node))
      continue; // no pairing necessary

    // else, we have an interesting node to create a fixed pairing for
    const inpIndex = inp.map(e => edgeToCrs.get(e));
    const outIndex = out.map(e => edgeToCrs.get(e));
    wales.bind(inpIndex, outIndex, {
      courses: this.sdCourses, paths: this.crsPaths,
      penalty: this.basePenalty.bind(this),
      minimal: true,
      numBranches: this.bindingBranches,
      flatLayouts: this.flatLayouts,
      flatFlipping: this.useFlatFlipping
    });
  }

  // measure interface binding time
  this.timer.measure('itfbind');

  // create stitch seam storage
  this.stitchSeamDists = new Float32Array(this.coarseSampler.length);
  this.stitchSeamDists.fill(NaN);
  this.timer.measure('ssalloc');

  return true;
};

SamplingAlgorithm.prototype.basePenalty = function(src, trg){
  const key = [ src.index, trg.index ].join('/');
  if(this.penaltyCache.has(key))
    return this.penaltyCache.get(key);

  // get distance sampler
  const distSampler = this.mesh.getDistanceSampler();

  // compute cost
  let cost = 0.0;

  // 1) distance penalty
  const ls = this.mesh.layers[src.getLayerIndex()];
  const ps = src.getPosition();
  const lt = this.mesh.layers[trg.getLayerIndex()];
  const pt = trg.getPosition();
  const { dist } = distSampler.sketchQueryBetween(
    ls, ps, lt, pt
  );
  // /!\ we want to minimize the distance, not match waleDist!
  // this is important because the stitches may be co-located,
  // so the wale spacing does not make sense here!
  const ndiff = dist / this.waleDist;
  cost += this.distWeight * ndiff * ndiff;

  // 2) flow penalty
  // XXX add flow alignment penalty

  // store in cache
  this.penaltyCache.set(key, cost);

  return cost;
};

SamplingAlgorithm.prototype.stitchPath = function(src, trg){
  // measure coarseness level
  let coLvl = 0;
  if(src.sampler === this.coarseSampler)
    ++coLvl;
  if(trg.sampler === this.coarseSampler)
    ++coLvl;
  // get matching key
  const key = [src.index, trg.index, coLvl].join('/');
  // check geodesic path cache
  if(this.geoPathCache.has(key))
    return this.geoPathCache.get(key);

  // get distance sampler
  const distSampler = this.mesh.getDistanceSampler();

  // compute geodesic path (with distance)
  const ls = this.mesh.layers[src.getLayerIndex()];
  const ps = src.getPosition();
  const lt = this.mesh.layers[trg.getLayerIndex()];
  const pt = trg.getPosition();
  const { dpath } = distSampler.sketchQueryBetween(
    ls, ps, lt, pt
  );
  const dist = dpath[dpath.length - 1].dist;
  const ret = { ls, ps, lt, pt, dpath, dist };
  this.geoPathCache.set(key, ret);
  return ret;
};

SamplingAlgorithm.prototype.stitchMinSeamDist = function(
  stitch, useCache = true
){
  // check cache first
  if(useCache && !Number.isNaN(this.stitchSeamDists[stitch.index]))
    return this.stitchSeamDists[stitch.index];

  // else we compute it and cache it
  const seamLayer = this.mesh.seamLayers[stitch.getLayerIndex()];
  const pos = stitch.getPosition();
  const minSeamDist = seamLayer.querySeamDistance(pos);
  const seamDistRatio = minSeamDist / this.courseDist; // in course ratio
  if(useCache)
    this.stitchSeamDists[stitch.index] = seamDistRatio; // cache value
  return seamDistRatio;
};

SamplingAlgorithm.prototype.walePenalty = function(src, trg, srcIrr, trgIrr){
  const key = [
    src.index, srcIrr ? 'i' : 'r',
    trg.index, trgIrr ? 'i' : 'r', 
    'co' // coarse version
  ].join('/');
  if(this.penaltyCache.has(key))
    return this.penaltyCache.get(key);

  // compute cost
  let cost = 0.0;

  // 1) distance penalty (while storing the geodesic path)
  const { dpath } = this.stitchPath(src, trg);
  const dist = dpath[dpath.length - 1].dist;
  let diff;
  if(this.minWaleDiff)
    diff = dist - this.waleDist;
  else
    diff = dist;
  const ndiff = diff / this.waleDist;
  cost += this.distWeight * ndiff * ndiff;

  // irregular stitch penalties
  const irrStitches = [];
  if(srcIrr) irrStitches.push(src);
  if(trgIrr) irrStitches.push(trg);
  for(const s of irrStitches){
    
    // 2) seam penalty
    if(this.seamWeight > 0){
      const minDist = this.stitchMinSeamDist(s);
      const seamErr = Math.min(this.seamCrsSupport, minDist);
      cost += this.seamWeight * seamErr;
    }
  }

  // 4) flow matching penalty
  if(this.flowWeight > 0){
    let n = 0;
    let fcost = 0;
    // get directions from start to end
    // both at start and at end
    assert(dpath.length > 1, 'Invalid singular path');
    // at source
    let si = -1, sj = -1;
    for(let i = 0, j = 1; j < dpath.length; i = j++){
      if(dpath[i].layer === dpath[j].layer
      && !dpath[j].fromLink){
        si = i;
        sj = j;
        break;
      }
    }
    if(si !== sj){
      const layer = dpath[si].layer;
      const d = geom.unitVector(geom.axpby(
        1, layer.sketchToGrid(dpath[sj]),
        -1, layer.sketchToGrid(dpath[si])
      ));
      const nh = dpath[si].layer.sketchQuery(dpath[si], 1, true);
      const uv = nh.flow();
      fcost += 1 - geom.dot(d, uv);
      n += 1;
    }
    // at target
    let ti = -1, tj = -1;
    for(let i = dpath.length - 2, j = dpath.length - 1; i >= 0; j = i--){
      if(dpath[i].layer === dpath[j].layer
      && !dpath[j].fromLink){
        ti = i;
        tj = j;
        break;
      }
    }
    if(ti !== tj){
      const layer = dpath[tj].layer;
      const d = geom.unitVector(geom.axpby(
        1, layer.sketchToGrid(dpath[tj]),
        -1, layer.sketchToGrid(dpath[ti])
      ));
      const nh = dpath[tj].layer.sketchQuery(dpath[tj], 1, true);
      const uv = nh.flow();
      fcost += 1 - geom.dot(d, uv);
      n += 1;
    }
    // total cost
    // XXX what if n is 0?
    if(n > 0){
      cost += this.flowWeight * fcost; // / n;
    }
  }

  // store in cache
  this.penaltyCache.set(key, cost);

  return cost;
};

SamplingAlgorithm.prototype.distribute = function(){
  // if sampler non-empty, we're done
  if(this.relaxStep > 0)
    return true;

  // 1 = distribute wales
  const [idx0, idx1] = this.crsPairs[this.crsPairIdx];
  const links = wales.bindOneToOne(idx0, idx1, {
    courses: this.courses, paths: this.crsPaths,
    penalty: this.walePenalty.bind(this),
    minimal: !this.mixedShaping
  });
  this.crsLinks[this.crsPairIdx] = links;

  // go to next course pair
  if(++this.crsPairIdx >= this.crsPairs.length){
    this.crsPairIdx = 0;
    ++this.relaxStep;

    // 2 = relax positions
    // XXX allow stitches to move along isolines

    // this.penaltyCache.clear(); // since updated
  }
  

  // measure time
  const done = this.relaxStep > 0;
  if(done)
    this.timer.measure('distr');
  return done;
};

function getMidAlpha(alpha0, alpha1){
  let midAlpha;
  if(alpha0 <= alpha1)
    midAlpha = (alpha0 + alpha1) * 0.5; // default case
  else {
    // a1 < a0 => a0 -> a1 crosses right boundary 1
    midAlpha = (alpha0 + alpha1 + 1) * 0.5;
    if(midAlpha > 1.0)
      midAlpha = Math.max(0, midAlpha - 1.0);
  }
  assert(!isNaN(midAlpha) && 0 <= midAlpha && midAlpha <= 1,
    'Invalid middle alpha');
  return midAlpha;
}

function *splitDPath(dpath, N, startP = dpath[0]){
  const totalLen = (dpath[dpath.length - 1] || { dist: 0 }).dist;
  // singular case
  if(!totalLen){
    for(let i = 0; i < N; ++i)
      yield startP;
    return;
  }
  // else we need to split the geodesic path
  const sampleDist = totalLen / (N + 1);
  // note: start at 1, not 0, since above source stitch
  // thus we have sampIdx * sampleDist as the distance of interest
  let sampIdx = 1;
  let last;
  for(const p of dpath){
    const dist = Math.min(p.dist, totalLen); // for safety
    while(sampIdx * sampleDist < dist && sampIdx <= N){
      const sampDist = Math.min(sampIdx * sampleDist, totalLen); // safety
      const distRem = dist - sampIdx * sampleDist;
      // note: the first point has dist=0, so the loop doesn't happen
      assert(last,
        'No last location yet');
      assert(p.layer === last.layer,
        'Splitting between layers');
      const lastDist = Math.min(last.dist, totalLen); // for safety
      const distDelta = dist - lastDist;
      const alpha = distRem / distDelta;
      // compute splitting position
      const splitPos = geom.axpby(alpha, last, 1 - alpha, p);
      splitPos.layer = p.layer;
      splitPos.dist  = sampDist;
      yield splitPos;
      // target next sample
      ++sampIdx;
      // remember new last location
      last = splitPos;
    }
    last = p;
    if(sampIdx > N)
      break; // note: because of 1-indexing, equality does not break
  }
  // deal with the end samples to be safe (should not happen)
  for(; sampIdx <= N; ++sampIdx){
    // /!\ 1-indexing of sample
    yield last || {
      layer: startP.layer, x: startP.x, y: startP.y, dist: 0
    };
  }
  assert(sampIdx === N + 1,
    'Did not generate the correct number of samples', sampIdx, N + 1);
}

SamplingAlgorithm.prototype.subdivide = function(){
  if(this.subdiv === 1
  || this.sdPairIdx >= this.crsPairs.length)
    return true; // done since nothing to do

  // initialize random seed
  if(this.sdPairIdx === 0 && this.subdivSeam === 'rand')
    rand.seed();

  // get distance sampler
  const distSampler = this.mesh.getDistanceSampler();

  // get course pair information
  const [idx0, idx1, pairSR] = this.crsPairs[this.sdPairIdx];
  const coSrcCrs = this.courses[idx0];
  const srcPath = this.crsPaths[idx0];
  const trgPath = this.crsPaths[idx1];

  // get region information and check coherency
  const region = coSrcCrs[0].getRegionID();
  const coTrgCrs = this.courses[idx1];
  assert(coTrgCrs[0].getRegionID() === region,
    'Region before and after are not coherent for course pair');

  // subdivision courses
  const sdSrcCrs = this.sdCourses[idx0];
  const sdTrgCrs = this.sdCourses[idx1];

  // check course topology for potential shift
  const circ = srcPath.isCircular();
  assert(circ === trgPath.isCircular(),
    'Source and target of different topologies');

  // XXX compute association shift in circular case
  let dj = 0;
  // if circular, check best shift?

  // compute group assignments
  const coLinks = this.crsLinks[this.sdPairIdx];
  const srcToTrgs = new Map();
  const trgToSrcs = new Map();
  for(const [si, ti] of coLinks){
    // src to trgs
    if(srcToTrgs.has(si))
      srcToTrgs.get(si).push(ti);
    else
      srcToTrgs.set(si, [ti]);
    // trg to srcs
    if(trgToSrcs.has(ti))
      trgToSrcs.get(ti).push(si);
    else
      trgToSrcs.set(ti, [si]);
  }
  const clusters = []; // [srcs, trgs][]
  const srcSeen = new Set();
  for(const [src, trgs] of srcToTrgs.entries()){
    if(srcSeen.has(src))
      continue; // already seen previously through a 2-1 case
    const srcs = trgToSrcs.get(trgs[0]);
    for(const s of srcs)
      srcSeen.add(s); // visit all sources
    clusters.push([srcs, trgs]);
    assert(srcs.length === 1 || trgs.length === 1,
      'Neither 1-2, 2-1 nor 1-1');
  }
  clusters.sort(([[s0]], [[s1]]) => s0 - s1);

  // generate row of subdivision stacks
  const blocks = [];
  const subdiv = this.subdiv;
  const numNR = subdiv - 1;
  for(const [coSrcs, coTrgs] of clusters){
    // new rows being created
    const rows = Array.from({ length: numNR + 2 }, () => []);
    blocks.push(rows);
    
    // three cases based on the cardinality of both sides
    const coS = coSrcs.length;
    const coT = coTrgs.length;
    const cardMask = ((coS - 1) << 1) | (coT - 1);
    switch(cardMask){

      case 0b00:
        // 1-1 case (normal)
        //
        // |
        // becomes
        // ||||
        // ||||
        // ||||
        // ||||
        for(let j = 0; j < subdiv; ++j){
          let r = 0;
          const srcStitch = sdSrcCrs[coSrcs[0] * subdiv + j];
          rows[r++].push(srcStitch);
          const trgStitch = sdTrgCrs[coTrgs[0] * subdiv + j + dj];
          const { dpath } = this.stitchPath(srcStitch, trgStitch);
          const startPos = this.lposOf(srcStitch);
          for(const p of splitDPath(dpath, numNR, startPos)){
            rows[r++].push(p);
          }
          rows[r++].push(trgStitch);
          assert(r === numNR + 2, 'Stack of invalid size', r);
        }
        break;

      case 0b01:
        // 1-2 case (increase)
        //
        // V
        // becomes (modulo row-wise permutations)
        // ||||||V
        // ||||V |
        // ||V | |
        // V | | |
        //
        // stitches per row:
        // r=0: k      (src stitches)
        // r=1: k+1
        // r=2: k+2
        // ...
        // r=k: 2k=k+k (trg stitches)
        /* falls through */
      case 0b10: {
        // 2-1 case (decrease)
        //
        // Ʌ
        // becomes (modulo row-wise permutations)
        // | | | Ʌ
        // | | Ʌ||
        // | Ʌ||||
        // Ʌ||||||

        // source row
        const numS = subdiv * coS;
        for(let j = 0; j < numS; ++j){
          rows[0].push(sdSrcCrs[
            (coSrcs[0] * subdiv + j) % sdSrcCrs.length
          ]);
        }
        // target row
        const numT = subdiv * coT;
        for(let j = 0; j < numT; ++j){
          rows[numNR + 1].push(sdTrgCrs[
            (coTrgs[0] * subdiv + j + dj) % sdTrgCrs.length
          ]);
        }
        // rows in between using quad hull
        const { dpath: lpath } = this.stitchPath(
          rows[0][0], rows[numNR + 1][0]
        );
        const { dpath: rpath } = this.stitchPath(
          rows[0][numS - 1], rows[numNR + 1][numT - 1]
        );
        const lp0 = this.lposOf(rows[0][0]);
        const leftPs = Array.from(splitDPath(lpath, numNR, lp0));
        const rp0 = this.lposOf(rows[0][numS - 1]);
        const rightPs = Array.from(splitDPath(rpath, numNR, rp0));
        const dn = coT - coS;
        assert(dn !== 0, 'Irregular case is actually regular?');
        for(let r = 1; r <= numNR; ++r){
          // horizontal pseudo-isoline path
          const lp = leftPs[r-1];
          const rp = rightPs[r-1];
          const { dpath } = distSampler.sketchQueryBetween(
            lp.layer, lp, rp.layer, rp, { refine: true }
          );
          // left boundary
          rows[r].push(lp);
          // intermediate steps
          const numSteps = numS + dn * r - 2;
          for(const p of splitDPath(dpath, numSteps, lp)){
            rows[r].push(p);
          }
          // right boundary
          rows[r].push(rp);

          // should be within 1 of previous path
          assert(rows[r].length === rows[r-1].length + dn,
            'Row cardinality does not match expected value');
        } // endfor 1 <= r <= numNR
      } break;

      default:
        assert.error('Invalid linking', coS, coT);
    }
  }

  // create courses for each row and allocate short-row information
  const dt = (trgPath.isoline.time - srcPath.isoline.time) / (numNR + 1);
  const sdSR = Array.from({ length: numNR + 1 }, () => []);
  const srcRows = [ sdSrcCrs ];
  for(let r = 1; r <= numNR; ++r){
    const t = srcPath.isoline.time + dt * r;
    this.sampler.startCourse(t, region);
    let lastStitch;
    const crs = [];
    for(const blk of blocks){
      const row = blk[r];
      for(let c = 0; c < row.length; ++c){
        const lp = row[c];
        const stitch = this.sampler.createStitch(lp.layer.index, lp);
        row[c] = stitch; // replace position with stitch
        crs.push(stitch);
        if(lastStitch)
          lastStitch.setNextCourse(stitch);
        lastStitch = stitch;
      }
    }
    // if circular, connect two sides
    if(circ){
      const firstStitch = blocks[0][r][0];
      lastStitch.setNextCourse(firstStitch);
    }
    const numSDC = this.sdCourses.length;
    this.sdCourses.push(crs);
    srcRows.push(crs);

    // build subdivision course pairs
    const SR = sdSR[r-1];
    if(r > 1)
      this.sdCrsPairs.push([numSDC - 1, numSDC, SR]); // inter-inter
    else
      this.sdCrsPairs.push([idx0, numSDC, SR]); // src-inter
  }
  this.sdCrsPairs.push([
    this.sdCourses.length - 1, idx1, sdSR[sdSR.length - 1]
  ]); // inter-trg

  // create wale connectivity per block
  for(const blk of blocks){
    const S = blk[0].length;
    const T = blk[blk.length - 1].length;
    for(let r = 0; r <= numNR; ++r){
      const src = blk[r]; // source or intermediate
      const trg = blk[r+1]; // intermediate or target
      // three cases
      if(S === T){
        // 1-1 case
        assert(src.length === trg.length,
          '1-1 case is irregular');
        for(let j = 0; j < S; ++j)
          src[j].setNextWale(trg[j]);

      } else {
        // 1-2 or 2-1 cases
        let crs0, crs1;
        let link;
        if(S < T){
          // 1-2 case
          assert(src.length === trg.length - 1,
            '1-2 case is not increasing by one');
          crs0 = src;
          crs1 = trg;
          link = (s0, s1) => s0.setNextWale(s1);

        } else {
          // 2-1 case
          assert(src.length - 1 === trg.length,
            '2-1 case is not decreasing by one');
          crs0 = trg;
          crs1 = src;
          link = (s0, s1) => s0.setPrevWale(s1);
        }
        assert(crs0.length < crs1.length,
          'Regularized case is not as expected');
        // select irregularity (location of 2-1 or 1-2)
        // as modeled by the location where the wale
        // connectivity shifts by one to the left
        const seamMinDist = crs0.map(s => {
          const seamDist = this.stitchMinSeamDist(s, false); // no cache
          return Math.min(this.seamCrsSupport, seamDist);
        });
        let dj0 = -1;
        for(let j = 0; j < crs0.length; ++j){
          if(seamMinDist[j] >= this.seamCrsSupport)
            continue;
          if(dj0 === -1)
            dj0 = j; // first case below threshold
          else if(seamMinDist[j] < seamMinDist[dj0])
            dj0 = j; // better case below threshold
        }
        // if no best case found, use user selection
        let dj1 = dj0 + 1; // the one after does the merge
        if(dj1 === 0){
          // no useful seam information
          // => use the user-defined selection algorithm
          switch(this.subdivSeam){
            // constant cases
            case 'rcol':  dj1 = crs1.length - 1; break;
            case 'lcol':  dj1 = 1; break;
            // evolving cases
            case 'rdiag':
              if(S < T)
                dj1 = 1 + r * 2; // increasing case
              else
                dj1 = 1 + r; // decreasing case
              break;
            case 'ldiag':
              if(S < T)
                dj1 = crs1.length - 1 - r * 2; // increasing case
              else
                dj1 = crs1.length - 1 - r; // decreasing case
              break;
            // random case
            case 'rand':  dj1 = 1 + rand.getInt(crs1.length - 2); break;
            default:
              assert.error('Unsupported subdivision mode',
                this.subdivSeam);
              break;
          }
        }

        // wale connectivity
        assert(1 <= dj1 && dj1 <= crs0.length,
          'Discontinuity location is not valid');
        for(let j1 = 0; j1 < crs1.length; ++j1){
          const j0 = j1 >= dj1 ? j1 - 1 : j1;
          link(crs0[j0], crs1[j1]); // wale linking
        }
      } // endif S === T else ...
    } // endfor 0 <= r <= numNR
  } // endfor blk of blocks

  // distribute base short-row densities to subdivision
  // /!\ should keep original pairSR safe!
  assert(srcRows.length === sdSR.length,
    'Cardinality does not match');
  if(this.subdivSR === 'first'
  || this.subdivSR === 'last'){
    const baseSR = pairSR.map(sr => sr * this.subdiv);
    const r = this.subdivSR === 'first' ? 0 : sdSR.length - 1;
    const crs = srcRows[r];
    const sampleSR = c => {
      const ratio = c / (crs.length - 1);
      const c0 = Math.floor(ratio * (baseSR.length - 1));
      let avg = 0; // measure local average to smooth things
      for(let dc = 0; dc < this.subdiv; ++dc)
        avg += baseSR[(c0 + dc) % baseSR.length] / this.subdiv;
      return Math.round(avg);
    };
    for(let c = 0; c < crs.length; ++c)
      sdSR[r][c] = sampleSR(c);

  } else {
    const baseSR = pairSR.slice();
    assert(this.subdivSR === 'even',
      'Unsupported subdivision short-row mode', this.subdivSR);
    for(let r = 0; r < sdSR.length; ++r){
      const crs = srcRows[r];
      const sampleSR = c => {
        const ratio = c / (crs.length - 1);
        const c0 = Math.floor(ratio * (baseSR.length - 1));
        return baseSR[c0];
      };
      for(let c = 0; c < crs.length; ++c)
        sdSR[r][c] = sampleSR(c);
    } // endfor 0 <= r < #sdSR = #srcRows
  }

  // measure time
  const done = ++this.sdPairIdx >= this.crsPairs.length;
  if(done)
    this.timer.measure('subdiv');
  return done;
};

SamplingAlgorithm.prototype.split = function(){
  if(this.srPairIdx >= this.sdCrsPairs.length)
    return true;

  // get distance sampler
  const distSampler = this.mesh.getDistanceSampler();

  // get short-row information
  const [idx0, idx1, srcSR] = this.sdCrsPairs[this.srPairIdx];
  const srcCrs  = this.sdCourses[idx0];
  const srcTime = this.sampler.getCourseEntry(idx0).time;
  const trgCrs  = this.sdCourses[idx1];
  const trgTime = this.sampler.getCourseEntry(idx1).time;
  const circ = srcCrs[0].isCourseConnectedTo(srcCrs[srcCrs.length - 1]);
  assert(circ === trgCrs[0].isCourseConnectedTo(trgCrs[trgCrs.length - 1]),
    'Source and target courses of different circularity');

  // get region information and check coherency
  const region = srcCrs[0].getRegionID();
  assert(trgCrs[0].getRegionID() === region,
    'Region before and after are not coherent for course pair');

  // go over wales and create split locations for short-rows
  const sr = new Array(srcCrs.length); // grid storage
  let maxRows = 0;
  for(let i = 0; i < srcCrs.length; ++i){
    const stack = sr[i] = [];
    const stitch = srcCrs[i];
    const nwss = stitch.getNextWales();
    if(!nwss.length)
      continue;

    // get number of short-rows at that location
    const numRows = srcSR[i] || 0;
    if(!numRows)
      continue;
    maxRows = Math.max(maxRows, numRows);
    
    // get source location
    const ls = this.layerOf(stitch);
    const ps = stitch.getPosition();
    
    // get target location
    let dpath, totalLen;
    if(nwss.length === 1){
      ({ dpath, dist: totalLen } = this.stitchPath(stitch, nwss[0]));

    } else {
      assert(nwss.length === 2, 'Invalid number of next wales');
      const nextAlpha0 = nwss[0].getAlpha();
      const nextAlpha1 = nwss[1].getAlpha();
      let lt, pt;
      if(idx1 < this.crsPaths.length){
        const trgPath = this.crsPaths[idx1];
        const trgAlpha = getMidAlpha(nextAlpha0, nextAlpha1);
        [lt, pt] = trgPath.sample(trgAlpha);

      } else {
        // no course path available
        // => trace geodesic and use midpoint
        const lpos = this.lposOf(nwss[0]);
        const rpos = this.lposOf(nwss[1]);
        const { dpath: cpath } = distSampler.sketchQueryBetween(
          lpos.layer, lpos, rpos.layer, rpos
        );
        // get midpoint
        const midPos = Array.from(splitDPath(cpath, 1, lpos))[0] || lpos;
        lt = midPos.layer;
        pt = midPos;
      }
      ({ dpath, dist: totalLen } = distSampler.sketchQueryBetween(
        ls, ps, lt, pt
      ));
    }

    // get geodesic path between both sides and sample short-row locations
    const startPos = { layer: ls, x: ps.x, y: ps.y };
    for(const p of splitDPath(dpath, numRows, startPos))
      stack.push(p);
  }

  // create course connections between short-row stitches
  if(maxRows > 0){
    // create dense grid representation
    const grid = sr.map(stack => {
      // shortcut if already dense
      if(stack.length === maxRows)
        return stack; // already dense
      // partially dense => add necessary padding
      switch(this.srAlignment){
        // bottom => extend stack to maxRows
        case SR_BOTTOM:
          stack = stack.slice(); // create copy to not modify initial sr
          stack.length = maxRows;
          return stack;

        // top => introduce missing rows before
        case SR_TOP:
          return Array.from({
            length: maxRows - stack.length
          }).concat(stack);

        // middle => add padding before and after
        case SR_MIDDLE: {
          const rem = maxRows - stack.length;
          const pre = Math.floor(rem / 2);
          // prepend
          stack = Array.from({ length: pre }).concat(stack);
          // extend
          stack.length = maxRows;
          return stack;
        }

        default:
          assert.error(
            'Unsupported short-row alignment', this.srAlignment);
      }
    });

    // create short-rows, row-by-row
    const dt = (trgTime - srcTime) / (maxRows + 1);
    for(let row = 0, t = srcTime; row < maxRows; ++row, t += dt){
      // compute CCW continuous blocks
      const blocks = [[]];
      for(let col = 0; col < grid.length; ++col){
        const lastBlock = blocks[blocks.length - 1];
        if(grid[col][row])
          lastBlock.push(col);
        else if(lastBlock.length)
          blocks.push([]); // end last block, creating a new one
        // else, there's already a trailing empty block
      }
      assert(blocks[0].length, 'Empty first block');

      // for circular cases, potentially merge endpoint blocks
      if(circ && blocks.length > 1){
        // check if last block is non-empty
        // and the first column was non-empty too
        if(blocks[blocks.length - 1].length
        && grid[0][row]){
          const lastBlk = blocks.pop();
          blocks[0] = lastBlk.concat(blocks[0]);
        }
      }
      
      // remove last block if empty
      if(!blocks[blocks.length - 1].length)
        blocks.pop();

      // create short-rows and their course connections
      for(const blk of blocks){
        assert(blk.length, 'Empty short-row block');
        this.sampler.startShortRow(t, region);
        let prev;
        for(const col of blk){
          const p = grid[col][row];
          const curr = this.sampler.createStitch(p.layer.index, p, {
            shortRow: true
          });
          grid[col][row] = curr; // store the new stitch

          // create CCW course connection
          if(prev)
            prev.setNextCourse(curr);
          prev = curr;
        } // endfor col of blk
      } // endfor blk of blocks
    } // endfor 0 <= row < maxRows

    // create wale connections
    for(let col = 0; col < sr.length; ++col){
      const stack = sr[col];
      if(!stack.length)
        continue; // no short-row stitch here
      const src = srcCrs[col];
      const targets = src.getNextWales(); // in CCW order!
      src.clearNextWales();
      let last = src;
      const gridCol = grid[col];
      for(let r = 0; r < maxRows; ++r){
        const s = gridCol[r];
        if(!s)
          continue;
        // else we connect to the past
        s.setPrevWale(last);
        last = s; // remember for next one
      } // endfor 0 <= r < maxRows

      // connect the last stitch to the target(s) of the initial source
      for(const trg of targets)
        last.setNextWale(trg); // in CCW order
    } // endfor 0 <= col < #sr
  } // endif maxRows > 0

  // move to next pair, until none remaining
  const done = ++this.srPairIdx >= this.sdCrsPairs.length;
  if(done)
    this.timer.measure('split');
  return done;
};

SamplingAlgorithm.prototype.finish = function(){
  // apply sketch layers to sampler (intarsia)
  SketchLayer.applyTo(this.sampler, []);

  // debug timing and distribution
  if(this.verbose){
     // get distance sampler
    const distSampler = this.mesh.getDistanceSampler();
    // distribution of wales and irregularities
    let numIrr = 0;
    let numRegWales = 0;
    let numIrrWales = 0;
    let numInc = 0;
    let numDec = 0;
    let distSum = 0, distNum = 0;
    let penSum = 0, penNum = 0;
    const numStitches = this.sampler.length;
    for(let i = 0; i < numStitches; ++i){
      const s = this.sampler.getStitch(i);
      const nwc = s.countNextWales();
      const pwc = s.countPrevWales();
      if(nwc > 1 || pwc > 1)
        ++numIrr;
      if(nwc > 1)
        ++numInc;
      if(pwc > 1)
        ++numDec;
      for(const nws of s.getNextWales()){
        const { dist } = distSampler.sketchQueryBetween(
          this.mesh.layers[s.getLayerIndex()], s.getPosition(),
          this.mesh.layers[nws.getLayerIndex()], nws.getPosition()
        );
        distSum += dist;
        ++distNum;
        if(nwc > 1)
          ++numIrrWales;
        else
          ++numRegWales;
      }
    }
    const regDist = this.waleDist;
    const irrDist = Math.sqrt(
      this.waleDist * this.waleDist + this.courseDist * this.courseDist
    );
    const expWaleDist = (
      numRegWales * regDist + numIrrWales * irrDist
    ) / (numRegWales + numIrrWales);
    // penalty distribution
    for(const penalty of this.penaltyCache.values()){
      penSum += penalty;
      ++penNum;
    }
    console.log(
      '#stitches=' + numStitches
    + ', #irr=' + numIrr + ', #inc=' + numInc + ', #dec=' + numDec
    + '\navg[wale dist]=' + (distSum / distNum).toFixed(3)
    + ' (D_wale=' + this.waleDist.toFixed(3)
    + ', E[wale dist]=' + expWaleDist.toFixed(3)
    + ')\navg[penalty]=' + (penSum / penNum).toFixed(3)
    + '\nsubdiv=' + this.subdiv
    );
    this.timer.debug('Sampling');
  }
  return true;
};

module.exports = Object.assign(SamplingAlgorithm, {
  // WASM loading
  resolve: () => Promise.all([
    SNBranchBound.resolve(),
    LocalSolver.resolve()
  ])
});
