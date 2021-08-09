// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const NodeEdit = require('./node-edit.js');

class AlignHorizontal extends NodeEdit {
  constructor(curve = null){
    super(curve, '#66F');
  }

  nodeAction(uictx, indices){
    const meanY = indices.reduce((my, i) => {
      return my + this.curve.getPoint(i).y / indices.length;
    }, 0);
    for(const idx of indices){
      const { x } = this.curve.getPoint(idx);
      this.curve.setPoint(idx, { x, y: meanY });
    }
  }
}

module.exports = SketchAction.register('align-horizontal', AlignHorizontal);