// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const CoursePath = require('../mesh/coursepath.js');
//const Timer = require('../../timer.js');
const { PairingQueue } = require('../../ds/pqueue.js');
const LocalBranchAndBound = require('./localbb.js');
const SRSolver = require('./srsolver.js');

const InitStage     = 0;
const ShortRowStage = 1;
const IsolineStage  = 2;
const CompleteStage = 3;
// const NumStages = 3;

class LocalState {
  constructor(N){
    assert(typeof N === 'number'
        && !Number.isNaN(N) && N >= 0,
      'Invalid number of isolines', N);

    // variables
    this.N = N;   // number of subisolines
    this.sn = []; // stitch numbers for each isoline
    this.srn = []; // short-rows between each pair of isolines

    // stage data
    this.stage = InitStage;
    this.error = 0; // total error
    this.isolines = []; // traced isolines
    this.crsPaths = []; // course path of isolines
    this.srSolvers = null;
    this.localBB = null; // local branch and bound instance
  }

  isComplete(){
    return this.stage === CompleteStage;
  }
}

class LocalSolver {
  constructor(regionGraph, regionIndex, {
    waleDist,
    courseDist,
    shapingFactor     = 4,
    courseAccWeight   = 1,
    waleAccWeight     = 1,
    simplicityWeight  = 0,
    timeBudget        = 1, // in seconds'
    localBranches     = 3,
    shortRowMode      = 'none',
    srSimpWeight      = 0,
    srSimpPower       = 2,
    ssAlignment       = 'none',
    ssDepth           = 3,
    ssThreshold       = 0.5,
    localScaling      = false,
    debugWasm         = false,
    verbose           = false
  } = {}){
    // inputs
    this.regionGraph = regionGraph;
    this.regionIndex = regionIndex;
    this.region      = regionGraph.nodes[regionIndex];
    this.waleDist         = waleDist;
    this.courseDist       = courseDist;
    this.shapingFactor    = shapingFactor;
    this.courseAccWeight  = courseAccWeight;
    this.waleAccWeight    = waleAccWeight;
    this.simplicityWeight = simplicityWeight;
    this.timeBudget       = timeBudget;
    this.localBranches    = localBranches;
    this.shortRowMode     = shortRowMode;
    this.srSimpWeight     = srSimpWeight;
    this.srSimpPower      = srSimpPower;
    this.ssAlignment      = ssAlignment;
    this.ssDepth          = ssDepth;
    this.ssThreshold      = ssThreshold;
    this.localScaling     = localScaling;
    this.debugWasm        = debugWasm;
    this.verbose          = verbose;

    // from global solver
    this.snStart    = 0;
    this.edgeStart  = null;
    this.snEnd      = 0;
    this.edgeEnd    = null;

    // local data
    this.stateQueue = null;
    this.pending    = null;
    this.lastStage  = InitStage;
    this.stageStep  = 0;
    this.bestState  = null;
    this.bestErr    = Infinity;
    this.sols       = [];
    this.iter       = 0;
    this.start      = 0;
    this.last       = 0;
  }

  initialize({ snStart, edgeStart, snEnd, edgeEnd }){
    this.snStart    = snStart;
    this.edgeStart  = edgeStart;
    this.snEnd      = snEnd;
    this.edgeEnd    = edgeEnd;

    // create initial state exploration queue
    this.stateQueue = new PairingQueue(this.localBranches);
    for(const N of this.NValues()){
      const state = new LocalState(N);
      this.stateQueue.insert(state, -1); // uninitialized error
    }
  }

  *NValues(Nk = this.localBranches, reverse = true){
    if(reverse){
      const Ns = Array.from(this.NValues(Nk, false));
      Ns.reverse();
      yield *Ns;
      return;
    }
    const dt = this.regionGraph.dt(this.regionIndex);
    const minN = Math.max(0, Math.ceil(
      Math.log(
        Math.max(
          this.snStart / this.snEnd,
          this.snEnd / this.snStart
        )
      ) / Math.log(this.shapingFactor)
    ) - 1);
    // example test:
    // ns = 10, ne = 1000, S = 1.7;
    // minN = Math.max(0, Math.ceil(Math.log(Math.max(ns/ne, ne/ns)) / Math.log(S)) - 1)
    // n = ns; i = 1; console.log('s', ns); while(n < ne){ n = Math.floor(n * S); if(n < ne) console.log(i++, n); } console.log('e', ne);
    
    // expected N, but at least minN:
    const expN = Math.max(minN, Math.round(dt / this.waleDist) - 1);

    // initial expected N value
    yield expN;

    // go over dN values (at most K of them in each direction)
    const K = Nk--;
    for(let k = 1; k <= K && Nk > 0; ++k){
      const Np = expN + k;
      yield Np;
      --Nk;

      const Nn = expN - k;
      if(Nn >= minN && Nk-- > 0)
        yield Nn;
    }
  }

