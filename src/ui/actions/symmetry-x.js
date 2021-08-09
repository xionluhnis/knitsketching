// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const Symmetrize = require('./symmetry.js');

class SymmetrizeAlongX extends Symmetrize {
  constructor(curve = null){
    super(curve, { x: 1, y: 0 });
  }
}

module.exports = SketchAction.register('symmetry-x', SymmetrizeAlongX);