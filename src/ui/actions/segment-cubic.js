// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const SketchAction = require('./action.js');
const SegmentMode = require('./segment-mode.js');

class SegmentCubic extends SegmentMode {
  constructor(){
    super(sk.Curve.CUBIC);
  }
}

module.exports = SketchAction.register('segment-cubic', SegmentCubic);