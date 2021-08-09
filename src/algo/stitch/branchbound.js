// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const Timer = require('../../timer.js');
const { basePath } = require('../../wasm.js');
const gs_module = require('../../../libs/nlopt-wasm/global_sampling.js');
let gs = gs_module({
  locateFile: function(path){
    return basePath + '/libs/nlopt-wasm/' + path;
  }
}).then(g => gs = g);

/**
 * Stitch Number node with connectivity constraint and wale term
 */
class SNNode {
  constructor(index, inpEdges, outEdges, simple, flatSide = false){
    this.index = index;
    this.inp = inpEdges;
    this.out = outEdges;
    this.simple = !!simple;
    this.flatSide = flatSide;
  }

  isInternal(){ return this.inp.length && this.out.length; }
  hasConstraint(){ return !this.simple && this.isInternal(); }
  isSplitting(){ return this.out.length > 1; }
  isMerging(){ return this.inp.length > 1; }
  hasWaleTerm(){ return this.simple && this.isInternal(); }
  isBranching(){
    return this.hasConstraint()
        && (this.isSplitting() || this.isMerging());
  }
  isFlatBranching(){
    return this.flatSide && this.isBranching();
  }
}

/**
 * Stitch Number exploration state
 */
class SNState {
  constructor(sn, size, order, error = NaN){
    this.sn    = sn;       // sequence (in given order)
    this.size  = size;
    this.order = order; // sequence order
    this.error = error; // incremental error

    // check arguments
    assert(Array.isArray(sn)
        && typeof size === 'number'
        && order instanceof SNOrder
        && typeof error === 'number', 'Invalid argument types');
    assert(!Number.isNaN(error), 'The error value is not a number');
    assert(sn.length === this.order.length,
      'The sequence argument must be fully allocated');
    assert(size <= this.order.length, 'State exceeds order size');
  }

  get length(){ return this.size; }
  get maxSize(){ return this.order.length; }
  get maxLength(){ return this.order.length; }

  canInfer(){ return !!this.order.infer[this.size]; }
  inferNext(){ 
    const infer = this.order.infer[this.size];
    const n = infer(this.sn);
    assert(!Number.isNaN(n), 'Invalid inference');
    return this.nextState(n);
  }
  isValid(){ return Number.isFinite(this.err); }
  isComplete(){ return this.size === this.maxSize; }


  *keys(){
    for(let i = 0; i < this.size; ++i)
      yield this.order.indexOf(i);
  }
  *values(){
    for(let i = 0; i < this.size; ++i){
      const idx = this.order.indexOf(i);
      yield this.sn[idx];
    }
  }
  *entries(){
    for(let i = 0; i < this.size; ++i){
      const idx = this.order.indexOf(i);
      yield [idx, this.sn[idx]];
    }
  }

  nextIndex(){ return this.order.indexOf(this.size); }
  nextState(n, newError = NaN){
    assert(this.size < this.maxLength,
      'State is complete, cannot be extended');
    const sn = this.sn.slice();
    const ord = this.order.oriToOrd[this.size];
    sn[ord] = n;
    return this.order.newState(sn, this.size + 1, newError);
  }


  static sizeOf(sn){
    return sn.reduce((sum, n) => {
      return typeof n === 'number' ? sum + 1 : sum;
    }, 0);
  }
}

/**
 * Stitch Number exploration order
 */
class SNOrder {
  constructor(oriToOrd, ordToOri, errFun, constrFun){
    this.oriToOrd   = oriToOrd;
    this.ordToOri   = ordToOri;
    this.errFun     = errFun;
    this.constrFun  = constrFun;
    // build inference data
    this.infer = this.inferData();
  }

  get length(){ return this.oriToOrd.length; }
  [Symbol.iterator](){ return this.oriToOrd.values(); }

