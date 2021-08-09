// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const Action = require('./action.js');
const { NORMAL_STITCH, HALF_GAUGE_STITCH } = require('../../knitout.js');

/** @typedef {KnittingProgram|ProgramFragment} ProgramParent */

// constants
// - general types
const EVENT_PASS      = 'event';
const TRANSFER_PASS   = 'transfer';
const ACTION_PASS     = 'action';
const CASTON_PASS     = 'caston';
const CASTOFF_PASS    = 'castoff';
const YARNSTART_PASS  = 'yarnstart';
const YARNEND_PASS    = 'yarnend';
// - specific subtypes
const SHAPING_PASS    = 'shaping';
const ALIGNMENT_PASS  = 'alignment';

/**
 * Abstract knitting program fragment
 * 
 * @property {string} type the fragment type
 * @property {boolean} labelCode whether the output should be labeled
 * @property {ProgramParent?} parent the parent context
 * @property {ProgramFragment?} prev the previous fragment
 * @property {ProgramFragment?} next the next fragment
 * @property {Knitout} output the knitout output stream
 * @property {number} firstPtr the first instruction pointer
 * @property {number} lastPtr the last instruction pointer
 */
class ProgramFragment {
  constructor(parent, type = 'fragment'){
    // labeling
    this.type   = type;
    // global information
    this.halfGauge = false;
    // fragment context
    this.parent = parent;
    this.prev   = null;
    this.next   = null;
    // output stream and index range
    this.output   = null;
    this.firstPtr = 0;
    this.lastPtr  = this.firstPtr - 1;
  }

  program(){
    if(this.parent instanceof ProgramFragment)
      return this.parent.program();
    else
      return this.parent;
  }

  get stitchNumber(){
    return this.halfGauge ? HALF_GAUGE_STITCH : NORMAL_STITCH;
  }

  /**
   * Generates the knitout output
   * while storing the instruction range.
   * 
   * @param {Knitout} output the knitout output
   * @param {KnittingMachineState} state the current machine state
   * @param {boolean} verbose whether to use verbose output
   * @final
   */
  build(output, state, verbose = true){
    // should not have pending sliders across passes
    assert(!state.hasPendingSliders(),
      'Pending sliders at the start of a knitting pass');

    // pre-code wrapping of output
    this.output = output;
    this.firstPtr = output.length;

    // set pass-specific stitch number
    if(state.stitchNumber !== this.stitchNumber
    && this.stitchNumber >= 0){
      output.xStitchNumber(this.stitchNumber);
      output.flush();
    }

    // actual code generation (through implementation)
    this.generate(output, state, verbose);
    output.flush(); // make sure entries have been processed
    
    // final post-code wrapping
    this.lastPtr = output.length - 1;
    if(this.size() > 0
    && !output.hasComment(this.firstPtr))
      output.setComment(this.firstPtr, this.type);
  }

  generate(/* k, state, verbose */){
    assert.error('Program fragment is not implemented yet');
  }

  instruction(localIdx, within = true){
    if(localIdx < this.firstPtr
    || localIdx > this.lastPtr)
      assert(within, 'Out-of-bound instruction load');
    return this.output.getEntry(this.start + localIdx);
  }

  *instructions(){
    for(let iptr = this.first; iptr <= this.last; ++iptr)
      yield this.getEntry(iptr);
  }

  isEmpty(){ return this.lastPtr < this.firstPtr; }
  size(){ return this.lastPtr - this.firstPtr + 1; }
  hasPrev(){ return !!this.prev; }
  hasNext(){ return !!this.next; }
  isConnected(){ return this.hasPrev() || this.hasNext(); }

  insertNext(fragment, fireEvent = true){
    assert(!fragment.isConnected(), 'Fragment is already connected');
    // set fragment parent
    if(this.parent)
      fragment.parent = this.parent;
    // connect fragment with potential next fragment
    if(this.next){
      this.next.prev = fragment;
      fragment.next = this.next;
    }
    // connect with fragment
    this.next = fragment;
    fragment.prev = this;
    // fire necessary event
    if(fireEvent)
      this.program().fireFragmentEvent(fragment);
  }
  insertPrev(fragment, fireEvent = true){
    assert(!fragment.isConnected(), 'Fragment is already connected');
    // set fragment parent
    if(this.parent)
      fragment.parent = this.parent;
    // connect fragment with potential previous fragment
    if(this.prev){
      this.prev.next = fragment;
      fragment.prev = this.prev;
    }
    // connect with fragment
    this.prev = fragment;
    fragment.next = this;
    // fire necessary event
    if(fireEvent)
      this.program().fireFragmentEvent(fragment);
  }

  /**
   * Creates an instance of this fragment from a step block
   * 
   * @param {YarnStepBlock} block an active block of yarn
   * @param {...any} args additional arguments
   * @return {FragmentProgram} the new fragment
   */
  static fromBlock(block, ...args){
    const step = block.step;
    assert(step, 'Block is not an active step block');
    // slice-level
    const stitches  = block.stitches;
    const needles   = block.getNeedles();
    // active level
    const index     = block.getActiveIndex();
    const dirs      = block.getDirections();
    // /!\ the static `this` refers to the constructor of the class
    // and class extension gets automatically the correct constructor
    return new this({
      step, stitches, needles,
      index, dirs,
    }, ...args);
  }
}

