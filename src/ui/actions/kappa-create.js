// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const draw = require('../draw.js');
const colors = require('../colors.js');
const util = require('../util.js');
const SketchAction = require('./action.js');
const SetKappaAlpha = require('./kappa-set-alpha.js');

// constants
const constrColor = colors.timeStretchColor();

class CreateKappa extends SketchAction {
  constructor(sketch = null){
    super();
    this.sketch = sketch;
    this.constr = null;
  }
  isFreehand(){
    return document.getElementById('kappa-freehand').checked;
  }
  getTargetPos(uictx, freehand = this.isFreehand()){
    if(!this.sketch)
      return [];
    const pos = this.sketch.globalToLocal(uictx.getSketchPos());
    // check base target
    baseHit: {
      const curve = uictx.getHITTarget(false, true);
      if(!curve || curve.root() !== this.sketch)
        return [];
    }
    if(!freehand){
      // constrained target
      const [curve, segIdx] = uictx.getHITTarget(true);
      if(curve
      && curve.root() === this.sketch
      && segIdx !== -1){
        // valid target => get parameters
        const seg = curve.getSegment(segIdx);
        if(seg){
          let localPos;
          if(curve === this.sketch)
            localPos = pos;
          else
            localPos = curve.parentToLocal(pos);
          // project
          const proj = seg.project(localPos);
          // project back
          let sketchPos;
          if(curve === this.sketch)
            sketchPos = proj;
          else
            sketchPos = curve.localToParent(proj);
          return [sketchPos, curve, segIdx, proj.t];
        }
      }

    } else {
      // freehand
      return [pos, null, pos.x, pos.y];
    }
    return [];
  }
  isValidParent(skobj){
    return skobj && skobj instanceof sk.Sketch && skobj.isRoot();
  }
  start(uictx){
    if(this.sketch)
      return;

    // do we have a selection?
    if(!this.sketch || !this.isValidParent(this.sketch)) {
      // else we disambiguate by clearing the selection
      this.sketch = null;
      uictx.clearSelection();
    }
  }
  move(uictx){
    // front drawing context
    const ctx = uictx.getDrawingContext();
    
    // selection state
    if(!this.sketch){
      // special display of selection
      // so that the user knows which sketch will own the curve
      const skObj = uictx.getHITTarget();
      if(this.isValidParent(skObj)){
        draw.withinContext(ctx, skObj, () => {
          skObj.drawPath(ctx);
          ctx.fillStyle = constrColor + '33';
          ctx.fill();
        });
      }

    } else {
      const [sketchPos] = this.getTargetPos(uictx);
      if(!sketchPos)
        return; // nothing
      const r = draw.getConstantRadius(uictx.transform, 10);
      draw.withinContext(ctx, this.sketch, () => {
        ctx.beginPath();
        draw.circle(ctx, sketchPos.x, sketchPos.y, r);
        ctx.strokeStyle = constrColor + '66';
        ctx.stroke();
        ctx.fillStyle = constrColor + '22';
        ctx.fill();
      });
    } // endif sketch else
  }

  stop(uictx /*, event */){
    if(this.sketch){
      // get location
      const [sketchPos, curve, p1, p2] = this.getTargetPos(uictx);
      if(!sketchPos){
        // invalid state or location
        // => reset sketch target (and selection)
        this.sketch = null;
        uictx.clearSelection();
        return;
      }

      // create kappa constraint
      const kappa = this.sketch.newKappaConstraint();
      kappa.setPosition(curve, p1, p2);
      uictx.commitHistory('create kappa');

      // get kappa value
      util.askForNumber('Curvature (kappa) value (0;10):', kappa.kappa).then(value => {
        kappa.setKappa(value);
        uictx.updateContent();

      }).catch(util.noop);

      uictx.updateContent();

      // delegate to kappa-weight
      uictx.setAction(new SetKappaAlpha(kappa, this));

    } else {
      // update parent sketch
      uictx.updateSelection();
      // check new selection
      if(uictx.selectionSize() === 1){
        const skobj = uictx.firstSelection();
        // if a valid parent, use it
        if(this.isValidParent(skobj)){
          this.sketch = skobj;
        }
      }
    }
  }
  click(/* uictx, event */){ /*return this.stop(uictx, event); */ }
}

module.exports = SketchAction.register('kappa-create', CreateKappa);