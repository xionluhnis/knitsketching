// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { Hook } = require('./program.js');

/** @typedef {import('../../knitout.js').MachineKnittingState} State */

/**
 * Transforms a needle from full-gauge to half-gauge
 * 
 * @param {Needle} n the input needle
 * @param {number} [off=-1] the inverleaving offset (+1|-1)
 * @return {Needle} the corresponding half-gauge needle
 */
function fullToHalfGauge(n, off = -1){
  if(n.inHook()){
    if(n.inFront())
      return n.shiftedTo(n.offset * 2);
    else
      return n.shiftedTo(n.offset * 2 + off);

  } else {
    // on slider
    assert(n.onSlider(),
      'Needle must be either in hook or on slider');
    if(n.inFront())
      return n.toHook().shiftedTo(n.offset * 2 + off);
    else
      return n.toHook().shiftedTo(n.offset * 2);
  }
}

/**
 * Transforms a needle from half-gauge to full-gauge
 * 
 * @param {Needle} n the input needle (should be in hook)
 * @param {number} [off=-1] the inverleaving offset (+1|-1)
 * @return {Needle?} the corresponding full-gauge needle (if any)
 */
function halfToFullGauge(n, off = -1){
  if(n.onSlider()){
    assert.error('Half-gauge needle on slider has no full-gauge equivalent');
    return null;
  }
  const hasOffset = n.offset % 2 !== 0;
  const deoffset = n.offset - (hasOffset ? off : 0);
  const fullOffset = Math.round(deoffset / 2);
  if(n.inFront()){
    // hook => no offset
    // slider => offset
    return (hasOffset ? n.onSlider() : n).shiftedTo(fullOffset);

  } else {
    // hook => offset
    // slider => no offset
    return (hasOffset ? n : n.onSlider()).shiftedTo(fullOffset);
  }
}

/**
 * Returns whether a half-gauge needle
 * corresponds to a slider in full-gauge.
 * 
 * This method does NOT check whether the needle is on a slider already.
 * If it is on a slider, then it cannot be converted to full-gauge.
 * 
 * @param {Needle} n the needle to check
 * @return {boolean} true if the needle would become a slider in full-gauge
 */
function isHalfGaugeSlider(n){
  const hasOffset = n.offset % 2 !== 0;
  if(n.inFront())
    return hasOffset;
  else
    return !hasOffset;
}

/**
 * Checks whether a machine state matches a stable state that
 * correspond to a complete half-gauge state, i.e.:
 * - no pending sliders
 * - all needles convert into full-gauge hook needles.
 * 
 * @param {State} state the machine knitting state
 * @return {boolean} whether the state is a complete half-gauge state
 */
function isCompleteHalfGauge(state){
  // check for pending sliders
  if(state.hasPendingSliders())
    return false;
  // check needle entries
  for(const n of state.needles()){
    if(isHalfGaugeSlider(n))
      return false;
  }
  return true;
}

/**
 * Transform the gauge of an entire knitting machine state.
 * This creates a copy which updates:
 * - the location of the loops
 * - the location of the carriers.
 * 
 * @param {State} state the machine knitting state
 * @param {Needle=>Needle} gaugeTransform a gauge transformation
 * @return {State} a modified copy of the state
 */
function transformStateGauge(state, gaugeTransform){
  const newState = state.clearCopy();

  // update needle entries
  for(const [pn, loops] of state.needleEntries()){
    const cn = gaugeTransform(pn);
    assert(cn, 'Transformation failed');
    const nb = newState.getBed(cn.side);
    nb.setLoops(cn, loops);
  }

  // update carriers
  const cnames = Array.from(state.carriers.keys());
  for(const cname of cnames){
    newState.setCarrier(cname, c => {
      const newNeedle = gaugeTransform(c.needle);
      c.atNeedleSide(newNeedle, c.side, false);
    });
  }

  return newState;
}

/**
 * Converts a full-gauge knitting machine to a half-gauge one.
 * 
 * @param {State} state the full-gauge machine state
 * @param {number} [off=-1] the half-gauge offset
 * @return {State} the half-gauge machine state
 */
function stateToHalfGauge(state, off = -1){
  return transformStateGauge(state, n => fullToHalfGauge(n, off));
}

/**
 * Try converting a half-gauge knitting machine to a full-gauge one.
 * This will fail if the state has pending sliders.
 * 
 * @param {State} state the half-gauge machine state
 * @param {number} [off=-1] the half-gauge offset
 * @return {State?} the full-gauge machine state or null
 */
function stateToFullGauge(state, off = -1){
  // first check that we can do it
  if(state.hasPendingSliders())
    return null; // we're not in complete half-gauge!
  else
    return transformStateGauge(state, n => halfToFullGauge(n, off));
}

/**
 * Pre-Knitout half-gauge modifier
 * 
 * This modifies the program during assembly,
 * before the initial Knitout code is generated.
 */
class HalfGaugeHook extends Hook {
  handle(fragment){
    // transform any "needle" from full-gauge to half-gauge
    // - sources
    // - targets
    // - needles
    if('sources' in fragment)
      this.convert(fragment.sources);
    if('targets' in fragment)
      this.convert(fragment.targets);
    if('needles' in fragment)
      this.convert(fragment.needles);
    if('halfGauge' in fragment)
      fragment.halfGauge = true;
  }
  convert(needles){
    if(!Array.isArray(needles))
      return;
    for(let i = 0; i < needles.length; ++i){
      needles[i] = fullToHalfGauge(needles[i]);
    } // endfor 0 <= i < #needles
  }
}


module.exports = {
  // classes
  HalfGaugeHook,
  // methods
  fullToHalfGauge,
  halfToFullGauge,
  stateToHalfGauge,
  stateToFullGauge,
  isHalfGaugeSlider,
  isCompleteHalfGauge
};