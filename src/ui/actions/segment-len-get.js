// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const SegmentSelect = require('./segment-select.js');

class SegmentGetLength extends SegmentSelect {
  constructor(){
    super((curve, segIdx) => {
      const len = curve.getSegmentLength(segIdx);
      alert('Length = ' + len);
    });
  }
}

module.exports = SketchAction.register('segment-len-get', SegmentGetLength);