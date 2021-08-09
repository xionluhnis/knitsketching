// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const SketchAction = require('./action.js');
const SegmentMode = require('./segment-mode.js');

class SegmentLine extends SegmentMode {
  constructor(){
    super(sk.Curve.LINEAR);
  }
}

module.exports = SketchAction.register('segment-line', SegmentLine);