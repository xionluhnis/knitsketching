// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const NodeEdit = require('./node-edit.js');

class DistributeHorizontal extends NodeEdit {
  constructor(curve = null){
    super(curve, '#66F');
  }

  nodeAction(uictx, indices){
    const N = indices.length;
    if(N < 2)
      return;
    const distr = indices.map(i => {
      return {
        index: i, value: this.curve.getPoint(i).x
      };
    });
    distr.sort((d1, d2) => d1.value - d2.value);
    const min = distr[0].value;
    const max = distr[distr.length - 1].value;
    for(let i = 0; i < N; ++i){
      const { index } = distr[i];
      const { y } = this.curve.getPoint(index);
      this.curve.setPoint(index, { x: min + (max - min) * i / (N-1), y });
    }
  }
}

module.exports = SketchAction.register('distr-horizontal', DistributeHorizontal);