// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const CreateSubCurve = require('./subcurve-create.js');
const { SEAM_ON } = require('../../sketch/seam.js');

class CreateSeamCurve extends CreateSubCurve {
  constructor(parentSketch = null){
    super(parentSketch);
  }
  setSeam(curve = this.curve){
    if(!curve)
      return;
    for(let segIdx = 0; segIdx < curve.segLength; ++segIdx)
      curve.setSeamMode(segIdx, SEAM_ON);
  }
  createCurve(curve){
    this.setSeam(curve);
  }
  stop(...args){
    const curve = this.curve;
    super.stop(...args);
    this.setSeam(curve);
  }
}

module.exports = SketchAction.register('seam-create', CreateSeamCurve);