  iterate(
    batchIter = 5,
    batchTime = Math.min(1, this.timeBudget) * 3e2
  ){
    if(this.done())
      return true;

    if(this.iter === 0){
      // start time measurement for budget
      this.start = this.last = Date.now();
    }

    // go over next available state for processing
    stateLoop:
    while(this.pending || !this.stateQueue.isEmpty()){
      // each batch iterations, check time
      if(++this.iter % batchIter === 0){
        const now = Date.now();
        if(now - this.last > batchTime){
          this.last = now;
          break;
        }
      }

      const state = this.pending ? this.pending : this.stateQueue.pop();
      this.pending = null; // no more pending
      if(state.stage === this.lastStage)
        ++this.stageStep;
      else
        this.stageStep = 0;
      this.lastStage = Math.max(this.lastStage, state.stage);
      assert(state.stage === this.lastStage, 'Invalid stage');
      // check error
      if(this.bestErr <= state.error)
        continue; // not worth exploring state further

      // act given stage
      switch(state.stage){

        // given N, sample isolines
        case InitStage: {
          this.initIsolines(state);
          // initialize error, so it ends up beyond
          state.error = 0;
          ++state.stage;
        } break;

        // given N, find srn[][]
        case ShortRowStage: {
          if(!state.srSolvers)
            this.initSRSolvers(state);
          // go over more iterations
          const done = state.srSolvers.map(srs => srs.iterate());
          if(done.every(d => d)){
            const werr = state.srSolvers.reduce((sum, srs) => {
              return sum + srs.error;
            }, 0.0);
            // wale + simplicity error
            state.error = werr / state.srSolvers.length;
            // record short-row numbers
            state.srn = state.srSolvers.map(srs => srs.sr);
            // go to next stage
            ++state.stage;

          } else {
            // keep pending
            this.pending = state;
            continue stateLoop;
          }
        } break;

        // given N, find ns[], only for best option
        case IsolineStage: {
          if(!state.localBB)
            this.initLocalBB(state);
          // go over more iterations
          const done = state.localBB.iterate();
          if(done){
            // note: the course / simplicity errors
            // do not contribute to the decision about N or short-rows
            // record stitch numbers
            state.sn = state.localBB.sn;
            // store best state solution
            this.bestState = state;
            this.bestErr = state.error;
            // mark as complete stage (to ensure we're properly done)
            ++state.stage;
            this.lastStage = CompleteStage;

            // we're done!
            break stateLoop;

          } else {
            // keep pending
            this.pending = state;
            continue stateLoop;
          }
        } break;

        // should not reach here!
        default:
          assert.error('Invalid stage', state.stage);
      } // endswitch

      // push updated state for processing
      this.stateQueue.insert(state, state.error);
    } // endwhile #states
    
    const done = this.done();
    if(!done && this.stateQueue.isEmpty() && !this.pending){
      assert.error('No valid local solution.');
    }
    return done;
  }

  progress(){
    if(this.done())
      return 1.0;
    switch(this.lastStage){
      case InitStage:
        return this.stageStep / this.localBranches * 0.35;
      case ShortRowStage:
        return 0.35 + this.stageStep / this.localBranches * 0.35;
      case IsolineStage:
        return 0.7 + this.pending.localBB.progress() * 0.3;
      default:
        return 1.0;
    }
    /*
    return Math.max(0.0, Math.min(1.0 - 1e-4,
      (Date.now() - this.start) / (this.timeBudget * 1e3)
    ));
    */
  }

  done(){
    return this.lastStage === CompleteStage
        || this.stateQueue.isEmpty();
  }

  debug(problemName = 'L?'){
    let lstr = '';
    if(this.bestState){
      const lbb = this.bestState.localBB;
      const [alpha, c0] = lbb.getScalingParams();
      lstr += ' | alpha=' + alpha + ', c0=' + c0;
      lstr += ' | a0=' + (1.0 / this.courseDist);
    }
    console.log(
      problemName + ' solved, iters=' + this.iter
      + ' | E=' + this.bestErr + lstr
    );
    console.log(this.bestState);
  }

  initIsolines(state){
    // create isolines
    state.isolines = this.getIsolines(state.N);
  }

  getIsolines(N){
    // trace isolines within current region
    if(N === 0)
      return [];

    // compute splitting times
    const times = Array.from(geom.linspace(
      this.edgeStart.isoline.time,
      this.edgeEnd.isoline.time,
      N + 2 // N splits + start + end
    )).slice(1, N + 1);
    assert(times.length === N, 'Invalid number of splits');

    // find and trace sub-isolines
    const mesh = this.regionGraph.mesh;
    const red = mesh.reducedRegions[this.region.index];
    assert(red, 'Missing original reduced region');
    const splitMap = new Map();
    splitMap.set(red, times);
    const isoMap = mesh.getSplittingIsolines(splitMap);
    const isolines = isoMap.get(red);
    assert(isolines
        && Array.isArray(isolines)
        && isolines.length === N,
      'Some splitting isoline not found');
    return isolines || [];
  }

  initLocalBB(state){
    // create local branch and bound algorithm
    state.localBB = new LocalBranchAndBound({
      snStart:          this.snStart,
      snEnd:            this.snEnd,
      lenStart:         this.edgeStart.courseWidth(),
      lenEnd:           this.edgeEnd.courseWidth(),
      courseDist:       this.courseDist,
      courseAccWeight:  this.courseAccWeight,
      simplicityWeight: this.simplicityWeight,
      shapingFactor:    this.shapingFactor,
      timeBudget:       this.timeBudget / 3,
      localScaling:     this.localScaling,
      debugWasm:        this.debugWasm,
      verbose:          this.verbose
    });
    // initialize data
    
    // - initialize BB parameters
    state.localBB.initFromIsolines(state.isolines);
  }

  initSRSolvers(state){
    // gather course paths in state
    state.crsPaths = [
      this.edgeStart.getCoursePath(),
      ...state.isolines.map(iso => CoursePath.from(iso, [0])),
      this.edgeEnd.getCoursePath()
    ];
    state.srSolvers = Array.from({ length: state.N + 1 }, (_, i) => {
      return new SRSolver(
        state.crsPaths[i], // source course path
        state.crsPaths[i + 1], // target course path
        this // = the parameters (waleDist, shortRowMode ...)
      );
    });
  }
}

module.exports = Object.assign(LocalSolver, {
  // classes
  LocalState,
  // constants
  IsolineStage, ShortRowStage, CompleteStage,
  // resolution promise
  resolve: LocalBranchAndBound.resolve
});