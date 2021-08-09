// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const NodeMode = require('./node-mode.js');
const SketchAction = require('./action.js');

class NodeAuto extends NodeMode {
  constructor(){
    super(sk.Curve.AUTOMATIC);
  }
}

module.exports = SketchAction.register('node-auto', NodeAuto);
