// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const PackedArray = require('../../ds/packedarray.js');
const StitchSampler = require('../stitch/stitchsampler.js');
const YarnStack = require('../../yarnstack.js');
const { U8, U16, U32 } = PackedArray;

// constants
// - trace fields
const STITCH_INDEX  = 'sidx';
const TRACE_FLAGS   = 'flags';
const TRACE_YARN    = 'tyarn';
const TRACE_PREV    = 'tprev';
const TRACE_NEXT    = 'tnext';
const SHAPING_DATA  = 'shape';
const LAYER_DATA    = 'layer';
const STITCH_PROG   = 'prog';
const STITCH_TYPE   = 'type';
const STITCH_FYARNS = 'fyarns';
const STITCH_BYARNS = 'byarns';
// - index fields
const TRACED_STITCH_0 = 'ts0';
const TRACED_STITCH_1 = 'ts1';
// - tuck flags
const TUCK_NEXT = 0x0001;
const TUCK_PREV = 0x0002;
const TUCK_MASK = TUCK_NEXT | TUCK_PREV;
// - orientation
const CW        = -1;
const CCW       = 1;
const DEFAULT   = 0x0000;
const INVERSE   = 0x0004;
const ORIENTATION_MASK = INVERSE;
// note: 0x08 available
// - pass flag
const TWICE     = 0x0008;
const PASS_MASK = TWICE;
const PASS_SHIFT = 3;
// - start/end flags
const START     = 0x0010;
const END       = 0x0020;
// - shaping flags
const SHAPE_LINK_MASK = 0x80;
const SHAPE_TYPE_MASK = ~SHAPE_LINK_MASK;
// - layer flags
const TWOSIDED = 0x01;

class Trace {
  constructor(sampler){
    this.array = new PackedArray([
      [STITCH_INDEX,  U32],
      [TRACE_FLAGS,   U16],
      [TRACE_PREV,    U16],
      [TRACE_NEXT,    U16],
      [TRACE_YARN,    U8],
      [SHAPING_DATA,  U8],
      [LAYER_DATA,    U8],
      [STITCH_TYPE,   U8],
      [STITCH_FYARNS, U16],
      [STITCH_BYARNS, U32],
      [STITCH_PROG,   U32]
    ]);
    this.index = new PackedArray([
      [TRACED_STITCH_0, U32],
      [TRACED_STITCH_1, U32]
    ]);
    this.sampler = sampler;
    this.regions = 0;
    assert(sampler,
      'A trace must be associated with a stitch sampler');
  }

  static empty(){ return new Trace(new StitchSampler([])); }

  get sketches(){ return this.sampler.sketches; }
  get courseDist(){ return this.sampler.courseDist; }
  get waleDist(){ return this.sampler.waleDist * 0.5; }
  get sketchScale(){ return this.sampler.sketchScale; }
  get length(){ return this.array.length; }

  allocate(numExpActions){
    this.array.allocate(numExpActions);
    // allocate sampler reverse index
    // stitch index => traced stitch indices
    this.index.allocate(this.sampler.length);
    this.index.length = this.sampler.length; // use all allocated space
  }

  addEntry(stitch, yarn, flags = 0){
    // update region count if starting a new path
    if(flags & START)
      this.regions += 1;
    this.array.push({
      [STITCH_INDEX]:   stitch.index,
      [TRACE_FLAGS]:    flags,
      [TRACE_YARN]:     yarn,
      [SHAPING_DATA]:   0,  // default = knit, link 0
      [LAYER_DATA]:     0,  // default = no layer data
      [STITCH_PROG]:    0,  // default = knit program
      [STITCH_TYPE]:    0,  // default = knit
      [STITCH_FYARNS]:  1 << (yarn - 1), // default = trace yarn
      [STITCH_BYARNS]:  0  // default = no back yarn
    });
    const tidx = this.array.length - 1;
    // store traced stitch index
    const which = flags & TWICE ? TRACED_STITCH_1 : TRACED_STITCH_0;
    this.index.set(stitch.index, which, tidx + 1);
    // return the traced stitch index
    return tidx;
  }

