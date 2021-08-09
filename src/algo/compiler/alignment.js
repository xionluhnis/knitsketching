// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const ProgramFragment = require('./fragment.js');
const TransferPass = require('./transfer.js');
const { /* Needle, */ FRONT, BACK } = require('../../knitout.js');
class AlignmentPass extends TransferPass {
  constructor(settings, options){
    super(settings, ProgramFragment.ALIGNMENT_PASS, options);
    // parameters
    this.stashAll = settings.stashAll || false;
    this.stashAlways = settings.stashAlways || false;
  }

  computeUnsafeSequence(
    state,
    sources = this.sources,
    targets = this.targets
  ){
    if(!sources.length)
      return;
    // compute pairs of moves while filtering those
    // whose starting needle is currently empty (because of patterns)
    const fmoves = [];
    const bmoves = [];
    for(const [i, sn] of sources.entries()){
      if(state.getBed(sn.side).isEmpty(sn))
        continue; // skip empty needle move
      const tn = targets[i];
      assert(sn.side === tn.side, 'Source and target on different sides');
      if(sn.side !== tn.side){
        assert.error('Source and target needles have different sides');
        continue;
      }
      const offset = tn.offset - sn.offset;
      if(!offset)
        continue; // no need to change location
      // else we create the move entry
      (sn.inFront() ? fmoves : bmoves).push([sn, offset]);
    }

    // sort moves by source offset => have it in LTR ordering
    for(const moves of [fmoves, bmoves])
      moves.sort(([s1], [s2]) => s1.offset - s2.offset);

    // measure of remaining total offsets to apply
    const sumOfAbs = (sum, [, off]) => sum + Math.abs(off);

    // create sequence of moves
    this.sequence.clear();
    const beds = {
      [FRONT]: fmoves,
      [BACK]: bmoves
    };
    // create state copy (to modify locally)
    state = state.copy();
    const rack = r => {
      // check if racking needed
      // in which case, apply on virtual machine
      if(state.racking !== r)
        state.rack(r);
    };
    const xfer = (sn, tn) => {
      // execute on virtual machine
      state.xfer(sn, tn);
      // store transfer entry (for execution in Knitout)
      this.addTransfer(sn, tn);
    };
    while(beds[FRONT].length || beds[BACK].length){

      // go over side passes
      for(const side of [FRONT, BACK]){
        const moves = beds[side];
        if(!moves.length)
          continue; // done here
        // align beds
        rack(0);
  
        // measure absolute extent of shifts
        const preSum = moves.reduce(sumOfAbs, 0);
  
        // the other slider bed should be empty upon starting
        assert(state.getSliderBed(side).isEmpty(),
          'Other slider bed is not empty');
  
        // stash to other bed
        if(this.stashAll){
          // stash whole bed (for safety)
          for(const sn of state.getBed(side).needleKeys())
            xfer(sn, sn.otherSlider());
  
        } else {
          // only stash active moves
          for(const [sn] of moves)
            xfer(sn, sn.otherSlider());
        }
  
        // compute groups of moves
        const groups = new Map();
        for(const m of moves){
          const shift = Math.max(-2, Math.min(2, m[1]));
          if(groups.has(shift))
            groups.get(shift).push(m);
          else
            groups.set(shift, [m]);
        }
  
        // do transfers by group
        const shifts = Array.from(groups.keys()).sort((o1, o2) => o1 - o2);
        for(const [i, shift] of shifts.entries()){
          const grp = groups.get(shift);
          assert(Array.isArray(grp) && grp.length, 'Empty group');
          
          // set appropriate racking
          const sn0 = grp[0][0];
          const r = sn0.otherSlider().rackingTo(sn0.shiftedBy(shift));
          rack(r);
  
          // do group transfer
          for(const m of grp){
            const sn = m[0];
            xfer(sn.otherSlider(), sn.shiftedBy(shift));
            m[0] = sn.shiftedBy(shift);
            m[1] -= shift; // apply change of offset requirement
          }
          
          // if we need to always be stashed
          // then stash back on other side (unless that was the last shift)
          if(this.stashAll
          && this.stashAlways
          && i < shifts.length - 1){
            // stash back
            rack(0);
            for(const [sn] of grp)
              xfer(sn, sn.otherSlider());
          }
        } // endfor [i, shift] of shifts.entries()
  
        // if we were stashing all and keeping it stashed
        // then now we should stash back anything remaining on slider
        if(this.stashAll && this.stashAlways){
          rack(0);
          // unstash whole bed back
          for(const n of state.getSliderBed(side).needleKeys())
            xfer(n, n.otherHook());
        }
        // the other slider bed should be empty by now
        assert(state.getSliderBed(side).isEmpty(),
          'Other slider bed is not empty');
  
        // filter out moves that reached their target (offset=0)
        beds[side] = moves.filter(([, offset]) => offset !== 0);
  
        // check that we got better
        const postSum = beds[side].reduce(sumOfAbs, 0);
        assert(postSum < preSum,
          'Offset target did not reduce');
      } // endfor side of sides
    } // endwhile #fmoves || #bmoves
  }

