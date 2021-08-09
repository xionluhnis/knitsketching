// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const rand = require('../../random.js');
const Timer = require('../../timer.js');
const LinkSampleGroup = require('./linkgroup.js');

// constants
const FLOW = 'flow';
const TIME = 'time';
const SOURCE_DTIME = -1;
const TARGET_DTIME = 1;
const BIDIR_DTIME  = 2;

function TimeSolverAlgorithm(mesh, params = {}){
  this.mesh = mesh;
  // parameters
  this.verbose = !!params.verbose;
  this.flowAccuracy = params.flowAccuracy || 0.001;
  this.timeAccuracy = params.timeAccuracy || 0.005;
  this.timeStretchRange = params.timeStretchRange || 0;
  this.timeMoment   = params.timeMoment || 0;
  this.maxTimeIter  = params.maxTimeIter || Infinity;
  this.nhPower      = params.nhPower || 0;
  this.nhThreshold  = params.nhThreshold || Infinity;
  this.dtimeEquation = params.dtimeEquation || BIDIR_DTIME;
  this.isoMergeDist = params.isoMergeDist || 0.1;
  this.invertTime   = !!params.invertTime;
  // additional parameters
  this.params = params || {};

  // state
  this.linkGroups   = new Set(); // Set<LinkSampleGroup>
  this.linkIndex    = new Map(); // Map<BorderSample, LinkSampleGroup>
  this.timeGroups   = new Set(); // Set<TimeSampleGroup>
  this.sampleGroups = new Map(); // Map<GridSample, TimeGroupMap>
  this.timings = [{ start: Date.now(), iter: 0, stage: FLOW }]; // = [ { start, iter, stage, duration, end } ]
  this.timer = Timer.create();
  this.delta = 0; // local progress information

  // set seed for reproducibility
  rand.seed('apple');
}

TimeSolverAlgorithm.prototype.getDistanceWeight = function(d){
  switch(this.nhPower){
    case 0: return 1;
    case 1: return d;
    case 2: return d * d;
    default:
      return Math.pow(d, this.nhPower);
  }
};

TimeSolverAlgorithm.prototype.createLinkGroups = function(){
  // clear past groups
  this.linkGroups.clear();

  // create new groups
  this.linkIndex = new Map();
  for(const layer of this.layers()){
    for(const sample of layer.borderSamples){
      if(!sample.hasLinks()
      || this.linkIndex.has(sample))
        continue; // no associated link group, or already defined
      // else not part of any group yet

      // create link group from that sample
      const group = LinkSampleGroup.from(sample);
      if(group){
        // add group
        this.linkGroups.add(group);
        // link samples of that group to it
        for(const sample of group.samples){
          assert(!this.linkIndex.has(sample),
            'Overwriting link group mapping');
          this.linkIndex.set(sample, group);
        }
      } // endif group
    } // endfor sample of borderSamples
  } // endfor layer
};

/**
 * Get flow from averaging a neighborhood
 *
 * @param layer MeshLayer
 * @param y y-index
 * @param x x-index
 * @return { x, y }
 */
TimeSolverAlgorithm.prototype.getNHFlow = function (sample){

  // accumulate contribution from direct neighbors
  let u = 0;
  let v = 0;
  for(const nsample of sample.directNeighbors()){
    // compute distance to modulate weight
    const d = geom.distBetween(sample, nsample);
    assert(d > 0, 'Invalid sample distance', d);
    // skip neighbors that are too far
    if(d >= this.nhThreshold)
      continue;

    // get seam weight
    const seamWeight = nsample.getSeamWeight();
    // skip neighbors with full seam weight
    if(seamWeight >= 1)
      continue;

    // base neighbor weighting
    const w = 1 / this.getDistanceWeight(d);
    // get neighboring flow in this sample's rotation frame
    const n_uv = nsample.flow();

    // if non-zero seam weight, then multiplicative blocking effect
    if(seamWeight > 0){
      // weighted contribution
      const alpha = Math.max(0, 1 - seamWeight);
      u += n_uv.x * alpha * w;
      v += n_uv.y * alpha * w;
    } else {
      u += n_uv.x * w;
      v += n_uv.y * w;
    }
  }
  return { x: u, y: v };
};

