// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchLayer = require('./base.js');
const { YarnMaskType } = require('./param.js');

// constants

class IntarsiaLayer extends SketchLayer {

  // works with stitch graph, not trace!
  fromTrace(){ return false; }

  mark(/* layers */){
    const yarnMask = this.getParam('yarnMask') || 0;
    this.prog.each(s => {
      s.setYarnMask(yarnMask);
    });
  }

}

module.exports = SketchLayer.register(
  'intarsia-layer', IntarsiaLayer,
[
  ['yarnMask', YarnMaskType]
], [
  'anchorgrid', 'rectangle', 'sketch'
]);