// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SegmentEdit = require('./segment-edit.js');

class SegmentMode extends SegmentEdit {
  constructor(segMode){
    super();
    this.segMode = segMode;
  }
  segmentAction(uictx, segPairs){
    for(const [i1, i2] of segPairs){
      this.curve.setSegmentMode(i1, i2, this.segMode);
    } // endfor [i1, i2] of segPairs
  }
}

module.exports = SegmentMode;