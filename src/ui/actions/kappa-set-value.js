// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const util = require('../util.js');
const SketchAction = require('./action.js');
const SelectKappa = require('./kappa-select.js');

class SetKappa extends SelectKappa {
  constructor(constr = null, returnTo = null){
    super(constr);
    this.returnTo = returnTo;
    assert(!returnTo || returnTo instanceof SketchAction,
      'ReturnTo argument must be a sketch action');
  }
  
  selectKappa(uictx, kappa){
    util.askForNumber('Set curvature (kappa) value:', kappa.kappa).then(value => {
      kappa.setKappa(value);
      uictx.updateContent();
      // commit history
      uictx.commitHistory();
      if(this.returnTo)
        uictx.setAction(this.returnTo);
      // update flow if needed
      uictx.updateFlow();

    }).catch(() => {
      if(this.returnTo)
        uictx.setAction(this.returnTo);
    });
    this.constr = null;
  }
}

module.exports = SketchAction.register('kappa-set-value', SetKappa);