TimeSolverAlgorithm.prototype.flowIteration = function(/*, iter */){

  // go over link groups and project solutions
  // note: we do that first, so it's not the last thing we do
  // before we move the next stage (we want a smooth solution!)
  for(const lg of this.linkGroups){
    lg.projectFlow();
  }

  // compute neighborhood and constraint-based flow
  let minDP = 1;
  for(const layer of this.layers()){
    // update flow at each sample
    for(const sample of layer.samples()){
      // store old flow (for convergence info)
      const oldUV = sample.flow();

      // get accummulation of neighboring flows
      // /!\ this vector is NOT a unit vector!
      // note: we may not need it => computed lazily
      const nhUV = geom.lazy(() => this.getNHFlow(sample));

      // accummulate constraint information
      const cUV = { x: 0, y: 0 };
      let cw = 0;
      for(const cdata of sample.constraints){
        if(!cdata.dir)
          continue;
        if(cdata.project){
          geom.pax(cUV, cdata.weight,
            geom.signProject(nhUV(), cdata.dir, 1)
          );
        } else {
          geom.pax(cUV, cdata.weight, cdata.dir);
        }
        cw += cdata.weight;
      }

      // aggregate flows to get new flow sum
      let newUV;
      if(cw >= 1){
        // only constraint flow
        newUV = cUV;

      } else if(cw > 0){
        // mix of constraint + neighborhood flows
        newUV = geom.axpby(1 - cw, nhUV(), cw, cUV);

      } else {
        // only neighborhood flow
        newUV = nhUV();
      }
      assert(!isNaN(newUV.x) && !isNaN(newUV.y), 'Invalid flow');

      // get total flow length
      const len = Math.max(1e-6, geom.length(newUV));
      newUV = geom.scale(newUV, 1/len);
      sample.setFlow(newUV);

      // if sample has a border sample, with a link with transmission
      // then do NOT consider its change as important for convergence
      if(sample.isBorder()
      && this.linkIndex.has(sample))
        continue;

      // measure change (for convergence)
      // /!\ special treatment with zero-flow variants
      if(oldUV.x == 0 && oldUV.y == 0
      && newUV.x == 0 && newUV.y == 0)
        continue; // do not record empty flow non-update (for convergence)
      const dot = oldUV.x * newUV.x + oldUV.y * newUV.y;
      minDP = Math.min(dot, minDP);
    }
  }
  
  return minDP;
};

TimeSolverAlgorithm.prototype.getDeltaTime = function(
  d, uv_0, uv_n, k_0 = 1, k_n = 1){
  // unweighted delta time (assuming d is unitary)
  switch(this.dtimeEquation){
    case SOURCE_DTIME:
      return -geom.dot(uv_0, d);
    case TARGET_DTIME:
      return -geom.dot(uv_n, d);
    case BIDIR_DTIME:
      return -0.5 * (k_0 * geom.dot(uv_0, d) + k_n * geom.dot(uv_n, d));
    default:
      assert.error('Unsupported delta-time equation', this.dtimeEquation);
      return 0;
  }
};

TimeSolverAlgorithm.prototype.needsTimeRef = function(){
  return !this.mesh.hasTimeConstraint() // no isoline constraint
      || this.mesh.currentLevel === 0;  // starting level
};

TimeSolverAlgorithm.prototype.getFastNHTime = function(sample){
  const dt = sample.getDt();
  let sumT = 0;
  let n = 0;
  for(const [nsample] of sample.neighbors()){
    sumT += nsample.time();
    n += 1;
  }
  if(n)
    return sumT / n + dt;
  else
    return sample.isTimeRef() ? 0 : sample.time();
};

