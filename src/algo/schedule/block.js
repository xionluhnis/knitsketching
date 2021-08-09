// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
// const BedShape = require('./shape.js');
// const Cost = require('./cost.js');

// constants
const NONE  = 0;
const FRONT = 1;
const BACK  = 2;
const BOTH  = FRONT | BACK;

class NeedleBlock {
  constructor(needles = [], side = NONE, min = [NaN, NaN], max = [NaN, NaN]){
    // needle list
    this.needles = needles;
    // extents
    this.side = side;
    this.min  = min;
    this.max  = max;
  }

  isTwoSided(){ return this.side === BOTH; }
  hasFront(){ return (this.side & FRONT) !== 0; }
  hasBack(){ return (this.side & BACK) !== 0; }
  matches(blk){
    if(!blk
    || blk.needles.length !== this.needles.length
    || blk.side !== this.side)
      return false;
    // each existing extents must match
    for(const s of this.sides()){
      if(this.left(s) !== blk.left(s)
      || this.right(s) !== blk.right(s))
        return false;
    }
    return true;
  }

  left(side = BOTH){
    // if asking for a specific side, return its min value
    if(side !== BOTH)
      return this.min[side - 1];
    // else, depends on the side flag
    switch(this.side){
      case NONE:
        return 0;
      case FRONT:
      case BACK:
        return this.min[this.side - 1];
      case BOTH:
        return Math.min(this.min[0], this.min[1]);
      default:
        assert.error('Invalid side flag', this.side);
        return NaN;
    }
  }

  right(side = BOTH){
    if(side !== BOTH)
      return this.max[side - 1];
    // else depends on side flag
    switch(this.side){
      case NONE:
        return 0;
      case FRONT:
      case BACK:
        return this.max[this.side - 1];
      case BOTH:
        return Math.max(this.max[0], this.max[1]);
      default:
        assert.error('Invalid side flag', this.side);
        return NaN;
    }
  }

  width(side = BOTH){
    if(this.side === NONE)
      return 0;
    else
      return this.right(side) - this.left(side) + 1;
  }

  *sides(){
    if(this.side & FRONT) yield FRONT;
    if(this.side & BACK)  yield BACK;
  }

  static *sidesOf(flag){
    if(flag & FRONT) yield FRONT;
    if(flag & BACK)  yield BACK;
  }

  trimLeft(useNeedles = true){
    const leftPad = this.left();
    if(leftPad === 0)
      return this;
    const min = this.min.slice();
    const max = this.max.slice();
    for(const side of this.sides()){
      min[side-1] -= leftPad;
      max[side-1] -= leftPad;
    }
    return new NeedleBlock(
      useNeedles ? this.needles.map(n => n.shiftedBy(-leftPad)) : [],
      this.side, min, max
    );
  }

  copy(){
    return new NeedleBlock(this.needles, this.side, this.min, this.max);
  }

  rightExtend(blk, padding = 0){
    return this.rightMerge(blk, padding, false);
  }

  rightMerge(blk, padding = 0, useNeedles = true){
    if(blk.side === NONE)
      return this.copy();
    else if(this.side === NONE)
      return blk.copy();
    // else, we need to merge the two,
    // which depends on their respective needle extents
    const newSide = this.side | blk.side;
    if(this.side & blk.side){
      // overlap in side => to the right (with some padding)
      const offset = this.right(blk.side) + padding + 1;
      const min = [ NaN, NaN ];
      const max = [ NaN, NaN ];
      for(const side of NeedleBlock.sidesOf(newSide)){
        const s = side - 1;
        // min on left
        if(this.side & side)
          min[s] = this.min[s];
        else
          min[s] = blk.min[s] + offset;
        // max on right
        if(blk.side & side)
          max[s] = blk.max[s] + offset;
        else
          max[s] = this.max[s];
      }
      return new NeedleBlock(
        useNeedles ?
          this.needles.concat(blk.needles.map(n => n.shiftedBy(offset)))
        : [],
        newSide, min, max
      );

    } else {
      assert(newSide === BOTH, 'New side is invalid');
      // no overlap in sides => independent merging of each side block
      // note: no padding used here
      const [fBlk, bBlk] = this.side & FRONT ? [this, blk] : [blk, this];
      return new NeedleBlock(
        useNeedles ? this.needles.concat(blk.needles) : [],
        newSide,
        [fBlk.min[0], bBlk.min[1]],
        [fBlk.max[0], bBlk.max[1]]
      );
    }
  }

  static extentsOf(needles, baseOffset = 0){
    let sideFlag = NONE;
    let min = [ NaN, NaN ];
    let max = [ NaN, NaN ];
    // if empty needle list, trivial extents
    if(!needles.length)
      return [sideFlag, min, max];
    // else go over needles
    for(const n of needles){
      // update side
      const side = n.inFront() ? FRONT : BACK;
      sideFlag |= side;
      // update offset
      const s = side - 1;
      const offset = n.offset + baseOffset;
      if(typeof min[s] !== 'number' || Number.isNaN(min[s])){
        // first needle on that side
        max[s] = min[s] = offset;
      } else {
        // later needle on that side
        max[s] = Math.max(max[s], offset);
        min[s] = Math.min(min[s], offset);
      }
    }
    return [sideFlag, min, max];
  }