  *indices(N = this.length){
    for(let i = 0; i < N; ++i)
      yield this.indexOf(i);
  }
  indexOf(i){ return this.oriToOrd[i]; }
  errorOf(sn){ return this.errFun(sn); }
  constraintErrorOf(sn){ return this.constrFun(sn); }
  isValid(sn){ return !this.constraintErrorOf(sn); }

  emptyState(){
    const sn = new Array(this.length);
    return new SNState(sn, 0, this, 0);
  }
  newState(sn, size = SNState.sizeOf(sn), err = NaN){
    if(Number.isNaN(err)){
      // must compute the error
      // and check constraints
      const state = new SNState(sn, size, this, Infinity);
      // check constraints first
      if(!this.isValid(sn))
        err = Number.POSITIVE_INFINITY;
      else
        err = this.errorOf(state); // compute error
      
      // if finite error, store it
      if(Number.isFinite(err))
        state.error = err;
      
      // return state
      return state;

    } else {
      // fully defined state, nothing to compute
      return new SNState(sn, size, this, err);
    }
  }
  relaxedState(sn){
    assert(SNState.sizeOf(sn) === this.length,
      'Relaxed states must use full stitch number sequences');
    // note: we do not check constraints
    // /!\ this.errorOf can be called with an array, only if it's full
    return new SNState(sn, this.length, this, this.errorOf(sn));
  }

  inferData(){
    // allocate inference data
    const infer = new Array(this.length);

    // allocate initial state
    const state = this.emptyState();

    // grow initial state according to the order sequence
    for(const i of this){
      // focus on current variable
      // => use 1 to resolve failing constraints
      state.sn[i] = 1;
      state.size += 1;

      // locate constraint errors
      const errGroups = this.constraintErrorOf(state);
      if(errGroups){
        const [inp, out] = errGroups;
        // extract group information
        // /!\ do NOT modify inp/out since those are the original groups
        const isInput = inp.includes(i);
        const thisGrp = (isInput ? inp : out).slice();
        const thatGrp = (isInput ? out : inp).slice();
        // remove self from thisGrp
        const idx = thisGrp.indexOf(i);
        assert(idx !== -1, 'Neither in thisGrp nor thatGrp');
        thisGrp.splice(idx, 1);

        // create inference function to reduce this variable
        // exploration to a simple function call
        infer[i] = sn => {
          // sum sn[i in thisGrp] + sn[i] = sum sn[j in thatGrp]
          // => sn[i] = sum sn[j] - sum sn[i]
          let val = 0;
          for(const idx of thatGrp)
            val += sn[idx] || NaN;
          for(const idx of thisGrp)
            val -= sn[idx] || NaN;
          return val;
        };
      }

      // replace 1 by 0 to remove focus on variable
      state.sn[i] = 0;
    }
    return infer;
  }

  static getInvPerm(perm){
    const N = perm.length;
    const iperm = new Array(N);
    for(let i = 0, ord = perm[0]; i < N; ord = perm[++i]){
      assert(0 <= ord && ord < N,
        'Permutation out of index range');
      assert(iperm[ord] === undefined, 'Not a valid permutation');
      // assign inverse permutation map
      iperm[ord] = i;
    }
    return iperm;
  }
  static identity(N, errFun, constrFun){
    const oriToOrd = Array.from({ length: N }, (_, i) => i);
    return new SNOrder(oriToOrd, oriToOrd, errFun, constrFun);
  }
  static from(perm, errFun, constrFun){
    const iperm = SNOrder.getInvPerm(perm);
    return new SNOrder(perm, iperm, errFun, constrFun);
  }
}

// L2 loss
function loss(err){ return err * err; }

