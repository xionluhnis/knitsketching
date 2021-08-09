// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const draw = require('../draw.js');
const SketchAction = require('./action.js');
const SelectKappa = require('./kappa-select.js');

// constants
const delColor = '#FF6666';

class DeleteKappa extends SelectKappa {
  constructor(constr = null, returnTo = null){
    super(constr);
    this.returnTo = returnTo;
    assert(!returnTo || returnTo instanceof SketchAction,
      'ReturnTo argument must be a sketch action');
  }
  
  selectKappa(uictx, kappa){
    // remove constraint
    kappa.remove();
    this.constr = null;

    // update scene
    uictx.updateContent();

    // commit history
    uictx.commitHistory('delete kappa');
    
    // return to callback if any
    if(this.returnTo)
        uictx.setAction(this.returnTo);
  }

  draw(uictx, constr){
    const ctx = uictx.getDrawingContext();
    const width = draw.getConstantRadius(uictx.transform, 3);
    ctx.lineWidth = width;
    ctx.strokeStyle = delColor;

    // draw constraint influence area
    ctx.beginPath();
    const p = constr.getPosition();
    const r = constr.alpha;
    const len = Math.max(r, width * 2);
    draw.times(ctx, p.x, p.y, len);
    ctx.stroke();
  }
}

module.exports = SketchAction.register('kappa-delete', DeleteKappa);