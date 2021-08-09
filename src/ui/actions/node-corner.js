// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const NodeMode = require('./node-mode.js');
const SketchAction = require('./action.js');

class NodeCorner extends NodeMode {
  constructor(){
    super(sk.Curve.CORNER, false);
  }
}

module.exports = SketchAction.register('node-corner', NodeCorner);