class SNBranchAndBound {
  constructor({
    waleDist,
    courseDist,
    shapingFactor     = 2,
    globalShaping     = false,
    uniformBranching  = false,
    evenInterfaces    = false,
    courseAccWeight   = 1,
    simplicityWeight  = 0.1,
    aliasingLevel     = 2, // trivial + basic aliasing
    timeBudget        = 1, // in seconds
    debugWasm         = false,
    verbose           = false
  }){
    // parameters
    this.courseDist = courseDist;
    this.waleDist   = waleDist;
    this.shapingFactor    = shapingFactor;
    this.globalShaping    = globalShaping;
    this.uniformBranching = uniformBranching;
    this.evenInterfaces   = evenInterfaces;
    this.courseAccWeight  = courseAccWeight;
    this.simplicityWeight = simplicityWeight;
    this.aliasingLevel    = aliasingLevel;
    this.timeBudget = timeBudget;
    this.debugWasm  = debugWasm;
    this.verbose    = verbose;

    // data
    this.sn     = []; // original index
    this.sn0    = []; // original index
    this.cdata  = []; // original index
    this.wdata  = []; // oridinal index
    this.iwdata = []; // original index
    this.nodes  = []; // original index
    this.snMin  = [];
    this.snMax  = [];
    
    // state
    this.order    = null;
    this.snErr    = Infinity;
    this.states   = [];
    this.iter     = 0;
    this.sols     = [];
    this.start    = 0;
    this.last     = 0;

    // debug
    this.timer = Timer.create();
  }

  get numEdges(){ return this.cdata.length; }
  get numNodes(){ return this.nodes.length; }

  exploreState(state){
    this.states.push(state);
  }

  initFromGraph(graph){
    // Prepare the data for the stitch number optimization
    // this.ns = this.regionGraph.edges.map(() => 1);
    this.cdata = graph.edges.map(e => {
      return Math.max(4, e.courseWidth() / this.courseDist);
    });
    this.wdata = graph.nodes.map(n => {
      if(n.isInterface())
        return 0;
      // only meaningful for simple regions (aka green nodes)
      const expNumCourses = Math.max(1, Math.floor(
        n.timeRange() * graph.mesh.lastEta / this.waleDist
      ));
      // additive: expNumCourses * this.shapingFactor
      // multiplicative: this.shapingFactor ** expNumCourses
      return Math.pow(this.shapingFactor, expNumCourses);
    });
    this.iwdata = this.wdata.map(w => 1.0 / w);
    this.nodes = graph.nodes.map((n, i) => {
      return new SNNode(
        i,
        graph.inpEdges[i].map(e => e.index),
        graph.outEdges[i].map(e => e.index),
        n.isArea(),
        [...graph.inpEdges[i], ...graph.outEdges[i]].some(e => {
          return e.isFlat();
        })
      );
    });

    // compute bounds on stitch numbers
    const minSN = this.cdata.reduce((min, snStar) => {
      return Math.min(min, Math.floor(snStar));
    }, Infinity);
    this.snMin = this.cdata.map(() => minSN);
    const maxSN = this.cdata.reduce((max, snStar) => {
      return Math.max(max, Math.ceil(snStar));
    }, 4);
    this.snMax = this.cdata.map(() => maxSN);

    // create initial identity order
    this.setOrder();

    // get initial value
    this.getInitialValue();

    // order by constraint block first
    this.orderByConstraint();

    // create initial branch
    this.exploreState(this.order.emptyState());
  }

