// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { CW, CCW } = require('../trace/trace.js');

// constants
// - states
const EXPECTED  = 0;
const ACTIVE    = 1;
const SUSPENDED = 2;

class TraceSlice {
  /**
   * Create a new trace slice
   * 
   * @param {array} stitches CCW sequence of traced stitches
   * @param {array} stateEntries list of state entries
   * @param {boolean} [circular] whether the slice is that of a circular course
   * @param {boolean} [fresh=false] whether the slice may need normalization
   */
  constructor(
    stitches,
    stateEntries,
    circular = TraceSlice.isCircular(stitches),
    fresh = false
  ){
    assert(stitches && stitches.length, 'An empty slice');
    this.stitches = stitches;
    this.circular = circular;
    this.stateMap = new Map(stateEntries);
    assert(this.stateMap.size === stitches.length,
      'Some stitches or states are duplicates');
    assert(this.stitches.every(ts => this.stateMap.has(ts.index)),
      'Some stitch is missing state information');
    // check we do not have pass-different stitch duplicates
    for(const ts of stitches){
      // - if the stitch has one previous wale, it should NOT be in the slice
      // - if the stitch has two previous wales, at least one of them should
      //   not be in the slice anymore (but one could = async decrease) 
      assert(ts.needsCastOn()
          || !ts.getPrevWales().every(pts => this.hasTracedStitch(pts)),
        'Stitch in slice with all its previous wale(s)');
    }
    // active trace pointers
    this.firstIndex = -1;
    this.lastIndex  = -1;
    this.dir        = CCW;
    this.fresh      = fresh;
    // active trace range
    this.traceStart = -1;
    this.traceEnd   = -1;
  }

  get activeCount(){
    if(this.firstIndex !== -1)
      return this.traceEnd - this.traceStart + 1;
    else 
      return 0;
  }
  get stitchCount(){  return this.stitches.length; }
  get first(){  return this.stitches[this.firstIndex]; }
  get last(){   return this.stitches[this.lastIndex]; }
  get trace(){  return this.stitches[0].trace; }
  get orientation(){ return this.dir; }

  isCCW(){ return this.dir === CCW; }
  hasTracedStitch(ts){ return this.stateMap.has(ts.index); }
  isActive(ts){   return this.stateMap.get(ts.index) === ACTIVE; }
  isExpected(ts){ return this.stateMap.get(ts.index) === EXPECTED; }
  isSuspended(ts){ return this.stateMap.get(ts.index) === SUSPENDED; }
  areAdjacent(idx1, idx2){
    const N = this.stitchCount;
    assert(0 <= idx1 && idx1 < N
        && 0 <= idx2 && idx2 < N,
      'Invalid argument indices - out of bounds');
    if(this.circular){
      return idx1 === ((idx2 + 1) % N)
          || idx2 === ((idx1 + 1) % N); 
    } else {
      return idx1 === idx2 + 1
          || idx2 === idx1 + 1;
    }
  }
  needsNormalization(){ return this.circular && this.fresh; }

  applyDecrease(ts){
    assert(ts.fromDecrease(), 'Not a decrease');
    if(!this.hasTracedStitch(ts)){
      // get previous wales
      const pwss = ts.getPrevWales();
      assert(pwss.length === 2, 'Not a decrease?');
      assert(pwss.every(pws => this.isSuspended(pws)),
        'A previous wale is not suspended yet');
      const [pws0, pws1] = pwss;

      // replace suspended previous wales with stitch
      const idx0 = this.stitches.findIndex(s => s.matches(pws0));
      assert(idx0 !== -1, 'Missing previous wale');
      this.stitches.splice(idx0, 1, ts);
      const idx1 = this.stitches.findIndex(s => s.matches(pws1));
      this.stitches.splice(idx1, 1);

      // update firstIndex/lastIndex as needed
      if(idx1 < this.firstIndex)
        --this.firstIndex;
      if(idx1 < this.lastIndex)
        --this.lastIndex;

      // update state map
      this.stateMap.delete(pws0.index);
      this.stateMap.delete(pws1.index);
      this.stateMap.set(ts.index, EXPECTED);
    }

    // should be expected by now
    assert(this.isExpected(ts), 'Applying decrease twice?');
  }

