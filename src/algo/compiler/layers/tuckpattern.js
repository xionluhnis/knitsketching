// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchLayer = require('./base.js');
const { ImageType, MappingType, YarnMaskType } = require('./param.js');
const MultiYarnPattern = require('./multiyarnpattern.js');
const { IMPLICIT, EXPLICIT } = MultiYarnPattern;

// constants
const SMART_SKIP = 'smart skip';
const SMART_KEEP = 'smart keep';
const SMART_NONE = 'keep as-is';

class TuckPattern extends MultiYarnPattern {

  filterNode(nprog){
    return this.getParam('withinNode')
        || nprog.indices.includes(this.anchorStitch.index);
  }

  smartOption(stitch){
    if(!stitch.isDecreasing())
      return SMART_NONE; // no need to be smart
    else
      return this.getParam('shapingType');
  }

  markStitch(sprog, value /*, px, py, gx, gy */){
    const stitch = sprog.stitches[sprog.indices[0]];
    const sopt = this.smartOption(stitch);
    if(sopt === SMART_NONE){
      // set back yarn as tuck
      sprog.yarns(ys => ys.setBackYarns(value, 'tuck'));

    }
    // XXX else look for better options on side neighbors
    // better neighbors, in order:
    // 1. has a front knit with the matching yarn (then we can skip our tuck)
    // 2. has a non-decreasing back tuck with the matching yarn (then we can skip our tuck)
    // 3. has a non-decreasing stitch without matching front yarn, nor any back tuck (then we should tuck that one, i.e. keep it)
    // or if none is found, then depending on the option,
    // we either tuck as-is (keep) or cancel the tuck (skip)
  }

}

module.exports = SketchLayer.register(
  'tuck-pattern', TuckPattern,
[
  ['pattern',     ImageType],
  ['mapping',     MappingType],
  ['yarnMask',    YarnMaskType],
  ['withinNode',  true],
  ['missType',    [IMPLICIT, EXPLICIT]],
  ['shapingType', [SMART_SKIP, SMART_KEEP, SMART_NONE]]
], [
  'anchorgrid' // only agrid because only TILED
]);