  getInitialValue(){

    // use cdata a first initial value for pivots
    this.sn0 = this.cdata.map(n => Math.round(n));
    const cdataState = this.order.newState(this.sn0);
    if(cdataState.error < this.snErr){
      this.sn = this.sn0.slice();
      this.enforceUserConstraints();
      this.snErr = cdataState.error;
      this.sols.push([this.sn, this.snErr]);
      if(this.verbose)
        console.log('The default solution is valid');
    }

    // attempt to get better pivot position using NLOpt
    // = solving the NLP problem without integer constraints
    const sn_nlopt = gs.nlopt_optimize({
      cdata: this.cdata, wdata: this.wdata, nodes: this.nodes,
      weights: [
        this.courseAccWeight, this.simplicityWeight
      ],
      globalShaping: this.globalShaping,
      aliasingLevel: this.aliasingLevel,
      constraintTol: 2, // we allow one stitch error on each side
      verbose: this.debugWasm
    });

    // check relaxed error (for pivot locations, not solution!)
    const nloptRelState = this.order.relaxedState(sn_nlopt);
    const sn_nlopt_rnd = sn_nlopt.map(n => Math.round(n));
    if(nloptRelState.error < this.snErr){
      this.sn0 = sn_nlopt_rnd; // use rounded value as pivot
      if(this.verbose)
        console.log('Using NLOpt pivot');
    }

    // check integer solution
    // /!\ this solution checks for all integer constraints!
    const nloptState = this.order.newState(sn_nlopt_rnd);

    // try our luck at an integer solution
    if(nloptState.error < this.snErr){
      this.sn0    = nloptState.sn.slice();
      this.sn     = nloptState.sn.slice();
      this.enforceUserConstraints();
      this.snErr  = nloptState.error;
      this.sols.push([this.sn, this.snErr]);
      if(this.verbose)
        console.log('The initial solution is valid');
    }
  }

  enforceUserConstraints(sn = this.sn){
    // note: those constraints are enforced "a posteriori"
    // which is obviously suboptimal (but makes it easier)

    // uniform splitting at interfaces
    if(this.uniformBranching){
      if(this.verbose)
        console.log('Enforcing uniform splitting');
      // enforce that the stitches numbers at an interface
      // are uniformly the same across two sides
      for(const node of this.nodes){
        if(!node.isFlatBranching())
          continue; // no constraint to apply
        const inpK = node.inp.length;
        const outK = node.out.length;
        const lcmK = Array.from({ length: outK }, (_, i) => {
          return inpK * (i+1);
        }).reduce((min, n) => {
          return n % outK === 0 ? Math.min(min, n) : min;
        }, inpK * outK);
        const inpSN = node.inp.map(i => sn[i]);
        const outSN = node.out.map(i => sn[i]);
        const inpSum = inpSN.reduce((sum, n) => sum + n, 0);
        const outSum = outSN.reduce((sum, n) => sum + n, 0);
        assert(inpSum === outSum, 'Invalid solution');
        // 1 = modify sums so they end up having proper divisibility
        //     while ensuring both sides match
        let sum = Math.max(inpSum, outSum, 2 * inpK, 2 * outK);
        sum += sum % lcmK; // made to be divisible on each side
        const sni = sum / inpK;
        const sno = sum / outK;
        if(this.verbose){
          console.log('Node #' + node.index + ':');
          console.log(
            node.inp.map(i => sn[i]).join('/')
            + ' -> ' + inpK + 'x' + sni
          );
          console.log(
            node.out.map(i => sn[i]).join('/')
            + ' -> ' + outK + 'x' + sno
          );
        }
        for(const inpIdx of node.inp)
          sn[inpIdx] = sni;
        for(const outIdx of node.out)
          sn[outIdx] = sno;
      }
    }

    // even number of stitches per interface
    if(this.evenInterfaces){
      if(this.verbose)
        console.log('Enforcing even interfaces');
      // enforce that the stitches numbers at an interface
      // are all even, while keeping the sums equal
      for(const node of this.nodes){
        if(!node.isBranching()){
          // just round up to nearest even number
          const edgeIndex = node.inp.concat(node.out);
          assert([1,2].includes(edgeIndex.length),
            'Non-branching node has more than two edges');
          for(const i in edgeIndex)
            sn[i] = sn[i] + (sn[i] % 2);
          continue; // no branching constraint to worry about
        }

        // else we have some constraint to maintain
        // 1 = make all interfaces even separately
        // const inpSum0 = node.inp.reduce((sum, i) => sum + sn[i], 0);
        const inpSN = node.inp.map(i => sn[i] + (sn[i] % 2));
        const inpSum1 = inpSN.reduce((sum, n) => sum + n, 0);
        // const outSum0 = node.out.reduce((sum, i) => sum + sn[i], 0);
        const outSN = node.out.map(i => sn[i] + (sn[i] % 2));
        const outSum1 = outSN.reduce((sum, n) => sum + n, 0);
        if(inpSum1 === outSum1)
          continue; // the constraint is satisfied already

        // 2 = we must spread the increase to the defective side
        const spreadToOut = outSum1 < inpSum1;
        let spread;
        let toEdges;
        let toSN;
        if(spreadToOut){
          spread = inpSum1 - outSum1;
          toEdges = node.out;
          toSN = outSN;
        } else {
          spread = outSum1 - inpSum1;
          toEdges = node.inp;
          toSN = inpSN;
        }
        assert(spread % 2 === 0, 'Difference must be even');
        for(; spread > 0; spread -= 2){
          // find edge that is closest to original
          const e = toEdges.reduce((minIdx, curIdx, i) => {
            const minDiff = toSN[minIdx] - sn[toEdges[minIdx]];
            const curDiff = toSN[i] - sn[curIdx];
            return minDiff <= curDiff ? minIdx : i;
          }, 0);
          toSN[e] += 2; // note: stays even, while reducing defect
        }
        const inpSum = inpSN.reduce((sum, n) => sum + n, 0);
        const outSum = outSN.reduce((sum, n) => sum + n, 0);
        assert(inpSum === outSum, 'Invalid solution');

        // output transformation for debug
        if(this.verbose){
          console.log('Node #' + node.index + ':');
          console.log(
            node.inp.map(i => sn[i]).join('/')
            + ' -> ' + inpSN.join('/')
          );
          console.log(
            node.out.map(i => sn[i]).join('/')
            + ' -> ' + outSN.join('/')
          );
        }
        // apply solution
        for(const [i, inpIdx] of node.inp.entries())
          sn[inpIdx] = inpSN[i];
        for(const [i, outIdx] of node.out.entries())
          sn[outIdx] = outSN[i];
      }
    }
  }

