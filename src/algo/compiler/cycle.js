// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');

// constants
const CCW = 1;
const CW = -1;

function limitShift(shift, maxAbsShift){
  if(!maxAbsShift)
    return 0;
  assert(maxAbsShift > 0, 'Shift limit must be non-negative');
  if(Math.abs(shift) <= maxAbsShift)
    return shift;
  else
    return Math.sign(shift) * maxAbsShift;
}

class CCWCycle {
  constructor({ needles, slacks, targets = null }){
    this.needles = needles;
    this.slacks  = slacks;
    this.targets = targets;
  }
  get length(){ return this.needles.length; }
  targetShift(idx){
    return this.targets[idx].offset - this.needles[idx].offset;
  }
  targetDir(idx){ return Math.sign(this.targetShift(idx)); }
  targetOrient(idx, dir = this.targetDir(idx)){
    if(!dir)
      return 0; // no orientation
    if(this.needles[idx].inFront())
      return dir > 0 ? CCW : CW;
    else
      return dir > 0 ? CW : CCW;
  }
  needleOf(idx, target = false){
    return target ? this.targets[idx] : this.needles[idx];
  }
  offsetOf(idx, target = false){ return this.needleOf(idx, target).offset; }
  shiftBetween(idx1, idx2, target = false){
    const needles = target ? this.targets : this.needles;
    return needles[idx2].offset - needles[idx1].offset;
  }
  slackBetween(idx1, idx2){
    if(idx1 > idx2)
      [idx1, idx2] = [idx2, idx1];
    if(idx1 === 0 && idx2 === this.length - 1)
      return this.slacks[idx2]; // CCW wrap-around
    else
      return this.slacks[idx1]; // CCW within
  }
  orientedNeighborOf(idx, ori){
    return (idx + ori + this.length) % this.length;
  }

  getConstrainedShifts(
    group, headCarriers, { maxRacking, dir = 0, ori = 0 }
  ){
    if(!group.length)
      return [];
    if(!dir)
      dir = this.targetDir(group[0]);
    if(!ori)
      ori = this.targetOrient(group[0]);

    // Get shifts, limited by maximum racking
    const shifts = group.map(idx => {
      return limitShift(this.targetShift(idx), maxRacking);
    }); // racking-constrained shifts

    // Apply barrier constraint
    this.constrainFromBarrier(group, shifts, dir, headCarriers);

    // Constrain from slack + barrier in the front
    this.constrainFromFront(group, shifts, { dir, ori });

    // Constrain from slack in the back
    this.constrainFromBack(group, shifts, { dir, ori });

    // Prevent non-final decreases
    this.constrainDecreases(group, shifts, { dir, ori });

    // return head shifts
    return shifts;
  }

  getMaxSlackShift(idx, sideIdx, dir){
    const slack = this.slackBetween(idx, sideIdx);
    const shift = this.shiftBetween(idx, sideIdx); // from idx to sideIdx
    // dir = direction of move from idx
    // shift = direction if going toward sideIdx
    // - same sign => move goes toward sideIdx
    //             => increases the available slack
    // - opposite sign => move goes away from sideIdx
    //                 => removes slack (further constrained!)
    const slackShift = slack + shift * dir;
    assert(slackShift >= 0, 'Slack was violated already');
    return slackShift;
  }

  constrainFromBack(group, shifts, { dir, ori }){
    assert(group.length === shifts.length,
      'Different cardinalities');
    const backIdx = dir > 0 ? 0 : group.length - 1;
    const headIdx = group.length - 1 - backIdx;
    for(let i = backIdx, n = headIdx + dir; i !== n; i += dir){
      const ni = group[i];
      const nj = this.orientedNeighborOf(ni, -ori);
      const nk = group[i - dir];
      // basic slack limit from previous
      let maxShift = this.getMaxSlackShift(ni, nj, dir);
      // if previous needle was moving, take move into account
      if(nj === nk){
        // shift is moving together
        // => we can technically move a bit more
        assert(i !== backIdx,
          'First index is limited by previous (invalid) index');
        // previous shifts by headShifts[i-dir]
        // => our slack virtually increases by headShifts[i-dir]
        maxShift += Math.abs(shifts[i - dir]);
      }
      // else we use the basic slack - offset
      shifts[i] = limitShift(shifts[i], maxShift);
    } // endfor i from hbIdx to hfIdx
  }