  getFlags(index, extract = false){
    const flags = this.array.get(index, TRACE_FLAGS);
    if(!extract)
      return flags;
    // extract individual flags
    return {
      flags,
      tuckPrev: flags & TUCK_PREV,
      tuckNext: flags & TUCK_NEXT,
      tuck:     flags & TUCK_MASK,
      dir:      flags & INVERSE ? CW : CCW,
      pass:    (flags & PASS_MASK) >> PASS_SHIFT,
      start:    flags & START,
      end:      flags & END
    };
  }
  getEntry(index){
    const stitch = this.getStitch(index);
    return Object.assign(this.getFlags(index, true), {
      stitch, index
    });
  }
  hasFlags(index, flag, exact = false){
    if(exact)
      return (this.getFlags(index) & flag) === flag;
    else
      return (this.getFlags(index) & flag) !== 0;
  }

  // trace yarn
  getTraceYarn(index){ return this.array.get(index, TRACE_YARN); }
  lastTraceYarn(){ return this.getTraceYarn(this.length - 1); }

  // trace prev/next
  getTracePrevData(index){ return this.array.get(index, TRACE_PREV); }
  getTracePrevIndex(index){
    return index - (this.getTracePrevData(index) || 1);
  }
  setTracePrevIndex(index, prevIdx){
    assert(prevIdx < index, 'Previous index is not smaller than index',
      prevIdx, index);
    const delta = index - prevIdx; // positive delta => u16
    this.array.set(index, TRACE_PREV, delta);
  }
  getTraceNextData(index){ return this.array.get(index, TRACE_NEXT); }
  getTraceNextIndex(index){
    return index + (this.getTraceNextData(index) || 1);
  }
  setTraceNextIndex(index, nextIdx){
    assert(index < nextIdx, 'Next index is not greater than index',
      nextIdx, index);
    const delta = nextIdx - index; // positive delta => u16
    this.array.set(index, TRACE_NEXT, delta);
  }

  // shaping data
  getShapingBits(index){
    return this.array.get(index, SHAPING_DATA);
  }
  getShapingData(index){
    const bits = this.getShapingBits(index);
    // extract data
    return [
      bits & SHAPE_TYPE_MASK,           // shaping action
      (bits & SHAPE_LINK_MASK) ? 1 : 0  // shaping link
    ];
  }
  setShapingData(index, shapeData){
    if(typeof shapeData === 'number')
      this.array.set(index, SHAPING_DATA, shapeData);
    else {
      assert(Array.isArray(shapeData) && shapeData.length === 2,
        'Shape data must be an array with two entries',
        shapeData);
      this.array.set(index, SHAPING_DATA,
        shapeData[0] | (shapeData[1] ? SHAPE_LINK_MASK : 0)
      );
    }
  }
  setShapingAction(index, shapeAct){
    assert(typeof shapeAct === 'number',
      'Invalid shaping action', shapeAct);
    const shapeLink = this.getShapingBits(index) & SHAPE_LINK_MASK;
    this.setShapingData(index, (shapeAct & SHAPE_TYPE_MASK) | shapeLink);
  }
  setShapingLink(index, shapeLink){
    assert([0, 1, SHAPE_LINK_MASK].includes(shapeLink),
      'Shape link must be a number', shapeLink);
    const shapeAct = this.getShapingBits(index) & SHAPE_TYPE_MASK;
    const linkMask = shapeLink ? SHAPE_LINK_MASK : 0;
    this.setShapingData(index, shapeAct | linkMask);
  }

  // layer data
  getLayerData(index){
    return this.array.get(index, LAYER_DATA);
  }
  setLayerData(index, data){
    this.array.set(index, LAYER_DATA, data);
  }