  setOrder(perm = null){
    if(perm === null)
      perm = this.cdata.map((_, i) => i);
    // check permutation
    assert(Array.isArray(perm)
        && perm.length === this.numEdges
        && new Set(perm).size === this.numEdges,
      'Invalid permutation over edges');
    // create order related to this algorithm
    this.order = SNOrder.from(perm, state => {
      return this.getError(state);
    }, state => {
      return this.findConstraintError(state);
    });
  }

  orderByConstraint(){
    // order by blocks of constraints first, then individual errors last
    // XXX compute the order permutation
  }
  orderByError(){
    // order by block errors last, then individual errors last
    // XXX compute the order permutation
  }

  findConstraintError(state){
    const sn = state instanceof SNState ? state.sn : state;
    assert(Array.isArray(sn), 'Invalid argument');
    nodeLoop:
    // for(let i = 0; i < this.nodes.length; ++i){
    for(const node of this.nodes){
      // only consider nodes with constraints
      if(!node.hasConstraint())
        continue;
      // check that sum_{in a} ns[a] === sum_{out b} ns[b]
      let inSum = 0;
      for(const idx of node.inp){
        if(idx in sn)
          inSum += sn[idx];
        else
          continue nodeLoop; // partial answer => don't know
      }
      let outSum = 0;
      for(const idx of node.out){
        if(idx in sn)
          outSum += sn[idx];
        else
          continue nodeLoop;
      }
      if(inSum !== outSum){
        // constraint not satisfied
        return [node.inp, node.out];
      }
    }
    // valid if ns.length === N
    // valid to coverage otherwise
    return null; // no error found
  }

  checkConstraints(state){
    return !this.findConstraintError(state);
  }

