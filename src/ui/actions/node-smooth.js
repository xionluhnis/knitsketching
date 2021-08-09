// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const NodeMode = require('./node-mode.js');
const SketchAction = require('./action.js');

class NodeSmooth extends NodeMode {
  constructor(){
    super(sk.Curve.SMOOTH);
  }
}

module.exports = SketchAction.register('node-smooth', NodeSmooth);