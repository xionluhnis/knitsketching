// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const NeedleBlock = require('./block.js');

// constants
const maxBlockPasses = 100;
const adaptiveWindows = [NaN, 25, 10, 3];
const L2 = 'l2';
const L1 = 'l1';
const L0 = 'l0';

/**
 * Wrapper for the offset optimization
 */
class OffsetOptimizer {
  constructor(blocks, {
    simpleOffsets = false,
    offsetError = L0,
    verbose = false
  } = {}){
    // input
    this.blocks = blocks;
    this.simpleOffsets = simpleOffsets;
    this.verbose = verbose;

    // block states
    const N = this.blocks.length;
    this.nblocks = new Array(N);
    this.gaps = new Array(N);
    this.blkCostCache = new Array(N);
    this.rowCost = new Array(N);
    this.rowDone = new Array(N);
    this.blockPass = 0;
    
    // costs
    this.shiftCost      = Infinity;
    this.ltrShiftCost   = Infinity;
    this.alignShiftCost = Infinity;
    this.offsetError    = offsetError;
    switch(offsetError){
      case L2: this.errFun = x => x * x; break;
      case L1: this.errFun = x => Math.abs(x); break;
      case L0: this.errFun = x => x ? 1 : 0; break;
      default:
        console.warn('Invalid offset error', offsetError);
        console.warn('Using L0 error instead');
        this.errFun = x => x ? 1 : 0;
        break;
    }
  }

  pack(){
    // LTR packing with gaps=0
    const N = this.blocks.length;
    let shiftCost = 0;
    for(let i = 0; i < N; ++i){
      const ltrBlocks = this.blocks[i];
      this.nblocks[i] = ltrBlocks.map(b => b.block);
      this.gaps[i] = ltrBlocks.map(() => 0);
      this.blkCostCache[i] = ltrBlocks.map(() => new Map());
      this.rowCost[i] = Infinity; // need constraints!
      this.rowDone[i] = false;
      const offsets = NeedleBlock.packToLeft(this.nblocks[i], {
        paddings: this.gaps[i]
      });
      for(let col = 0; col < ltrBlocks.length; ++col)
        ltrBlocks[col].offset = offsets[col];

      if(i == 0)
        continue; // no shift data yet
      // compute shift costs from past row
      const prevBlocks = this.blocks[i-1];
      for(let cp = 0; cp < prevBlocks.length; ++cp){
        for(let cc = 0; cc < ltrBlocks.length; ++cc){
          const cost = prevBlocks[cp].getShiftsTo(
            ltrBlocks[cc], prevBlocks[cp].offset,
            ltrBlocks[cc].offset, this.errFun
          );
          assert(!Number.isNaN(cost), 'Invalid cost computation');
          shiftCost += cost;
        } // endfor cc < #ltrBlocks
      } // endfor cp < #prevBlocks
    }
    this.ltrShiftCost = shiftCost;
  }

  align(){
    // = do initial pass that aligns the blocks based
    //   purely on the alignment with the previous row
    // => only change the leftmost gap (can be negative!)
    let shiftCost = 0;
    for(let row = 1; row < this.blocks.length; ++row){
      const prevBlocks = this.blocks[row-1];
      const ltrBlocks = this.blocks[row];
      const getShiftCost = shift => {
        let cost = 0;
        for(const prevBlk of prevBlocks){
          for(const currBlk of ltrBlocks){
            cost += prevBlk.getShiftsTo(currBlk,
              prevBlk.offset, currBlk.offset + shift,
              this.errFun
            );
          }
        }
        assert(!Number.isNaN(cost), 'Invalid cost computation');
        return cost;
      };
      const width = ltrBlocks.reduce((max, blk) => {
        return Math.max(max, blk.block.right());
      }, -Infinity);
      assert(width > 0, 'Invalid block extent', width);
      // just test all offsets in [-width;+width]
      let bestShift = 0;
      let bestCost = Infinity;
      for(let shift = -width; shift <= width; ++shift){
        const cost = getShiftCost(shift);
        if(cost < bestCost){
          bestShift = shift;
          bestCost = cost;
        }
      }
      assert(Number.isFinite(bestCost), 'No shift found!');
      // use best shift as initial gap for this row
      this.gaps[row][0] = bestShift;
      const offsets = NeedleBlock.packToLeft(this.nblocks[row], {
        paddings: this.gaps[row]
      });
      for(let col = 0; col < ltrBlocks.length; ++col){
        const colOffset = ltrBlocks[col].offset + bestShift;
        assert(colOffset === offsets[col]
          || (colOffset + 1 == offsets[col] && this.gaps[col] === 1),
          'Incoherent row shift');
        ltrBlocks[col].offset = offsets[col];
      }

      assert(bestCost === getShiftCost(0),
        'Invalid best cost');

      shiftCost += bestCost;
    }
    this.shiftCost = this.alignShiftCost = shiftCost;
  }

