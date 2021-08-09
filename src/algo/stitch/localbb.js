// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const SNBranchAndBound = require('./branchbound.js');
const { basePath } = require('../../wasm.js');
const ls_module = require('../../../libs/nlopt-wasm/local_sampling.js');
let ls = ls_module({
  locateFile: function(path){
    return basePath + '/libs/nlopt-wasm/' + path;
  }
}).then(l => ls = l);

// constants
const MaxNumStitches = 1e4;

// basic loss
function loss(x){ return x * x; }

/**
 * Local instance of branch and bound problem
 */
class LocalBranchAndBound extends SNBranchAndBound {
  constructor(params = {}){
    super(params);
    // boundary parameters
    this.snStart  = params.snStart;
    this.snEnd    = params.snEnd;
    this.lenStart = params.lenStart;
    this.lenEnd   = params.lenEnd;
    this.localScaling = params.localScaling;
    // global minima and maxima based on first/end and shaping
    this.snMin   = [];
    this.snMax   = [];
    this.singular = true;
  }

  getScalingParams(){
    let c0 = 0;
    const alpha0 = 1.0 / this.courseDist;
    const maxDev = 1.5;
    let alpha;
    if(this.snStart === this.snEnd){
      alpha = Math.max(4, this.snStart * 2) / Math.max(
        this.lenStart + this.lenEnd,
        4 * this.courseDist
      );
      // prevent too large deviation from real data
      alpha = Math.max(Math.min(
        alpha, alpha0 * maxDev
      ), alpha0 / maxDev);

    } else {
      alpha = Math.abs(
        (this.snEnd - this.snStart) / (this.lenEnd - this.lenStart) 
      );
      // prevent too large deviation from real data
      alpha = Math.max(Math.min(
        alpha, alpha0 * maxDev
      ), alpha0 / maxDev);
      c0 = this.snStart - this.lenStart * alpha;
    }
    return [alpha, c0];
  }

  initFromIsolines(isolines){
    const N = isolines.length;
    let alpha = 1.0 / this.courseDist;
    let c0 = 0;
    if(this.localScaling)
      [alpha, c0] = this.getScalingParams();
    this.cdata = isolines.map(ig => {
      return Math.max(4, ig.length() * alpha + c0);
    });
    if(this.localScaling){
      this.udata = isolines.map(ig => {
        return Math.max(4, ig.length() / this.courseDist);
      });
    }
    this.snMin = new Array(N);
    this.snMax = new Array(N);
    this.sn0   = new Array(N);
    this.singular = true;
    for(let i = 0; i < N; ++i){
      const fromStart = Math.pow(this.shapingFactor, i + 1);
      const fromEnd   = Math.pow(this.shapingFactor, N - i);
      const startMin = Math.ceil(this.snStart  / fromStart);
      const startMax = Math.floor(this.snStart * fromStart);
      const endMin   = Math.ceil(this.snEnd    / fromEnd);
      const endMax   = Math.floor(this.snEnd   * fromEnd);
      this.snMin[i] = Math.max(4, startMin, endMin);
      this.snMax[i] = Math.min(MaxNumStitches, startMax, endMax);
      if(this.snMin[i] < this.snMax[i])
        this.singular = false;
      this.sn0[i] = Math.max(
        this.snMin[i], Math.min(
          this.snMax[i], Math.round(this.cdata[i])
        )
      );
    }
    // create initial identity order
    this.setOrder();

    // special case for no isoline
    if(N === 0){
      // compute base error (there won't be any iteration)
      this.snErr = this.getErrorImpl([], 0, this.order);
      this.iter = 1; // so that we can be done without iterating

    } else {
      // get initial value
      this.getInitialValue();

      // create initial branch
      this.exploreState(this.order.emptyState());
    }
  }

