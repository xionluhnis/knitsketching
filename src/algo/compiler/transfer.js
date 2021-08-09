// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const ProgramFragment = require('./fragment.js');
const { Needle, LEFT, RIGHT, FRONT, BACK } = require('../../knitout.js');
const NeedleBlock = require('../schedule/block.js');
const {
  isCompleteHalfGauge,
  halfToFullGauge,
  stateToFullGauge,
  fullToHalfGauge
} = require('./halfgauge.js');
const CCWCycle = require('./cycle.js');
// const { xfer } = require('../../knitout/transfer.js');

// constants
const NEEDLE_TRANSFER = 'nxfer';
const CARRIER_MOVE    = 'cmove';


/**
 * A step of a transfer pass
 */
class TransferStep {
  constructor(type, args){
    this.type = type;
    this.args = args;

    // check arguments
    assert(Array.isArray(args),
      'Invalid arguments, must be an array');
    switch(type){

      // args = [sn, tn, stitch]
      case NEEDLE_TRANSFER: {
        const [sn, tn] = args;
        assert(sn instanceof Needle && tn instanceof Needle,
          'Transfer needles have invalid type(s)');
        assert(sn.side.charAt(0) !== tn.side.charAt(0),
          'Transfer within same bed side');
      } break;

      // args = [cs, offset, side]
      case CARRIER_MOVE: {
        const [cs, offset, side] = this.args;
        assert(Array.isArray(cs) && cs.length,
          'Invalid non-list or empty list of carriers');
        assert(typeof offset === 'number',
          'Offset must be an integer');
        assert([LEFT, RIGHT].includes(side),
          'Invalid side, neither LEFT nor RIGHT');
      } break;
      
      default:
        assert.error('Unsupported transfer step type', type);
    }
  }

  isTransfer(){ return this.type === NEEDLE_TRANSFER; }
  isCarrierMove(){ return this.type === CARRIER_MOVE; }
  toString(){
    switch(this.type){
      case NEEDLE_TRANSFER: {
        const [sn, tn] = this.args;
        return 'xfer ' + sn.toString() + ' ' + tn.toString();
      }
      case CARRIER_MOVE: {
        const [cs, offset, side] = this.args;
        return 'move ' + cs.join(' ') + ' '
              + offset + (side > 0 ? '+' : '-');
      }
      default: return '<?>';
    }
  }
}

class TransferSequence {
  constructor(steps = []){
    this.steps = steps;
  }
  get length(){ return this.steps.length; }
  clear(){ this.steps = []; return this; }
  addTransfer(sn, tn, stitch = null){
    this.steps.push(new TransferStep(NEEDLE_TRANSFER, [sn, tn, stitch]));
    return this;
  }
  addCarrierMove(cs, offset, side){
    this.steps.push(new TransferStep(CARRIER_MOVE, [cs, offset, side]));
    return this;
  }
  addSteps(steps){ this.steps.push(...steps); return this; }
  appendSequence(seq){ return this.addSteps(seq.steps); }
  *[Symbol.iterator](){
    yield *this.steps;
  }
}

/** @typedef {1|-1} Direction */

/**
 * A generic knitting transfer pass
 * 
 * @property {YarnStep}       step the corresponding active yarn step
 * @property {TracedStitch[]} stitches the sequence of traced stitches
 * @property {Action[]}       actions the sequence of actions
 * @property {Needle[]}       needles the sequence of needles
 * @property {Direction[]}    dirs the sequence of tracing orientations
 * @property {string[]}       carriers the set of yarn carriers
 */
