// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const MeshGrid = require('../../ds/meshgrid.js');
const { PairingQueue } = require('../../ds/pqueue.js');

// constants
const SOURCE = 0;
const TARGET = 1;
const BOTH = 2;

function dtwInit(sources, targets, penalty){
  const M = sources.length;
  const N = targets.length;
  // height = M
  // width = N
  const cost = new MeshGrid(N, M, 1, MeshGrid.F32);
  // fill first row and column
  const src0 = sources[0];
  const trg0 = targets[0];
  const d00 = penalty(src0, trg0, cost, 0, 0);
  cost.set(0, 0, 0, d00);
  for(let i = 1, d = d00; i < M; ++i){
    const src = sources[i];
    d += penalty(src, trg0, cost, i, 0);
    cost.set(i, 0, 0, d);
  }
  for(let j = 1, d = d00; j < N; ++j){
    const trg = targets[j];
    d += penalty(src0, trg, cost, 0, j);
    cost.set(0, j, 0, d);
  }

  return cost;
}

function dtwPath(cost){
  // traceback:
  // @see https://nipunbatra.github.io/blog/2014/dtw.html
  const path = [];
  let i = cost.dim(0) - 1;
  let j = cost.dim(1) - 1;
  path.push([i, j]);
  while(i > 0 || j > 0){
    if(i == 0){
      --j; // only one choice possible
    } else if(j == 0){
      --i; // only one choice possible
    } else {
      const pp = cost.get(i-1, j-1, 0);
      const cp = cost.get(i+0, j-1, 0);
      const pc = cost.get(i-1, j+0, 0);
      // check which path matches
      const m = geom.min([pp, cp, pc]);
      if(m === pp){
        --j;
        --i;
      } else if(m === pc){
        --i;
      } else {
        assert(m === cp, 'Invalid state');
        --j;
      }
    }
    path.push([i, j]);
  }
  return path;
}

/**
 * Compute a generic dynamic time warping alignment without constraints
 *
 * @param sources a sequence of sources
 * @param targets a sequence of targets
 * @param penalty a penalty function (src, trg) => Number
 * @return { minCost, cost, path }
 */
function findAlignment(sources, targets, penalty){
  const M = sources.length;
  const N = targets.length;

  // create initial cost matrix with first row and column filled
  const cost = dtwInit(sources, targets, penalty);

  // measure cost by filling the cost matrix
  for(let i = 1; i < M; ++i){
    const src = sources[i];
    for(let j = 1; j < N; ++j){
      const trg = targets[j];
      const d = penalty(src, trg, cost, i, j);
      cost.set(i, j, 0,
        d + geom.min([
          cost.get(i+0, j-1, 0), // re-using source
          cost.get(i-1, j+0, 0), // re-using target
          cost.get(i-1, j-1, 0)  // matching both new source with new target
        ])
      );
    }
  }

  // the total cost is that at the end of the matrix
  // we then backtrack from it to figure out the optimal alignment
  const minCost = cost.get(M - 1, N - 1, 0);

  // trace path backward from cost matrix
  const path = dtwPath(cost);

  return { path, minCost, cost };
}

/**
 * Dynamic Time Warping with constrained source/target alignment.
 *
 * The constraints is that sources and targets (except the first and last)
 * cannot be picked more than a fixed number of times in a row.
 *
 * @param sources the source sequence
 * @param targets the target sequence
 * @param penalty the pairing penalty
 * @param maxPerSource the maximum of matches for a same source (except first and last)
 * @param maxPerTarget the maximum of matches for a same target (except first and last)
 * @return { path, minCost, cost, usage }
 */
