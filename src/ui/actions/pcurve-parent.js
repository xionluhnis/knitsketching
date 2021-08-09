// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const SketchAction = require('./action.js');
const SelectTarget = require('./select-target.js');

class PCurveParent extends SelectTarget {
  constructor(callback){
    super(callback);
  }
  get commitLabel(){ return 'pcurve parent'; }
  isValidTarget(skobj){
    return skobj && skobj.isRoot() && skobj instanceof sk.Sketch;
  }
}

module.exports = SketchAction.register('pcurve-parent', PCurveParent);
