// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const SketchAction = require('./action.js');
const SegmentMode = require('./segment-mode.js');

class SegmentQuad extends SegmentMode {
  constructor(){
    super(sk.Curve.QUADRATIC);
  }
}

module.exports = SketchAction.register('segment-quad', SegmentQuad);