function findConstrainedAlignment(
  sources, targets, penalty,
  maxPerSource = 2,
  maxPerTarget = 2
){
  const M = sources.length;
  const N = targets.length;

  // create initial cost matrix with first row and column filled
  const cost = dtwInit(sources, targets, penalty);

  // create reuse data
  const usage = new MeshGrid(N, M, 2, MeshGrid.U8); // zero-initialized

  // measure cost by filling the cost matrix
  for(let i = 1; i < M; ++i){
    const src = sources[i];
    for(let j = 1; j < N; ++j){
      const trg = targets[j];
      const d = penalty(src, trg);
      // check which we can use
      const canReuseSource = usage.get(i+0, j-1, SOURCE) < maxPerSource || i === M - 1; // /!\ can always reuse last source
      const canReuseTarget = usage.get(i-1, j+0, TARGET) < maxPerTarget || j === N - 1; // same for last target
      const past = [
        canReuseSource ? cost.get(i+0, j-1, 0) : Infinity, // re-using source, using new target
        canReuseTarget ? cost.get(i-1, j+0, 0) : Infinity, // using new source, re-using target
                         cost.get(i-1, j-1, 0) // using both new source and new target (always available)
      ];
      const minPast = geom.min(past);
      cost.set(i, j, 0, d + minPast);
      // update reuse counters
      if(minPast === past[SOURCE]){
        // re-using source => new TARGET pointer
        usage.set(i, j, SOURCE, usage.set(i+0, j-1, SOURCE) + 1); // re-using = old usage + 1
        usage.set(i, j, TARGET, 1); // new target = 1 usage
      } else if(minPast === past[TARGET]){
        // re-using target => new SOURCE pointer
        usage.set(i, j, SOURCE, 1); // new source = 1 usage
        usage.set(i, j, TARGET, usage.set(i-1, j+0, TARGET) + 1); // re-using = old usage + 1
      } else {
        assert(minPast === past[BOTH], 'Could not find the minimum');
        usage.set(i, j, SOURCE, 1); // new source = 1 usage
        usage.set(i, j, TARGET, 1); // new target = 1 usage
      }
    } // endfor j < N
  } // endfor i < M

  // the total cost is that at the end of the matrix
  // we then backtrack from it to figure out the optimal alignment
  const minCost = cost.get(M - 1, N - 1, 0);

  // trace path backward from cost matrix
  const path = dtwPath(cost);

  return { path, minCost, cost, usage };
}

class LinkingState {
  constructor(src, trg, remSrc, remTrg){
    this.src = src;
    this.trg = trg;
    this.remSrc = remSrc;
    this.remTrg = remTrg;
    assert(src >= 0 && trg >= 0,
      'Negative source and/or target pointer(s)');
    assert(remSrc >= 0 && remTrg >= 0,
      'Negative remainder(s)', remSrc, remTrg);
  }

  isComplete(){
    return this.remSrc === 0 && this.remTrg === 0;
  }
  toString(){
    return String.fromCharCode(this.src, this.trg, this.remSrc, this.remTrg);
  }
  next({ src, trg }, S, T){
    return new LinkingState(
      (this.src + src + S) % S,
      (this.trg + trg + T) % T,
      this.remSrc - src,
      this.remTrg - trg
    );
  }
  prev({ src, trg }, S, T){
    return this.next({ src: -src, trg: -trg }, S, T);
  }
  static fromString(str){
    assert(str.length === 4, 'Invalid number of character points');
    const data = Array.from(str, c => c.charCodeAt(0));
    return new LinkingState(...data);
  }
}

class Linking {
  constructor(src, trg){
    this.src = src;
    this.trg = trg;
  }

  *sublinks(){
    if(this.src === 1){
      yield new Linking(1, 1);
      for(let i = 1; i < this.trg; ++i)
        yield new Linking(0, 1);

    } else if(this.trg === 1){
      yield new Linking(1, 1);
      for(let i = 1; i < this.src; ++i)
        yield new Linking(1, 0);

    } else {
      assert(!this.src && !this.trg,
        'Invalid action', this.src, this.trg);
    }
  }
}

const Start = new Linking(0, 0);
const Link_1_1 = new Linking(1, 1);
const Link_1_2 = new Linking(1, 2);
const Link_2_1 = new Linking(2, 1);

function arrayOf(arg, length){
  assert(length, 'No length argument');
  return Array.from({ length }, () => arg);
}
/**
 * General wale distribution using a DTW implementation
 * inspired mainly by that of AutoKnit [Narayanan 2018].
 * 
 * [Narayanan 2018]:
 *    Automatic Machine Knitting of 3D Meshes
 *    Vidya Narayanan, Lea Albaugh, Jessica Hodgins, Stelian Coros and Jim McCann
 *    Siggraph 2018
 * 
 * @param {array} sources list of source stitches
 * @param {array} targets list of target stitches
 * @param {(any,any)=>number} penalty penalty function between stitches
 * @param {any} params alignment parameters (circular, regularSources, regularTargets)
 * @return {{path,minCost}} alignment result
 * @see https://github.com/textiles-lab/autoknit/blob/e3addabd1960ccc614e6bcf7fc37dfeb9670062c/ak-optimal_link.cpp
 */