  getOffsetCost(rowIdx, colIdx, offset){
    const cache = this.blkCostCache[rowIdx][colIdx];
    let blkCost;
    if(!cache.has(offset)){
      blkCost = 0; // shift cost between this row and its neighbors
      const thisBlk = this.blocks[rowIdx][colIdx];
      const prevRow = this.blocks[rowIdx - 1];
      if(prevRow){
        for(const prevBlk of prevRow){
          blkCost += prevBlk.getShiftsTo(
            thisBlk, prevBlk.offset, offset,
            this.errFun
          );
        }
      }
      const nextRow = this.blocks[rowIdx + 1];
      if(nextRow){
        for(const nextBlk of nextRow){
          blkCost += thisBlk.getShiftsTo(
            nextBlk, offset, nextBlk.offset,
            this.errFun
          );
        }
      }
      cache.set(offset, blkCost);
  
    } else {
      blkCost = cache.get(offset);
    }
    assert(!Number.isNaN(blkCost), 'Invalid cost computation');
    return blkCost;
  }

  *gapsAround(startGaps){
    const w = adaptiveWindows[startGaps.length] || adaptiveWindows[adaptiveWindows.length - 1];
    const gapRanges = startGaps.map((gap, idx) => {
      const rng = [ gap ];
      for(let i = 1; i <= w; ++i){
        rng.push(gap + i);
        if(idx === 0 || gap - i >= 0)
          rng.push(gap - i);
      }
      return rng;
    });
    const gapIndex = gapRanges.map(() => 0);
    const gaps = startGaps.slice(); // copy of original
    yieldLoop:
    while(true){
      // update gap list by increasing the first index
      let complete = false;
      for(let i = 0; i < gaps.length && !complete; ++i){
        if(++gapIndex[i] >= gapRanges[i].length){
          gapIndex[i] = 0;
          // check whether this was the last index
          if(i === gaps.length - 1)
            break yieldLoop; // no more gap to test

        } else {
          complete = true;
        }
        gaps[i] = gapRanges[i][gapIndex[i]];
      }
      yield gaps;
    }
  }