  getInitialValue(){

    // use cdata a first initial value for pivots
    const cdataState = this.order.newState(this.sn0);
    if(cdataState.error < this.snErr){
      this.sn = this.sn0.slice();
      this.snErr = cdataState.error;
      this.sols.push([this.sn, this.snErr]);
      // could be singular
      if(this.singular){
        if(this.verbose)
          console.log('The default solution is valid, and singular');
        return;

      } else if(this.verbose)
        console.log('The default solution is valid');
    }
    assert(!this.singular, 'No default solution for a singular problem');

    // attempt to get better pivot position using NLOpt
    // = solving the NLP problem without integer constraints
    const sn_nlopt = ls.nlopt_optimize({
      cdata: this.cdata, start: this.snStart, end: this.snEnd,
      weights: [
        this.courseAccWeight, this.simplicityWeight
      ],
      shaping: this.shapingFactor,
      constraintTol: 1, // we allow half a stitch on each side
      verbose: this.debugWasm
    });

    // check relaxed error (for pivot locations, not solution!)
    const nloptRelState = this.order.relaxedState(sn_nlopt);
    const sn_nlopt_rnd = sn_nlopt.map((n, i) => {
      return Math.max(this.snMin[i],
             Math.min(this.snMax[i], Math.round(n)));
    });
    if(nloptRelState.error < this.snErr){
      // use rounded value projected within min/max range as pivot
      // note: this may not be a valid solution due to pairwise shaping
      this.sn0 = sn_nlopt_rnd;
      if(this.verbose)
        console.log('Using NLOpt pivot');
    }

    // check integer solution
    // /!\ this solution checks for all pairwise bounds
    const nloptState = this.order.newState(sn_nlopt_rnd);

    // try our luck at an integer solution
    if(nloptState.error < this.snErr){
      this.sn0    = nloptState.sn.slice();
      this.sn     = nloptState.sn.slice();
      this.snErr  = nloptState.error;
      this.sols.push([this.sn, this.snErr]);
      if(this.verbose)
        console.log('The initial solution is valid');
    }
  }

  findConstraintError(){ return null; }

  getErrorImpl(sn, size, order, {
    asArray = false, incremental = false, checkBounds = true
  } = {}){
    // the penalty-based error from here
    let E  = 0;
    let Ec = 0;
    let Es = 0;

    // special case (with N=0)
    const N = order.length;
    if(N === 0){
      const diff = this.snStart - this.snEnd;
      Es = loss(diff);
      E  = Es * this.simplicityWeight;

      // if checking bounds, then we check first/last
      if(checkBounds){
        if(this.snStart > this.snEnd * this.shapingFactor
        || this.snStart < this.snEnd / this.shapingFactor)
          E = Infinity; // bounds violated
      }
      return asArray ? [E, Ec, Es] : E;
    }

    // simplicity term for start
    if(0 in sn){
      const diff = this.snStart - sn[0];
      const Esi = loss(diff);
      Es += Esi;
      E  += Esi * this.simplicityWeight;
    }
  
    // 1) Compute course accuracy penalty
    for(const i of order.indices(size)){
      const n = sn[i];

      // check relative and absolute bounds
      if(i > 0 && checkBounds){
        const np = sn[i-1];
        if(n > np * this.shapingFactor
        || n < np / this.shapingFactor
        || n > this.snMax[i]
        || n < this.snMin[i])
          return asArray ? [Infinity, NaN, NaN] : Infinity;
      }

      // course accuracy error
      const Eci = loss(n - this.cdata[i]);
      Ec += Eci;
      E  += Eci * this.courseAccWeight;

      // simplicity with next term
      if(i+1 in sn){
        const diff = n - sn[i+1];
        const Esi = loss(diff);
        Es += Esi;
        E  += Esi * this.simplicityWeight;
      }
    }

    // simplicity term for last term
    if((N-1) in sn){
      const diff = this.snEnd - sn[N-1];
      const Esi = loss(diff);
      Es += Esi;
      E  += Esi * this.simplicityWeight;
    }

    // incremental: check if higher than best option
    // in which case we return infinity
    if(incremental && E > this.snErr)
      return asArray ? [Infinity, NaN, NaN] : Infinity;
  
    return asArray ? [E, Ec, Es] : E;
  }

  *branchesOf(state, invert = true){
    // get base values
    const values = Array.from(super.branchesOf(state, false));
    if(invert)
      values.reverse();

    // if previous or next values are already there
    // then we can constrain the list of valid branches
    const idx = state.nextIndex();
    const prevIdx = idx - 1;
    const nextIdx = idx + 1;
    if(prevIdx in state.sn
    || nextIdx in state.sn){

      // filter values based on box constraints from prev/next
      let prevMin = 2;
      let prevMax = MaxNumStitches;
      if(prevIdx in state.sn){
        prevMin = Math.ceil(state.sn[prevIdx] / this.shapingFactor);
        prevMax = Math.floor(state.sn[prevIdx] * this.shapingFactor);
      }
      let nextMin = 2;
      let nextMax = MaxNumStitches;
      if(nextIdx in state.sn){
        nextMin = Math.ceil(state.sn[nextIdx] / this.shapingFactor);
        nextMax = Math.floor(state.sn[nextIdx] * this.shapingFactor);
      }
      const min = Math.max(prevMin, nextMin, this.snMin[idx]);
      const max = Math.min(prevMax, nextMax, this.snMax[idx]);
      for(const n of values){
        if(min <= n && n <= max)
          yield n;
      }

    } else {
      yield *values;
    }
  }

  static resolve(){
    if(ls instanceof Promise)
      return ls;
    else
      return Promise.resolve();
  }
}

module.exports = LocalBranchAndBound;