  setActive(ts){
    assert(this.hasTracedStitch(ts)
        && this.isExpected(ts),
      'Invalid stitch activation', ts, this.stateMap);
    this.stateMap.set(ts.index, ACTIVE);
    assert(this.traceStart <= ts.index,
      'Stitch before slice start?', this.traceStart, ts);
    
    // starting stitch
    if(this.firstIndex === -1){
      // find first index
      this.firstIndex = this.stitches.findIndex(s => s.matches(ts));
      assert(this.firstIndex !== -1, 'Stitch not found', ts);
      // compute direction
      this.dir = ts.getOrientation();
      // store trace range
      this.traceStart = ts.index;
      this.traceEnd   = ts.index;

      // if the slice needs normalization
      // then we rotate the stitches appropriately
      if(this.needsNormalization()){
        const N = this.stitches.length;
        const firstIdx = this.isCCW() ? 0 : N - 1;
        if(this.firstIndex !== firstIdx){
          // enforce desired rotation
          this.stitches = TraceSlice.rotateSequence(
            this.stitches, firstIdx - this.firstIndex
          );
          this.firstIndex = firstIdx;
        }
      }
      assert(this.stitches[this.firstIndex].matches(ts),
        'The first index is not valid');
      this.lastIndex  = this.firstIndex;

    } else {
      // must ensure that that orientation matches
      assert(ts.getOrientation() === this.orientation,
        'Active stitches have different orientations');
      // the new stitch must be one step away from the last
      this.lastIndex = this.indexFromEnd(1);
      this.traceEnd  = this.traceEnd + 1;
      const last = this.stitches[this.lastIndex];
      assert(last.matches(ts), 'Active stitch does not match ordering');
      assert(last.index === this.traceEnd, 'Discontinuous trace');
    }
    this.fresh = false;
  }

  startsYarn(){       return this.first && this.first.isStart(); }
  endsYarn(){         return this.last && this.last.isEnd(); }
  needsCastOn(){      return this.activeCount > 1 && this.first.needsCastOn(); }
  needsCastOff(){     return this.first && this.first.needsCastOff(); }
  indexOf(ts){        return this.stitches.findIndex(s => s.matches(ts)); }
  indexFromStart(index){
    const N = this.stitches.length;
    return (N + this.firstIndex + index * this.dir) % N;
  }
  indexFromEnd(index){
    const N = this.stitches.length;
    return (N + this.lastIndex + index * this.dir) % N;
  }
  activeIndex(index){
    assert(index >= 0 && index < this.activeCount,
      'Index out of active range');
    return this.indexFromStart(index);
  }
  *activeIndices(){
    if(this.firstIndex === -1)
      return;
    const N = this.stitches.length;
    for(let i = this.firstIndex;
        i !== this.lastIndex;
        i = (N + i + this.dir) % N){
      yield i;
    }
    yield this.lastIndex;
  }
  activeStitch(index){ return this.stitches[this.activeIndex(index)]; }
  *activeStitches(){
    if(this.firstIndex === -1)
      return;
    const N = this.stitches.length;
    for(let i = this.firstIndex;
        i !== this.lastIndex;
        i = (N + i + this.dir) % N){
      yield this.stitches[i];
    }
    yield this.stitches[this.lastIndex];
  }
  getActiveMap(map = ts => ts){
    if(this.firstIndex === -1)
      return [];
    const stitches = [];
    const trace = this.stitches[0].trace;
    for(let ti = this.traceStart, idx = 0; ti <= this.traceEnd; ++ti, ++idx){
      const ts = trace.getTracedStitchAt(ti);
      const si = this.activeIndex(idx);
      stitches.push(map(ts, si, idx));
    }
    return stitches;
  }

  /**
   * Gets the next slice generated after going over the active stitches
   * of the current one, without introducing additional stitches.
   * 
   * @param {boolean} [circular] an optional circular state to reset
   * @return {TraceSlice} a new slice
   */
  next(legacySlicing = false){
    // --- legacy slicing ------------------------------------------
    if(legacySlicing){
      const stitches = this.stitches.flatMap(ts => {
        if(this.isExpected(ts)) {
          return [ ts ]; // keep as-is
        } else {
          // active stitch => replace with next wale(s)
          // note: there may be 0, 1 or 2
          // if there are 2, then they are already in CCW ordering
          // /!\ the trace ordering may be CW / CCW, what we care is
          // the layout on the bed, which is independent from the trace
          // and instead connected to the original stitch graph
          return ts.getNextWales();
        }
      }).filter((ts, i, arr) => {
        // filter out neighboring duplicates due to decreases
        // decrease => two stitches lead to the same expected stitch each
        return arr.length === 1
            || !ts.matches(arr[(i + 1) % arr.length]);
      });
      return new TraceSlice(
        stitches,
        stitches.map(ts => [ts.index, EXPECTED]),
        this.circular
      );

    } else {
      // --- new slicing -------------------------------------------
      const stitches = [];
      const stateEntries = [];
      for(const ts of this.stitches){
        if(this.isExpected(ts)) {
          // keep as-is
          stitches.push(ts);
          stateEntries.push([ts.index, EXPECTED]);

        } else {
          // active stitch
          // two cases:
          // - "decreasing" stitch => keep as "suspended"
          // - otherwise => replace with next wale(s) (0, 1 or 2)
          // when replacing, if there are two wales, they are in CCW order
          // so that the result stays a CCW cycle
          // /!\ the trace ordering may be CW / CCW, what we care is
          // the layout on the bed, which is independent from the trace
          // and instead connected to the original stitch graph
          if(ts.isDecreasing()){
            // keep as suspended
            stitches.push(ts);
            stateEntries.push([ts.index, SUSPENDED]);

          } else {
            // replace with the expected next wales
            for(const nws of ts.getNextWales()){
              stitches.push(nws);
              stateEntries.push([nws.index, EXPECTED]);
            } // endfor nws of nwss
          }
        } // endif ts is expected else
      } // endfor ts of this.stitches
      return new TraceSlice(
        stitches, stateEntries, this.circular
      );
    } // endif legacySlicing else
  }