TimeSolverAlgorithm.prototype.getNHTime = function(sample){
  // check whether this is the single fixed reference
  if(sample.isTimeRef() && this.needsTimeRef()){
    return 0; // t=0 for base reference
  }

  // two scenarios:
  //
  // 1) all neighbors are available
  // => we use the average neighbor time + a constant dt value
  //
  // 2) some neighbors are not available yet
  // => we use the information from available neighbors only
  //
  if(sample.hasDt()){
    // case (1)
    return this.getFastNHTime(sample);
  }
  // else case (2)

  // we use the neighborhood time
  // together with the flow to learn the time
  const t0 = sample.time();
  let sumT  = 0;
  let sumDt = 0;
  let n = 0;
  let full = true;
  for(const baseSample of sample.family()){
    // do we have flow yet?
    const uv = baseSample.flow();
    if(!uv.x && !uv.y){
      if(baseSample.isTimeRef())
        return 0.0;
      // else we cannot compute time from that base sample
      full = false;
      continue;
    }
    const k = baseSample.kappa();
    // go over direct neighbors
    for(const nsample of baseSample.directNeighbors()){
      // get neighbor's time
      const n_t = nsample.time();
      if(isNaN(n_t)){
        full = false;
        continue; // no valid time (or flow) there yet
      }

      // get direct neighbor's curvature and flow
      const n_k = nsample.kappa();
      const n_uv = nsample.flow();

      // compute displacement to direct neighbor
      const dir = baseSample.deltaTo(nsample);

      // delta time
      const dt = this.getDeltaTime(dir, uv, n_uv, k, n_k);
      assert(!Number.isNaN(dt), 'Invalid delta time');
      sumDt += dt;

      // average neighbor time
      sumT += n_t;
      n += 1;
    }
  }

  // check special cases
  if(!isNaN(t0)){
    // if no valid neighbor, just return self
    if(!n)
      return t0;
    // else, we should not become NaN
    assert(!isNaN(sumT) && !isNaN(sumDt),
      'Neighborhood collapse', t0, sumT, sumDt);
  }

  // if full, then store constant dt
  if(full){
    const dt = sumDt / (n || 1);
    sample.setDt(dt);
  }

  // return average expected time at sample
  return (sumT + sumDt) / n;
};

TimeSolverAlgorithm.prototype.getMoment = function(iter){
  if(this.mesh.currentLevel > 0){ // }=== this.mesh.levels.length - 1){
    return this.timeMoment * iter / (iter + 1);
  } else {
    return 0;
  }
};

class TimeSampleGroup {
  constructor(){
    this.parent = this;
    this.samples = new Map();
    this.avgTime = NaN;
  }
  setSampleDt(sample, dt){ this.samples.set(sample, dt); }
  addSample(sample){ this.setSampleDt(sample, 0); }
  mergeGroup(tsg){
    for(const sample of tsg.samples.keys())
      this.addSample(sample);
  }
  root(){
    // union find incremental parenting
    if(this.parent !== this)
      this.parent = this.parent.root();
    return this.parent;
  }
  linkGroup(that){
    const thisRoot = this.root();
    const thatRoot = that.root();
    // if the tree have different roots
    // merge them by replacing the root of one by that of the other
    if(thisRoot !== thatRoot){
      thatRoot.parent = thisRoot;
      // merge the samples too
      thisRoot.mergeGroup(thatRoot);
    }
  }

  computeTime(){
    let sum = 0;
    let n = 0;
    for(const [sample, dt] of this.samples){
      const t = sample.time();
      if(isNaN(t))
        continue; // skip invalid samples
      sum += sample.time() + dt;
      ++n;
    }
    // only update if one sample is valid
    if(n > 0)
      this.avgTime = sum / n;
  }

  hasTime(){
    return !Number.isNaN(this.avgTime);
  }
}
class TimeGroupMap {
  constructor(){
    // last time for convergence
    this.lastTime = NaN;
    // group assignments
    this.groups   = []; // TimeSampleGroup[]
    this.dtimes   = []; // number[]
    this.weights  = []; // number[] 
  }

  addGroup(timeGroup, dt, weight){
    this.groups.push(timeGroup);
    this.dtimes.push(dt);
    this.weights.push(weight);
  }

  isEmpty(){ return this.groups.length === 0; }
  get length(){ return this.groups.length; }
}

