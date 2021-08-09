// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const Symmetrize = require('./symmetry.js');

class SymmetrizeAlongY extends Symmetrize {
  constructor(curve = null){
    super(curve, { x: 0, y: 1 });
  }
}

module.exports = SketchAction.register('symmetry-y', SymmetrizeAlongY);