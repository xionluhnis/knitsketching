// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const NeedleBlock = require('../block.js');
const Knitout = require('../../../knitout/knitout.js');
const { Needle, FRONT, BACK } = Knitout;

// constants
const NONE         = 0;
const FRONT_LEFT   = 1 << 0;
const FRONT_RIGHT  = 1 << 1;
const FRONT_BOTH   = FRONT_LEFT | FRONT_RIGHT;
const BACK_LEFT    = 1 << 2;
const BACK_RIGHT   = 1 << 3;
const BACK_BOTH    = BACK_LEFT | BACK_RIGHT;
const NIBBLE_MASK         = 0x0F;
const NIBBLE_CODE = {
  [NONE]: '-',
  [FRONT_LEFT]: 'fl',
  [FRONT_RIGHT]: 'fr',
  [FRONT_BOTH]: 'fl+fr',
  [BACK_LEFT]: 'bl',
  [BACK_RIGHT]: 'br',
  [BACK_BOTH]: 'bl+br',
  [FRONT_LEFT | BACK_RIGHT]: 'fl+br',
  [FRONT_RIGHT | BACK_LEFT]: 'fr+bl'
};
const NIBBLES = Object.keys(NIBBLE_CODE).map(s => parseInt(s));
const EVEN_NIBBLE_LIST = [
  NONE,
  FRONT_LEFT | BACK_RIGHT,
  FRONT_RIGHT | BACK_LEFT,
  FRONT_BOTH,
  BACK_BOTH
];
const ODD_NIBBLE_LIST = [
  FRONT_LEFT,
  BACK_LEFT,
  FRONT_RIGHT,
  BACK_RIGHT
];
const CIRCULAR            = 1 << 5;
const FLIPPED             = 1 << 6;
const MAIN_SIDE           = 1 << 6; // replacing flipped
const REDUCED             = 1 << 7;
const C_SHAPE             = 1 << 7; // replacing reduction
// - packing masks and shifts
/*
const PACK_FLAGS_SHIFT  = 0;
const PACK_FLAGS_MASK   = 0xFF;
const PACK_COUNT_SHIFT  = 8;
const PACK_COUNT_MASK   = 0xFFF;
const PACK_ROLL_SHIFT   = 20;
const PACK_ROLL_MASK    = 0xFFF;
*/

class BedShape {
  /**
   * Creates a bed layout shape
   * 
   * @param {number} stitchCount number of stitches in the layout
   * @param {number} flags layout flags (nibbles, circularity, flipping ...)
   * @param {number} [param=0] the rotation count (0 by default)
   */
  constructor(stitchCount, flags, param = 0){
    this.stitchCount = stitchCount;
    assert(stitchCount > 0, 'Empty bed shape');
    this.flags    = flags;
    this.nibbles  = flags & NIBBLE_MASK;
    this.param    = param;
    // generic flag test
    assert((flags & (~this.constructor.validFlags)) === 0,
      'Invalid flags for given bed shape space', flags);
    // check nibbles
    if(this.nibbles){
      // check that the nibble combination is valid
      assert(!this.hasNibble(FRONT_LEFT | BACK_LEFT)
          && !this.hasNibble(FRONT_RIGHT | BACK_RIGHT),
        'Cannot have both front and back nibbles on a same side');
      assert(NIBBLES.includes(this.nibbles),
        'Invalid nibble value', this.nibbles);
    }
    // generic param test
    assert(this.paramMin <= param && param <= this.paramMax,
      'Bed parameter is out of bounds', param);
  }
  static get validFlags(){ return 0; }
  get circular(){ return false; }
  get paramMin(){ return 0; }
  get paramMax(){ return this.stitchCount - 1; }
  get type(){ return 'abstract'; }
  isAligned(){ return this.nibbles === 0; }
  toString(){
    return 'Shape(N=' + this.stitchCount
        + ',f=' + this.flags
        + ',p=' + this.param
        + ')';
  }

