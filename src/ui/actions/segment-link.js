// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const LinkEdit = require('./link-edit.js');
const SketchAction = require('./action.js');
const colors = require('../colors.js');

// colors
const baseColor = '#FF6';
// const invalidColor = '#F66';
// const diffColor = '#FCA';
const parentColor = '#6666FF99';
const delColor = '#F6F';

class SegmentLink extends LinkEdit {

  move(uictx){
    // list of direct segment in consideration
    const segments = [];

    // get current target (if any)
    if(this.prevSketch){
      // => startSegIdx != -1 by construction
      segments.push([this.prevSketch, this.prevSegIdx]);
    }
    // get current hit
    const [ curve, segIdx ] = uictx.getHITTarget(true);
    if(curve && curve instanceof sk.Sketch
    && (segIdx !== -1 || this.isParentSketch(curve))){
      segments.push([curve, segIdx]);
    }

    for(const [sketch, segIdx] of segments){
      let color;
      if(segIdx === -1){
        color = parentColor;

      } else if(this.prevSketch){
        // with a select sketch/segment
        const { error } = this.checkTarget(sketch, segIdx);
        color = colors.getLinkQualityColor(error);

      } else {
        // first segment
        color = baseColor;
      }
      this.drawLink(uictx, sketch, segIdx, color);

      // possible link to consider
      if(segIdx === -1)
        continue;
      const link = sketch.getLink(segIdx);
      if(link && !link.isParentLink())
        this.drawLink(uictx, link.target, link.targetIndex, delColor, [5, 5]);
    }
  }

  stop(uictx){
    // check whether we are releasing on the same as we pressed
    const [sketch, segIdx] = uictx.getHITTarget(true);
    if(sketch !== this.startSketch || segIdx !== this.startSegIdx){
      // changed our mind => discard click
      this.resetTarget();

    } else {
      // kept our mind => trigger action!
      // check if valid pairing:
      // - two valid distinct curves
      // - either last index is > 0
      // - or last index is 0, and last curve is the parent of the start one
      if(sketch
      && this.prevSketch
      && (segIdx !== -1 || this.isParentSketch(sketch))){
        // reset link
        this.prevSketch.setLink(this.prevSegIdx, sketch, segIdx);
        // commit history
        uictx.commitHistory();
      }

      // keep actionTarget to memorize last selection
      this.storeTarget();
    }
    uictx.update();
  }
}

module.exports = SketchAction.register('segment-link', SegmentLink);