  // program, stitch and yarn data
  getProgram(index){
    return this.array.get(index, STITCH_PROG);
  }
  setProgram(index, progIdx){
    this.array.set(index, STITCH_PROG, progIdx);
  }
  getStitchType(index){
    return this.array.get(index, STITCH_TYPE);
  }
  setStitchType(index, sType){
    this.array.set(index, STITCH_TYPE, sType);
  }
  getFrontYarnBits(index){
    return this.array.get(index, STITCH_FYARNS);
  }
  getBackYarnBits(index){
    return this.array.get(index, STITCH_BYARNS);
  }
  getYarnStack(index, asRef = true){
    const fyarns = this.getFrontYarnBits(index);
    const byarns = this.getBackYarnBits(index);
    return YarnStack.fromBits(fyarns, byarns, asRef ? ys => {
      this.array.set(index, STITCH_FYARNS, ys.fyarns);
      this.array.set(index, STITCH_BYARNS, ys.byarns);
    } : null);
  }
  getFrontYarns(index){
    const bits = this.getFrontYarnBits(index);
    return YarnStack.asFYarnList(bits);
  }
  getBackYarns(index){
    const bits = this.getBackYarnBits(index);
    return YarnStack.asBYarnList(bits);
  }
  getYarns(index){ return this.getYarnStack(index, false).yarns; }
  hasBackYarn(index){ return this.getBackYarnBits(index) !== 0; }
  hasDefaultYarn(index){
    const defYarn = this.getTraceYarn(index);
    return this.getFrontYarnBits(index) === (1 << (defYarn-1))
        && this.getBackYarnBits(index) === 0;
  }
  setDefaultYarn(index){
    const defYarn = this.getTraceYarn(index);
    this.array.set(index, STITCH_FYARNS, (1 << (defYarn-1)));
    this.clearBackYarns(index);
  }
  clearBackYarns(index){
    this.array.set(index, STITCH_BYARNS, 0);
  }

  hasInverseOrientation(index){ return this.hasFlags(index, INVERSE); }
  getOrientation(index){ return this.hasInverseOrientation(index) ? CW : CCW; }
  getPass(index){ return (this.getFlags(index) & PASS_MASK) >> PASS_SHIFT; }
  isStart(index){ return !!this.hasFlags(index, START); }
  isEnd(index){ return !!this.hasFlags(index, END); }
  hasPrevTuck(index){ return !!this.hasFlags(index, TUCK_PREV); }
  hasNextTuck(index){ return !!this.hasFlags(index, TUCK_NEXT); }
  getStitchIndex(index){ return this.array.get(index, STITCH_INDEX); }
  getStitch(index){
    const stitchIdx = this.getStitchIndex(index);
    return this.sampler.getStitch(stitchIdx);
  }
  getTracedStitch(stitchIdx, pass, traceIndex = -1){
    assert(typeof stitchIdx === 'number' && [0, 1].includes(pass)
        && typeof traceIndex === 'number',
      'Invalid argument(s)', stitchIdx, pass);
    return new TracedStitch(this, stitchIdx, pass, traceIndex);
  }
  getTracedStitchAt(index){
    return this.getTracedStitch(
      this.getStitchIndex(index),
      this.getPass(index),
      index
    );
  }
  getTracedStitchIndex(stitchIndex, pass){
    return this.index.get(stitchIndex, pass ? TRACED_STITCH_1 : TRACED_STITCH_0) - 1;
  }
  getTraceCount(stitch){
    let count = 0;
    for(const pass of [0, 1]){
      if(this.getTracedStitchIndex(stitch.index, pass) > -1){
        assert(count === pass, 'Passes out of order', count, pass, stitch);
        ++count;
      }
    }
    return count;
  }
  appendFlags(newFlags, index = this.array.length - 1){
    assert(!(newFlags & PASS_MASK),
      'Pass flags cannot be appended, they must be specified during entry creation');
    assert(0 <= index,
      'Cannot add a flag a posteriori without adding an action first');
    assert(index < this.array.length,
      'Appending flags out-of-bounds', index);
    const flags = this.getFlags(index);
    this.array.set(index, TRACE_FLAGS, flags | newFlags);
  }
  setOrientation(index, orient){
    const flags = this.getFlags(index);
    const noOri = flags & (~ORIENTATION_MASK);
    const newOri = orient === CCW ? DEFAULT : INVERSE;
    this.array.set(index, TRACE_FLAGS, noOri | newOri);
  }
  flipOrientation(index){
    const orient = this.getOrientation(index);
    this.setOrientation(index, -orient);
    return -orient;
  }