class TransferPass extends ProgramFragment {
  constructor({
    parent,
    stitches,
    sources, targets,
    sequence = new TransferSequence(),
    halfGauge = false
  }, xferType = ProgramFragment.TRANSFER_PASS, {
    multiTransfer = false,
    canSimplify = true
  } = {}){
    super(parent, xferType);
    // generic transfer context
    this.stitches = stitches;
    this.sources  = sources;
    this.targets  = targets;
    this.sequence = sequence;
    this.halfGauge = halfGauge;
    this.simplify = canSimplify;
    this.multiTransfer = multiTransfer;
    assert(stitches.length === sources.length,
      'Stitches and sources of different sizes');
    assert(sources.length === targets.length,
      'Sources and targets of different sizes');
    assert(sequence instanceof TransferSequence,
      'Invalid sequence type');
  }

  get stitchNumber(){ return 0; }

  stitchIndexOf(ts){
    return this.stitches.findIndex(s => s.matches(ts));
  }
  needleOf(ts){
    const idx = this.stitchIndexOf(ts);
    assert(idx !== -1, 'Stitch is not active within this pass');
    return this.needles[idx];
  }
  setRacking(k, state, racking = 0){
    if(state.racking !== racking)
      k.rack(racking);
  }
  createSequence(){ return new TransferSequence(); }
  addTransfer(sn, tn, stitch = null){
    return this.sequence.addTransfer(sn, tn, stitch);
  }
  addCarrierMove(cs, offset, side){
    return this.sequence.addCarrierMove(cs, offset, side);
  }
  appendSequence(seq){ this.sequence.appendSequence(seq); }
  setSequence(seq){
    assert(seq instanceof TransferSequence,
      'Invalid sequence type');
    this.sequence = seq;
  }

  isCompleteHalfGauge(state){
    return this.halfGauge && isCompleteHalfGauge(state);
  }

  computeSimplifiedSequence(state){
    if(!this.sources.length)
      return; // nothing to do
    // go into full gauge
    const sources = this.sources.map(n => halfToFullGauge(n));
    const targets = this.targets.map(n => halfToFullGauge(n));
    const fullState = stateToFullGauge(state);

    // unsafe solution in full-gauge
    this.computeUnsafeSequence(fullState, sources, targets);

    // transformation back to half-gauge
    for(const step of this.sequence){
      assert(step.isTransfer(), 'Unsafe alignment with carrier moves?');
      const [sn, tn] = step.args;
      step.args[0] = fullToHalfGauge(sn);
      step.args[1] = fullToHalfGauge(tn);
    }
  }

  computeUnsafeSequence(/* state, sources, targets */){
    assert.error('Unsafe sequence not implemented');
  }

  computeSequence(state){
    this.computeUnsafeSequence(state);
  }

