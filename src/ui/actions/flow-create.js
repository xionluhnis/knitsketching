// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const CreateSubCurve = require('./subcurve-create.js');
const FlowType = require('./flow-type.js');
const assert = require('../../assert.js');

class CreateFlowCurve extends CreateSubCurve {
  constructor(parentSketch = null){
    super(parentSketch);
  }
  createCurve(curve){
    assert(this.parentSketch && curve, 'Missing sketch or curve');
    // set it as constraint
    const [flowType, flowDir] = FlowType.getTypeAndDir();
    this.parentSketch.setConstraint(this.curve, flowType, flowDir);
  }
}

module.exports = SketchAction.register('flow-create', CreateFlowCurve);