TimeSolverAlgorithm.prototype.createTimeGroups = function(){
  // reset data
  this.timeGroups.clear();    // Set<TimeSampleGroup>
  this.sampleGroups.clear();  // GridSample => TimeGroupMap

  // create temporary map to allow easy merging
  const timeGroupMap = new Map(); // Constraint => TimeSampleGroup

  // create mapping from constraint to samples
  for(const layer of this.layers()){
    const sketch = layer.sketch;
    for(const sample of layer.samples()){
      const linkConstraints = [];
      let hasGroup = false;
      for(const cdata of sample.constraints){
        if(!cdata.isTimeIsoline())
          continue; // skip any non-time constraint
        hasGroup = true;

        // compute delta time given flow
        cdata.updateDt(sample);

        // get associated constraint and register sample
        const constr = sketch.constraints[cdata.index];
        assert(constr, 'Missing constraints');
        let timeGroup;
        if(timeGroupMap.has(constr)){
          timeGroup = timeGroupMap.get(constr);
        } else {
          timeGroupMap.set(constr, timeGroup = new TimeSampleGroup());
        }
        timeGroup.addSample(sample);

        // if close enough, then register in link set
        if(cdata.layerDist < this.isoMergeDist)
          linkConstraints.push(constr);
      } // endfor cdata

      // merge time constraints across links
      if(sample.multiplicity > 1){
        for(const lsample of sample.linkSamples){
          if(!this.sampleGroups.has(lsample))
            continue; // not ready to link yet
          // ready to merge constraints
          for(const cdata of lsample.constraints){
            // skip non-time constraints
            // as well as constraints that are too far (not mergeable)
            if(!cdata.isTimeIsoline()
            || cdata.layer >= this.isoMergeDist)
              continue;
            // merge associated constraints
            const constr = lsample.sketch.constraints[cdata.index];
            linkConstraints.push(constr);
          } // endfor cdata of lsample.constraints
        } // endfor lsample of linkSamples
      } // endif multiplicit > 1

      // if has group, init reverse mapping
      if(hasGroup){
        this.sampleGroups.set(sample, new TimeGroupMap());
      }

      // merge all unmerged time groups
      if(linkConstraints.length > 1){
        const tg0 = timeGroupMap.get(linkConstraints[0]);
        assert(tg0, 'Missing time group');
        for(let i = 1; i < linkConstraints.length; ++i){
          const tg = timeGroupMap.get(linkConstraints[i]);
          if(tg !== tg0){
            // union-find type merging
            tg0.linkGroup(tg);
          }
        }
      } // endif #linkConstraints
    } // endfor sample
  } // endfor layer

  // compute set of time groups
  for(const tsg of timeGroupMap.values())
    this.timeGroups.add(tsg.root()); // only root groups
  if(this.verbose){
    console.log('Created ' + this.timeGroups.size + ' time groups');
  }

  // precompute per-sample groups
  for(const [sample, map] of this.sampleGroups.entries()){
    // find associated time groups from constraint data
    const groups = new Set();
    for(const cdata of sample.constraints){
      const sketch = sample.layer.sketch;
      const constr = sketch.constraints[cdata.index];
      // check whether constraint links to a time group
      const otsg = timeGroupMap.get(constr);
      if(otsg){
        const tsg = otsg.root();
        // add entry to reverse map
        map.addGroup(tsg, cdata.dt, constr.weight);
        groups.add(tsg);
      }
    }
    // should not have empty map
    assert(!map.isEmpty(), 'Did not find a matching constraint data entry');

    // associate average sample dt contribution with each group
    for(const tsg of groups){
      const avgDt = geom.mean(map.dtimes.map((dt, i) => {
        return dt * map.weights[i]; // weighted average
      }).filter((_, i) => {
        return map.groups[i] === tsg; // of those matching the group
      }));
      tsg.setSampleDt(sample, avgDt);
    } // endfor tsg of groups
  } // endfor [sample, map]
};

TimeSolverAlgorithm.prototype.timeVertices = function*(iter){
  // regular out-of-order vertices (= filtered samples)
  for(const layer of this.layers())
      yield *layer.vertices(iter < 8 ? iter : 0);
  // other schemes:
  // - borders first, then inner samples
  //  for(const layer of this.layers())
  //    yield *layer.borderVertices(iter % 2);
  //  for(const layer of this.layers())
  //    yield *layer.innerSamples(iter);
  // - inner samples first, then borders
  // /!\ regular non-ordered seem to converge faster
};