  generate(k, state, verbose = true){
    // check for degenerate case
    if(!this.sources.length && !this.targets.length)
      return; // no transfer to do

    // check for identity case
    if(this.sources.every((sn, i) => sn.matches(this.targets[i])))
      return; // identity = no transfer to do

    // get initial source loops
    let srcLoops;
    if(verbose)
      srcLoops = this.sources.map(n => state.getNeedleLoops(n));

    // compute sequence given state
    if(this.simplify && this.isCompleteHalfGauge(state)){
      // compute in full-gauge and transfer back to half-gauge
      // => we don't have to worry about carrier conflicts
      this.computeSimplifiedSequence(state);

    } else {
      // we cannot or should not use the simplified procedure
      // => use original sequence computation
      this.computeSequence(state);
    }

    // go over sequence
    const xferPass = [];
    let passCount = 0;
    let passFrom = null;
    let passRack = 0;
    const commitPass = () => {
      // check if any step has multiple loops
      for(let pass = 0; pass < passCount; ++pass){
        let lastIdx = k.length;
        for(const [sn, tn] of xferPass)
          k.xfer(sn, tn);
        if(k.length > lastIdx)
          k.setComment(lastIdx, 're-transfer ' + (pass + 1));
      }
      // clear pass information
      xferPass.length = 0;
      passCount = 0;
    };
    const pushStep = ([sn, tn], r) => {
      // check if step has multiple source loops that move
      const loops = state.getNeedleLoops(sn);
      passCount = Math.max(passCount, loops.length - 1);
      if(xferPass.length){
        assert(passFrom === sn.side && passRack === r,
          'Side and racking do not match');
      }
      xferPass.push([sn, tn]);
      passFrom = sn.side;
      passRack = r;
      // else, no need to remember
      // XXX unless we're doubling always?
    };
    for(const step of this.sequence){
      switch(step.type){

        case NEEDLE_TRANSFER: {
          const [sn, tn, s] = step.args;

          // measure necessary bed alignment
          const r = sn.rackingTo(tn);

          // potentially commit pass, remember step
          if(this.multiTransfer){
            if(xferPass.length
            && (passRack !== r || passFrom !== sn.side))
              commitPass();
            pushStep([sn, tn], r);
          }

          // set racking
          this.setRacking(k, state, r);

          // actual transfer
          k.xfer(sn, tn);

          // stitch metadata if any
          if(s)
            k.setMetadata(-1, s.index);
        } break;

        case CARRIER_MOVE: {
          const [cs, offset, side] = step.args;
          assert(!state.hasPendingSliders(),
            'Carrier move while sliders are pending');

          // potentially commit pass
          if(this.multiTransfer && xferPass.length){
            commitPass();
          }

          // bed alignment
          this.setRacking(k, state, 0);

          // explicit carrier move
          k.miss(side, Needle.from(offset), cs);
        } break;

        default:
          assert.error('Invalid step type');
          break;
        
      } // endswitch step.type
    } // endfor step of this.sequence

    // reset racking to zero
    this.setRacking(k, state, 0);
    k.flush();

    // check that loops have transferred to target needles
    if(verbose){
      for(const [i, loops] of srcLoops.entries()){
        const n = this.targets[i];
        for(const loop of loops){
          assert(state.getLoopNeedle(loop).matches(n),
            'Loop did not end at the expected target needle');
        } // endfor loop of loops
      } // endfor [i, loops] of srcLoops
    }
  }

  /**
   * Compute the transfer parameters given the state and needles
   * 
   * @param {KnittingMachineState} state the machine state
   * @param {Needle[]} sources the initial needles
   * @param {Needle[]} targets the target needles
   * @return {{maxRacking, slack, minFree, maxFree}} the parameters
   */
  getParams(
    state,
    sources = this.sources,
    targets = this.targets,
    expand = false
  ){

    // maximum racking
    let maxRacking;
    if(this.halfGauge)
      maxRacking = expand ? 2 : 4;
    else
      maxRacking = 2;

    // compute slack between ccw needles
    const slacks = TransferPass.slackOf(sources, targets);

    // compute range of free needles
    const [minFree, maxFree] = TransferPass.freeRangeOf(state, sources);

    // return the parameters
    return { maxRacking, slacks, minFree, maxFree };
  }