function align(sources, targets, penalty, params = {}){
  // cardinalities
  const S = sources.length;
  const T = targets.length;
  // default parameters
  const minimal = params.minimal || false;
  const regularSources = params.regularSources || arrayOf(false, S);
  const regularTargets = params.regularTargets || arrayOf(false, T);
  const circular = !!params.circular;
  // global link options
  // minimal => only use a link type if it is necessary
  const mustLink12 = S < T; // requires increase(s)
  const mustLink21 = S > T; // requires decrease(s)
  const canLink12 = !minimal || mustLink12;
  const canLink21 = !minimal || mustLink21;
  // const standardShaping = !!params.standardShaping;
  const bestStateCost = new Map(); // Map<string(LinkingState), [number, Linking]
  const queue = new PairingQueue();
  const visit = (state, cost, action) => {
    const stateKey = state.toString();
    const [currCost,] = bestStateCost.get(stateKey) || [Infinity];
    if(cost < currCost){
      bestStateCost.set(stateKey, [cost, action]);
      queue.insert(state, cost);
    }
  };
  const isPossible = state => {
    // possible if we can apply standard shaping to fit
    // the remaining numbers of stitches on each side
    // <=> there is no case of not being to do shaping
    return !(
       state.remSrc * 2 < state.remTrg // increases only is not sufficient
    || state.remTrg * 2 < state.remSrc // decreases only is not sufficient
    );
  };
  // initial selection
  if(circular){
    for(let trg = 0; trg < targets.length; ++trg){
      visit(new LinkingState(0, trg, S, T), 0.0, Start);
    }
  } else {
    visit(new LinkingState(0, 0, S, T), 0.0, Start);
  }
  let bestState;
  let minCost = Infinity;
  let numStates = 0;
  while(!queue.isEmpty()){
    const [state, cost] = queue.pop(true);
    ++numStates;

    // check if this state is still optimal
    const [currCost] = bestStateCost.get(state.toString());
    assert(currCost <= cost, 'Distance increase?');
    if(currCost < cost)
      continue; // a better state exists, skip branch expansion
    
    // check state completeness
    if(state.isComplete()){
      // by the greedy least-distance traversal,
      // this state is the optimal final state
      bestState = state;
      minCost = cost;
      break;
    }
    assert(state.remSrc > 0 && state.remTrg > 0,
      'Partially complete state');
    
    // we need to try expanding
    const nextSrc = (state.src + 1) % S;
    const nextTrg = (state.trg + 1) % T;
    one_one: {
      // 1-1 action
      const nextState = state.next(Link_1_1, S, T);
      if(isPossible(nextState)){
        const actionCost = penalty(
          sources[state.src], targets[state.trg], false, false
        );
        visit(nextState, cost + actionCost, Link_1_1);
      }
    }
    // irregular cases
    if(state.remTrg >= 2
    && canLink12
    && !regularSources[state.src]
    && !regularTargets[state.trg]
    && !regularTargets[nextTrg]){
      // 1-2 action
      const nextState = state.next(Link_1_2, S, T);
      if(isPossible(nextState)){
        const actionCost = penalty(
          sources[state.src], targets[state.trg], true, false
        ) + penalty(
          sources[state.src], targets[nextTrg], true, false
        );
        visit(nextState, cost + actionCost, Link_1_2);
      }
    }
    if(state.remSrc >= 2
    && canLink21
    && !regularSources[state.src]
    && !regularSources[nextSrc]
    && !regularTargets[state.trg]){
      // 2-1 action
      const nextState = state.next(Link_2_1, S, T);
      if(isPossible(nextState)){
        const actionCost = penalty(
          sources[state.src], targets[state.trg], false, true
        ) + penalty(
          sources[nextSrc], targets[state.trg], false, true
        );
        visit(nextState, cost + actionCost, Link_2_1);
      }
    }
  }
  assert(bestState, 'No valid state found', bestState);

  // debug number of states processed
  // console.log('DTW: visited ' + numStates + ' of ' + (S*T) + ' states');
  
  // compute reverse linking path
  const path = [];
  let state = bestState;
  let action;
  do {
    [, action] = bestStateCost.get(state.toString());
    // undo action and generate links
    for(const linkAction of action.sublinks()){
      state = state.prev(linkAction, S, T);
      path.push([state.src, state.trg]);
    }

  } while (action !== Start);
  path.reverse();

  return { path, minCost, numStates };
}

module.exports = {
  SOURCE, TARGET, BOTH,
  findAlignment,
  findConstrainedAlignment,
  align
};
