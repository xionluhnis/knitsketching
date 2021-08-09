// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');

// constants
// - front yarn action
const FYARN_NONE = 0;
const FYARN_SOME = 1;
const FYARN_MASK = 1;
// - back yarn actions
const BYARN_NONE = 0;
const BYARN_MISS = 1;
const BYARN_TUCK = 2;
const BYARN_KNIT = 3;
const BYARN_MASK = 3;
// - bit sets
const FYARN_BITS = Array.from({ length: 10 }, (_, i) => 1 << i);
const BYARN_BITS = Array.from({ length: 10 }, (_, i) => 3 << i * 2);
const YARN_BITS_PAIRS = FYARN_BITS.map((fy, i) => {
  return [fy, BYARN_BITS[i]];
});
const FYARN_FULL_MASK = FYARN_BITS.reduce((bits, msk) => bits | msk, 0);
const BYARN_FULL_MASK = BYARN_BITS.reduce((bits, msk) => bits | msk, 0);

function asYarnList(yarns, yarnBits = FYARN_BITS){
  if(Array.isArray(yarns)){
    return yarns.map(yarn => {
      return typeof yarn === 'string' ? parseInt(yarn) : yarn;
    });
  }
  if(typeof yarns === 'string')
    yarns = parseInt(yarns);
  assert(typeof yarns === 'number',
    'Invalid yarns argument type', yarns);
  return yarnBits.flatMap((msk, i) => (msk & yarns) ? [i+1] : []);
}
function asFYarnList(yarns){ return asYarnList(yarns); }
function asBYarnList(yarns){ return asYarnList(yarns, BYARN_BITS); }
function asYarnBits(
  yarns,
  masks = FYARN_SOME,
  bitsPerYarn = 1,
  mskMask = FYARN_MASK
){
  yarns = asYarnList(yarns);
  masks = asBYarnMask(masks);
  return yarns.reduce((bits, yarn, i) => {
    const msk = Array.isArray(masks) ? masks[i] : masks;
    assert(typeof msk === 'number',
      'Invalid mask type', msk);
    assert((msk | mskMask) === mskMask,
      'Yarn mask is invalid', msk);
    return bits | (msk << ((yarn-1) * bitsPerYarn));
  }, 0);
}
function asFYarnBits(yarns){ return asYarnBits(yarns); }
function asBYarnBits(yarns, masks){
  return asYarnBits(yarns, masks, 2, BYARN_MASK);
}
function asBYarnMask(masks){
  if(typeof masks === 'string'){
    switch(masks.toLowerCase()){
      case 'none': return BYARN_NONE;
      case 'miss': return BYARN_MISS;
      case 'tuck': return BYARN_TUCK;
      case 'knit': return BYARN_KNIT;
      default:
        assert.error('Unsupported back yarn mask string', masks);
        return BYARN_MISS;
    }
  }
  return masks;
}

