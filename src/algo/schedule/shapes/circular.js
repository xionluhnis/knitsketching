// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const BedShape = require('./base.js');
const {
  Needle,
  CIRCULAR,
  FRONT, BACK, NONE,
  FRONT_LEFT, FRONT_RIGHT, FRONT_BOTH,
  BACK_LEFT, BACK_RIGHT, BACK_BOTH,
  NIBBLE_CODE, NIBBLE_MASK,
  EVEN_NIBBLE_LIST,
  ODD_NIBBLE_LIST
} = BedShape;
const NeedleBlock = require('../block.js');

class CircularBedShape extends BedShape {
  /**
   * Creates a bed layout shape
   * 
   * @param {number} stitchCount number of stitches in the layout
   * @param {number} [nibbles=0] nibble flags
   * @param {number} [roll=0] the rotation count (0 by default)
   */
  constructor(stitchCount, nibbles = NONE, roll = 0){
    super(stitchCount, nibbles | CIRCULAR, roll);
  }
  get roll(){ return this.param; }
  get circular(){ return true; }
  get type(){ return 'circular'; }
  static get validFlags(){ return NIBBLE_MASK | CIRCULAR; }

  toString(){
    return 'Shape(N=' + this.stitchCount
      + ',f=' + this.flags
      + ',r=' + this.roll
      + '|circ,n=' + NIBBLE_CODE[this.nibbles]
      + ')';
  }

  getNeedle(index, baseOffset = 0){
    const { stitchCount, nibbles } = this;
    assert(index < stitchCount, 'Invalid index');
    const roll = (this.roll + index) % stitchCount;
    assert(roll < stitchCount,
      'Roll must be below stitch count', stitchCount, roll);
    // three cases
    if(stitchCount <= 2){
      assert(!nibbles, 'Cannot have nibbles with two stitches only');
      // special case, two options only (and no nibble)
      return new Needle(roll ? FRONT : BACK, baseOffset);

    } else if(stitchCount % 2 === 0){
      // Nibble cases:
      // x is the first stitch for our parameterization
      // then the rest goes CCW
      const halfCount = stitchCount / 2;
      let offset;
      let side;
      switch(nibbles){

        case NONE:
          // oooo   7654    halfCount = 4
          // xooo   0123

          if(roll < halfCount){
            offset = roll;
            side = FRONT;
          } else {
            // folded: oooo|ooox
            //         7654|3210
            // offset = halfCount - 1 - (roll - halfCount);
            offset = stitchCount - 1 - roll; 
            side = BACK;
          }
          break;

        case BACK_BOTH:
          // -oo-   -54-    halfCount = 3
          // xooo   0123
          if(roll < halfCount + 1){
            offset = roll;
            side = FRONT;
          } else {
            // folded: -oo-|ooox
            //         -54-|3210
            // offset = halfCount - 1 - (roll - (halfCount + 1))
            // offset = halfCount + halfCount - roll
            offset = stitchCount - roll;
            side = BACK;
          }
          break;

        case FRONT_BOTH:
          // oooo   5432    halfCount = 3
          // -xo-   -01-
          if(roll < halfCount - 1){
            offset = 1 + roll;
            side = FRONT;
          } else {
            // folded: oooo|-oo-
            //         5432|-10-
            // offset = halfCount - (roll - (halfCount - 1))
            // offset = halfCount + halfCount - 1 - roll
            offset = stitchCount - 1 - roll;
            side = BACK;
          }
          break;

        case FRONT_RIGHT | BACK_LEFT:
          // -ooo   -543   halfCount = 3
          // xoo-   012-
          if(roll < halfCount){
            offset = roll;
            side = FRONT;
          } else {
            // folded: -ooo|-oox
            //         -543|-210
            // offset = halfCount - (roll - halfCount)
            // offset = halfCount + halfCount - roll
            offset = stitchCount - roll;
            side = BACK;
          }
          break;

        case FRONT_LEFT | BACK_RIGHT:
          // ooo-   543-   halfCount = 3
          // -xoo   -012
          if(roll < halfCount){
            offset = 1 + roll;
            side = FRONT;
          } else {
            // folded: ooo-|oox-
            //         543-|210-
            // offset = halfCount - 1 - (roll - halfCount)
            // offset = halfCount + halfCount - 1 - roll
            offset = stitchCount - 1 - roll;
            side = BACK;
          }
          break;
          
        default:
          assert.error('Invalid nibbles combination!',
            stitchCount, nibbles, NIBBLE_CODE[nibbles]);
      }
      return new Needle(side, baseOffset + offset);

    } else {
      // Nibble cases:
      //
      // 1) ooo-
      //    xooo
      // 2) -ooo
      //    xooo
      // 3) oooo
      //    xoo-
      // 4) oooo
      //    -xoo
      const halfCount = (stitchCount + 1) / 2;
      let offset;
      let side;
      switch(nibbles){

        case BACK_RIGHT:
          // ooo-   654-   halfCount = 4
          // xooo   0123
          if(roll < halfCount){
            offset = roll;
            side = FRONT;
          } else {
            // folded: ooo-|ooox
            //         654-|3210
            // offset = halfCount - 2 - (roll - halfCount)
            // offset = (halfCount + halfCount - 1) - 1 - roll
            // /!\ stitchCount = 2 * halfCount - 1
            offset = stitchCount - 1 - roll;
            side = BACK;
          }
          break;

        case BACK_LEFT:
          // -ooo   -654   halfCount = 4
          // xooo   0123
          if(roll < halfCount){
            offset = roll;
            side = FRONT;
          } else {
            // folded: -ooo|ooox
            //         -654|3210
            offset = stitchCount - roll;
            side = BACK;
          }
          break;

        case FRONT_RIGHT:
          // oooo   6543   halfCount = 4
          // xoo-   012-
          if(roll < halfCount - 1){
            offset = roll;
            side = FRONT;
          } else {
            // folded: oooo|-oox
            //         6543|-210
            // offset = halfCount - 1 - (roll - (halfCount - 1))
            // offset = halfCount - 1 - (roll - halfCount + 1)
            // offset = (halfCount + halfCount - 1) - 1 - roll
            offset = stitchCount - 1 - roll;
            side = BACK;
          }
          break;

        case FRONT_LEFT:
          // oooo   6543   halfCount = 4
          // -xoo   -012
          if(roll < halfCount - 1){
            offset = 1 + roll;
            side = FRONT;
          } else {
            // folded: oooo|oox-
            //         6543|210-
            offset = stitchCount - 1 - roll;
            side = BACK;
          }
          break;

        default:
          assert.error('Invalid nibble combination!',
            stitchCount, nibbles, NIBBLE_CODE[nibbles]);
      }
      return new Needle(side, baseOffset + offset);
    }
  }