TimeSolverAlgorithm.prototype.constrainedTimeIteration = function(iter){
  let minT = 0, maxT = 0;
  let maxDT = 0;
  const meanT = geom.runningMean();
  const mt = this.getMoment(iter);
  for(const sample of this.timeVertices(iter)){
    // time update
    const oldT = sample.time();
    const nhT = this.getNHTime(sample);
    let newT;
    if(!mt || isNaN(oldT)){
      newT = nhT;
      sample.setTime(newT, true);
    } else {
      // moment update
      newT = nhT + mt * (nhT - oldT);
      sample.setTime(newT, true);
    }
    if(!isNaN(newT)){
      // check for isoline constraint
      if(this.sampleGroups.has(sample)){
        const map = this.sampleGroups.get(sample);
        map.lastTime = oldT;
        // /!\ do not update statistics yet since the time value
        // is only temporary for this location
      } else {
        // update the statistics since the time value is kept as-is
        meanT.push(newT);
        const dt = Math.abs(newT - oldT);
        maxDT = Math.max(maxDT, dt);
        minT = Math.min(newT, minT);
        maxT = Math.max(newT, maxT);
      }

    } else {
      maxDT = Infinity;
    } // endif NaN else
  } // endfor layer

  // update constrained time groups
  for(const tsg of this.timeGroups){
    tsg.computeTime();
  }

  // update constrained samples
  for(const [sample, map] of this.sampleGroups){
    let sumT = 0;
    let sumW = 0;
    for(let i = 0; i < map.groups.length; ++i){
      const tsg = map.groups[i];
      if(tsg.hasTime()){
        // get continuous time contribution
        const contT = tsg.avgTime - map.dtimes[i];
        const alpha = map.weights[i];
        sumT += contT * alpha;
        sumW += alpha;
      }
    }
    let mixT;
    if(!sumW) {
      continue; // no valid group yet

    } else if(sumW >= 1){
      // only use constraint time
      mixT = sumT / sumW;

    } else {
      // mix in neighborhood-based time
      const newT = sample.time();
      if(Number.isNaN(newT))
        mixT = sumT / sumW; // cannot use neighborhood time yet
      else
        mixT = sumT + (1 - sumW) * sample.time();
    }
    sample.setTime(mixT);

    // update running statistics for samples without linked samples
    if(sample.multiplicity === 1){
      meanT.push(mixT);
      maxDT = Math.max(maxDT, Math.abs(mixT - map.lastTime));
      minT = Math.min(mixT, minT);
      maxT = Math.max(mixT, maxT);
    }
  }

  // merge time at linked samples
  for(const [sample, map] of this.sampleGroups){
    if(sample.multiplicity === 1
    || !sample.isVertex())
      continue; // skip samples without links, and non-vertex samples
    // merge time from all links
    // but only do so at vertex sample
    let newT = sample.time();
    for(const lsample of sample.linkSamples)
      newT += lsample.time();
    newT /= sample.multiplicity;
    sample.setTime(newT, true);

    // update statistics
    meanT.push(newT);
    maxDT = Math.max(maxDT, Math.abs(newT - map.lastTime));
    minT = Math.min(newT, minT);
    maxT = Math.max(newT, maxT);
  }

  // record time range
  for(const layer of this.layers()){
    layer.minT = minT;
    layer.maxT = maxT;
  }

  return { minT, maxT, maxDT, meanT };
};

TimeSolverAlgorithm.prototype.timeIteration = function(iter){
  const { maxDT, meanT } = this.constrainedTimeIteration(iter);

  // update reference
  if(iter === 0){
    this.setTimeReference(meanT.value);
  }

  return maxDT;
};

