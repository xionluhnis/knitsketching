// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const LinkEdit = require('./link-edit.js');
const SketchAction = require('./action.js');

// colors
const delColor = '#F66';
const parentColor = '#FF666666';

class SegmentUnlink extends LinkEdit {

  move(uictx){
    // highlight current hit (and its potentially removed link)
    const [ sketch, segIdx ] = uictx.getHITTarget(true);
    if(sketch && sketch instanceof sk.Sketch && segIdx !== -1){
      const link = sketch.getLink(segIdx);
      if(link){
        this.drawLink(
          uictx, sketch, segIdx,
          delColor
        );
        this.drawLink(
          uictx, link.target, link.isParentLink() ? -1 : link.targetIndex,
          link.isParentLink() ? parentColor : delColor,
          [5, 5] // dash on linked side
        );
      }
    }
  }

  stop(uictx){
    const [sketch, segIdx] = uictx.getHITTarget(true);
    if(sketch && segIdx !== -1
    && this.startSketch === sketch
    && this.startSegIdx === segIdx){
      // only unlink if the same as initially selected
      // as a precaution and to allow the user to cancel by moving away
      // before releasing the click
      sketch.setLink(segIdx, null);
      // commit history
      uictx.commitHistory();
    }
    this.resetTarget();
    uictx.update();
  }
}

module.exports = SketchAction.register('segment-unlink', SegmentUnlink);