  getOffsetRange(baseOffset = 0){
    // notes: 
    // 1) min is the minimum offset, included
    // 2) max is the maximum offset, included! (=> halfWidth-1)
    const stitchCount = this.stitchCount;
    if(stitchCount === 2){
      return {
        min: baseOffset, max: baseOffset
      };

    } else if(stitchCount % 2 === 0){
      const halfCount = stitchCount / 2;
      return this.nibbles ? {
        min: baseOffset, max: baseOffset + halfCount
      } : {
        min: baseOffset, max: baseOffset + halfCount - 1
      };

    } else {
      const halfCount = (stitchCount + 1) / 2;
      return {
        min: baseOffset, max: baseOffset + halfCount - 1
      };
    }
  }
  getFrontOffsetRange(baseOffset = 0){
    // notes: 
    // 1) min is the minimum offset, included
    // 2) max is the maximum offset, included! (=> halfWidth-1)
    const stitchCount = this.stitchCount;
    if(stitchCount === 2){
      return {
        min: baseOffset, max: baseOffset
      };

    }
    const nibbles = this.nibbles;
    if(stitchCount % 2 === 0){
      const halfCount = stitchCount / 2;
      switch(nibbles){

        case NONE:
          // oooo   7654    halfCount = 4
          // xooo   0123
          return { min: baseOffset, max: baseOffset + halfCount - 1 };

        case BACK_BOTH:
          // -oo-   -54-    halfCount = 3
          // xooo   0123
          return { min: baseOffset, max: baseOffset + halfCount };

        case FRONT_BOTH:
          // oooo   5432    halfCount = 3
          // -xo-   -01-
          return { min: baseOffset + 1, max: baseOffset + halfCount - 1 };

        case FRONT_RIGHT | BACK_LEFT:
          // -ooo   -543   halfCount = 3
          // xoo-   012-
          return { min: baseOffset, max: baseOffset + halfCount - 1 };

        case FRONT_LEFT | BACK_RIGHT:
          // ooo-   543-   halfCount = 3
          // -xoo   -012
          return { min: baseOffset + 1, max: baseOffset + halfCount };
          
        default:
          assert.error('Invalid nibbles combination!', nibbles);
      }

    } else {
      const halfCount = (stitchCount + 1) / 2;
      switch(nibbles){

        case BACK_RIGHT:
          // ooo-   654-   halfCount = 4
          // xooo   0123
          return { min: baseOffset, max: baseOffset + halfCount - 1 };

        case BACK_LEFT:
          // -ooo   -654   halfCount = 4
          // xooo   0123
          return { min: baseOffset, max: baseOffset + halfCount - 1 };

        case FRONT_RIGHT:
          // oooo   6543   halfCount = 4
          // xoo-   012-
          return { min: baseOffset, max: baseOffset + halfCount - 2 };

        case FRONT_LEFT:
          // oooo   6543   halfCount = 4
          // -xoo   -012
          return { min: baseOffset + 1, max: baseOffset + halfCount - 1 };

        default:
          assert.error('Invalid nibble combination!', nibbles);
      }
    }
  }
  getBackOffsetRange(baseOffset = 0){
    // notes: 
    // 1) min is the minimum offset, included
    // 2) max is the maximum offset, included! (=> halfWidth-1)
    const stitchCount = this.stitchCount;
    if(stitchCount === 2){
      return {
        min: baseOffset, max: baseOffset
      };

    }
    const nibbles = this.nibbles;
    if(stitchCount % 2 === 0){
      const halfCount = stitchCount / 2;
      switch(nibbles){

        case NONE:
          // oooo   7654    halfCount = 4
          // xooo   0123
          return { min: baseOffset, max: baseOffset + halfCount - 1 };

        case BACK_BOTH:
          // -oo-   -54-    halfCount = 3
          // xooo   0123
          return { min: baseOffset + 1, max: baseOffset + halfCount - 1 };

        case FRONT_BOTH:
          // oooo   5432    halfCount = 3
          // -xo-   -01-
          return { min: baseOffset, max: baseOffset + halfCount };

        case FRONT_RIGHT | BACK_LEFT:
          // -ooo   -543   halfCount = 3
          // xoo-   012-
          return { min: baseOffset + 1, max: baseOffset + halfCount };

        case FRONT_LEFT | BACK_RIGHT:
          // ooo-   543-   halfCount = 3
          // -xoo   -012
          return { min: baseOffset, max: baseOffset + halfCount - 1 };
          
        default:
          assert.error('Invalid nibbles combination!', nibbles);
      }

    } else {
      const halfCount = (stitchCount + 1) / 2;
      switch(nibbles){

        case BACK_RIGHT:
          // ooo-   654-   halfCount = 4
          // xooo   0123
          return { min: baseOffset, max: baseOffset + halfCount - 2 };

        case BACK_LEFT:
          // -ooo   -654   halfCount = 4
          // xooo   0123
          return { min: baseOffset + 1, max: baseOffset + halfCount - 1 };

        case FRONT_RIGHT:
          // oooo   6543   halfCount = 4
          // xoo-   012-
          return { min: baseOffset, max: baseOffset + halfCount - 1 };

        case FRONT_LEFT:
          // oooo   6543   halfCount = 4
          // -xoo   -012
          return { min: baseOffset, max: baseOffset + halfCount - 1 };

        default:
          assert.error('Invalid nibble combination!', nibbles);
      }
    }
  }
  getSideRange(){ return NeedleBlock.BOTH; }

