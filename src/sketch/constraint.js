// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const Curve = require('./curve.js');
const PCurve = require('./pcurve.js');

// constants
// types
const DIRECTION = 'direction';
const ISOLINE   = 'isoline';
const SEAM      = 'seam';
const SEAM_SRC  = 'seam1';
const SEAM_SNK  = 'seam-1';
// directionality
const FORWARD   = 1;
const BACKWARD  = -1;
const NONE      = 0;
// target type
const CURVE     = 'curve';
const PCURVE    = 'pcurve';
// listings
const FLOW_TYPES = [DIRECTION, ISOLINE, SEAM];
const DIR_TYPES  = [FORWARD, BACKWARD, NONE];
// colors
const COLOR_OF = {
  [DIRECTION]: '#FF66FF',
  [ISOLINE]:   '#33CCFF',
  [SEAM]:      '#FFCC33',
  [SEAM_SNK]:  '#FF4499',
  [SEAM_SRC]:  '#00DD66',
};
const DIR_NAME_OF = {
  [FORWARD]: 'forward',
  [BACKWARD]: 'backward',
  [NONE]: 'none'
};
const DIR_NAMES  = DIR_TYPES.map(d => DIR_NAME_OF[d] || '???');

/**
 * Flow constraint
 * 
 * A time/flow constraint associated with a sketch,
 * of a given type (DIRECTION, ISOLINE or SEAM)
 * and with a given directionality (FORWARD, BACKWARD or NONE).
 */
class FlowConstraint {
  /**
   * Creates a new flow constraint object
   * 
   * @param {Sketch}  parent the sketch parent
   * @param {Curve|PCurve} target the constraint object
   * @param {string}  type the type of constraint
   * @param {string}  dir the constraint directionality
   * @param {number}  weight a weight in [0;1]
   * @param {boolean} noCheck whether to avoid data verification
   */
  constructor(parent, target, type, dir, weight, noCheck = false){
    this.parent = parent;
    this.target = target;
    this.targetType = target instanceof Curve ? CURVE : PCURVE;
    this.type   = type || ISOLINE;
    this.dir    = dir || (this.type !== SEAM ? FORWARD : NONE);
    this.w      = weight || 0.0; // default weight
    // for reconstruction, allow invalid state
    if(noCheck)
      return;
    // check target type
    assert(target instanceof Curve || target instanceof PCurve,
      'Constraint targets must be curves or pcurves', target);
    // check type
    assert(FLOW_TYPES.includes(type),
      'Unsupported flow constraint type');
    // check direction
    assert(DIR_TYPES.includes(this.dir),
      'Unsupported constraint directionality', this.dir);
    // check weight
    assert(typeof weight === 'number',
      'Weight must be a number', weight);
  }

  setType(type, dir){
    assert(FLOW_TYPES.includes(type), 'Invalid constraint type', type);
    if(this.type === type){
      if(dir === undefined)
        return; // nothing to do
      // else, we set the weight to default
      this.w = 0.0;
    }
    this.type = type; // update type

    // update accompanying direction
    if(DIR_TYPES.includes(dir)){
      this.dir = dir;

    } else {
      // use default direction depending on type
      if(type === DIRECTION){
        // direction uses default forward
        this.dir = FORWARD;

      } else {
        // no direction by default
        this.dir = NONE;
      }
    }
  }

  set weight(w){
    assert(!isNaN(w), 'Weight must be a number in [0; 1]');
    assert(w >= 0.0, 'Negative weight');
    // XXX can we accept weights >1.0?
    this.w = w;
  }
  get weight(){
    if(this.w)
      return this.w;
    // return default weight
    switch(this.type){
      case DIRECTION: return 0.3;
      default:        return 1.0;
    }
  }
  hasAutoWeight(){ return this.w === 0; }
  setAutoWeight(){ this.w = 0.0; }

  toJSON(){
    return {
      parent: this.parent.id,
      target: this.target.id,
      type: this.type,
      dir: this.dir,
      weight: this.w
    };
  }

  toggleDir(){
    if(this.type === SEAM)
      return; // no toggling since this changes semantics
    const types = DIR_TYPES;
    const d = types.indexOf(this.dir);
    this.dir = types[(d + 1) % types.length];
  }

  isDirectional(){
    return this.type !== SEAM && this.dir !== NONE;
  }
  isTimeConstraint(){
    return this.type === ISOLINE && this.dir !== NONE;
  }

  isSeam(){
    return this.type === SEAM;
  }

  isBorder(){
    return this.target instanceof PCurve && this.target.subCurve;
  }

  *segments(){
    if(this.dir != BACKWARD){
      for(let i = 0; i < this.target.segLength; ++i){
        const segment = this.target.getSegment(i);
        if(segment)
          yield segment; // may be temporarily null (for pcurves)
      } // endfor i < segLength

    } else {
      for(let i = this.target.segLength - 1; i >= 0; --i){
        const segment = this.target.getSegment(i);
        if(segment)
          yield segment; // may be temporarily null (for pcurves)
      } // endfor i >= 0
    } // endif else
  }

  get dirName(){
    return DIR_NAME_OF[this.dir] || '???';
  }
  get color(){
    return FlowConstraint.colorOf(this.type, this.dir);
  }
  static colorOf(type, dir){
    const fullType = type + dir;
    if(fullType in COLOR_OF)
      return COLOR_OF[fullType];
    else
      return COLOR_OF[type] || '#000000';
  }
}

// bundle constants
const constants = {
  DIRECTION, ISOLINE, SEAM,
  FORWARD, BACKWARD, NONE,
  CURVE, PCURVE,
  FLOW_TYPES, DIR_TYPES, DIR_NAMES,
  COLOR_OF, DIR_NAME_OF
};
module.exports = Object.assign(FlowConstraint, constants, {
  constants
});