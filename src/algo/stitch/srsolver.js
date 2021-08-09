// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const Timer = require('../../timer.js');
const sr_module = require('../../../libs/nlopt-wasm/sr_sampling.js');
let sr = sr_module({
  locateFile: function(path){
    return location.origin + '/libs/nlopt-wasm/' + path;
  }
}).then(m => sr = m);
const dtw = require('./dtw.js');

// constants
const SR_NONE     = 'none';
const SR_MAX      = 'max';
const SR_QIP      = 'qip';
const SS_NONE = 'none';
const SS_MIN  = 'min';
const SS_ALL  = 'all';

function loss(x){ return x * x; }
function wrapT(t){
  if(t < 0) return t + 1;
  else if(t > 1) return t - 1;
  else return t;
}

class SRSolver {
  constructor(srcPath, trgPath, {
    shortRowMode = SR_NONE, waleDist,
    waleAccWeight = 1.0,
    srSimpWeight  = 0.0,
    srSimpPower   = 2,
    ssAlignment   = SS_NONE,
    ssDepth       = 3,
    ssThreshold   = 0.5,
    debugWasm     = false,
    verbose       = false
  }){
    this.srcPath  = srcPath.makeCCW();
    this.trgPath  = trgPath.makeCCW();
    this.mode     = shortRowMode;
    this.waleDist = waleDist;
    this.waleWeight   = waleAccWeight;
    this.simpWeight   = srSimpWeight;
    this.simpPower    = srSimpPower;
    this.ssAlign      = shortRowMode !== SR_NONE ? ssAlignment : SS_NONE;
    this.ssDepth      = ssDepth;
    this.ssThreshold  = ssThreshold;
    this.debugWasm    = debugWasm;
    this.verbose      = verbose && debugWasm;

    // simplicity penalty
    switch(srSimpPower){
      case 0: this.simplicity = (n, p) => n !== p ? 1 : 0; break;
      case 1: this.simplicity = (n, p) => Math.abs(n - p); break;
      default: this.simplicity = (n, p) => loss(n - p); break;
    }

    // data
    this.sources  = []; // [[MeshLayer, {x,y}, t]]
    this.targets  = []; // [[MeshLayer, {x,y}, t]]
    this.mapping  = []; // trgIdx[srcIdx] = alignment data
    this.dist     = []; // number[srcIdx] = d(s_i;t_i)
    this.curv     = []; // number[srcIdx] = k_i
    this.expSR    = []; // number[srcIdx] = d(s_i;t_i)/(D_w*k_i)
    this.avgExpSR = NaN;
    this.sr       = []; // number[srcIdx] = short-row data
    this.error    = Infinity;
    this.circular = false;
    this.alignSamples();
  }

  alignSamples(){
    const t = Timer.create();
    // compute samples to be aligned
    const sampDist = Math.min(
      ...Array.from(this.srcPath.layers(), l => l.eta),
      ...Array.from(this.trgPath.layers(), l => l.eta)
    );
    if(this.srcPath.isSingular()
    || this.trgPath.isSingular())
      return; // singular case, no short-rows
    const N = Math.ceil(
      Math.max(
        this.srcPath.length(),
        this.trgPath.length()
       ) / sampDist // XXX do we need an extra /2?
    );
    if(!N)
      return; // nothing to do for singular cases
    const srcCirc = this.srcPath.isCircular();
    this.sources = Array.from({ length: N }, (_, i) => {
      return this.srcPath.sample(i / (srcCirc ? N : N-1));
    });
    const trgCirc = this.trgPath.isCircular();
    const Dtt = 1 / (trgCirc ? N : N-1);
    this.targets = Array.from({ length: N }, (_, i) => {
      return this.trgPath.sample(i * Dtt);
    });
    const circular = this.circular = srcCirc || trgCirc;

    // compute alignment
    const mesh = this.srcPath.isoline.mesh;
    const ds = mesh.getDistanceSampler();
    const cache = Array.from({ length: N }, () => new Array(N));
    const geodesicPenalty = (si, ti) => {
      let d = cache[si][ti];
      if(!d){
        const [ls, qs] = this.sources[si];
        const [lt, qt] = this.targets[ti];
        d = cache[si][ti] = ds.sketchQueryBetween(ls, qs, lt, qt).dist;
        assert(d !== undefined,
          'No distance between samples');
      }
      return d;
    };
    const index = Array.from({ length: N }, (_, i) => i);
    const { path, minCost /*, numStates */ } = dtw.align(
      index, index, geodesicPenalty, { circular, minimal: true }
    );
    t.measure('dtw');

    // store mapping
    this.mapping = new Array(N);
    for(const [si, ti] of path){
      // store mapping
      this.mapping[si] = ti;
    }

    // compute the data given the initial mapping
    this.getDataFromMapping(path, geodesicPenalty);

    // optimize sub-sample alignment by shifting the target stitches
    // while keeping the original DTW alignment
    // UNLESS we're not bound to have short-rows
    if(this.ssAlign !== SS_NONE
    && geom.above(this.avgExpSR, this.ssThreshold)){
      this.subSampleAlign(N, Dtt, ds, cache, minCost);
      t.measure('subsample');
      const before = this.avgExpSR;
      this.getDataFromMapping(path, geodesicPenalty);
      console.log('MESR from ' + before + ' to ' + this.avgExpSR);
    }

    if(this.verbose)
      console.log('Align timing:', t.toString());
  }