  shift(
    state, sources, targets, { slacks, maxRacking },
    carrierSafety = false, maxSteps = Infinity
  ){
    const seq = this.createSequence();
    const needles = sources.slice();
    const cycle = new CCWCycle({ needles, targets, slacks });
    const getAbsShiftSum = grp => grp.reduce((sum, idx) => {
      return sum + Math.abs(cycle.targetShift(idx));
    }, 0);

    // compute set of potential conflicting carriers
    const carriers = [];
    if(carrierSafety){
      for(const c of state.activeCarriers()){
        carriers.push(c);
        assert(c.getLoopNeedle(),
          'Active carrier without loop needle');
      }
    }

    // compute shift groups
    const shifts = {
      [FRONT]: {
        [LEFT]: [],
        [RIGHT]: [],
      },
      [BACK]: {
        [LEFT]: [],
        [RIGHT]: []
      }
    };
    for(let i = 0; i < cycle.length; ++i){
      const { side } = cycle.needleOf(i);
      const dir = cycle.targetDir(i);
      if(dir !== 0)
        shifts[side][dir].push(i);
    }

    // create list of groups in LTR order
    let shiftGroups = [
      shifts[FRONT][LEFT],
      shifts[FRONT][RIGHT],
      shifts[BACK][LEFT],
      shifts[BACK][RIGHT]
    ].filter(sgrp => sgrp.length > 0);
    for(const sgrp of shiftGroups)
      sgrp.sort((i1, i2) => cycle.offsetOf(i1) - cycle.offsetOf(i2));

    // while we still have shifts to do, do them!
    while(shiftGroups.length){
      const nextGroups = [];

      // process each group sequentially
      // XXX does the order of the groups matter for speed?
      let absSumBefore = 0;
      let absSumAfter = 0;
      for(const shiftGrp of shiftGroups){
        // measure absolute sum before doing anything
        absSumBefore += getAbsShiftSum(shiftGrp);

        // measure properties of this group
        // const N = shiftGrp.length; // /!\ not #needles
        const dir  = cycle.targetDir(shiftGrp[0]);
        const ori  = cycle.targetOrient(shiftGrp[0]);
        assert(dir, 'No shift');

        // 1) Get barrier offsets in LTR order
        const barriers = [
          ...new Set(carriers.map(c => c.getLoopNeedle().offset))
        ].sort((a,b) => a-b);

        // 2) Split group based on barrier offsets
        const numBlocks = barriers.length + 1;
        const blks = Array.from({ length: numBlocks }, () => []);
        const headIdx = dir > 0 ? numBlocks - 1 : 0;
        const tailIdx = numBlocks - 1 - headIdx;
        needleLoop:
        for(const idx of shiftGrp){
          const off = cycle.offsetOf(idx);
          // find LTR block we belong to, from head to tail
          for(let i = headIdx, n = tailIdx; i !== n; i -= dir){
            // barriers are LTR (one less than blocks)
            // dir=+1 => the barrier is at i-1
            // dir=-1 => the barrier is at i (co-located with block)
            const barrier = barriers[dir > 0 ? i - 1 : i];
            if((off - barrier) * dir >= 0){
              blks[i].push(idx);
              continue needleLoop;
            }
            // else it's in some group behind (toward the tail)
          }
          // it's not ahead of (or equal to) any barrier
          // => it's in the group behind all barriers
          blks[tailIdx].push(idx);
        }
        // also get per-group carrier split (head vs tail)
        const barrierCarriers = blks.map((_, i) => {
          // special tail and head cases
          if(i === headIdx)
            return [[], carriers.slice()]; // all behind
          else if(i === tailIdx)
            return [carriers.slice(), []]; // all ahead
          // else we have a mix
          const ahead = [];
          const behind = [];
          const barrier = barriers[dir > 0 ? i - 1 : i];
          for(const c of carriers){
            const offset = c.getLoopNeedle().offset;
            // note: if matching barrier, the carrier is in the tail!
            // /!\ this is the opposite of the stitches (that are ahead)
            if((offset - barrier) * dir > 0)
              ahead.push(c);
            else
              behind.push(c);
          }
          return [ahead, behind];
        });

        // 3) Process move of blocks from head to tail
        for(let i = headIdx, n = tailIdx - dir; i !== n; i -= dir){
          const group = blks[i];
          if(!group.length)
            continue; // skip empty group
          const [headCarriers, tailCarriers] = barrierCarriers[i];

          // a | Measure constrained shifts
          const groupShifts = cycle.getConstrainedShifts(
            group, headCarriers, { maxRacking, dir, ori }
          );
          // check if the block can move at all
          if(groupShifts.every(s => s === 0))
            continue; // cannot move this round!

          // b | Resolve carrier conflicts ahead of the group
          this.resolveGroupConflicts(
            state, seq, cycle, headCarriers, group, dir
          );

          // c | Resolve carrier conflicts behind the group
          this.resolveGroupConflicts(
            state, seq, cycle, tailCarriers, group, -dir
          );

          // d | Do block shift
          this.blockShift(state, seq, cycle, group, groupShifts);

          // check that we haven't gone beyond the max number of steps
          if(seq.length > maxSteps)
            return null; // this sequence is too long!
        }

        // measure absolute sum after
        absSumAfter += getAbsShiftSum(shiftGrp);

        // if group still needs additional moves,
        // schedule for a next round
        const next = shiftGrp.filter(idx => {
          return cycle.targetShift(idx) !== 0;
        });
        if(next.length)
          nextGroups.push(next);

      } // endfor group of shiftGroups
      shiftGroups = nextGroups;

      // absolute sum must have reduced
      if(absSumAfter >= absSumBefore){
        assert.error('Absolute shift sum did not decrease during step');
        return null;
      }
    } // endwhile #shiftGroups
    return seq;
  }

