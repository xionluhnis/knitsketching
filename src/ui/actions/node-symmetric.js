// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const NodeMode = require('./node-mode.js');
const SketchAction = require('./action.js');

class NodeSymmetric extends NodeMode {
  constructor(){
    super(sk.Curve.SYMMETRIC);
  }
}

module.exports = SketchAction.register('node-symmetric', NodeSymmetric);