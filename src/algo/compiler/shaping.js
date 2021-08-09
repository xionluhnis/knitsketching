// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const ProgramFragment = require('./fragment.js');
const TransferPass = require('./transfer.js');
const { Needle } = require('../../knitout.js');
const { csePlanTransfers } = require('../../knitout/transfer.js');
const CCWCorners = require('./corners.js');

class ShapingPass extends TransferPass {
  constructor(settings, options){
    super(settings, ProgramFragment.SHAPING_PASS, options);
    // shaping parameters
    this.useCSE = !!options.useCSE;
    this.reduceCSE = !!options.reduceTransfers;
  }

  computeUnsafeSequence(
    state,
    sources = this.sources,
    targets = this.targets
  ){
    if(!sources.length)
      return;

    // XXX should we remove source/target entries that do not exist?
    //     e.g. after some patterning transfers?
    //     though that may lead to slack overestimation! so likely no

    // get transfer problem parameters
    const { maxRacking, slacks, minFree, maxFree } = this.getParams(
      state, sources, targets, true // will expand back to half-gauge
    );

    // two options: CSE or RS
    if(this.useCSE){
      // compute CSE transfers
      try {
        let seq = csePlanTransfers(
          sources.map(n => n.toString()),
          targets.map(n => n.toString()), {
            needles_as_array: true, max_racking: maxRacking,
            slack: slacks, min_free: minFree, max_free: maxFree
          }
        );
        if(this.reduceCSE && seq.length)
          seq = ShapingPass.reduceCSE(seq, state);
        for(const [sn, tn] of seq){
          this.addTransfer(
            Needle.from(...sn),
            Needle.from(...tn)
          );
        }

      } catch(err){
        assert.error('CSE transfer failed', err);
      }

    } else {
      // compute RS transfers without carrier safety
      this.computeSequence(state, sources, targets, true);
    }
  }

  static pruneTransfers(seq, state, createCopy = true){
    if(createCopy)
      state = state.copy();
    const prunedSeq = [];
    for(const [sn, tn] of seq){
      if(!state.isEmpty(sn)){
        prunedSeq.push([sn, tn]);
        state.rack(sn.rackingTo(tn));
        state.xfer(sn, tn);
      }
    }
    return prunedSeq;
  }

  static reduceCSE(seq, state, createCopy = true){
    // cluster transfers into passes
    const passes = [];
    let lastSrcSide = null;
    for(let [sn, tn] of seq){
      sn = Needle.from(...sn);
      tn = Needle.from(...tn);
      const srcSide = sn.side.charAt(0);
      if(srcSide !== lastSrcSide){
        // new pass
        passes.push([[sn, tn]]);
        lastSrcSide = srcSide;

      } else {
        passes[passes.length - 1].push([sn, tn]);
      }
    } // endfor [sn,tn] of seq

    // CSE uses 3 passes per iteration:
    // - collapse = collapse all stitches onto other bed
    // - shift = transfer all stitches to original bed
    // - expand = transfer some stitches to the other bed
    if(passes.length % 3 !== 0){
      assert.error('CSE passes are not a multiple of 3', passes.length);
      return seq;
    }

    // work on state copy
    if(createCopy)
      state = state.copy();

    // identity-based simplification
    // = remove forms of identity transfer within CSE triplets
    for(let i = 0; i < passes.length; i += 3){
      // copy initial state
      const initState = state.copy();
      // go over transfers and record set of loops moving
      const loops = new Set();
      for(let j = 0; j < 3; ++j){
        for(const [sn, tn] of passes[i + j]){
          if(j === 1){
            // shift => all loops move
            for(const loop of state.getNeedleLoops(sn))
              loops.add(loop);
          }
          // actual transfer
          state.rack(sn.rackingTo(tn));
          state.xfer(sn, tn);
        }
      }
      // get list of identity loops
      const identityLoops = new Set();
      for(const loop of loops){
        const sn = initState.getLoopNeedle(loop);
        const tn = state.getLoopNeedle(loop);
        if(sn.matches(tn))
          identityLoops.add(loop);
      }
      // prune all transfers within the triplet that are moving
      // loops that are all identity loops
      for(let j = 0; j < 3; ++j){
        const pass = []; // new pass
        for(const [sn, tn] of passes[i + j]){
          const srcLoops = initState.getNeedleLoops(sn);
          if(srcLoops.some(loop => !identityLoops.has(loop))){
            // not a complete identity, so we must apply it
            pass.push([sn, tn]);
            initState.rack(sn.rackingTo(tn));
            initState.xfer(sn, tn);
          } 
        }
        passes[i + j] = pass; // update pass
      }
      // each active loop should have the same state after CSE
      for(const loop of loops){
        const n0 = initState.getLoopNeedle(loop);
        const n1 = state.getLoopNeedle(loop); 
        assert(n0 && n1 && n0.matches(n1),
          'Identity reduction changed the loop distribution');
      }
    }
    // [sn,tn][][] => [sn,tn][] => [[ss,so],[ts, to]][]
    return passes.flat().map(([sn, tn]) => {
      return [[sn.side, sn.offset], [tn.side, tn.offset]];
    });
  }

