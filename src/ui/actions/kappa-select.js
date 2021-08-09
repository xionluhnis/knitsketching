// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
const draw = require('../draw.js');
const colors = require('../colors.js');
const util = require('../util.js');
const SketchAction = require('./action.js');

class SelectKappa extends SketchAction {
  constructor(constr = null){
    super();
    this.constr = constr;
  }
  get sketch(){
    return this.constr ? this.constr.parent : null;
  }
  getKappa(uictx){
    const pos = uictx.getSketchPos();
    for(const sketch of sk.allRootSketches()){
      const sketchPos = sketch.globalToLocal(pos);
      for(const kappa of sketch.kappas){
        const kappaPos = kappa.getPosition();
        if(!kappaPos)
          continue;
        if(util.distBetween(sketchPos, kappaPos) <= kappa.alpha){
          return kappa;
        }
      } // endfor kappa
    } // endfor sketch
    return null;
  }
  move(uictx){
    // front drawing context
    const ctx = uictx.getDrawingContext();
    const kappa = this.getKappa(uictx);
    if(kappa){
      draw.withinContext(ctx, kappa.parent, () => {
        this.draw(uictx, kappa, { highlight: true, inContext: true });
      });
    }
  }

  selectKappa(/* uictx, kappa */){}

  stop(uictx){
    // select kappa
    this.constr = this.getKappa(uictx);
    // trigger action
    if(this.constr)
      this.selectKappa(uictx, this.constr);
  }
  click(/* uictx, event */){ /*return this.stop(uictx, event); */ }

  draw(uictx, constr, { highlight = false, inContext = false } = {}){
    SelectKappa.draw(
      uictx.getDrawingContext(),
      constr,
      { highlight, inContext }
    );
  }

  static draw(ctx, constr, {
    highlight = false, inContext = false,
    position = constr.getPosition(),
    kappa = constr.kappa, alpha = constr.alpha,
    transform = null, width = 0, strokeColor = null
  } = {}){
    // enter correct context
    const stack = inContext ? [] : constr.parent.getContextStack();
    draw.enterContext(ctx, stack);

    // set style
    if(!strokeColor){
      if(kappa < 1.0)
        strokeColor = colors.timeStretchColor();
      else if(kappa > 1.0)
        strokeColor = colors.timeShrinkColor();
      else
        strokeColor = '#999999';
    }
    // const d = this.getConstantRadius(width || 3);
    if(transform)
      width = draw.getConstantRadius(transform, 3);
    if(width)
      ctx.lineWidth = width;
    ctx.strokeStyle = strokeColor + (highlight ? '33' : '11');

    // draw constraint influence area
    ctx.beginPath();
    const p = position;
    const r = alpha;
    draw.circle(ctx, p.x, p.y, r);
    ctx.stroke();
    ctx.fillStyle = strokeColor + (highlight ? '08' : '04');
    ctx.fill();
    // center cross
    ctx.beginPath();
    const len = Math.min(r, width * 2);
    draw.times(ctx, p.x, p.y, len);
    ctx.stroke();

    // exit context
    draw.exitContext(ctx, stack);
  }
}

module.exports = SelectKappa;