  /**
   * Create a copy of this shape
   * 
   * @return {BedShape} a copy of this shape
   */
  copy(){
    return new this.constructor(
      this.stitchCount,
      this.flags,
      this.param
    );
  }

  /**
   * Returns whether this shapes is the same as another
   * 
   * @param {BedShape} shape the shape to compare
   * @return {boolean} whether the shapes are the same (including offsets)
   */
  matches(shape){
    // return this.pack() === shape.pack();
    return this.stitchCount === shape.stitchCount
        && this.flags === shape.flags
        && this.param  === shape.param
        && shape instanceof this.constructor;
  }

  getNeedleBlock(offset = 0){
    // we want a needle block without computing the needles
    // => use sided offset ranges
    const { min: fmin, max: fmax } = this.getFrontOffsetRange(offset);
    const { min: bmin, max: bmax } = this.getBackOffsetRange(offset);
    return new NeedleBlock(
      [], // no computed needle!
      this.getSideRange(),
      [fmin, bmin],
      [fmax, bmax]
    );
  }

  hasNibble(flag){ return (this.nibbles & flag) === flag; }

  getNeedle(/* index, baseOffset = 0 */){
    assert.error('BedShape::getNeedle not implemented');
  }
  getNeedles(indices = null, offset = 0){
    if(!indices)
      return Array.from(this.needles(offset));
    // else go over indices
    const needles = [];
    for(const index of indices)
      needles.push(this.getNeedle(index, offset));
    return needles;
  }
  *needles(offset = 0){
    for(let i = 0; i < this.stitchCount; ++i)
      yield this.getNeedle(i, offset);
  }
  getOffsetRange(baseOffset = 0){
    // naive implementation
    let min = Infinity;
    let max = -Infinity;
    for(const { offset } of this.needles(baseOffset)){
      min = Math.min(min, offset);
      max = Math.max(max, offset);
    }
    return { min, max };
  }
  getFrontOffsetRange(baseOffset = 0){
    // naive implementation
    let min = Infinity;
    let max = -Infinity;
    for(const n of this.needles(baseOffset)){
      if(!n.inFront())
        continue;
      min = Math.min(min, n.offset);
      max = Math.max(max, n.offset);
    }
    if(!Number.isFinite(min))
      min = max = NaN;
    return { min, max };
  }
  getBackOffsetRange(baseOffset = 0){
    // naive implementation
    let min = Infinity;
    let max = -Infinity;
    for(const n of this.needles(baseOffset)){
      if(n.inFront())
        continue;
      min = Math.min(min, n.offset);
      max = Math.max(max, n.offset);
    }
    if(!Number.isFinite(min))
      min = max = NaN;
    return { min, max };
  }
  getSideRange(){
    let sides = NeedleBlock.NONE;
    for(const n of this.needles()){
      if(n.inFront())
        sides |= NeedleBlock.FRONT;
      else if(n.inBack())
        sides |= NeedleBlock.BACK;
    }
    return sides;
  }

  toLayoutString(gap = 0){
    const { min, max } = this.getOffsetRange(gap);
    assert(min === gap, 'Invalid minimum extent');
    assert(gap >= 0, 'Gap cannot be negative', gap);
    const f = Array.from({ length: max - min + 1 }, () => '-');
    const b = f.slice();
    const beds = { f, b };
    let first = true;
    for(const n of this.getNeedles()){
      const c = first ? 'x' : 'o';
      beds[n.side][n.offset + gap] = c;
      first = false;
    }
    return b.join('') + '\n' + f.join('');
  }
}

module.exports = Object.assign(BedShape, {
  // objects
  Needle,
  // general flags
  CIRCULAR, FLIPPED, REDUCED,
  MAIN_SIDE, C_SHAPE,
  // nibbles
  NONE,
  FRONT_LEFT, FRONT_RIGHT, FRONT_BOTH,
  BACK_LEFT, BACK_RIGHT, BACK_BOTH,
  NIBBLE_CODE, NIBBLE_MASK,
  EVEN_NIBBLE_LIST,
  ODD_NIBBLE_LIST,
  // beds
  FRONT, BACK
});