/**
 * Action entry exposing properties of individual actions
 * 
 * @property {+1|-1} orientation the pass' orientation
 * @property {TracedStitch} stitch the underlying traced stitch
 * @property {Needle} needle the target needle
 * @property {+1|-1} dir the target's direction
 * @property {Action} action the underlying action unit
 */
class ActionEntry {
  constructor(pass, index){
    this.pass   = pass;
    this.actIdx = index;
    this.sliIdx = pass.actIndex[index];
    assert(0 <= index && index < pass.actIndex.length,
      'Activity index is out-of-bounds', index);
  }
  // getters
  get orientation(){ return this.pass.step.orientation; }
  get stitch(){ return this.pass.stitches[this.sliIdx]; }
  get action(){ return Action.from(this.stitch); }
  get needle(){ return this.pass.needles[this.sliIdx]; }
  get needles(){
    if(this.stitch.isShaping()){
      const pts = this.stitch.getPairedStitch();
      return [ this.needle, this.pass.needleOf(pts) ];
    } else
      return [ this.needle ];
  }
  get dir(){ return this.pass.dirs[this.actIdx]; }
  get carriers(){
    return this.stitch.getFrontYarns().map(i => i.toString());
  }
  get yarns(){
    return Array.from(this.stitch.getYarns(), i => i.toString());
  }
  get nextIdx(){ return this.stepIndex(1); }
  get prevIdx(){ return this.stepIndex(-1); }
  get nextStitch(){ return this.pass.stitches[this.nextIdx]; }
  get prevStitch(){ return this.pass.stitches[this.prevIdx]; }
  get nextNeedle(){ return this.pass.needles[this.nextIdx]; }
  get prevNeedle(){ return this.pass.needles[this.prevIdx]; }
  stepIndex(n){
    if(this.pass.isCircular()){
      return (
        this.sliIdx + this.orientation * n + this.pass.stitches.length
      ) % this.pass.stitches.length;
    } else
      return this.sliIdx + this.orientation * n;
  }
  stepNeedle(n){ return this.pass.needles[this.stepIndex(n)]; }

  // neighborhood
  hasNext(n = 1){ return this.actIdx < this.pass.actIndex.length - n; }
  hasPrev(n = 1){ return this.actIdx > n - 1; }
  next(n = 1){
    if(this.hasNext(n))
      return new ActionEntry(this.pass, this.actIdx + n);
    else
      return null;
  }
  prev(n = 1){
    if(this.hasPrev(n))
      return new ActionEntry(this.pass, this.actIdx - n);
    else
      return null;
  }

  // action computations
  knit(k, backward = false){
    k.knit(
      backward ? -this.dir : this.dir,
      this.needle,
      this.carriers
    );
  }
  kickback(k, backward = false){ this.knit(k, !backward); }
  tuck(k, backward = false){
    k.tuck(
      backward ? -this.dir : this.dir,
      this.needle,
      this.carriers
    );
  }
  miss(k, backward = false){
    k.miss(
      backward ? -this.dir : this.dir,
      this.needle,
      this.carriers
    );
  }
}

/**
 * A basic active pass that exposes the actions and slice information
 * 
 * Slice-wise, cardinality S:
 * - stitches[S]
 * - needles[S]
 * 
 * Action-wise, cardinality N:
 * - dirs[N]
 * - 
 */
class ActivePass extends ProgramFragment {
  constructor({
    parent,
    step, stitches, needles,
    index, dirs,
    verbose = false
  }, type){
    super(parent, type);
    // action context
    this.step = step;
    // slice level data
    this.stitches = stitches;
    this.needles  = needles;
    // active level
    this.actIndex = index;
    this.dirs     = dirs;
    // parameter
    this.verbose = verbose;
  }

  get numEntries(){ return this.actIndex.length; }
  get firstEntry(){ return this.entry(0); }
  get lastEntry(){ return this.entry(this.numEntries - 1); }
  isCircular(){ return this.step.slice.circular; }
  *entries(){
    for(let i = 0, n = this.numEntries; i < n; ++i)
      yield new ActionEntry(this, i);
  }
  entry(i){ return new ActionEntry(this, i); }
  needle(i){ return this.needles[this.actIndex[i]]; }
  get carriers(){ return this.firstEntry.carriers; }
  get yarns(){ return this.firstEntry.yarns; }

  stitchIndexOf(ts){
    return this.stitches.findIndex(s => s.matches(ts));
  }
  needleOf(ts, isActive = true){
    const idx = this.stitchIndexOf(ts);
    assert(idx !== -1 || !isActive,
      'Stitch is not active within this pass');
    return this.needles[idx];
  }
  findNeedleOf(ts, state){
    const an = this.needleOf(ts, false);
    if(an)
      return an;
    // else, search a past stitch within this bed
    const needles = Array.from(state.filterLoopNeedles(loop => {
      const s = loop.data;
      if(!s)
        return false;
      // keep if it has a next wale that matches our next stitch
      return s.getNextWales().some(nws => nws.matches(ts));
    }));
    // XXX what if there are two (from split)?
    return needles[0];
  }
}

module.exports = Object.assign(ProgramFragment, {
  // classes
  ActivePass,
  ActionEntry,
  // constants
  EVENT_PASS,
  TRANSFER_PASS,
  ACTION_PASS,
  CASTON_PASS,
  CASTOFF_PASS,
  YARNSTART_PASS,
  YARNEND_PASS,
  SHAPING_PASS,
  ALIGNMENT_PASS
});