  getYarnRange(index = -1){
    if(index < 0)
      index = this.length + index;
    const start = this.findLast(({ start }) => start, { index: -1 }, index).index;
    const end = this.find(({ end }) => end, { index: this.length - 1 }, index).index;
    assert((start !== -1 && end !== -1) || (start === -1 && end === -1), 'Invalid start/end pair');
    return [ start, end ];
  }
  find(predicate, defaultResult = null, startFrom = 0){
    for(let index = startFrom; index < this.length; ++index){
      const entry = this.getEntry(index);
      if(predicate(entry))
        return entry;
    }
    // did not find anything
    // => return default result
    return defaultResult;
  }
  findLast(predicate, defaultResult = null, startFrom = -1){
    if(startFrom < 0)
      startFrom += this.length;
    for(let index = startFrom; index >= 0; --index){
      const entry = this.getEntry(index);
      if(predicate(entry))
        return entry;
    }
    // did not find anything
    // => return default result
    return defaultResult;
  }
  findPrev(predicate, defaultResult = null){
    return this.findLast(predicate, defaultResult, -2);
  }

  getBuffers(){
    return this.array.getBuffers();
  }

  toData(minimal){
    return {
      array: minimal ? this.array.toData(true) : this.array,
      index: this.index, // always send as a whole
      regions: this.regions
    };
  }
  loadData(data){
    assert('array' in data && 'index' in data && 'regions' in data,
      'Invalid data, missing fields', data);
    this.array = PackedArray.fromData(data.array);
    this.index = PackedArray.fromData(data.index);
    this.regions = data.regions;
    return this;
  }

  *stitches(){
    for(let i = 0; i < this.length; ++i)
      yield this.getTracedStitchAt(i);
  }
  first(){ return this.getTracedStitchAt(0); }
  last(){ return this.getTracedStitchAt(this.length - 1); }
  lastStitch(){ return this.getStitch(this.length - 1); }

  // generic getter
  get(...args){
    return this.array.get(...args);
  }
}

class TracedStitch {
  constructor(trace, samplerIndex, pass, traceIdx = -1){
    this.trace  = trace;
    if(traceIdx === -1)
      this.index = trace.getTracedStitchIndex(samplerIndex, pass);
    else
      this.index = traceIdx;
    this.pass   = pass;
    this.stitch = trace.sampler.getStitch(samplerIndex);
  }

  get sampler(){ return this.trace.sampler; }
  get sketches(){ return this.trace.sketches; }
  matches(ts){ return !!ts && ts.index === this.index; }

  // properties
  getOrientation(){ return this.trace.getOrientation(this.index); }
  isCW(){           return this.getOrientation() === CW; }
  isCCW(){          return this.getOrientation() === CCW; }
  isStart(){        return this.trace.isStart(this.index); }
  isEnd(){          return this.trace.isEnd(this.index); }
  isLocalStart(){   return this.trace.getTracePrevData(this.index) > 1; }
  isLocalEnd(){     return this.trace.getTraceNextData(this.index) > 1; }
  isLocalRestart(){ return this.trace.getTracePrevData(this.index) === 1; }
  isLocalPause(){   return this.trace.getTraceNextData(this.index) === 1; }
  hasPrevTuck(){    return this.trace.hasPrevTuck(this.index); }
  hasNextTuck(){    return this.trace.hasNextTuck(this.index); }
  getGroupData(){   return this.stitch.getGroupData(); }
  getRegionID(){    return this.stitch.getRegionID(); }
  onShortRow(){     return this.stitch.isShortRow(); }
  isShortRow(){     return this.stitch.isShortRow(); }
  getCourseIndex(){ return this.stitch.getCourseIndex(); }
  getLowerCourseIndex(){ return this.stitch.getLowerCourseIndex(); }
  getUpperCourseIndex(){ return this.stitch.getUpperCourseIndex(); }
  getStitchGroup(){
    return Array.from(this.stitch.stitchGroup(), s => {
      return new TracedStitch(this.trace, s.index, this.pass);
    });
  }
  getStitchGroupSize(){ return this.stitch.getStitchGroupSize(); }
  isCourseConnectedTo(that){
    return this.stitch.isCourseConnectedTo(that.stitch);
  }

