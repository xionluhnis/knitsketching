// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const NodeEdit = require('./node-edit.js');

class AlignVertical extends NodeEdit {
  constructor(curve = null){
    super(curve, '#66F');
  }

  nodeAction(uictx, indices){
    const meanX = indices.reduce((mx, i) => {
      return mx + this.curve.getPoint(i).x / indices.length;
    }, 0);
    for(const idx of indices){
      const { y } = this.curve.getPoint(idx);
      this.curve.setPoint(idx, { x: meanX, y });
    }
  }
}

module.exports = SketchAction.register('align-vertical', AlignVertical);