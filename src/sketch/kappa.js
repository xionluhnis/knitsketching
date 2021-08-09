// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');

class KappaConstraint {
  constructor(sketch, curve, p1, p2, kappa = 0.5, alpha = 100){
    this.parent = sketch;
    this.target = curve;
    this.p1 = p1;
    this.p2 = p2;
    // constraint value and influence (distance)
    this.kappa = kappa;
    this.alpha = alpha;
  }

  isConstrained(){ return this.target !== null; }
  isFree(){ return this.target === null; }

  getPosition(){
    if(this.target){
      const localPos = this.target.getSegment(this.p1).get(this.p2);
      // transform to sketch domain
      if(this.target === this.parent)
        return localPos; // nothing to do, already in that domain
      else
        return this.target.localToParent(localPos);
      
    } else {
      return { x: this.p1, y: this.p2 };
    }
  }

  setPosition(target, ...location){
    this.target = target;
    if(target){
      assert(target.root() === this.parent,
        'Target has different root from constraint');
      const segIdx = location[0];
      const t = location[1];
      assert(typeof segIdx === 'number'
          && 0 <= segIdx && segIdx < target.segLength,
        'Invalid segment index', segIdx);
      assert(typeof t === 'number' && 0 <= t && t <= 1,
        'Invalid segment location', t);
      this.p1 = segIdx;
      this.p2 = t;

    } else if(location.length === 1){
      const p = location[0];
      assert('x' in p && typeof p.x === 'number'
          && 'y' in p && typeof p.y === 'number',
        'Invalid position location');
      this.p1 = p.x;
      this.p2 = p.y;

    } else {
      this.p1 = location[0];
      this.p2 = location[1];
      assert(location.length === 2,
        'Invalid location parameters');
    }
  }

  setKappa(kappa){
    assert(!isNaN(kappa), 'Invalid kappa argument', kappa);
    this.kappa = Math.max(1e-3, Math.min(10, kappa));
    return this.kappa;
  }

  setInfluence(alpha){
    assert(!isNaN(alpha), 'Invalid influence argument', alpha);
    const ext = this.parent.extents();
    const maxAlpha = Math.max(
      ext.max.x - ext.min.x,
      ext.max.y - ext.min.y
    );
    this.alpha = Math.max(1, Math.min(maxAlpha, alpha));
    return this.alpha;
  }

  remove(){
    this.parent.kappas = this.parent.kappas.filter(k => k !== this);
  }

  toJSON(){
    return {
      parent: this.parent.id,
      target: this.target ? this.target.id : null,
      p1: this.p1, p2: this.p2,
      kappa: this.kappa,
      alpha: this.alpha
    };
  }
}
module.exports = KappaConstraint;