  constrainFromFront(group, shifts, { dir, ori }){
    assert(group.length === shifts.length,
      'Different cardinalities');
    const frontIdx = dir > 0 ? group.length - 1 : 0;
    const backIdx = group.length - 1 - frontIdx;
    for(let i = frontIdx, n = backIdx - dir; i !== n; i -= dir){
      const ni = group[i];
      const nj = this.orientedNeighborOf(ni, ori);
      const nk = group[i + dir];
      const n = this.needleOf(ni);
      const nn = this.needleOf(nj);
      // distance to needle ahead
      const offset = Math.abs(this.shiftBetween(ni, nj));
      // three cases:
      // a) the needle ahead is in this group
      // b) the needle ahead is fixed, on this bed
      // c) the needle ahead is fixed, on the other bed
      let maxShift;
      if(nj === nk){
        // case (a)
        // = we can go up to that needle, taking movement into account
        maxShift = offset + Math.abs(shifts[i + dir]);

      } else if(n.side === nn.side){
        // case (b)
        // = we can go up to that needle, no movement to worry about
        maxShift = offset;

      } else {
        // case (c)
        // = we need to stay within valid slack
        maxShift = this.getMaxSlackShift(ni, nj, dir);
      }
      shifts[i] = limitShift(shifts[i], maxShift);
    }
  }

  constrainFromBarrier(group, shifts, dir, headCarriers){
    if(!headCarriers.length)
      return;
      // get closest head barrier needle
    let bn = headCarriers[0].getLoopNeedle();
    for(let i = 1; i < headCarriers.length; ++i){
      const c = headCarriers[i];
      const cn = c.getLoopNeedle();
      if((cn.offset - bn.offset) * dir < 0)
        bn = cn; // closer (direction-wise)
    }
    // head stitch case, with barrier
    // => can go up to barrier (included)
    // note: the no-merging constraint is applied separately
    const frontIdx = dir > 0 ? group.length - 1 : 0;
    const fn = this.needleOf(group[frontIdx]);
    const boffset = (bn.offset - fn.offset) * dir; 
    assert(boffset > 0, 'Barrier is not ahead');
    shifts[frontIdx] = limitShift(shifts[frontIdx], boffset);
  }

  constrainDecreases(group, shifts, { dir, ori }){
    assert(group.length === shifts.length,
      'Different cardinalities');
    const frontIdx = dir > 0 ? group.length - 1 : 0;
    const backIdx = group.length - 1 - frontIdx;
    for(let i = frontIdx, n = backIdx - dir; i !== n; i -= dir){
      const ni = group[i];
      const nj = this.orientedNeighborOf(ni, ori);

      // check if on same bed
      const n = this.needleOf(ni);
      const nn = this.needleOf(nj);
      if(n.side !== nn.side)
        continue; // different beds => no possible merging
      
      // check if both targets are the same
      const nk = group[i + dir];
      const tn = this.needleOf(ni, true);
      const tnn = this.needleOf(nj, true);
      if(tn.matches(tnn)){
        // two cases:
        // 1) needle ahead is not moving
        // => we can merge with it
        // 2) needle ahead is moving
        // => check whether it reaches the target

        if(nj !== nk)
          continue; // ni is moving, nj is not
        // both moving
        if(nn.shiftedBy(shifts[i + dir]).matches(tnn))
          continue; // we can merge, since it reaches the target 
      }
      // else, merging is NOT allowed

      // measure shift before movement
      const offset = Math.abs(this.shiftBetween(ni, nj));
      assert(offset, 'No offset between needles');

      // prevent merging, taking potential movement into account
      let maxShift = offset - 1; // can move up to the needle before
      if(nj === nk){
        // movement => add to offset for shift constraint
        maxShift += Math.abs(shifts[i + dir]);
      }
      shifts[i] = limitShift(shifts[i], maxShift);
    }
  }
}

module.exports = Object.assign(CCWCycle, {
  CCW, CW
});