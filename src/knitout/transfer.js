// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const xfer_module = require('../../libs/autoknit-wasm/plan_transfers.js');
const { basePath } = require('../wasm.js');
let xfer = typeof location !== 'undefined' ? xfer_module({
  locateFile: function(path){
    return basePath + '/libs/autoknit-wasm/' + path;
  }
}).then(m => xfer = m) : null;
const { Needle, LEFT, RIGHT } = require('./knitout.js');

function setRacking(k, state, racking = 0){
  if(state.racking !== racking)
    k.rack(racking);
}

function singleTransfer(k, from, to, state){
  assert(from.side !== to.side,
    'Transfers happen between different sides', from, to);
  const r = from.rackingTo(to);
  if(state.racking !== r)
    k.rack(r);
  k.xfer(from, to);
  if(r !== 0)
    k.rack(0);
  return k;
}

function splitTo(k, dir, from, to, cs, state, withSliders = false){
  assert(from.inHook() && to.inHook(), 'Split from or to sliders?');
  if(from.side !== to.side){
    // simple case = direct split to other bed
    const r = from.rackingTo(to);
    setRacking(k, state, r);

    k.split(dir, from, to, cs);
    if(r !== 0)
      k.rack(0);
  } else {
    // side case = to slider, then rack and transfer back
    let tmp;
    if(!withSliders && state.isEmpty(from.otherHook()))
      tmp = from.otherHook();
    else
      tmp = from.otherSlider();
    k.split(dir, from, tmp, cs);
    singleTransfer(k, tmp, to, state);
  }
  return k;
}

function singleMove(k, from, to, state){
  assert(from.inHook() && to.inHook(), 'Move from or to sliders?');
  // get ordered conflict range
  let left, right;
  if(from.offset <= to.offset)
    [left, right] = [from, to];
  else
    [left, right] = [to, from];
  assert(left.offset <= right.offset, 'Invalid range');
  
  // safe carrier moves
  for(const c of state.getAllCarriers()){
    if(c.conflictsWith(from, state.racking)
    || c.conflictsWith(to, state.racking)){
      // we must move the carrier out of conflict range
      // where = the closest to the current position
      const distToLeft = Math.abs(c.needle.offset - left.offset);
      const distToRight = Math.abs(c.needle.offset - right.offset);
      if(distToLeft === 0 || distToRight === 0)
        k.miss(-c.side, c.needle, [c.name]); // just toggle side
      else if(distToLeft <= distToRight)
        k.miss(LEFT, left, [c.name]); // go towards the left side
      else
        k.miss(RIGHT, right, [c.name]); //go towards the right side
      k.setComment(-1, '1-move kickback');
    }
  }
  
  if(from.side !== to.side){
    // simple case = just one transfer
    const r = from.rackingTo(to);
    setRacking(k, state, r);
    k.xfer(from, to);
    if(r !== 0)
      k.rack(0);

  } else {
    // default case = two transfers
    // four available needles (two hooks, two sliders)
    const ons = [
      from.otherHook(), to.otherHook(),
      from.otherSlider(), to.otherSlider()
    ];
    const on = ons.find(n => {
      return state.beds.get(n.side).isEmpty(n);
    });
    assert(on, 'No direct needle available on the other side');
    // compute necessary racking to go to other needle
    const r0 = from.rackingTo(on);
    setRacking(k, state, r0);
    k.xfer(from, on);
    const r1 = on.rackingTo(to);
    k.rack(r1);
    k.xfer(on, to);
    if(r1 !== 0)
      k.rack(0);
  }
}

function needleStr(n){
  return n.toString();
}

function cseTransfer(k, from, to, liveState, params = { slack: 2, max_racking: 4}){
  assert(liveState.isLive(), 'State argument must be live', liveState);
  assert(from.length === to.length,
    'Need same from/to cardinality', from, to);
  const xfers = xfer.plan_transfers(
    from.map(needleStr),
    to.map(needleStr), Object.assign(params, {
    needles_as_array: true
  })).map(([fn, tn]) => [new Needle(fn[0], fn[1]), new Needle(tn[0], tn[1])]);
  if(!xfers.length)
    return;

  // generate rack+xfer instructions
  for(const [fn, tn] of xfers){
    const r = fn.rackingTo(tn);
    setRacking(k, liveState, r);
    k.xfer(fn, tn);
  }
  setRacking(k, liveState, 0);
}

module.exports = {
  setRacking,
  singleTransfer,
  splitTo,
  singleMove,
  cseTransfer,
  csePlanTransfers(...args){ return xfer.plan_transfers(...args); },
  // resolution promise
  resolve: function(){
    if(xfer instanceof Promise)
      return xfer;
    else
      return Promise.resolve();
  }
};
