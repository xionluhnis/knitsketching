// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const Knitout = require('./knitout/knitout');
const { Needle, Stream, constants } = Knitout;
const { from, fromData, toJointString } = Knitout;
const Block = require('./knitout/block');
const sim = require('./knitout/simulation');
const { NeedleBed, KnittingMachineState } = sim;
const xfer = require('./knitout/transfer');

module.exports = Object.assign({
  // objects
  Knitout, Needle, Stream,
  Block, NeedleBed, KnittingMachineState,
  // static methods
  from, fromData, toJointString,
  // libraries
  sim, xfer
}, constants, sim, xfer);