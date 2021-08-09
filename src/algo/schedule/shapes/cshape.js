// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const NeedleBlock = require('../block.js');
const BedShape = require('./base.js');
const {
  Needle,
  NONE,
  FRONT, BACK,
  FLIPPED, C_SHAPE
} = BedShape;

class CShapeBedShape extends BedShape{
  /**
   * Creates a bed layout shape
   * 
   * @param {number} stitchCount number of stitches in the layout
   * @param {number} [flags=0] layout flags (FLIPPED | C_SHAPE)
   * @param {number} [main=stitchCount] the number of main stitches
   */
  constructor(stitchCount, flags, main = stitchCount){
    super(stitchCount, flags | C_SHAPE, main);
    this.flipped  = !!(flags & FLIPPED);
  }
  get mainCount(){ return this.param; }
  get secondCount(){ return this.stitchCount - this.mainCount; }
  get leftCount(){ return Math.ceil(this.secondCount / 2); }
  get rightCount(){ return Math.floor(this.secondCount / 2); }
  get paramMin(){ return Math.ceil(this.stitchCount / 2); }
  get paramMax(){ return this.stitchCount; }
  static get validFlags(){ return C_SHAPE | FLIPPED; }
  get type(){ return 'cshape'; }
  toString(){
    return 'Shape(N=' + this.stitchCount
        + ',f=' + this.flags
        + '|cshape'
        + ',m=' + this.mainCount
        + ',l=' + this.leftCount
        + ',r=' + this.rightCount
        + ',s=' + (this.flipped ? 'B' : 'F')
        + ')';
  }

  getNeedle(index, baseOffset = 0){
    const main = this.mainCount;
    let offset;
    let side;
    if(this.flipped){
      const right = this.rightCount;
      // main in back
      // secondary in front
      if(index < right){
        // front right
        side = FRONT;
        offset = main - right + index;

      } else if(index < right + main) {
        // back
        side = BACK;
        offset = main - 1 - (index - right);

      } else {
        side = FRONT;
        offset = index - main - right;
      }

    } else {
      const left = this.leftCount;
      // main in front
      // secondary in back
      if(index < left){
        // back left
        side = BACK;
        offset = left - 1 - index;

      } else if(index < left + main){
        // front
        side = FRONT;
        offset = index - left;

      } else {
        // back right
        side = BACK;
        offset = main - 1 - (index - main - left);
      }
    }
    return new Needle(side, baseOffset + offset);
  }
  getOffsetRange(baseOffset = 0){
    return {
      min: baseOffset,
      max: baseOffset + this.mainCount - 1
    };
  }
  getPrimaryOffsetRange(baseOffset = 0){
    return this.getOffsetRange(baseOffset);
  }
  getSecondaryOffsetRange(baseOffset = 0){
    const { leftCount: left, rightCount: right } = this;
    if(left){
      if(right){
        // like front
        return this.getOffsetRange(baseOffset);

      } else {
        // only left side
        return {
          min: baseOffset,
          max: baseOffset + left - 1
        };
      }

    } else if(right){
      const main = this.mainCount;
      // only right side
      return {
        min: baseOffset + main - right,
        max: baseOffset + main - 1
      };

    } else {
      return {
        min: NaN, max: NaN
      };
    }
  }
  getFrontOffsetRange(offset = 0){
    if(this.flipped)
      return this.getSecondaryOffsetRange(offset);
    else
      return this.getPrimaryOffsetRange(offset);
  }
  getBackOffsetRange(offset = 0){
    if(this.flipped)
      return this.getPrimaryOffsetRange(offset);
    else
      return this.getSecondaryOffsetRange(offset);
  }
  getSideRange(){
    // either on single bed (based on flipped flag)
    // or on both beds
    if(this.mainCount === this.stitchCount)
      return this.flipped ? NeedleBlock.BACK : NeedleBlock.FRONT;
    else
      return NeedleBlock.BOTH;
  }

  /**
   * Generator enumerating all c-shape layouts
   * for a given number of stitches.
   * 
   * @param {number} stitchCount number of stitches in the layout
   * @yield {CShapeBedShape} all possible c-shape layouts
   */
  static *shapes(stitchCount){
    assert(stitchCount, 'Empty layout?');
    const minMain = Math.ceil(stitchCount / 2);
    // /!\ roll i maps into main as m=i+1
    for(let main = stitchCount; main >= minMain; --main){
      for(const sideFlag of [NONE, FLIPPED])
        yield new CShapeBedShape(stitchCount, sideFlag | C_SHAPE, main);
    }
  }

  /**
   * Generates the set of splitting pairs [front, back]
   * that can be represented by a c-shape layout.
   * 
   * @param {array} crs a CCW stitch sequence
   * @return {array[]} [front, back] in left-to-right order
   */
  static *splits(crs){
    assert(Array.isArray(crs) && crs.length > 0,
      'Invalid course argument');
    const N = crs.length;
    // special singleton case
    if(N === 1){
      yield [[], crs.slice()];
      yield [crs.slice(), []];
      return;
    }

    const m = Math.ceil(N/2);
    const s = N - m;
    const hs = [];
    if(s % 2)
      hs.push(Math.floor(s / 2), Math.ceil(s / 2));
    else
      hs.push(s / 2);
    for(const l of hs){
      const r = N - m - l;
      assert(r >= 0, 'Invalid right value');
      // sub courses
      const cl = crs.slice(0, l);
      const cm = crs.slice(l, l + m);
      const cr = crs.slice(l + m);
      // assuming main side on front
      yield [
        cm.slice(),
        cl.slice().reverse().concat(cr.slice().reverse())
      ];
      // assuming main side on back
      yield [cr.concat(cl), cm.slice()];
    }
  }
}

module.exports = Object.assign(CShapeBedShape, {
  // general flags
  FLIPPED, C_SHAPE,
  // beds
  FRONT, BACK
});