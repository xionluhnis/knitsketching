// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const sk = require('../../sketch.js');
const NodeEdit = require('./node-edit.js');

class NodeMode extends NodeEdit {
  constructor(controlMode, makeCubic = true){
    super();
    this.controlMode = controlMode;
    this.makeCubic = makeCubic;
  }
  setSidesAsCubic(indices){
    assert(this.curve, 'Missing curve');
    for(const idx of indices){
      const i1 = idx;
      const i0 = (i1 - 1 + this.curve.length) % this.curve.length;
      this.curve.setSegmentMode(i0, i1, sk.Curve.CUBIC);
      const i2 = (i1 + 1) % this.curve.length;
      this.curve.setSegmentMode(i1, i2, sk.Curve.CUBIC);
    }
  }
  nodeAction(uictx, indices){
    if(this.makeCubic){
      this.setSidesAsCubic(indices);
    }
    for(const idx of indices){
      this.curve.setControlMode(idx, this.controlMode);
    }
  }
}

module.exports = NodeMode;