  static rotateSequence(tss, rot){
    const N = tss.length;
    assert(rot <= N,
      'The rotation cannot exceed number of elements');
    return Array.from({ length: N }, (_, i) => {
      return tss[(i + N - rot) % N];
    });
  }

  /**
   * Computes the CCW course sequence associated with a stitch
   * 
   * @param {TracedStitch} ts0 a traced stitch of interest
   * @return {TracedStitch[]} a sequence of traced stitches in CCW order, including the argument
   */
  static getCCWSequenceFrom(ts0){
    const trace = ts0.trace;
    const tss = Array.from(ts0.stitch.stitchGroup(), s => {
      return trace.getTracedStitch(s.index, ts0.pass);
    });
    return tss;
  }

  /**
   * Computes a trace slice from a fresh starting stitch
   * 
   * @param {TracedStitch} ts0 a traced stitch of interest
   * @return {TraceSlice} the new fresh trace slice
   */
  static fromStitch(ts0){
    const tss = TraceSlice.getCCWSequenceFrom(ts0);
    const circular = TraceSlice.isCircular(tss);
    return new TraceSlice(
      tss, tss.map(ts => [ts.index, EXPECTED]), circular, true
    );
  }

  /**
   * Checks whether a CCW sequence is circular by verifying
   * the course-connectivity of its boundaries.
   * 
   * @param {array} tss a sequence of traced stitches in CCW orientation
   * @return {boolean} whether the sequence is circular
   */
  static isCircular(tss){
    const startStitch = tss[0].stitch;
    const endStitch = tss[tss.length - 1].stitch;
    return startStitch.matches(endStitch.getNextCourse());
  }

