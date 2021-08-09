// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const SketchLayer = require('./base.js');
const { ImageType, MappingType, YarnMaskType } = require('./param.js');
const MultiYarnPattern = require('./multiyarnpattern.js');
const { TILED, SCALED, EXPLICIT, IMPLICIT } = MultiYarnPattern;

class FloatPattern extends MultiYarnPattern {

  markStitch(sprog, value /*, px, py */){
    // set front yarn
    sprog.yarns(ys => {
      assert(ys.hasEveryYarn(value), 'Marking unallocated yarn');
      const numY = ys.yarns.size;
      ys.setFrontYarns(value);
      assert(ys.yarns.size === numY, 'Yarn cardinality changed');
    });
  }

}

module.exports = SketchLayer.register(
  'float-pattern', FloatPattern,
[
  ['spreadMode',  [SCALED, TILED]],
  ['pattern',     ImageType],
  ['mapping',     MappingType],
  ['yarnMask',    YarnMaskType],
  ['missType',    [IMPLICIT, EXPLICIT]]
], [
  'anchorgrid', 'rectangle'
]);