// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { FRONT, BACK } = require('../../knitout.js');

// constants
const CCW = 1;
const CW = -1;

class CCWCorners {
  constructor(needles, index, offsets = { [FRONT]: 0, [BACK]: 0 }){
    this.needles = needles;
    this.index   = index; // [fl, fr, br, bl]
    assert(index.length === 4, 'Invalid corner index');
    // variations
    this.offsets = offsets;
  }
  get length(){ return this.needles.length; }
  get fl(){ return this.index[0]; }
  set fl(idx){ this.index[0] = idx; }
  get fr(){ return this.index[1]; }
  set fr(idx){ this.index[1] = idx; }
  get br(){ return this.index[2]; }
  set br(idx){ this.index[2] = idx;}
  get bl(){ return this.index[3]; }
  set bl(idx){ this.index[3] = idx;}
  copy(){
    return new CCWCorners(
      this.needles, this.index.slice(), Object.assign({}, this.offsets)
    );
  }
  shiftBy({ f = 0, b = 0 }){
    this.offsets[FRONT] += f;
    this.offsets[BACK] += b;
    return this;
  }
  shiftedBy(shift){ return this.copy().shiftBy(shift); }
  shiftedNeedles(){
    return this.needles.map(n => n.shiftedBy(this.offsets[n.side]));
  }
  afterRotation(cornerIdx){
    const ci = this.indexOf(cornerIdx);
    // get updated needles given implicit shift
    const newNeedles = this.shiftedNeedles();
    // apply bed transfer
    newNeedles[ci] = newNeedles[ci].otherSide();
    // update corner index
    const index = this.index.slice();
    const revIdx = this.cornerIndex(cornerIdx, true, false);
    if(this.isSingular(cornerIdx)){
      const offIdx = this.cornerIndex(cornerIdx, false, true);
      index[cornerIdx] = index[offIdx] = -1; // no needle anymore

    } else {
      // check that transfer keeps cycle in CCW order
      const dir = this.directionOf(cornerIdx);
      const ri = this.indexOf(cornerIdx, true);
      assert((newNeedles[ci].offset - newNeedles[ri].offset) * dir >= 0,
        'Collapse with invalid orientation');
      index[cornerIdx] = this.preIndexOf(cornerIdx);
    }
    index[revIdx] = ci; // corner replaces the reverse one
    return new CCWCorners(newNeedles, index);
  }
  cornerIndex(idx, revBed = false, revOffset = false){
    if(revBed && revOffset)
      return [2, 3, 0, 1][idx]; // fl<->br, fr<->bl
    else if(revBed)
      return [3, 2, 1, 0][idx]; // fl<->bl, fr<->br
    else if(revOffset)
      return [1, 0, 3, 2][idx]; // fl<->fr, br<->bl
    else
      return idx;
  }
  indexOf(idx, ...args){
    return this.index[this.cornerIndex(idx, ...args)];
  }
  exists(idx, ...args){ return this.indexOf(idx, ...args) !== -1; }
  isSingular(idx, revBed = false, revOffset = false){
    const thisIdx = this.indexOf(idx, revBed, revOffset);
    return thisIdx === this.indexOf(idx, revBed, !revOffset); 
  }
  needleAt(i){
    const n = this.needles[i];
    return n.shiftedBy(this.offsets[n.side]);
  }
  offsetAt(i){ return this.needleAt(i).offset; }
  needle(idx, ...args){
    return this.needleAt(this.indexOf(idx, ...args));
  }
  preIndexOf(idx, ...args){
    const nidx = this.indexOf(idx, ...args);
    const orient = this.orientationOf(idx, ...args);
    return (nidx - orient + this.length) % this.length;
  }
  preNeedle(idx, ...args){
    return this.needleAt(this.preIndexOf(idx, ...args));
  }
  offset(idx, ...args){ return this.needle(idx, ...args).offset; }
  preOffset(idx, ...args){ return this.preNeedle(idx, ...args).offset; }
  sideOf(idx, ...args){
    return [FRONT, FRONT, BACK, BACK][this.cornerIndex(idx, ...args)];
  }
  orientationOf(idx, ...args){
    return [CW, CCW, CW, CCW][this.cornerIndex(idx, ...args)];
  }
  directionOf(idx, ...args){
    return [-1, +1, +1, -1][this.cornerIndex(idx, ...args)];
  }
  isCCW(idx, ...args){
    return this.orientationOf(idx, ...args) === CCW;
  }
  range(arg, rev=false){
    if(typeof arg === 'string'){
      if(arg === FRONT || (rev && arg === BACK)){
        // front range
        if(this.index[0] === -1 || this.index[1] === -1)
          return [];
        else
          return [this.offset(0), this.offset(1)];
      } else {
        // back range
        if(this.index[2] === -1 || this.index[3] === -1)
          return [];
        else
          return [this.offset(2), this.offset(3)];
      }
    } else {
      assert(typeof arg === 'number', 'Invalid argument type');
      return this.range(this.sideOf(arg), rev);
    }
  }
  width(arg, rev=false){
    if(typeof arg === 'string'){
      assert(arg === FRONT || arg === BACK, 'Invalid side');
      const isFront = arg === FRONT || (rev && arg === BACK);
      const lidx = this.index[isFront ? 0 : 2];
      const ridx = this.index[isFront ? 1 : 3];
      if(lidx === -1 || ridx === -1)
        return 0;
      const ln = this.needles[lidx]; // note: no need to shift
      const rn = this.needles[ridx]; // because of subtraction!
      assert(ln.offset <= rn.offset, 'Corner order is wrong');
      return rn.offset - ln.offset + 1;

    } else {
      assert(typeof arg === 'number', 'Invalid argument type');
      return this.width(this.sideOf(arg), rev);
    }
  }
  *cornerNeedles(){
    for(const cidx of this.index){
      if(cidx !== -1)
        yield this.needleAt(cidx);
    }
  }
  *cornerEntries(){
    for(let i = 0; i < 4; ++i){
      if(this.index[i] !== -1)
        yield [i, this.index[i]];
    }
  }
  *getOptions(cornerIdx, { state, slacks, targets, minFree, maxFree }){

    // corner needle
    const cnIdx = this.indexOf(cornerIdx);
    const cn = this.needles[cnIdx];

    // check if other side has any corner to worry about
    const rbIdx = this.indexOf(cornerIdx, true);
    if(rbIdx === -1
    && state.isEmpty(cn.otherSide())){
      // special shortcut case
      yield [this, cornerIdx];
      // no need to check something else, since we cannot do better
      return;
    }

    // get needle of corner we would collapse next to
    const rn = this.needles[rbIdx];
    assert(cn.side !== rn.side, 'Reverse bed has same side');

    // compute gap by looking at targets of both corners
    const tcn = targets[cnIdx];
    const trn = targets[rbIdx];
    let gap;
    // special half-rotation case
    if(tcn.side !== trn.side)
      gap = 1; // assume minimum space
    else {
      // both have the same side
      // are they merging at that exact location?
      if(tcn.matches(trn) && rn.matches(trn))
        gap = 0; // allow direct merging
      else
        gap = Math.max(1, Math.abs(trn.offset - tcn.offset));
    }

    // get gap direction
    const dir = this.directionOf(cornerIdx);

    // get range of meaningful offsets for corner needle
    const rnGapOffset = rn.offset + dir * gap;
    const minOffset = Math.min(
      cn.offset, Math.min(rnGapOffset, maxFree)
    );
    const maxOffset = Math.max(
      cn.offset, Math.max(rnGapOffset, minFree)
    );
    const N = this.length;
    offsetLoop:
    for(let offset = minOffset; offset <= maxOffset; ++offset){
      const thisShift = offset - cn.offset;
      const revOffset = offset - dir * gap;
      const revShift  = revOffset - rn.offset;
      // shifted corner representation
      const setup = this.shiftedBy({
        [cn.side]: thisShift, [rn.side]: revShift
      });
      // check that all corners are within valid needle range
      for(const nn of setup.cornerNeedles()){
        if(nn.offset < minFree
        || nn.offset > maxFree)
          continue offsetLoop; // outside of valid range!
      }
      // check that the slack is satisfied
      for(let i = 0; i < 4; ++i){
        const cidx = setup.indexOf(i);
        if(cidx === -1)
          continue;
        const coff = setup.offsetAt(cidx);
        // check CW slack
        const pidx = (cidx - 1 + N) % N;
        if(Math.abs(setup.offsetAt(pidx) - coff) > slacks[pidx])
          continue offsetLoop; // invalid CW slack

        // check CCW slack
        const nidx = (cidx + 1 + N) % N;
        if(Math.abs(setup.offsetAt(nidx) - coff) > slacks[cidx])
          continue offsetLoop; // invalid CCW slack
      }
      // valid configuration!
      yield [setup, cornerIdx];
    } // endfor minOffset <= offset <= maxOffset
  }
  static from(needles){
    assert(needles.length, 'Argument must be non-empty');
    const corners = {
      [FRONT]: { min: -1, max: -1 },
      [BACK]:  { min: -1, max: -1 }
    };
    for(let i = 0; i < needles.length; ++i){
      const n = needles[i];
      const range = corners[n.side];
      if(range.min === -1)
        range.min = range.max = i;
      else {
        if(n.offset < needles[range.min].offset)
          range.min = i;
        if(n.offset > needles[range.max].offset)
          range.max = i;
      }
    } // endfor 1 <= i < #needles
    return new CCWCorners(needles, [
      corners[FRONT].min, corners[FRONT].max,
      corners[BACK].max, corners[BACK].min
    ]);
  }
}

module.exports = Object.assign(CCWCorners, {
  CCW, CW
});