TimeSolverAlgorithm.prototype.setTimeReference = function(meanT){
  const layers = this.layers();
  // compute mean if not available
  if(meanT === undefined || Number.isNaN(meanT)){
    const meanTime = geom.runningMean();
    let minT = Infinity, maxT = -Infinity;
    for(const layer of layers){
      for(const sample of layer.samples()){
        const t = sample.time();
        if(!isNaN(t)){
          meanTime.push(t);
          minT = Math.min(minT, t);
          maxT = Math.max(maxT, t);
        }
      }
    }
    if(meanTime.samples === 0)
      return; // cannot set a new reference yet
    meanT = meanTime.value;

    // min/max bounds
    for(const layer of layers){
      layer.minT = minT;
      layer.maxT = maxT;
    }
  }
  // re-distribute time to have an even sampling
  // = set mean time to be the reference
  //   + set its time to be 0 (while shifting the rest)
  let bestMeanDT = Infinity;
  let bestRef = null;
  for(const layer of layers){
    for(const vertex of layer.vertices()){
      const t = vertex.time();
      if(Number.isNaN(t))
        continue; // skip time value
      const meanDT = Math.abs(t - meanT);
      if(meanDT < bestMeanDT){
        bestMeanDT = meanDT;
        bestRef = vertex;
      }
    }
  }
  assert(bestRef, 'No best reference found');
  const refT = bestRef.time();
  for(const layer of layers){
    for(const sample of layer.vertices()){
      const t = sample.time();
      if(Number.isNaN(t))
        continue; // skip vertex
      // /!\ propagate to linked samples since we go only on vertices
      // this is so that we get the same value across a sample family
      sample.setTime(t - refT, true);
    }
  }
  //if(this.verbose)
  //  console.log('RefT ' + refT + ' @ (l=' + bestRef.layer.index + ', y=' + bestRef.y + ', x=' + bestRef.x);
  assert(!isNaN(refT), 'Invalid time reference');

  // update time range
  for(const layer of layers){
    layer.minT -= refT;
    layer.maxT -= refT;
    layer.tref = { x: -1, y: -1 };
  }
  bestRef.layer.tref = { x: bestRef.x, y: bestRef.y };
};

TimeSolverAlgorithm.prototype.upscaleMesh = function(){
  const mesh = this.mesh;
  const l0 = this.l0();
  const lmax = this.lmax();
  assert(l0 < lmax, 'Cannot upscale further');

  // update mesh level
  mesh.currentLevel = Math.min(l0 + 1, lmax);

  // transfer of flow + time using neighborhood interpolation
  for(let i = 0; i < mesh.levels[l0 + 1].length; ++i){
    const player = mesh.levels[l0+0][i];
    const nlayer = mesh.levels[l0+1][i];
    // ratio between dimensions = prev / next (typically 1/4)
    const sy = player.height / nlayer.height;
    const sx = player.width / nlayer.width;
    const r = geom.max([1, Math.ceil(sx), Math.ceil(sy)]);
    const factor = (1/sx + 1/sy) * 0.5;
    for(const nsample of nlayer.samples()){
      const q = geom.scale(nsample, sx, sy);
      const pnh = player.layerQuery(q, r, true);
      assert(pnh, 'No found neighborhood even after projection');
      // NN upscaling of flow
      const uv = pnh.flow();
      nsample.setFlow(uv);

      // upscaling time
      const t = pnh.time();
      if(!isNaN(t)){
        nsample.setTime(t * factor, true); //  * 2);
      } // endif not NaN
    } // endfor sample
  } // enfor i < levels[?].length

  // set new time reference
  this.setTimeReference(); // mesh.levels[l0 + 1]);
};

TimeSolverAlgorithm.prototype.progress = function(newDelta){
  if(newDelta !== undefined){
    assert(0 <= newDelta && newDelta <= 1, 'Invalid delta', newDelta);
    this.delta = newDelta;
  }
  const timings = this.timings;
  const levels = this.mesh.levels.length;
  if(timings.length == levels * 2 && timings[timings.length - 1].done)
    return 1.0;
  else
    return (timings.length - 1 + this.delta) / (2 * levels); // F+T for each
};

TimeSolverAlgorithm.prototype.message = function(){
  return 'Flow + time (level '
       + (this.l0() + 1) + '/'
       + (this.lmax() + 1) + ')';
};

TimeSolverAlgorithm.prototype.currStage = function(){
  return this.timings[this.timings.length - 1];
};