  // graph neighborhood
  getPrev(){
    if(this.isStart())
      return null;
    const prevIdx = this.trace.getTracePrevIndex(this.index);
    return this.trace.getTracedStitchAt(prevIdx);
  }
  getNext(){
    if(this.isEnd())
      return null;
    const nextIdx = this.trace.getTraceNextIndex(this.index);
    return this.trace.getTracedStitchAt(nextIdx);
  }
  atPass(pass){ return new TracedStitch(this.trace, this.stitch.index, pass); }
  getNextWales(){
    if(this.pass){
      return this.stitch.getNextWales().map(nws => {
        return new TracedStitch(this.trace, nws.index, 0);
      });
    } else {
      return [ this.atPass(1) ];
    }
  }
  getPrevWales(){
    if(this.pass){
      return [ this.atPass(0) ];
    } else {
      return this.stitch.getPrevWales().map(pws => {
        return new TracedStitch(this.trace, pws.index, 1);
      });
    }
  }
  *graphNeighbors(){
    const pcs = this.stitch.getPrevCourse();
    if(pcs)
      yield new TracedStitch(this.trace, pcs.index, this.pass);
    const ncs = this.stitch.getNextCourse();
    if(ncs)
      yield new TracedStitch(this.trace, ncs.index, this.pass);
    // wales
    yield *this.getPrevWales();
    yield *this.getNextWales();
  }
  *traceNeighbors(){
    const ps = this.getPrevCourse();
    if(ps)
      yield ps;
    const ns = this.getNextCourse();
    if(ns)
      yield ns;
    yield *this.getPrevWales();
    yield *this.getNextWales();
  }
  *neighbors(inGraph = true){
    if(inGraph)
      yield *this.graphNeighbors();
    else
      yield *this.traceNeighbors();
  }
  getLowerCourseStitch(){
    if(this.isShortRow()){
      const s = this.stitch.getLowerCourseStitch();
      return new TracedStitch(this.trace, s.index, 1);
    } else
      return this;
  }
  getUpperCourseStitch(){
    if(this.isShortRow()){
      const s = this.stitch.getUpperCourseStitch();
      return new TracedStitch(this.trace, s.index, 0);
    } else
      return this;
  }

  // countings
  countNextWales(){
    if(this.pass)
      return this.stitch.countNextWales();
    else
      return 1;
  }
  countPrevWales(){
    if(this.pass)
      return 1;
    else
      return this.stitch.countPrevWales();
  }

  // semantic properties
  fromDecrease(){
    return this.pass === 0 && this.stitch.countPrevWales() > 1;
  }
  toIncrease(){
    return this.pass > 0 && this.stitch.countNextWales() > 1;
  }
  isDecreasing(){
    if(this.pass === 0)
      return false; // decreasing happens from pass=1 to pass=0
    const nwss = this.getNextWales();
    if(nwss.length !== 1)
      return false; // decreasing is (2-1) pairing => single next wale
    return nwss[0].fromDecrease(); // has two previous wales
  }
  needsCastOn(){
    // XXX should be taking Terminal stitches into account
    //   = closed cast-on
    return !this.pass && this.stitch.countPrevWales() === 0;
  }
  needsCastOff(){
    return this.pass > 0 && this.stitch.countNextWales() === 0;
    /*
    if(this.stitch.countNextWales() === 0){
      if(this.pass > 0)
        return true;
      // beware of very special edge cases where stitch needs cast-off on next step on itself
      // => we can actually cast-off already now
      const ns = this.getNext();
      assert(ns, 'Yarn should not end on the first pass of anything');
      return !!ns && ns.isEnd();
    }
    return false; // next wale => not yet casting off
    */
  }
  isSingularCastOff(){
    // special singular cast-off case
    return this.stitch.countNextWales() === 0
        && this.pass === 0
        && this.getNext()
        && this.getNext().isEnd();
  }