class YarnStack {
  constructor(fyarns = 0, byarns = 0, applyFunc = null){
    this.yarns  = new Set();
    this.fyarns = fyarns;
    this.byarns = byarns;
    assert(typeof fyarns === 'number'
        && (fyarns | FYARN_FULL_MASK) === FYARN_FULL_MASK,
      'Invalid front yarn bits', fyarns);
    assert(typeof byarns === 'number'
        && (byarns | BYARN_FULL_MASK) === BYARN_FULL_MASK,
      'Invalid back yarn bits', byarns);
    if(fyarns || byarns)
      this.recomputeSet();
    // callback application
    this.applyFunc = applyFunc;
  }
  get yarnMask(){
    return asFYarnBits(Array.from(this.yarns));
  }
  recomputeSet(){
    this.yarns.clear();
    for(const [i, [fmsk, bmsk]] of YARN_BITS_PAIRS.entries()){
      if((this.fyarns & fmsk)
      || (this.byarns & bmsk))
        this.yarns.add(i + 1);
    }
    return this;
  }
  commit(){
    if(this.applyFunc)
      this.applyFunc(this);
  }
  resetFrontYarns(yarns, skipCommit = false){
    yarns = asYarnList(yarns);
    this.fyarns = asFYarnBits(yarns);
    this.recomputeSet();
    if(!skipCommit)
      this.commit();
    return this;
  }
  resetBackYarns(yarns, masks = BYARN_MISS, skipCommit = false){
    yarns = asYarnList(yarns);
    masks = asBYarnMask(masks);
    assert(Array.isArray(masks) || (0 <= masks && masks <= 3),
      'Invalid back yarn mask');
    this.byarns = asBYarnBits(yarns, masks);
    this.recomputeSet();
    if(!skipCommit)
      this.commit();
    return this;
  }
  setFrontYarns(yarns, missToBack = true){
    yarns = asFYarnBits(yarns);
    // XXX with yarn grouping, this should become a group
    for(const [i, [fbit, bbit]] of YARN_BITS_PAIRS.entries()){
      if(fbit & yarns){
        // = setting in front

        // add to front
        this.fyarns |= fbit;
        // remove from back
        this.byarns &= ~bbit;
        // add to yarn set
        this.yarns.add(i + 1);

      } else if(missToBack && (this.fyarns & fbit)){
        // = moving from front to back as miss

        // remove from front
        this.fyarns &= ~fbit;
        // add as miss in back
        this.byarns &= ~bbit;
        this.byarns |= (BYARN_MISS << (2 * i));
        // already in yarn set
        assert(this.yarns.has(i + 1), 'Invalid yarn state');
      }
    }
    this.commit();
    return this;
  }
  setBackYarns(yarns, masks = BYARN_MISS){
    yarns = asBYarnBits(yarns, masks);
    masks = asBYarnMask(masks);
    // XXX with yarn grouping, all same-action (tuck/knit) yarns
    //     should be part of a same group
    for(const [i, [fbit, bbit]] of YARN_BITS_PAIRS.entries()){
      const inMsk = bbit & yarns;
      const msk = inMsk >>> (i * 2);
      if(msk === BYARN_NONE)
        continue; // nothing to do here
      if(msk === BYARN_MISS && (this.fyarns & fbit)){
        assert(this.yarns.has(i + 1), 'Invalid yarn state');
        continue; // nothing to do here (because front wins)
      }
      // add the mask given as input to the back
      this.byarns &= ~bbit;
      this.byarns |= (bbit & yarns);
      // add to yarn set
      this.yarns.add(i + 1);
    }
    this.commit();
    return this;
  }
  setFrontBackYarns(yarns){
    yarns = asFYarnBits(yarns);
    // XXX with yarn grouping, this should become a group
    for(const [i, [fbit, bbit]] of YARN_BITS_PAIRS.entries()){
      if(fbit & yarns){
        this.fyarns |= fbit;
        this.byarns |= bbit;
        this.yarns.add(i + 1);
      }
    }
    this.commit();
    return this;
  }
  allocateYarns(yarns){
    yarns = asYarnList(yarns);
    const newYarns = yarns.filter(yarn => !this.hasYarn(yarn));
    if(newYarns.length)
      this.setBackYarns(newYarns, BYARN_MISS);
    return this;
  }
  hasYarn(yarn = 0){
    if(yarn)
      return this.yarns.has(yarn);
    else
      return this.yarns.size > 0;
  }
  hasEveryYarn(yarns){
    yarns = asYarnList(yarns);
    return yarns.every(y => this.hasYarn(y));
  }
  hasFrontYarn(yarn = 0){
    if(yarn)
      return (this.fyarns & FYARN_BITS[yarn-1]) !== 0;
    else
      return this.fyarns !== 0; 
  }
  hasBackYarn(yarn = 0){
    if(yarn)
      return (this.byarns & BYARN_BITS[yarn-1]) !== 0;
    else
      return this.byarns !== 0; 
  }
  getFrontYarns(){ return asYarnList(this.fyarns); }
  getBackYarns(){ return asYarnList(this.byarns, BYARN_BITS); }
  getBackYarnAction(yarnIdx){
    return (this.byarns >>> (yarnIdx * 2)) & BYARN_MASK;
  }

  // factories
  static fromBits(fyarns, byarns, yagrps, applyFunc = null){
    return new YarnStack(fyarns, byarns, yagrps, applyFunc);
  }
}
module.exports = Object.assign(YarnStack, {
  // functions
  asYarnList, asFYarnList, asBYarnList,
  asYarnBits, asFYarnBits, asBYarnBits,
  // bit arrays and masks
  FYARN_BITS, FYARN_MASK,
  BYARN_BITS, BYARN_MASK,
  YARN_BITS_PAIRS,
  FYARN_FULL_MASK, BYARN_FULL_MASK,
  // actions
  FYARN_NONE, FYARN_SOME,
  BYARN_NONE, BYARN_MISS, BYARN_TUCK, BYARN_KNIT
});