  getErrorImpl(sn, size, order, {
    asArray = false, incremental = false, checkBounds = true
  }){
    // the penalty-based error from here
    let E  = 0;
    let Ec = 0;
    let Es = 0;
  
    // 1) Compute course accuracy penalty
    for(const i of order.indices(size)){
      const n = sn[i];

      // check bounds
      if(checkBounds && (n < this.snMin[i] || n > this.snMax[i]))
        return asArray ? [Infinity, NaN, NaN] : Infinity;

      // course accuracy error
      const Eci = loss(n - this.cdata[i]);
      Ec += Eci;
      E  += Eci * this.courseAccWeight;
    }
    // incremental: check if higher than best option
    // in which case we don't compute further
    if(incremental && E > this.snErr)
        return asArray ? [Infinity, NaN, NaN] : Infinity;
  
    // 2+3) Compute delta penalties (wale accuracy + simplicity)
    deltaLoop:
    for(let i = 0; i < this.numNodes; ++i){
      const node = this.nodes[i];
      if(!node.hasWaleTerm())
        continue; // no error contribution
      
      // green edge contributions
      let inpSum = 0;
      for(const idx of node.inp){
        if(idx in sn)
          inpSum += sn[idx];
        else
          continue deltaLoop;
      }
      let outSum = 0;
      for(const idx of node.out){
        if(idx in sn)
          outSum += sn[idx];
        else
          continue deltaLoop;
      }
  
      // global shaping constraint:
      //    outSum / this.wdata[i] <= inpSum <= outSum * this.wdata[i]
      // => inpSum - outSum
      if(this.globalShaping){
        const minInp = outSum * this.iwdata[i]; // ~ outSum / this.wdata[i]
        const maxInp = outSum * this.wdata[i];
        if(inpSum < minInp || inpSum > maxInp){
          // global constraint not valid
          return asArray ? [Infinity, NaN, NaN] : Infinity;
        }
      }
      /* old wale term:
      const Ewi = loss(Math.max(0, delta - this.wdata[i]));
      Ew += Ewi;
      E  += Ewi * this.waleAccWeight;
      */

      // difference between sides
      const delta = Math.abs(inpSum - outSum);
  
      // simplicity penalty
      const Esi = loss(delta);
      Es += Esi;
      E  += Esi * this.simplicityWeight;
    }
    // incremental: check if higher than best option
    // in which case we don't compute further
    if(incremental && E > this.snErr)
      return asArray ? [Infinity, NaN, NaN] : Infinity;
  
    return asArray ? [E, Ec, Es] : E;
  }

  getError(state, {
    order             = null,
    incremental       = false,
    asArray           = null,
    checkConstraints  = false,
    checkBounds       = true
  } = {}){

    if(asArray === null)
      asArray = incremental;
    if(order === null){
      if(state instanceof SNState)
        order = state.order;
      else
        order = this.order;
    }
    assert(order instanceof SNOrder, 'Invalid order argument');
    const [sn, size] = state instanceof SNState ?
      [state.sn, state.size]
    : [state, state.length];
    assert(Array.isArray(sn), 'Invalid stitch number argument');

    // Check validity
    if(checkConstraints && !this.checkConstraints(sn))
      return asArray ? [Infinity, NaN, NaN] : Infinity;
  
    // Get error
    return this.getErrorImpl(sn, size, order, {
      asArray, incremental, checkBounds
    });
  }

  *branchesOf(state, invert = true){

    // simplest possible inversion
    if(invert){
      // get all values in non-inverted mode
      const values = Array.from(this.branchesOf(state, false));
      values.reverse(); // revert list
      yield *values; // yield that list!
      return;
    }

    // index and pre-error
    const idx = state.nextIndex();
    const preErr = state.error;

    // else non-inverted logic
    const nStar = this.cdata[idx];
    const nMin = this.snMin[idx];
    const nMax = this.snMax[idx];
    const n0 = this.sn0[idx]; // Math.round(nStar);

    // yield initial value (if within bounds and below error)
    // XXX in practice, this should always be true
    if(nMin <= n0 && n0 <= nMax
    && preErr + loss(nStar - n0) * this.courseAccWeight < this.snErr)
      yield n0;

    // alternate around n0, within bounds and below max error
    let done = false;
    for(let i = 1; !done; ++i){
      // reset done status
      done = true; // = we need at least one ok (from + or -)
      // i goes up 1, 2, 3, 4, 5 ...
      // n goes around n0: n0+1, n0-1, n0+2, n0-2, ...
      plus: {
        const n = n0 + i;
        if(n <= nMax
        && preErr + loss(nStar - n) * this.courseAccWeight < this.snErr){
          yield n;
          done = false;
        }
      }
      minus: {
        const n = n0 - i;
        if(nMin <= n
        && preErr + loss(nStar - n) * this.courseAccWeight < this.snErr){
          yield n;
          done = false;
        }
      }
    }
  }