  /**
   * Generator enumerating all circular layouts
   * for a given number of stitches.
   * 
   * The "simple" case does not allow nibbles for even stitch numbers.
   * 
   * @param {number} stitchCount number of stitches in the layout
   * @param {boolean} [simple=false] whether we have an simpler case
   * @yield {CircularBedShape} all possible circular layouts
   */
  static *shapes(stitchCount, simple = false){
    assert(stitchCount, 'Empty layout?');
    if(stitchCount === 1){
      // special case N=1
      yield new CircularBedShape(1, CIRCULAR, 0);

    } else if(stitchCount === 2){
      // special case N=2
      yield new CircularBedShape(2, CIRCULAR, 0);
      yield new CircularBedShape(2, CIRCULAR, 1);

    } else if(stitchCount % 2 === 0){
      // even layouts => 5N cases (or N in the simple case)
      for(let i = 0; i < stitchCount; ++i){
        if(simple){
          yield new CircularBedShape(stitchCount, CIRCULAR, i);
          continue;
        }
        for(const flag of EVEN_NIBBLE_LIST)
          yield new CircularBedShape(stitchCount, CIRCULAR | flag, i);
      }

    } else {
      // odd layouts => 4N cases
      for(let i = 0; i < stitchCount; ++i){
        for(const flag of ODD_NIBBLE_LIST)
          yield new CircularBedShape(stitchCount, CIRCULAR | flag, i);
      }
    } // endif stitchCount type
  }

  /**
   * Generates the set of splitting pairs [front, back]
   * that can be represented by a circular layout.
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
    // we have N > 1 from here on
    const H = Math.floor(N/2);
    if(N % 2 === 1){
      // odd case
      for(let i = 0; i < N; ++i){
        const f = [];
        const b = [];
        for(let j = 0; j < H; ++j){
          f.push(crs[(i + j) % N]);
          b.push(crs[(i + j + H + 1) % N]);
        }
        const m = crs[(i + H) % N]; // middle odd sample
        yield [f.concat([m]), b];
        yield [f, [m].concat(b)];
      }
    } else {
      // even case
      for(let i = 0; i < N; ++i){
        const f = [];
        const b = [];
        for(let j = 0; j < H; ++j){
          f.push(crs[(i + j) % N]);
          b.push(crs[(i + j + H) % N]);
        }
        yield [f, b];
      }
    }
  }
}

module.exports = Object.assign(CircularBedShape, {
  // general flags
  CIRCULAR,
  // nibbles
  NONE,
  FRONT_LEFT, FRONT_RIGHT, FRONT_BOTH,
  BACK_LEFT, BACK_RIGHT, BACK_BOTH,
  // beds
  FRONT, BACK
});