  computeSequence(state){
    // compute full bed with target moves
    const targetMap = new Map();
    for(let i = 0; i < this.sources.length; ++i){
      const sn = this.sources[i];
      const tn = this.targets[i];
      targetMap.set(sn.toString(), tn);
    }
    const fronts = state.beds.get('f').sortedNeedles((n1,n2) => {
      return n1.offset - n2.offset;
    });
    const rbacks = state.beds.get('b').sortedNeedles((n1,n2) => {
      return n2.offset - n1.offset;
    });
    const needles = fronts.concat(rbacks);
    const targets = needles.map(n => {
      const nkey = n.toString();
      return targetMap.get(nkey) || n;
    });

    // get transfer problem parameters
    const xferParams = this.getParams(
      state, needles, targets, false // no expansion to half-gauge
    );

    // XXX use full bed, not just sources/targets
    // XXX generate appropriate slack information
    const seq = this.shift(
      state.asCopy(), needles, targets,
      xferParams, true
    );
    this.appendSequence(seq);
  }

  static fromBlock(block, ...args){
    const curr = block.row.filter(blk => !blk.hasShape());
    assert(block.next, 'No next block for an active block');
    const next = block.next.row;
    return AlignmentPass.fromRows(curr, next, true, ...args);
  }

  static fromRows(curr, next, sameStitches, ...args){
    assert(curr.every(blk => !blk.hasShape()),
      'Should not try to align an active block');
    const stitches = [];
    const sources = [];
    const targets = [];
    const srcSet = new Set();
    const trgSet = new Set();
    for(const sblk of curr){
      for(const tblk of next){
        const pairs = sblk.stressPairsTo(tblk) || [];
        for(const [srcIdx, trgIdx] of pairs){
          const sn = sblk.getNeedle(srcIdx);
          const tn = tblk.getNeedle(trgIdx);
          // the bed side should be the same (shift only!)
          assert(sn.side === tn.side,
            'Source and target have different bed sides');
          // we only need to do a shift if
          // the source and target needles are different
          // /!\ and the needle actually exists!!!
          // note: if applying programs, the needle may be empty (moves!)
          if(sn.offset !== tn.offset){
            const stitch = sblk.stitches[srcIdx];
            stitches.push(stitch);
            const nextStitch = tblk.stitches[trgIdx];
            if(!nextStitch.matches(stitch)){
              if(sameStitches)
                assert.error('Offset is between different stitches');
              else {
                // must be two consecutive stitches at an interface
                assert(stitch.getNextWales().some(nws => nws.matches(nextStitch)),
                  'Alignment between unrelated stitches');
              }
            }
            sources.push(sn);
            targets.push(tn);
          }
  
          // check that they are both new, and in hook (not slider!)
          assert(!srcSet.has(sn.toString()),
            'Source shifts to multiple locations!');
          assert(!trgSet.has(tn.toString()),
            'Multiple sources shift to a target location');
          assert(sn.inHook() && tn.inHook(),
            'Source or target is not in hook');
  
          // and remember for checking uniqueness
          srcSet.add(sn.toString());
          trgSet.add(tn.toString());
        } // endfor [srcIdx, trgIdx] of pairs
      } // endfor tblk of nextRow
    } // endfor sblk of currRow
    return new AlignmentPass({ stitches, sources, targets }, ...args);
  }
}

module.exports = AlignmentPass;