  getDataFromMapping(pairs, geodesicPenalty){
    const N = this.sources.length;
    // compute error data
    this.dist = new Array(N);
    this.curv = new Array(N);
    for(const [si, ti] of pairs){
      // get geodesic distance
      this.dist[si] = geodesicPenalty(si, ti);
      // get average curvature over both sides
      this.curv[si] = 0;
      for(const [l, q] of [this.sources[si], this.targets[ti]]){
        const nh = l.sketchQuery(q, 1, true);
        this.curv[si] += nh.kappa() * 0.5;
      }
    }
    // smooth the distance data by taking a centered average
    // and compute expected number of short-rows given wale term only
    const [i0, iN] = this.circular ? [0, N] : [1, N-1];
    let expSRSum = 0;
    for(let i = i0; i < iN; ++i){
      const di = this.dist[i];
      const dp = this.dist[(i + N - 1) % N];
      const dn = this.dist[(i + 1) % N];
      this.dist[i] = (di + dp + dn) / 3;

      // expected number of short-rows (from wale term only)
      this.expSR[i] = this.dist[i] / (this.curv[i] * this.waleDist) - 1;
      expSRSum += this.expSR[i];
    }
    if(!this.circular){
      for(const i of [0, N-1]){
        this.expSR[i] = this.dist[i] / (this.curv[i] * this.waleDist) - 1;
        expSRSum += this.expSR[i];
      }
    }
    this.avgExpSR = expSRSum / N;
  }

  subSampleAlign(N, Dtt, ds, cache, minCost){
    if(this.ssAlign === SS_NONE)
      return 0; // nothing to do
    
    // local data cache
    const dcache = this.mapping.map((_, si) => {
      const ti = this.mapping[si];
      return new Map([[0, {
        dist: cache[si][ti],
        pt: this.targets[ti]
      }]]);
    });
    const localData = (si, dt) => {
      if(!dcache[si].has(dt)){
        const [ls, qs] = this.sources[si];
        const ti = this.mapping[si];
        const tt = wrapT(ti * Dtt + dt);
        const [lt, qt] = this.trgPath.sample(tt);
        const { dist } = ds.sketchQueryBetween(ls, qs, lt, qt);
        dcache[si].set(dt, {
          dist, pt: [lt, qt]
        });
      }
      return dcache[si].get(dt);
    };

    // get appropraite shift error function 
    let shiftError;
    let initError;
    switch(this.ssAlign){

      // use error at minimum error sample only
      case SS_MIN: {
        const [si, e] = this.mapping.reduce(([minSI, minE], ti, si) => {
          const d = cache[si][ti];
          if(d < minE)
            return [si, d];
          else
            return [minSI, minE];
        }, [0, cache[0][this.mapping[0]]]);
        shiftError = dt => {
          return localData(si, dt).dist; // distance at single sample
        };
        initError = e;
      } break;

      // use error over all samples
      case SS_ALL:
        shiftError = dt => {
          let err = 0;
          for(let si = 0; si < N; ++si){
            err += localData(si, dt).dist;
          }
          return err;
        };
        initError = minCost;
        break;

      default:
        assert.error('Invalid sub-sample alignment', this.ssAlign);
        break;
    }

    // binary search
    let lt = -0.5 * Dtt, rt = 0.5 * Dtt;
    let le = shiftError(lt);
    let re = shiftError(rt);
    if(le < re){
      rt = 0;
      re = initError;
    } else {
      lt = 0;
      le = initError;
    }
    for(let l = 0; l < this.ssDepth; ++l){
      const mt = (lt + rt) * 0.5;
      const me = shiftError(mt);
      if(le <= re){
        rt = mt;
        re = me;
      } else {
        lt = mt;
        le = me;
      }
    }
    // use best shift found
    let dt, lastE;
    if(le <= re){
      dt = lt;
      lastE = le;
    } else {
      dt = rt;
      lastE = re;
    }
    if(this.verbose){
      const de = initError - lastE;
      console.log(
        'dt%=' + Math.abs(dt / Dtt * 100).toFixed(0)
      + ' | de%=' + (de / initError * 100 || 0).toFixed(0)
      );
    }
    if(!dt)
      return 0; // sub-alignment was already best

    // update targets and cached distances
    for(let si = 0; si < N; ++si){
      const ti = this.mapping[si];
      const { dist, pt } = localData(si, dt);
      this.targets[ti] = pt;
      cache[si][ti] = dist;
    }
    return dt;
  }