  optimize(){
    // special version
    if(this.simpleOffsets){
      return true;
    }
    // compute block spacing to minimize L1 distance between matching needles
    // across all blocks
    if(this.blockPass >= maxBlockPasses)
      return true;

    // debug initial offset cost computation
    if(this.verbose && this.blockPass === 0){
      let totalCost = 0;
      for(let row = 0; row < this.blocks.length; ++row){
        const ltrBlocks = this.blocks[row];
        for(let col = 0; col < ltrBlocks.length; ++col){
          const blk = ltrBlocks[col];
          const cost = this.getOffsetCost(row, col, blk.offset);
          totalCost += cost;
        }
      }
      // got contributions twice
      assert(totalCost === this.shiftCost * 2,
        'Total cost does not match');
    }

    // go once forward and once backward
    const N = this.blocks.length;
    let changed = false;
    for(const [start, end, dir] of [[0, N-1, 1], [N-1, -1, -1]]){
      for(let row = start; row !== end; row += dir){
        if(this.rowDone[row])
          continue; // can skip
        const ltrBlocks = this.blocks[row];
        const pckBlocks = this.nblocks[row];
        // check which block has a shape (i.e. not suspended)
        const shapingIdx = ltrBlocks.findIndex(blk => blk.hasShape());
        let shapeChanging = false;
        let currBlk = null, nextBlk = null;
        if(shapingIdx !== -1){
          // if the shape changes, we definitely need a gap
          currBlk = ltrBlocks[shapingIdx];
          shapeChanging = currBlk.shapeChanges();

          // compute next block if existing
          if(this.blocks[row+1])
            nextBlk = this.blocks[row+1][shapingIdx];
        }

        // cost for the whole row
        // including hard constraint on 
        const getRowCost = paddings => {
          // if shaping, we need some gap
          if(shapeChanging
            && !paddings[shapingIdx]
            && !paddings[shapingIdx+1]
          ){
            return Infinity; // not a valid option since no gap set
          }

          // do LTR packing
          const offsets = NeedleBlock.packToLeft(pckBlocks, { paddings });
          
          // check for gap requirement
          // XXX likely different constraints for flat shapes!!!
          if(shapingIdx !== -1
          && currBlk && currBlk.isCircular()
          && nextBlk){
            // /!\ need to check that we have the proper gap for shaping
            // = check constraint satisfaction

            // check maximum occupancy on the left
            const currLeft = offsets[shapingIdx];
            const nextLeft = nextBlk.offset;
            const left = Math.min(currLeft, nextLeft);
            let maxLeft = -Infinity;
            for(let col = 0; col < shapingIdx; ++col){
              maxLeft = Math.max(maxLeft,
                offsets[col] + ltrBlocks[col].block.right()
              );
            }
            if(maxLeft >= left)
              return Infinity; // overlapping => not enough gap

            // check maximum occupancy on the right
            const currRight = currLeft + currBlk.width() - 1;
            const nextRight = nextLeft + nextBlk.width() - 1;
            const right = Math.max(currRight, nextRight);
            let minRight = Infinity;
            for(let col = shapingIdx + 1; col < ltrBlocks.length; ++col){
              minRight = Math.min(minRight,
                offsets[col] + ltrBlocks[col].block.left()
              );
            }
            if(minRight <= right)
              return Infinity; // overlapping => not enough gap
            
            // if shaping, we need ... some gap
            if(shapeChanging
            && maxLeft === currLeft - 1
            && minRight === currRight + 1)
              return Infinity; // no gap at all => unsafe!

            // else, the constraints are satisfied
          }

          // valid gap option!
          // get cost of whole row
          let rowCost = 0;
          for(let col = 0; col < ltrBlocks.length; ++col)
            rowCost += this.getOffsetCost(row, col, offsets[col]);
          return rowCost;
        };

        // compute current row cost
        const lastGaps = this.gaps[row];
        const lastRowCost = getRowCost(lastGaps);
        let bestGaps = lastGaps;
        let bestRowCost = lastRowCost;
        for(const newGaps of this.gapsAround(lastGaps)){
          const newCost = getRowCost(newGaps);
          if(newCost < bestRowCost){
            bestGaps = newGaps.slice(); // keep copy
            bestRowCost = newCost;
          }
        }
        // check if something happened
        if(bestRowCost < lastRowCost){
          // found a better option
          // 1. Update this row's gaps
          this.gaps[row] = bestGaps;
          // 2. Apply offsets
          // /!\ necessary for other rows to take them into account
          const offsets = NeedleBlock.packToLeft(pckBlocks, {
            paddings: bestGaps
          });
          for(let col = 0; col < ltrBlocks.length; ++col)
            ltrBlocks[col].offset = offsets[col];
          // 3. Invalidate the adjacent rows
          for(const nrow of [row-1, row+1]){
            if(nrow < 0 || this.blocks.length <= nrow)
              continue; // not a valid row => end or start
      
            // clear adjacent caches
            for(const cache of this.blkCostCache[nrow])
              cache.clear();

            // update flag
            this.rowDone[nrow] = false;
          }
          // note: we do not clear the cache of this row
          // since it can be reused (unless the adjacent rows change too)
          // this.rowDone[row] = false; // already the case!
          changed = true;

          // update best row cost
          this.rowCost[row] = bestRowCost;

        } else {
          // if the gaps are valid, then
          // no need to visit this row unless an adjacent row changes
          this.rowCost[row] = lastRowCost;
          this.rowDone[row] = Number.isFinite(lastRowCost); // valid!
        }
      } // endfor row
    } // endfor [start, end, dir]
    
    // done state depends on number of passes
    // as well as whether the current pass ends up changing anything
    const done = ++this.blockPass >= maxBlockPasses || !changed;
    if(done){
      // compute total shift cost
      this.shiftCost = this.rowCost.reduce((sum, cost) => sum + cost, 0) / 2;
      assert(Number.isFinite(this.shiftCost),
        'Some gap constraints are not valid. Offset optimization failed.');

      // debug
      if(this.verbose){
        console.log(
          'Offset cost: pack=' + this.ltrShiftCost
        + ', align=' + this.alignShiftCost
        + ' | constr-opt=' + this.shiftCost
        + ', in ' + this.blockPass + ' pass(es)'
        );
      }
    }
    return done;
  }

  progress(){
    return this.blockPass / maxBlockPasses;
  }
}

module.exports = OffsetOptimizer;