  /**
   * Execute a block shift in one of three potential ways:
   * 1. Use hooks directly on the other side
   * 2. Use hooks of the other side, shifted by one
   * 3. Use sliders of the other side (worst option)
   * 
   * The offset is chosen to match the block shift so that
   * we ensure that we do not create slack issues.
   */
  blockShift(state, seq, cycle, group, shifts){
    // remove samples that cannot move yet
    const keep = shifts.map(s => s !== 0);
    group = group.filter((_, i) => keep[i]);
    shifts = shifts.filter((_, i) => keep[i]);
    if(!group.length)
      return; // empty block

    // direction of the block shift
    const dir = Math.sign(shifts[0]);

    // three options to test, in order:
    // 1) use hooks at doff=0
    // 2) use hooks at doff=dir
    // 3) use sliders at doff=0
    let roffset = 0;
    let usingSliders = true;

    // check availability of (1) or (2)
    doffLoop:
    for(const doff of [0, dir]){
      // check availabilty of hooks on other bed side
      for(let i = 0; i < group.length; ++i){
        const idx = group[i];
        const sn = cycle.needleOf(idx);
        const tn = sn.shiftedBy(doff).otherHook();
        if(!state.isEmpty(tn))
          continue doffLoop; // not available!
      }
      // available!
      roffset = doff;
      usingSliders = false;
      break;
    }

    // actually do the block move with the best configuration
    initRack: {
      const sn0 = cycle.needleOf(group[0]);
      const tn0 = sn0.shiftedBy(roffset).otherHook();
      const racking = sn0.rackingTo(tn0);
      if(state.racking !== racking)
        state.rack(racking);
    }
    // initial transfer
    const moves = new Map();
    for(let i = 0; i < group.length; ++i){
      // register shift in same-shift group
      const sn = cycle.needleOf(group[i]);
      const rn = sn.shiftedBy(roffset);
      const tn = usingSliders ? rn.otherSlider() : rn.otherHook();
      const shift = shifts[i];
      if(moves.has(shift))
        moves.get(shift).push([sn, tn, group[i]]);
      else
        moves.set(shift, [[sn, tn, group[i]]]);

      // do initial transfer (same racking for all)
      seq.addTransfer(sn, tn);
      state.xfer(sn, tn);
    }
    // by group transfer to destination
    for(const [shift, xfers] of moves){
      const [sn0, tn0] = xfers[0];
      const fn0 = sn0.shiftedBy(shift);
      const racking = tn0.rackingTo(fn0);
      if(state.racking !== racking)
        state.rack(racking);
      
      for(const [sn, tn, idx] of xfers){
        const fn = sn.shiftedBy(shift);
        seq.addTransfer(tn, fn);
        state.xfer(tn, fn);

        // update cycle information
        cycle.needles[idx] = fn;
      }
    }
    state.rack(0); // reset racking
  }