  rollErrorOf(sources = this.sources, targets = this.targets){
    const N = sources.length;
    assert(targets.length === N, 'Different cardinalities');
    return sources.reduce((sum, s, i) => {
      if(s.side !== targets[i].side)
        return sum + 1;
      else
        return sum;
    }, 0);
  }

  windingErrorOf(
    sources = this.sources,
    targets = this.targets,
    withW = false
  ){
    const N = sources.length;
    assert(targets.length === N, 'Different cardinalities');
    const ds = new Array(N);
    const dt = new Array(N);
    const w  = new Array(N);
    let sumAbsW = 0;
    let numMap = new Map();
    for(let i = 0, j = N-1; i < N; j = i++){
      ds[j] = sources[j].side !== sources[i].side ? 1 : 0;
      dt[j] = targets[j].side !== targets[i].side ? 1 : 0;
      // special case for first winding number
      if(i === 0)
        w[0] = sources[0].side === targets[0].side ? 0 : 1;
      else
        w[i] = w[j] + dt[j] - ds[j];
      const wi = w[i];
      numMap.set(wi, (numMap.get(wi) || 0) + 1);
      sumAbsW += Math.abs(wi);
    }
    for(const dw of [-2, +2]){
      let saw = 0;
      for(const [wi, n] of numMap)
        saw += Math.abs(wi + dw) * n;
      // update sum if we found a better one
      if(saw < sumAbsW){
        sumAbsW = saw; // found a better option
        for(let i = 0; i < N; ++i)
          w[i] += dw; // update W since we return it
      }
    }
    return withW ? [sumAbsW, w] : sumAbsW;
  }

  computeSequence(
    state, 
    needles = this.sources.slice(),
    targets = this.targets,
    expand = false
  ){
    // get transfer problem parameters
    const xferParams = this.getParams(
      state, needles, targets, expand // no expansion by default
    );

    // carrier safety depends on expansion
    // if we expand, then safety can be done implicitly
    // otherwise, we need it explicitly
    const carrierSafety = !expand;

    // do rotations until we have no more roll error
    // or we cannot reduce it without applying decreases
    [state, needles] = this.rotate(
      state, needles, targets, xferParams, carrierSafety
    );
    if(!state || !needles)
      return; // failed!
    // note: the returned state matches the transfer sequence

    // apply last translations and decrease transfers
    const seq = this.shift(
      state, needles, targets,
      xferParams, carrierSafety
    );
    if(seq){
      // apply the transfer sequence
      this.appendSequence(seq);

      // apply potential final across-bed decreases
      for(let i = 0; i < needles.length; ++i){
        // check whether side before and after are the same
        // if they are not, then we need additional transfers
        // but those should be without racking, and direct one-to-one
        if(needles[i].side !== targets[i].side){
          // move carriers to resolve conflicts
          if(carrierSafety)
            this.resolveConflicts(state, needles[i]);
          // apply transfer
          this.addTransfer(
            targets[i].otherHook(),
            targets[i]
          );
        }
      } // endfor 0 <= i < #needles
    } // endif seq
  }

