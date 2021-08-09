// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const PCurve = require('../../sketch/pcurve.js');
const SketchAction = require('./action.js');
const SegmentSelect = require('./segment-select.js');
const { SEAM_MODES } = require('../../sketch/seam.js');

class SeamToggle extends SegmentSelect {
  constructor(){
    super((curve, segIdx, uictx) => {
      // filter pcurves away
      [curve, segIdx] = SeamToggle.filterCurveSegment(curve, segIdx);
      if(!curve)
        return;
      const currMode = curve.getSeamMode(segIdx) || 0;
      const newIdx = (SEAM_MODES.indexOf(currMode) + 1) % SEAM_MODES.length;
      const newMode = SEAM_MODES[newIdx];
      curve.setSeamMode(segIdx, newMode);
      // commit change
      uictx.commitHistory('toggle seam');
      // refresh
      uictx.update();
    });
  }

  static filterCurveSegment(curve, segIdx){
    if(curve instanceof PCurve && curve.subCurve){
      const { curve: c, segIdx: si } = (
        curve.firstSample || curve.lastSample || {}
      );
      if(curve && si !== -1)
        return [c, si];
    }
    return [curve, segIdx];
  }
}

module.exports = SketchAction.register('seam-toggle', SeamToggle);