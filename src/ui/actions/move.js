// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const sk = require('../../sketch.js');
const draw = require('../draw.js');
const util = require('../util.js');
const SketchAction = require('./action.js');

class Move extends SketchAction {
  constructor(returnTo = null){
    super();
    this.selection = [];
    this.startPos = null;
    this.startTransforms = [];
    // callback
    this.returnTo = returnTo;
    assert(!returnTo || returnTo instanceof SketchAction,
      'ReturnTo argument must be a sketch action');
  }

  start(uictx){
    if(uictx.hasSelection()){
      this.selection = uictx.copySelection();
      this.startPos = uictx.getSketchPos();
      this.startTransforms = this.selection.map(s => {
        return s.transform.copy();
      });
    } else {
      this.selection = [];
    }
  }

  static getConstrainedTarget(uictx, sketch, project = true, maxDist = Infinity){
    if(!sketch)
      return [];
    const pos = sketch.globalToLocal(uictx.getSketchPos());
    // constrained target
    const [curve, segIdx] = uictx.getHITTarget(true);
    if(curve
    && curve.root() === sketch
    && segIdx !== -1){
      // valid target => get parameters
      const seg = curve.getSegment(segIdx);
      if(seg){
        let localPos;
        if(curve === sketch)
          localPos = pos;
        else
          localPos = curve.parentToLocal(pos);
        // project
        const proj = seg.project(localPos);
        // project back
        let sketchPos;
        if(curve === sketch)
          sketchPos = proj;
        else
          sketchPos = curve.localToParent(proj);
        return [sketchPos, curve, segIdx, proj.t];
      }
    }
    if(!project)
      return [];
    // else, try to find a target within the sketch borders
    let minSqDist = maxDist;
    let minTarget = [];
    for(let segIdx = 0; segIdx < sketch.segLength; ++segIdx){
      const seg = sketch.getSegment(segIdx);
      const proj = seg.project(pos);
      const sqDist = util.sqDistBetween(proj, pos);
      if(sqDist < minSqDist){
        minSqDist = sqDist;
        minTarget = [pos, sketch, segIdx, proj.t];
      }
    }
    // try using a child curve
    for(const curve of sketch.children){
      if(!curve.segLength)
        continue;
      const curvePos = curve.parentToLocal(pos);
      for(let segIdx = 0; segIdx < curve.segLength; ++segIdx){
        const seg = curve.getSegment(segIdx);
        const proj = seg.project(curvePos);
        const skProj = curve.localToParent(proj);
        const sqDist = util.sqDistBetween(skProj, pos); 
        if(sqDist < minSqDist){
          minSqDist = sqDist;
          minTarget = [pos, curve, segIdx, proj.t];
        }
      }
    }
    return minTarget;
  }

  move(uictx){
    if(!this.selection.length)
      return;
    const ctx = uictx.getDrawingContext();
    const sketchDeltaX = uictx.sketchX - this.startPos.x;
    const sketchDeltaY = uictx.sketchY - this.startPos.y;
    for(let i = 0; i < this.selection.length; ++i){
      const skSel = this.selection[i];
      // if(skSel.parent)
        // continue; // skip translation
      // get curve context with artificial parent shift
      const stack = [
        skSel
      ];
      if(skSel.parent){
        stack.push(skSel.parent);
      }
      stack.push({
        transform: sk.translation(sketchDeltaX, sketchDeltaY)
      });
      draw.withinContext(ctx, stack, () => {
        // draw path
        draw.drawCurvePath(ctx, skSel, true); // in context (through enter + translate)
        if(!skSel.open){
          ctx.fillStyle = '#FFFFFFAA';
          ctx.fill();
        }
        ctx.strokeStyle = '#AAA';
        ctx.setLineDash([5, 5]);
        ctx.stroke();
      });
    }

    // draw highlight text => label space
    const transform = uictx.transform;
    draw.exitViewport(ctx);
    draw.withinLabelViewport(ctx, transform, () => {
      // draw highlight text
      draw.highlightText(ctx,
        '(' + util.toDecimalString(sketchDeltaX, 1)
        + ', ' + util.toDecimalString(sketchDeltaY, 1) + ')',
        this.startPos.x, this.startPos.y
      );
    });
    // back to viewport space
    draw.enterViewport(ctx, transform);
  }

  stop(uictx){
    if(!this.selection.length)
      return;
    // apply transform on selection
    const sketchDeltaX = uictx.sketchX - this.startPos.x;
    const sketchDeltaY = uictx.sketchY - this.startPos.y;
    for(const skSel of this.selection){
      // pre-translation
      const scale = skSel.parent ? skSel.parent.transform : { kx: 1, ky: 1 };
      const xform = sk.translation(
        sketchDeltaX / scale.kx,
        sketchDeltaY / scale.ky
      ).combineWith(skSel.transform);
      skSel.setTransform(xform);
      // .translatedBy(sketchDeltaX, sketchDeltaY);
    }
    this.selection = [];
    uictx.updateContent();
    // commit history
    uictx.commitHistory();

    // callback
    if(this.returnTo){
      uictx.setAction(this.returnTo);
    }
  }
}

module.exports = SketchAction.register('move', Move, {
  shortcuts: ['g', 'm']
});