TimeSolverAlgorithm.prototype.nextStage = function(errName, errValue){
  // up to 2N entries: { start, stage, iter, duration, end }
  // given 2 stages: FLOW and TIME
  const N = this.mesh.levels.length;
  const currTime = this.currStage();
  const t = Date.now();
  currTime.end = t;
  currTime.duration = t - currTime.start;
  if(this.verbose){
    console.log('Mesh'
      + ' level=' + this.l0()
      + ', stage=' + currTime.stage
      + ', iter=' + currTime.iter
      + ', dt=' + currTime.duration
      + ', ' + errName
      + '=' + errValue.toString().slice(0, 6)
    );
  }
  // new iteration if there is a next stage
  if(this.timings.length < N * 2){
    this.timings.push({ start: t, iter: 0, stage: null });
  }
  return this.timings[this.timings.length - 1]; // /!\ stage must be resolved!
};

TimeSolverAlgorithm.prototype.layers = function(){
  return this.mesh.levels[this.mesh.currentLevel];
};
TimeSolverAlgorithm.prototype.l0 = function(){
  return this.mesh.currentLevel;
};
TimeSolverAlgorithm.prototype.lmax = function(){
  return this.mesh.levels.length - 1;
};
TimeSolverAlgorithm.prototype.threshDP = function(){
  const endDP = Math.max(0.95, Math.min(1, 1 - this.flowAccuracy));
  return geom.lerp(0.95, endDP, this.l0() / this.lmax());
};
TimeSolverAlgorithm.prototype.threshDT = function(){
  const endDT = Math.min(1e-2, Math.max(0, this.timeAccuracy));
  return geom.lerp(1e-2, endDT, this.l0() / this.lmax()); 
};
TimeSolverAlgorithm.prototype.isFlowReady = function(minDP){
  return minDP >= this.threshDP();
};
TimeSolverAlgorithm.prototype.isTimeReady = function(maxDT, currIter){
  // check iteration limit
  if(currIter >= this.maxTimeIter)
    return true;
  // check max delta threshold
  if(maxDT <= this.threshDT()){
    // possibly also check time stretch
    if(!this.timeStretchRange){
      return true; // no need to enforce time stretch
    }
    // else we need the stretch to be within [1/rng;rng]
    // but ONLY at non-border samples!
    for(const layer of this.layers()){
      for(const sample of layer.innerSamples()){
        const ts = sample.timeStretch();
        if(ts < this.timeStretchRange
        || ts * this.timeStretchRange > 1 // <=> ts > 1/this.timeStretchRange
        ){
          // out of range
          return false;
        }
      }
    }
    return true; // all samples within range
  }
  return false;
};

TimeSolverAlgorithm.prototype.iterate = function(){
  // check if we need to do anything
  const currStage = this.currStage();
  if('end' in currStage)
    return true;

  // actual iteration depending on stage
  const currIter = currStage.iter++;
  switch(currStage.stage){

    case FLOW: {
      if(currIter === 1)
        this.timer.restart();
      const minDP = this.flowIteration(currIter);
      if(this.isFlowReady(minDP)){
        // next stage
        this.nextStage('minDP', minDP).stage = TIME;
        // create time groups
        this.createTimeGroups();
      }
      return false;
    }

    case TIME: {
      const maxDT = this.timeIteration(currIter);
      if(this.isTimeReady(maxDT, currIter)){
        // unconstrained step
        // this.unconstrainedTimeIteration();
        // reset time reference of this level
        this.setTimeReference();
        // next stage
        const l0 = this.l0();
        if(l0 != this.lmax()){
          // next stage
          this.nextStage('maxDt', maxDT).stage = FLOW;
          // initialize next mesh flow by upscaling the last layer
          this.upscaleMesh();
          // create link groups
          this.createLinkGroups();

        } else {
          this.nextStage('maxDt', maxDT).done = true;

          // user time inversion
          if(this.invertTime){
            this.mesh.invertTime();
          }
          this.timer.measure('time_solve');

          // post-processing
          if(!this.verbose){
            this.mesh.checkFlowAndTime();
            this.mesh.segment(this.params);
          } else
            this.timer.debug('Time solve');
          // else it gets computed on the client side anyway

          return true; // <-- endpoint for algorithm
        }
      }
      return false;
    }

    default:
      assert.error('Invalid stage', currStage);
      break;
  }
  return false;
};

module.exports = TimeSolverAlgorithm;