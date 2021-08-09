// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
// const sk = require('../../sketch.js');
const NodeMode = require('./node-mode.js');
const SketchAction = require('./action.js');

class NodeCatmullRom extends NodeMode {
  constructor(){
    super(NodeCatmullRom.getControlMode());
  }
  
  static getControlMode(){
    // get selected alpha
    const input = Array.from(
      document.querySelectorAll('input[name=cralpha]')
    ).find(input => input.checked);
    assert(input, 'Missing alpha input');
    return 'cr' + input.dataset.alpha;
  }

  nodeAction(uictx, indices){
    this.controlMode = NodeCatmullRom.getControlMode();
    super.nodeAction(uictx, indices);
  }
}

module.exports = SketchAction.register('node-cr', NodeCatmullRom);