  // interpolated
  // XXX this is wrong!!!
  getPosition(){
    const p0 = this.stitch.getPosition();
    const nps = this.pass > 0 ? this.stitch.getNextWales().map(nws => {
      return nws.getPosition();
    }) : [];
    switch(nps.length){
      case 0: return p0;
      case 1:
        return {
          x: (p0.x + nps[0].x) * 0.5,
          y: (p0.y + nps[0].y) * 0.5
        };

      case 2:
      default:
        return {
          x: (p0.x * 2 + nps[0].x + nps[1].x) * 0.25,
          y: (p0.y * 2 + nps[0].y + nps[1].y) * 0.25
        };
    }
  }
  getLayerIndex(){ return this.stitch.getLayerIndex(); }
  getTraceYarn(){ return this.trace.getTraceYarn(this.index); }

  // stitch shaping action and links
  getPairedStitch(){
    const pwss = this.getPrevWales();
    if(pwss.length !== 1)
      return null; // cannot have a paired stitch
    const pws = pwss[0];
    // return the other next wale stitch (if any)
    return pws.getNextWales().find(nws => !nws.matches(this));
  }
  getTargetWale(){
    const nwss = this.getNextWales();
    if(nwss.length !== 2)
      return nwss[0];
    // get link number
    const [, linkNum] = this.trace.getShapingData(this.index);
    return nwss[linkNum];
  }
  setTargetWale(tws){
    const nwss = this.getNextWales();
    const linkIdx = nwss.findIndex(ts => ts.matches(tws));
    assert([0, 1].includes(linkIdx), 'Invalid target wale', tws, linkIdx);
    this.trace.setShapingLink(this.index, linkIdx);
  }
  setShapingAction(action){
    this.trace.setShapingAction(this.index, action);
  }
  getShapingAction(){
    const [action] = this.trace.getShapingData(this.index);
    return action;
  }
  isShaping(){ return this.getShapingAction() > 0; }

  // layer data
  isTwoSided(){
    const ld = this.trace.getLayerData(this.index);
    return (ld & TWOSIDED) === TWOSIDED;
  }
  setTwoSided(flag = true){
    const ld = this.trace.getLayerData(this.index);
    if(flag){
      this.trace.setLayerData(this.index, ld | TWOSIDED);
    } else {
      this.trace.setLayerData(this.index, ld & (~TWOSIDED));
    }
  }

  // stitch program, type and yarns
  getProgram(){ return this.trace.getProgram(this.index); }
  setProgram(progIdx = 0, unsafe = false){
    // only apply program if in unsafe mode, or not shaping (i.e. safe)
    if(unsafe || !this.isShaping())
      this.trace.setProgram(this.index, progIdx);
    return this;
  }
  clearProgram(){ return this.setProgram(0, true); }
  getStitchType(){ return this.trace.getStitchType(this.index); }
  setStitchType(type = 0){
    this.trace.setStitchType(this.index, type);
    return this;
  }
  getYarnStack(asRef = true){
    return this.trace.getYarnStack(this.index, asRef);
  }
  getFrontYarns(){ return this.trace.getFrontYarns(this.index); }
  getBackYarns(){ return this.trace.getBackYarns(this.index); }
  getYarns(){ return this.trace.getYarns(this.index); }
  countYarns(){ return this.getYarns().size; }
  hasBackYarn(){ return this.trace.hasBackYarn(this.index); }
  hasDefaultYarn(){ return this.trace.hasDefaultYarn(this.index); }
  setDefaultYarn(){ this.trace.setDefaultYarn(this.index); return this; }
  clearBackYarns(){ this.trace.clearBackYarns(this.index); return this; }
}

module.exports = Object.assign(Trace, {
  STITCH_INDEX, TRACE_FLAGS, STITCH_PROG,
  STITCH_TYPE, STITCH_FYARNS, STITCH_BYARNS,
  TRACED_STITCH_0, TRACED_STITCH_1,
  TUCK_NEXT, TUCK_PREV, TUCK_MASK,
  CW, CCW, DEFAULT, INVERSE, ORIENTATION_MASK,
  TWICE, PASS_MASK, PASS_SHIFT,
  START, END
});