  /**
   * Resolve conflicts with a group.
   * 
   * This assumes that the conflict barrier is
   * - either outside the group of needles
   * - at one end of the needles.
   * 
   * The direction we want the carriers to be facing
   * should match the end / side of the conflict barrier.
   * 
   * @param {-1|+1} dir the direction carrier should be facing
   */
  resolveGroupConflicts(
    state, seq, cycle, carriers, group, dir
  ){
    if(!carriers.length)
      return; // nothing to do
    
    // get closest conflicting needle
    const ccIdx = dir > 0 ? group.length - 1 : 0;
    const ccn = cycle.needleOf(group[ccIdx]);
    const fcn = cycle.needleOf(group[group.length - 1 - ccIdx]);
    const cs = [];
    for(const c of carriers){
      if(c.conflictsWith(ccn)){
        // direct needle conflict
        assert(c.side === -dir,
          'Carrier conflicts while in expected direction');
        cs.push(c.name);

      } else if(c.side !== dir) {
        // barrier crossing with direction conflict
        cs.push(c.name);

      } else {
        // no conflict
        assert(!c.conflictsWith(fcn),
          'Closest without conflict, but farther with conflict');
      }
    } // endfor c of carriers

    // add carrier movements if any
    if(cs.length){
      // get closest barrier needle
      let bn = carriers[0].getLoopNeedle();
      for(let i = 1; i < carriers.length; ++i){
        const c = carriers[i];
        const cn = c.getLoopNeedle();
        if((cn.offset - bn.offset) * dir < 0)
          bn = cn; // closer (direction-wise)
      }

      // add carrier(s) move
      seq.addCarrierMove(cs, bn.offset, dir);
      state.miss(dir, bn, cs);
    }
  }

  /**
   * Compute the per-stitch slack
   * 
   * @param {Needle[]} sources the CCW source needles
   * @param {Needle[]} targets the CCW target needles
   * @return {number[]} the corresponding slack per needle
   */
  static slackOf(sources, targets){
    const N = sources.length;
    assert(targets.length === N, 'Different cardinalities');
    // XXX the last active stitch should have infinite slack
    // in the knitting direction since it has no next stitch yet
    return Array.from(sources, (n, i) => {
      // XXX should use real slack, not heuristic
      // XXX boundary samples may be outside of step?
      const n1 = n;
      const nn1 = sources[(N + i + 1)%N];
      const n2 = targets[i];
      const nn2 = targets[(N + i + 1)%N];
      return Math.max(2, Math.max(
        Math.abs(nn1.offset - n1.offset),
        Math.abs(nn2.offset - n2.offset)
      ));
    });
  }

  /**
   * Compute the free range of a set of needles to shape
   * 
   * @param {KnittingMachineState} state the machine state
   * @param {Needle[]} needles the current needles to shape
   * @return {[number, number]} the minimum and maximum free offsets
   */
  static freeRangeOf(state, needles){
    const blk = NeedleBlock.fromNeedles(needles);
    // block range
    const blkLeft = blk.left();
    const blkRight = blk.right();
    // compute free offset ranges
    let maxLeft = blkLeft - 20;
    let minRight = blkRight + 20;
    if(blk.isTwoSided()){
      // we must check both sides!
      // /!\ this range computation does not work if checking
      // the range of flat courses across both sides!

      // shrink bounds given existing needles
      for(const { offset } of state.needles()){
        if(offset < blkLeft)
          maxLeft = Math.max(maxLeft, offset);
        if(offset > blkRight)
          minRight = Math.min(minRight, offset);
      }

    } else {
      // only need to check one side
      let side;
      if(blk.hasFront())
        side = FRONT;
      else {
        assert(blk.hasBack(), 'Empty block of needles');
        side = BACK;
      }

      // shrink bounds given existing needles
      for(const offset of state.getBed(side).offsetKeys()){
        if(offset < blkLeft)
          maxLeft = Math.max(maxLeft, offset);
        if(offset > blkRight)
          minRight = Math.min(minRight, offset);
      }
    }
    return [maxLeft + 1, minRight - 1];
  }
}



module.exports = TransferPass;