  iterate(
    batchIter = 1e3,
    batchTime = Math.min(1, this.timeBudget) * 1e3
  ){
    if(this.done())
      return true;

    while(this.states.length){
      // each batchIter iterations, check time
      if(++this.iter % batchIter === 0){
        const now = Date.now();
        if(now - this.last > batchTime){
          this.last = now;
          break;
        }
      }
  
      const state = this.states.pop();
      // check that the error is acceptable
      if(this.snErr <= state.error){
        continue; // branch became invalid (found better!)
  
      } else if(state.isComplete()){
        // remember state since better than previously found
        if(!Number.isFinite(this.snErr)){
          if(this.verbose)
            console.log('First solution | iter=' + this.iter);
          // XXX we should maybe ensure we do some more iterations
        }
        this.sn = state.sn;
        this.enforceUserConstraints();
        this.snErr = state.error;
        if(this.verbose)
          this.sols.push([state.sn, state.error]);
  
      } else {
        // check whether we can infer the next variable
        if(state.canInfer()){
          const nextState = state.inferNext();

          // /!\ if the infered variable is part of multiple constraints
          //     then the inference may be invalid (bad branch)
          // XXX if this happens, then we could backtrack from here
          //     by checking which group is invalid
          //   = also remove all wrong exploration branches from the stack
          // we just check that the error is lower
          // note: if constraints are not valid, then the error is Infinity
          if(nextState.error < this.snErr){
            this.exploreState(nextState);
          }
          // else it's an invalid branch
  
        } else {
          // explore sub-branches
          for(const n of this.branchesOf(state)){
            const nextState = state.nextState(n);
            if(nextState.error < this.snErr)
              this.exploreState(nextState);
          }
        } // endif canInfer
      } // endif
    } // endfor

    const done = this.done();
    if(done && !Number.isFinite(this.snErr)){
      assert.error('No solution found');
    }
    return done;
  }

  progress(){
    if(this.done())
      return 1.0;
    // not done => < 1.0
    return Math.min(1.0 - 1e-3, Math.max(0, 
      (Date.now() - this.start) / (this.timeBudget * 1e3)
    ));
  }

  done(){
    // we need at least a valid solution (<=> finite error)
    // as well as one branch and bound iteration (to log data)
    if(!Number.isFinite(this.snErr) || !this.iter)
      return false;
    // either we have seen everything, or we've tried long enough
    return !this.states.length
        || Date.now() - this.start > this.timeBudget * 1e3;
  }

  debug(problemName = 'G'){
    console.log(
      problemName + ' solved, iters=' + this.iter
      + ' | E=' + this.snErr
      + ' | |stack|=' + this.states.length
      + ' | #sols=' + this.sols.length
    );
    const bestState = this.order.newState(
      this.sn,
      this.sn.length,
      this.snErr
    );
    const [, Ec, Es] = this.getError(bestState, { asArray: true });
    console.log(
      'Error: Ec=' + Ec + ', Es=' + Es
    );
    console.log(this.sn);
    // evolution of solutions
    console.log(this.sols);
  }

  solved(){
    return Number.isFinite(this.snErr);
  }
}

module.exports = Object.assign(SNBranchAndBound, {
  // classes
  SNNode, SNState, SNOrder,
  // resolution promise
  resolve: function(){
    if(gs instanceof Promise)
      return gs;
    else
      return Promise.resolve();
  }
});