  rotate(state, needles, targets, {
    maxRacking, slacks, minFree, maxFree
  }, carrierSafety = true){
    // get the initial winding error
    let [werr, w] = this.windingErrorOf(needles, targets, true);
    if(werr === 0)
      return [state.asCopy(), needles]; // nothing to do
    
    // compute the initial corners
    let corners = CCWCorners.from(needles);
    const maxWidth = maxFree - minFree + 1;

    // until done with rolls (or we get stuck), rotate bed
    rollLoop:
    while(werr > 0){
      // find good corner to do rotation
      // and if any, record potential rotation configuration
      const rotSetups = []; // [{ needles, cornerIdx }]
      for(const [i, idx] of corners.cornerEntries()){

        // 1) does that corner want to rotate?
        const ori = corners.orientationOf(i);
        // three cases based on sign(w[idx])
        //    0   => should not move = bad option
        //    ori => matches the orientation = good option
        //   -ori => would increase the winding error = bad option
        if(Math.sign(w[idx]) !== ori)
          continue; // not a good option

        // 2) side must have space
        const cornerSide = needles[idx].side;
        if(corners.width(cornerSide, true) > maxWidth)
          continue; // other side has no space

        // 4) compute available bed configurations
        for(const opt of corners.getOptions(i, {
          state, slacks, targets, minFree, maxFree
        }))
          rotSetups.push(opt);
      }
      // if no rotation is possible
      if(!rotSetups.length){
        assert.error('No valid rotation found');
        break; // we're done!
      }
      
      // if multiple options, pick that with smallest number of steps
      let bestSeq = null;     // TransferSequence
      let bestLen = Infinity; // number
      let bestOpt = null;     // [newCorners, cornerIdx]
      let bestState = null;  // KnittingMachineState
      for(const opt of rotSetups){
        const optState = state.copy();
        const newNeedles = opt[0].shiftedNeedles();
        const seq = this.shift(
          optState, needles, newNeedles, { maxRacking, slacks },
          carrierSafety, bestLen
        );
        if(seq && seq.length < bestLen){
          bestSeq = seq;
          bestLen = seq.length;
          bestOpt = opt;
          bestState = optState;
          if(!seq.length)
            break; // cannot do better!
        }
      }
      if(!bestSeq){
        assert.error('Shift computation failed');
        break;
      }
      // apply shift sequence
      this.appendSequence(bestSeq);

      // update sate
      updateState: {
        const [shiftCorners, cornerIdx] = bestOpt;
        const cn = shiftCorners.needle(cornerIdx);
        const on = cn.otherHook();
        // the other side should be empty so we can collapse onto it
        // unless it's a final decrease
        if(!bestState.isEmpty(on)){
          // should be a decrease, or it's invalid
          const rn = shiftCorners.needle(cornerIdx, true);
          assert(on.matches(rn),
            'The other side hook is not empty, and not decreasing');
          const tn = targets[shiftCorners.indexOf(cornerIdx)];
          assert(on.matches(tn),
            'Collapse onto non-empty hook that is not the target');
        }
        if(bestState.racking !== 0)
          bestState.rack(0);

        // add necessary carrier moves if any
        if(carrierSafety)
          this.resolveConflicts(bestState, cn);

        // do transfer
        this.addTransfer(cn, on);
        bestState.xfer(cn, on);

        // update state
        state = bestState;
      }

      // apply transfer of corners
      updateCorners: {
        const [shiftCorners, cornerIdx] = bestOpt;
        corners = shiftCorners.afterRotation(cornerIdx);
        needles = corners.needles;
      }

      // update winding data
      [werr, w] = this.windingErrorOf(needles, targets, true);
    }
    // return last state
    return [state.asCopy(), needles];
  }

  /**
   * Resolve any conflict that can arise from transferring a needle
   * across directly to the other bed.
   * 
   * @param {Needle} n the transfer needle to resolve conflicts for
   */
  resolveConflicts(state, n, seq = this.sequence){
    const cs = state.getCarrierConflicts(n);
    if(!cs.length)
      return; // nothing to do

    // group conflicting carriers by offset
    const map = new Map(); // Map<number, [cs, side]>
    for(const cname of cs){
      const [off, side] = state.mapCarrier(cname, c => {
        return [c.needle.offset, c.side];
      });
      if(map.has(off)){
        const [subCs, currSide] = map.get(off);
        assert(side === currSide,
          'Carrier should not be in conflict');
        subCs.push(cname);
      } else
        map.set(off, [[cname], side]);
    }

    // switch side for each group
    for(const [offset, [subCs, side]] of map){
      // transfer step
      seq.addCarrierMove(subCs, offset, -side);
      // state update
      state.miss(-side, Needle.from(offset), subCs);
    }

    // there should NOT be any conflicts anymore
    assert(!state.hasCarrierConflict(n),
      'Carrier conflict could not be resolved');
  }

  static fromBlock(blk, ...args){
    // get active stitch configurations in CCW order
    // /!\ the stitches are from trace slices
    // => the needles are already in CCW order
    const stitches = blk.shapingStitches();
    const sources = blk.preNeedles();
    const targets = blk.postNeedles();
    return new ShapingPass({ stitches, sources, targets }, ...args);
  }
}

module.exports = ShapingPass;