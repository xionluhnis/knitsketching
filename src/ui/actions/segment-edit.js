// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const draw = require('../draw.js');
const Edit = require('./edit.js');

// constants
const hoverColor = '#66F';

class SegmentEdit extends Edit {
  constructor(curve = null, selColor = '#FF6'){
    super(curve, false, selColor); // do not show controls
  }

  start(uictx){
    super.start(uictx);
    // but revert action to SELECT
    // => we do not modify things like Edit does
    this.editMode = Edit.SELECT;
  }

  move(uictx){
    if(!this.curve)
      return;
    // else, highlight current segments
    this.drawSegments(uictx);

    const ctx = uictx.getDrawingContext();
    const [curve, segIdx] = uictx.getHITTarget(true);
    if(curve === this.curve && segIdx !== -1){
      draw.drawCurveSegment(ctx, curve, segIdx);
      const prevWidth = ctx.lineWidth;
      ctx.lineWidth = draw.getConstantRadius(uictx.transform, 4);
      ctx.strokeStyle = hoverColor;
      ctx.stroke();
      ctx.lineWidth = prevWidth;
    }

    // then highlight rest as usual
    super.move(uictx);
  }

  drawSegments(uictx){
    const segPairs = this.getSegmentPairs();
    const ctx = uictx.getDrawingContext();
    const prevWidth = ctx.lineWidth;
    ctx.lineWidth = draw.getConstantRadius(uictx.transform, 4);
    ctx.strokeStyle = this.selectColor;
    
    // highlight segments
    draw.withinContext(ctx, this.curve, () => {
      for(const [segIdx, ] of segPairs){
        draw.drawCurveSegment(ctx, this.curve, segIdx, true);
        ctx.stroke();
      }
    });
    ctx.lineWidth = prevWidth;
  }

  getSegmentPairs(backToFront = true){
    // extract segment pairs
    const pairs = [];
    for(let i = 0; i < this.targets.length; ++i){
      const idx1 = this.targets[i];
      for(let j = i + 1; j < this.targets.length; ++j){
        const idx2 = this.targets[j];
        if(idx1 == (idx2 + 1) % this.curve.length
        || idx2 == (idx1 + 1) % this.curve.length){
          // valid pair
          const pair = [Math.min(idx1, idx2), Math.max(idx1, idx2)];
          if(pair[0] === 0 && pair[1] !== 1)
            pair.reverse(); // across boundaries => change ordering
          pairs.push(pair);
        } // endif pair
      } // endfor j
    } // endfor i

    // back to front sorting
    // = very useful for subdivision because
    //   only later indices change while subdividing
    if(backToFront){
      pairs.sort((p1, p2) => p2[0] - p1[0]);
    }
    return pairs;
  }

  segmentAction(/* uictx, segPairs */){}

  stop(uictx){
    
    // action requires selection
    if(this.targets.length && this.canEdit()){
      const segPairs = this.getSegmentPairs();
      this.segmentAction(uictx, segPairs);
      // commit history
      uictx.commitHistory();

      // reset targets
      this.resetTarget();

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

  dblclick(uictx){
    if(this.curve){
      // select all segments
      this.targets = Array.from({ length: this.curve.length },
        (_, i) => i
      );
      this.stop(uictx);
    }
  }
}

module.exports = SegmentEdit;