  /**
   * Computes a sequence of slices generated by a trace.
   * The increase/decrease maximum are per side, so circular slices
   * can technically use the double of increases/decreases.
   * 
   * @param {any} trace a stitch trace
   * @param {number} [maxIncrease=2] the maximum allowed number of increases per slice
   * @param {number} [maxDecrease=2] the maximum allowed number of decreases per slice
   * @param {boolean} [legacySlicing=false] legacy 
   * @return {TraceSlice[]} a sequence of active trace slices
   */
  static from(
    trace,
    maxIncrease = 2,
    maxDecrease = 2,
    legacySlicing = false
  ){
    assert(maxIncrease > 0 && maxDecrease > 0,
      'Shaping bounds must be strictly positive');
    if(!trace.length)
      return [];
    const slices = [];

    // 1) create initial slice and record initial states
    let yarn;
    let caston, castoff, orient;
    let increase = 0;
    let decrease = 0;
    let pass = 0;
    let courseIdx = 0;
    let regionId;
    init: {
      const ts0 = trace.getTracedStitchAt(0);
      slices.push(TraceSlice.fromStitch(ts0));
      // initial casting state
      yarn    = ts0.getTraceYarn();
      caston  = ts0.needsCastOn();
      castoff = ts0.needsCastOff();
      orient  = ts0.getOrientation();
      let sr;
      [courseIdx, sr] = ts0.getGroupData();
      assert(!sr, 'Should not start with a short-row!');
      regionId = ts0.getRegionID();
    }

    // 2) go over trace
    const checkShaping = legacySlicing ? () => {} : () => {
      const numSL = slices.length;
      if(numSL > 1){
        const currN = slices[numSL-1].stitches.length;
        const prevN = slices[numSL-2].stitches.length;
        const dN = currN - prevN;
        const shapeSides = slices[numSL-1].circular ? 2 : 1;
        assert(dN <= shapeSides * maxIncrease,
          'Invalid increasing profile', prevN, currN);
        assert(-dN <= shapeSides * maxDecrease,
          'Invalid decreasing profile', prevN, currN);
      }
    };
    for(let i = 0, n = trace.length; i < n; ++i){
      const ts = trace.getTracedStitchAt(i);

      // activate current traced stitch
      // => may have to generate a new slice if not available
      let lastSlice = slices[slices.length - 1];

      // check if we need a new slice
      const [ci, sr] = ts.getGroupData();
      const newCrs = !sr && ci !== courseIdx;
      const rid = ts.getRegionID();
      const fromDecr = ts.fromDecrease();
      if(rid !== regionId || (newCrs && legacySlicing)){
        // case 1 = starting a fresh new slice
        // legacy: (pass=0, new crsIdx)
        // update: new regionId
        assert(ts.pass === 0,
          'Starting a new course but not an initial pass');
        assert(newCrs,
          'New region, but not new course');
        lastSlice = TraceSlice.fromStitch(ts);
        slices.push(lastSlice);

        // update state
        yarn     = ts.getTraceYarn();
        caston   = ts.needsCastOn();
        castoff  = ts.needsCastOff();
        orient   = ts.getOrientation();
        decrease = 0; // ts.fromDecrease() ? 1 : 0;
        increase = ts.toIncrease() ? 1 : 0;
        pass     = ts.pass;
        courseIdx = ci; // new course index
        regionId = rid; // new region id
        
      } else if(lastSlice.hasTracedStitch(ts) || fromDecr){
        // case 2 = activating an existing, expected stitch
        assert(!lastSlice.isActive(ts),
          'Invalid state', lastSlice, ts);

        // check continuity of casting states
        const yar = ts.getTraceYarn();
        const on  = ts.needsCastOn();
        const off = ts.needsCastOff();
        const ori = ts.getOrientation();
        if(yar !== yarn
        || on  !== caston
        || off !== castoff
        || ori !== orient
        || ts.pass !== pass){
          // note: no need for insertion since current stitch
          // is available in the last slice already
          // => only process previously active stitches
          slices.push(lastSlice = lastSlice.next(legacySlicing));

          // safety check
          checkShaping();

          // update state
          yarn      = yar;
          caston    = on;
          castoff   = off;
          orient    = ori;
          increase  = 0;
          decrease  = 0;
          pass      = ts.pass;
        } // endif discontinuous state

        // Ensure shaping is not too extreme
        // = check that the number of increase/decrease is below threshold
        if(ts.fromDecrease()){
          ++decrease;
        }
        if(ts.toIncrease()){
          ++increase;
        }
        const shapeSides = lastSlice.circular ? 2 : 1;
        if(decrease > maxDecrease * shapeSides
        || increase > maxIncrease * shapeSides){
          // first create new slice
          // /!\ no need to insert sequence
          // since ts is within current slice
          slices.push(lastSlice = lastSlice.next(legacySlicing));

          // safety check
          checkShaping();

          // reduce shaping counts
          increase = Math.max(0, increase - maxIncrease * shapeSides);
          decrease = Math.max(0, decrease - maxDecrease * shapeSides);
          assert(increase <= 1 && decrease <= 1,
            'Shaping decrease was invalid?');
        } // endif too much shaping

        // 
        if(!legacySlicing && fromDecr){
          lastSlice.applyDecrease(ts);
        }
        
      } else {
        // case 3 = activating a stitch that comes in the next slice
        // note: stitch is not in last slice
        //       and not on a new course either!
        // => the stitch must be part of the next slice
        slices.push(lastSlice = lastSlice.next(legacySlicing));
        assert(lastSlice.hasTracedStitch(ts),
          'Stitch is not on a new course, nor in the next slice');

        // safety check
        checkShaping();

        // update state
        yarn      = ts.getTraceYarn();
        caston    = ts.needsCastOn();
        castoff   = ts.needsCastOff();
        orient    = ts.getOrientation();
        increase  = ts.toIncrease() ? 1 : 0;
        decrease  = ts.fromDecrease() ? 1 : 0;
        pass      = ts.pass;
      } // endif else

      // mark current stitch as active
      lastSlice.setActive(ts);

      // note: we cannot have any previous wale in the slice
      assert(ts.getPrevWales().every(pts => !lastSlice.hasTracedStitch(pts)),
        'A previous wale is in the slice of the current active stitch');

    } // endfor i < #trace

    // only keep the slices with active stitches
    // note: because of the state splits (yarn/caston/off/orient/shaping),
    //       it is possible that empty slices were created
    return slices.filter(slice => slice.activeCount > 0);
  }
}

module.exports = Object.assign(TraceSlice, {
  CCW, CW
});