  /**
   * Create a needle block from a shape layout and a list of needle indices
   * 
   * @param {BedShape} shape a shape layout
   * @param {number[]?} [indices=null] a list of needle indices (or null for all)
   * @param {number} [baseOffset=0] the base offset to apply to needles
   * @param {boolean} [removeLeft=false] whether to remove any left padding
   * @return {NeedleBlock} the corresponding needle block
   */
  static fromShape(shape, indices = null, baseOffset = 0, removeLeft = false){
    if(Array.isArray(indices) && !indices.length)
      return new NeedleBlock();
    // else we get the needles from the shape
    return NeedleBlock.fromNeedles(shape.getNeedles(indices), baseOffset, removeLeft);
  }

  /**
   * Create a needle block from a list of needles
   * 
   * @param {array} needles a list of needles
   * @param {number} [baseOffset=0] the base offset to apply to needles
   * @param {boolean} [removeLeft=false] whether to remove any left padding
   * @return {NeedleBlock} the corresponding needle block
   */
  static fromNeedles(needles, baseOffset = 0, removeLeft = false){
    assert(Array.isArray(needles), 'Needles must be an array');
    // remove any left padding if requested to
    if(removeLeft){
      let leftPad = needles.reduce((min, n) => Math.min(min, n.offset), Infinity);
      if(leftPad)
        needles = needles.map(n => n.shiftedBy(-leftPad));
    }
    return new NeedleBlock(needles, ...NeedleBlock.extentsOf(needles, baseOffset));
  }

  /**
   * Merge a sequence of blocks into a single block
   * 
   * @param {NeedleBlock[]} blocks a left-to-right list of blocks
   * @param {number} padding the padding to apply between blocks
   * @param {boolean} keepNeedles whether to keep the needles
   * @return {NeedleBlock} the aggregated needle block
   */
  static merge(blocks, padding = 0, keepNeedles = true){
    let block = blocks[0];
    for(let i = 1; i < blocks.length; ++i)
      block = block.rightMerge(blocks[i], padding, keepNeedles);
    return block;
  }

  /**
   * Pack a sequence of shapes from left to right and return the shape offsets
   * 
   * @param {BedShape[]} shapes a list of left-to-right shapes
   * @param {number[][]} [indexes] a list of needle index lists (one per shape)
   * @param {Object} [options] packing options
   * @param {number[]} [options.paddings] list of left padding values
   * @param {number} [options.padding] default padding value to use
   * @param {number} [options.padding] the padding between blocks (0 by default)
   * @param {number} [options.baseOffset] the base offset to use (0 by default)
   * @param {boolean} [options.removeLeft] whether to remove any left shape offset (true by default)
   * @return {number[]} the packed offsets of the shapes
   */
  static packShapesToLeft(
    shapes, indexes = null, {
      paddings = [], padding = 0, removeLeft = true
    } = {}
  ){
    const blocks = shapes.map((shape, i) => {
      if(!indexes)
        return shape.getNeedleBlock();
      // note: do not remove left side here
      return NeedleBlock.fromShape(shape, indexes[i], 0, false);
    });
    if(removeLeft){
      return NeedleBlock.packToLeft(
        blocks.map(blk => blk.trimLeft(false)), // remove left padding here
        { paddings, padding }
      ).map((offset, idx) => {
        return offset - blocks[idx].left(); // to account for existing left padding
      });
    } else {
      return NeedleBlock.packToLeft(blocks, { paddings, padding });
    }
  }

  /**
   * Pack a sequence of needle blocks from left to right
   * and returns their corresponding offsets
   * 
   * @param {NeedleBlock[]} blocks a list of left-to-right blocks
   * @param {Object} [options] a set of options
   * @param {number[]} [options.paddings] list of individual left paddings
   * @param {number} [options.padding] the default padding to use
   * @return {number[]} the packed offsets of the blocks
   */
  static packToLeft(blocks, { paddings = [], padding = 0 } = {}){
    const offsets = [ paddings[0] || padding ];
    const left = offsets[0]; // for alignment
    let block = blocks[0];
    for(let i = 1; i < blocks.length; ++i){
      const blk = blocks[i];
      const interBed = blk.side & block.side;
      block = block.rightExtend(blk, paddings[i] || padding);
      // offset depends on the interaction
      if(interBed){
        // new block has interaction side with previous pack
        // => can use right offset to measure expected offset of block
        // /!\ however we must check both sides
        // Examples:
        // ooo- | xx      oooxx
        // oooo | -x  =>  oooox
        //  r=3  r=1       r=4
        // br=2 br=1      br=4
        // fr=3 fr=1      fr=4
        //
        // full.right(BOTH) - last.right(BOTH) = 4 - 1 = 3 (correct)
        // full.right(BACK) - last.right(BACK) = 4 - 1 = 3 (correct)
        // full.right(FRNT) - last.right(FRNT) = 4 - 1 = 3 (correct)
        //
        // o--- | xx      oxx-
        // oooo | --  =>  oooo
        //  r=3  r=1       r=3
        // br=0 br=1      br=2
        // fr=3 fr=NaN    fr=3
        //
        // full.right(BOTH) - last.right(BOTH) = 3 - 1 = 2 (incorrect!)
        // full.right(BACK) - last.right(BACK) = 2 - 1 = 1 (correct)
        // full.right(FRNT) - last.right(FRNT) = NaN
        offsets[i] = Infinity;
        for(const side of blk.sides()){
          offsets[i] = Math.min(
            offsets[i], left + block.right(side) - blk.right(side)
          );
        }
        assert(Number.isFinite(offsets[i]),
          'Invalid offset computation');

      } else {
        // new block has no interaction side with previous block
        // => it gets put to the left (based on padding)
        offsets[i] = left;
      }
    }
    return offsets;
  }
}

module.exports = Object.assign(NeedleBlock, {
  NONE, FRONT, BACK, BOTH
});