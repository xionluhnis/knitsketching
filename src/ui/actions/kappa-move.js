// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const util = require('../util.js');
const SketchAction = require('./action.js');
const SelectKappa = require('./kappa-select.js');

class MoveKappa extends SelectKappa {
  constructor(constr = null, returnTo = null){
    super(constr);
    this.returnTo = returnTo;
    assert(!returnTo || returnTo instanceof SketchAction,
      'ReturnTo argument must be a sketch action');
    // initial position
    this.startPos = null;
  }

  start(uictx){
    // try to select a constraint if none yet
    if(!this.constr)
      this.constr = this.getKappa(uictx);
    // get start position
    this.startPos = this.sketch.globalToLocal(uictx.getSketchPos());
  }

  isFreehand(){
    return document.getElementById('kappa-freehand').checked;
  }
  getTargetPos(uictx, freehand = this.isFreehand()){
    if(!this.constr)
      return [];
    const sketch = this.constr.parent;
    // get displacement in sketch context
    const currPos = this.sketch.globalToLocal(uictx.getSketchPos());
    const delta = util.axpby(-1, this.startPos, 1, currPos);
    // get initial position in sketch context
    const pos = this.constr.getPosition();
    const newPos = util.axpby(1, pos, 1, delta);
    // constraining check
    if(!freehand){
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
            localPos = currPos;
          else
            localPos = curve.parentToLocal(currPos);
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
      // else, try to find a target within the sketch borders
      for(let segIdx = 0; segIdx < sketch.segLength; ++segIdx){
        const seg = sketch.getSegment(segIdx);
        const proj = seg.project(newPos);
        if(util.distBetweenBelow(proj, newPos, 10)){
          return [newPos, sketch, segIdx, proj.t];
        }
      }
      // try using a child curve
      for(const curve of sketch.children){
        if(!curve.segLength)
          continue;
        const curvePos = curve.parentToLocal(newPos);
        for(let segIdx = 0; segIdx < curve.segLength; ++segIdx){
          const seg = curve.getSegment(segIdx);
          const proj = seg.project(curvePos);
          if(util.distBetweenBelow(proj, newPos, 10)){
            return [newPos, curve, segIdx, proj.t];
          }
        }
      }
      // else no parametric target found

    } else {
      // freehand
      return [newPos, null, newPos.x, newPos.y];
    }
    return [];
  }

  move(uictx){
    if(this.constr && this.startPos){
      // draw change of location
      const [newPos] = this.getTargetPos(uictx);
      if(!newPos)
        return; // nothing to show
      
      SelectKappa.draw(uictx.getDrawingContext(), this.constr, {
        highlight: true,
        transform: uictx.transform,
        position: newPos,
        strokeColor: '#666666'
      });

    } else {
      super.move(uictx);
    }
  }

  stop(uictx, event){
    if(this.constr && this.startPos){
      // apply influence change
      const [newPos, target, p1, p2] = this.getTargetPos(uictx);
      if(newPos){
        this.constr.setPosition(target, p1, p2);
      }
      this.constr = null; // unselect
      // update scene
      uictx.updateContent();
      // commit history
      uictx.commitHistory('set alpha');
      // return to callback if any
      if(this.returnTo)
        uictx.setAction(this.returnTo);

    } else {
      super.stop(uictx, event);
    }
  }
}

module.exports = SketchAction.register('kappa-move', MoveKappa);