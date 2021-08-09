// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const SketchAction = require('./action.js');
const NodeEdit = require('./node-edit.js');

class NodeDelete extends NodeEdit {
  constructor(curve = null){
    super(curve, '#F66', 3);
  }

  nodeAction(uictx, indices){
    const remNumPoints = this.curve.length - indices.length;
    const minNumPoints = this.curve.open ? 2 : 3; // minimum number of points for the curve to be valid
    if(remNumPoints < minNumPoints){
      sk.deleteCurve(this.curve);
      uictx.unhighlight(this.curve);
      this.curve = null; // it does not exist anymore!

    } else {
      for(const idx of indices){
        this.curve.removePoint(idx);
        // update references from pcurves
        for(const pcurve of sk.allPCurves()){
          pcurve.updateReferences(this.curve, idx, 'remove');
        }
      }
    }

    // remove targets
    this.resetTarget();
  }
}

module.exports = SketchAction.register('node-delete', NodeDelete);