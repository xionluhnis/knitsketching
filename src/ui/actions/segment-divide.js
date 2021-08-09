// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchAction = require('./action.js');
const SegmentEdit = require('./segment-edit.js');
const sk = require('../../sketch.js');

class SegmentDivide extends SegmentEdit {
  stop(uictx){
    
    // action requires selection
    if(this.targets.length){
      // get hit location for special position
      const [curve, segIdx] = uictx.getHITTarget(true);
      let clickT = 0.5;
      if(curve && segIdx !== -1){
        const segment = curve.getSegment(segIdx);
        const localPos = curve.globalToLocal(uictx.getSketchPos());
        clickT = segment.project(localPos).t;
      }
      const segPairs = this.getSegmentPairs();
      for(const [sidx, ] of segPairs){
        if(this.curve === curve && sidx === segIdx){
          this.curve.divideSegment(sidx, clickT);
        } else {
          this.curve.divideSegment(sidx);
        }
        // update references from pcurves
        for(const pcurve of sk.allPCurves()){
          pcurve.updateReferences(this.curve, sidx, 'add');
        }
      } // endfor [segIdx, ] of segPairs

      // reset targets if any segment changed
      if(segPairs.length){
        this.resetTarget();
        // commit history
        uictx.commitHistory();
      }

      // may need to update content
      uictx.updateContent();

    } else {
      // update edit curve
      this.curve = uictx.getHITTarget();
    }

    // reset mouse information
    this.sketchStart = null;
    this.curveStart  = null;
  }
}

module.exports = SketchAction.register('segment-divide', SegmentDivide);