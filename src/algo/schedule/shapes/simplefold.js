// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const NeedleBlock = require('../block.js');
const BedShape = require('./base.js');
const {
  Needle,
  NONE, FRONT, BACK, OTHER_SIDE,
  FLIPPED, REDUCED
} = BedShape;

class SimpleFoldBedShape extends BedShape {
  /**
   * Creates a bed layout shape
   * 
   * @param {number} stitchCount number of stitches in the layout
   * @param {number} flags layout flags (nibbles, circularity, flipping, reduced)
   * @param {number} [roll] the rotation count (0 by default)
   */
  constructor(stitchCount, flags, roll = 0){
    super(stitchCount, flags, roll);
    this.flipped  = !!(flags & FLIPPED);
    this.reduced  = !!(flags & REDUCED);
  }
  get roll(){ return this.param; }
  get paramMax(){ return this.stitchCount * 2 - 1; }
  get type(){ return 'simplefold'; }
  toString(){
    return 'Shape(N=' + this.stitchCount
        + ',f=' + this.flags
        + ',r=' + this.roll
        + '|flat'
        + (this.flipped ? ',flip' : '')
        + (this.reduced ? ',red' : '')
        + ')';
  }

  getNeedle(index, baseOffset = 0){
    const { stitchCount, roll, flipped, reduced } = this;
    assert(index < stitchCount, 'Invalid index');
    // easy case: no folding done (roll = 0)
    if(!roll){
      return new Needle(flipped ? BACK : FRONT, baseOffset + index);
    }

    // else, we're folding, and there are multiple cases
    // for N=4, r=0...7
    // r=0  ----    r<w=4 (case 1)
    //      xooo
    // r=1  .--o    r<w=3
    //      .xoo
    // r=2  ..oo    2=w<=r<N (case 2)
    //      ..xo
    // r=3  .ooo    3=w<=r<N
    //      .--x
    // r=4  ooox    0<=r-N<w=4 (case 3)
    //      ----
    // r=5  oox.    0<=r-N<w=3
    //      o--.
    // r=6  ox..    0<=r-N<w=2
    //      oo..
    // r=7  x--.    3=w<=r-N (case 4)
    //      ooo.
    //
    // from front:
    //    0 <= roll < stitchCount
    // from back:
    //    stitchCount <= roll < 2*stitchCount
    //
    // simplified view:
    //  - rotation on stitchCount bed
    //  - with some (optional) shift to account for the available width
    const period = 2 * stitchCount;
    const rot = (roll + index) % period;
    let offset;
    let side;
    if(rot < stitchCount){
      offset = rot;
      side = FRONT;
    } else {
      offset = period - 1 - rot;
      side = BACK;
    }

    // remove padding
    if(reduced && roll < stitchCount){
      // cases 1 + 2 have padding on the left
      // /!\ width is not related to index! it depends on stitchCount and roll
      const width = Math.max(stitchCount - roll, roll);
      // the padding is the defect between stitchCount and width
      const padding = stitchCount - width;
      offset -= padding;
    }
    // cases 3+4 are tightly packed on the left => no padding
    
    return new Needle(
      flipped ? OTHER_SIDE[side] : side,
      baseOffset + offset
    );
  }
  getOffsetRange(baseOffset = 0){
    const { roll, stitchCount } = this;
    // simple single-bed cases
    if(roll === 0 || roll === stitchCount){
      return {
        min: baseOffset, max: baseOffset + stitchCount - 1
      };
    }
    // folded case
    const baseRoll = roll % stitchCount;
    const width = Math.max(stitchCount - baseRoll, baseRoll);
    if(roll < stitchCount){
      // right-aligned
      // ----ooooo
      // -----xooo
      //     ^   ^
      const margin = stitchCount - width;
      if(this.reduced){
        return {
          min: baseOffset,
          max: baseOffset + stitchCount - 1 - margin
        };

      } else {
        return {
          min: baseOffset + margin,
          max: baseOffset + stitchCount - 1
        };
      }
      
    } else {
      // left-aligned
      // ooooox----
      // oooo------
      // ^    ^
      return {
        min: baseOffset,
        max: baseOffset + width - 1
      };
    }
  }
  getFrontOffsetRange(baseOffset = 0, useFlip = true){
    if(useFlip && this.flipped)
      return this.getBackOffsetRange(baseOffset, false);
    const { stitchCount, roll } = this;
    // single-sided bed cases
    if(roll === 0){
      return {
        min: baseOffset, max: baseOffset + stitchCount - 1
      };
    } else if(roll === stitchCount) {
      return {
        min: NaN, max: NaN
      };
    }

    // folded case
    const baseRoll = roll % stitchCount;
    const width = Math.max(stitchCount - baseRoll, baseRoll);
    if(roll < stitchCount){
      // right-aligned
      // ----ooooo
      // -----xooo
      //      ^  ^
      const margin = this.reduced ? stitchCount - width : 0;
      return {
        min: baseOffset + roll - margin,
        max: baseOffset + stitchCount - 1 - margin
      };
    } else {
      // left-aligned
      // ooooox----
      // oooo------
      // ^  ^
      return {
        min: baseOffset, max: baseOffset + baseRoll - 1
      };
    }
  }
  getBackOffsetRange(baseOffset = 0, useFlip = true){
    if(useFlip && this.flipped)
      return this.getFrontOffsetRange(baseOffset, false);
    const { stitchCount, roll } = this;
    // single-sided bed cases
    if(roll === 0){
      return {
        min: NaN, max: NaN
      };
    } else if(roll === stitchCount) {
      return {
        min: baseOffset, max: baseOffset + stitchCount - 1
      };
    }

    // folded case
    const baseRoll = roll % stitchCount;
    const width = Math.max(stitchCount - baseRoll, baseRoll);
    if(roll < stitchCount){
      // right-aligned
      //     v   v
      // ----ooooo
      // -----xooo
      const margin = this.reduced ? stitchCount - width : 0;
      return {
        min: baseOffset + (stitchCount - roll) - margin,
        max: baseOffset + stitchCount - 1 - margin
      };
    } else {
      // left-aligned
      // v    v
      // ooooox----
      // oooo------
      return {
        min: baseOffset, max: baseOffset + (stitchCount - 1 - baseRoll)
      };
    }
  }
  getSideRange(){
    // three cases
    switch(this.roll){
      case 0: // all on the front by default
        return this.flipped ? NeedleBlock.BACK : NeedleBlock.FRONT;
      case this.stitchCount: // all on the back in this case
        return this.flipped ? NeedleBlock.FRONT : NeedleBlock.BACK;
      default: // mix of both sides
        return NeedleBlock.BOTH;
    }
  }
  /**
   * Generator enumerating all flat layouts for a given
   * number of stitches.
   * By default, spans 2N layouts for N stitches.
   * If allowing bed flipping, then spans 4N layouts.
   * 
   * @param {number} stitchCount number of stitches in the layout
   * @param {Object} options set of options for valid shapes
   * @param {boolean} [options.flipping=false] whether to allow flipping
   * @param {boolean} [options.reduced=false] whether to reduce flat offsets
   * @yield {SimpleFoldBedShape} all possible flat layouts
   */
  static *shapes(
    stitchCount, { 
      flipping = false, reduced = false
    } = {}
  ){
    assert(stitchCount, 'Empty layout?');
    // flat layouts => 2N base layouts (4N with flipping)
    const redFlag = reduced ? REDUCED : NONE;
    const flags = flipping ? [redFlag, redFlag | FLIPPED] : [redFlag];
    for(const flag of flags){
      for(let i = 0; i < 2 * stitchCount; ++i){
        yield new SimpleFoldBedShape(stitchCount, flag, i);
      } // endfor i < stitchCount
    } // endfor flag
  }

  static *splits(crs, flipping = false){
    assert(Array.isArray(crs) && crs.length > 0,
      'Invalid course argument');
    const N = crs.length;
    // special singleton case
    if(N === 1){
      yield [[], crs.slice()];
      yield [crs.slice(), []];
      return;
    }
    // flipping option
    if(flipping){
      yield *this.splits(crs); // CCW version
      yield *this.splits(crs.slice().reverse()); // CW version
      return;
    }

    // we have N > 1 from here on
    console.warn('Flat folding split not implemented yet');
  }
}

module.exports = Object.assign(SimpleFoldBedShape, {
  // general flags
  FLIPPED, REDUCED,
  // beds
  NONE, FRONT, BACK
});