  getTimeIndex(t){
    assert(0 <= t && t <= 1,
      'Invalid time value', t);
    if(this.circular)
      return Math.round(t * this.sr.length) % this.sr.length;
    else
      return Math.round(t * (this.sr.length - 1));
  }

  getShortRows(t){
    // trivial case
    if(this.mode === SR_NONE
    || this.sr.length === 0)
      return 0;
    // general case
    const i = this.getTimeIndex(t);
    return this.sr[i] || 0;
  }

  getError(sr = this.sr, withTerms = false){
    let Ew = 0, Es = 0;
    Ew += loss(this.expSR[0] - sr[0]);
    if(this.circular)
      Es += this.simplicity(sr[0], sr[sr.length - 1]);
    for(let i = 1; i < this.dist.length; ++i){
      Ew += loss(this.expSR[i] - sr[i]);
      Es += this.simplicity(sr[i], sr[i-1]);
    }
    const E = this.waleWeight * Ew + this.simpWeight * Es;
    return withTerms ? [E, Ew, Es] : E;
  }

  getNaiveError(){
    const dt = Math.abs(
      this.srcPath.isoline.pixelTime - this.trgPath.isoline.pixelTime
    );
    return this.waleWeight * loss(dt - this.waleDist);
  }

  /**
   * Enforce that at least one sample gets no short-rows
   * 
   * XXX should we delay that decision to short-row instantiation?
   */
  enforceSRConstraint(sr = this.sr){
    let minDEr = Infinity;
    let minIdx = -1;
    const last = sr.length - 1;
    const simp = this.simplicity;
    for(let i = 0; i < sr.length; ++i){
      // check if entry satisfies the constraint
      if(sr[i] === 0)
        return; // constraint satisfied!

      // measure if it's the smallest error change location
      let dEr = 0;
      // dEw = change of wale error
      dEr += loss(this.expSR[i]) - loss(this.expSR[i] - sr[i]);
      // dEs = change of simplicity error
      // - previous term
      if(i > 0){
        // direct contribution with past value
        dEr += simp(0, sr[i-1]) - simp(sr[i], sr[i-1]);
      } else if(this.circular){
        // circular contribution with past-value
        dEr += simp(0, sr[last]) - simp(sr[i], sr[last]);
      }
      // - next term
      if(i < last){
        dEr += simp(0, sr[i+1]) - simp(sr[i], sr[i+1]);
      } else if(this.circular){
        dEr += simp(0, sr[0]) - simp(sr[i], sr[0]);
      }
      if(dEr < minDEr){
        minDEr = dEr;
        minIdx = i;
      }
    }
    // enforce constraint by reducing least damageful index
    if(minIdx !== -1){
      sr[minIdx] = 0;
    }
  }

  iterate(){
    // in singular case, don't do anything
    if(!this.expSR.length){
      this.error = 0; // XXX doesn't that create an incorrect bias?
      return true; // no short-row because singular
    }
    switch(this.mode){
      // no short-rows => directly done
      case SR_NONE:
        this.sr = this.expSR.map(() => 0);
        this.error = this.getError();
        return true;

      // maximize short-rows to minimize wale error (no simplicity)
      case SR_MAX:
        this.sr = this.expSR.map(v => Math.max(0, Math.round(v)));
        this.enforceSRConstraint();
        this.error = this.getError();
        return true;
      
      // solve relaxed QP problem, then round to integer
      case SR_QIP: {
        // only use NLOpt if there is a chance for some non-zero solution
        // => we must have one expSR[i] >= 0.5
        if(this.expSR.some(r => r >= 0.5)){
          // potentially non-trivial solution
          const sr0 = sr.nlopt_optimize({
            cdata: this.expSR,
            weights: [ this.waleWeight, this.simpWeight ],
            circular: this.circular,
            simplicityPower: Math.max(1, this.simpPower),
            verbose: this.debugWasm
          });
          this.sr0 = sr0;
          this.sr = sr0.map(v => Math.max(0, Math.round(v)));
          this.enforceSRConstraint();
        } else {
          // trivial solution
          this.sr = this.expSR.map(() => 0);
        }
        this.error = this.getError();
        return true;
      }

      default:
        assert.error('Short-row mode not supported', this.mode);
        this.sr = this.expSR.map(() => 0);
        this.enforceSRConstraint();
        this.error = this.getError();
        return true;
    }
    return false; // not done
  }
}

module.exports = SRSolver;