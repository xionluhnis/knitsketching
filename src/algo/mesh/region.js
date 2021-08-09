// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const CoursePath = require('./coursepath.js');
const { Isoline } = require('./isoline.js');

class Region {
  constructor({
    srcIdx = -1, srcIso = null, srcChains = [],
    trgIdx = -1, trgIso = null, trgChains = []
  }){
    // merging pointer
    this.parent = this;
    // data
    this.srcIdx = srcIdx;
    this.srcIso = srcIso;
    this.srcChains = new Set(srcChains);
    this.trgIdx = trgIdx;
    this.trgIso = trgIso;
    this.trgChains = new Set(trgChains);
    assert(srcIdx !== -1 || trgIdx !== -1,
      'Region without side');
    assert((srcIso && srcIso instanceof Isoline)
        || (trgIso && trgIso instanceof Isoline),
      'Region without isoline side');
    assert(this.srcChains.size || this.trgChains.size,
      'Region without chain');
  }

  static afterIsoline(srcIdx, srcIso, ...srcChains){
    return new Region({ srcIdx, srcIso, srcChains });
  }
  static beforeIsoline(trgIdx, trgIso, ...trgChains){
    return new Region({ trgIdx, trgIso, trgChains });
  }

  hasSource(){ return this.srcIdx !== -1; }
  hasTarget(){ return this.trgIdx !== -1; }
  isComplete(){ return this.hasSource() && this.hasTarget(); }
  isSplitted(){ return this.srcIdx === -2 || this.trgIdx === -2; }
  getCoursePath(isoArg){
    assert(this.isComplete(), 'Incomplete region');
    if(isoArg === this.srcIdx || isoArg === this.srcIso){
      return CoursePath.from(this.srcIso, [...this.srcChains], +1);
    } else if(isoArg === this.trgIdx || isoArg === this.trgIso){
      return CoursePath.from(this.trgIso, [...this.trgChains], -1);
    } else {
      assert.error('Invalid isoline, neither source nor target');
      return null;
    }
  }
  *isolines(){
    if(this.srcIso)
      yield this.srcIso;
    if(this.trgIso)
      yield this.trgIso;
  }
  otherIsoline(isoArg){
    if(isoArg === this.srcIdx || isoArg === this.srcIso)
      return this.trgIso;
    else if(isoArg === this.trgIdx || isoArg === this.trgIso)
      return this.srcIso;
    else {
      assert.error('Invalid isoline, neither source nor target');
      return null;
    }
  }
  hasSingularity(){
    return this.srcIso.isSingular() || this.trgIso.isSingular();
  }

  copy(newArgs){ return new Region(Object.assign({}, this, newArgs)); }
  split(iso){
    const root = this.root();
    const chainIndex = iso.chains.map((_, i) => i);
    const srcReg = root.copy({
      trgIdx: -2, trgIso: iso, trgChains: chainIndex
    });
    const trgReg = root.copy({
      srcIdx: -2, srcIso: iso, srcChains: chainIndex
    });
    return [srcReg, trgReg];
  }

  root(){
    if(this.parent !== this)
      this.parent = this.parent.root();
    return this.parent;
  }
  isRoot(){ return this.parent === this; }

  union(that){
    if(!that)
      return; // nothing to do
    // get argument's root
    that = that.root();
    // then merge from the root of this
    if(this.parent !== this)
      return this.root().union(that); // merging at the root
    else if(this === that)
      return this; // nothing to merge
    // else this is the root

    // merge source data
    if(this.hasSource() && that.hasSource()){
      assert(this.srcIdx === that.srcIdx
          && this.srcIso === that.srcIso, 'Source isolines do not match');
      for(const cidx of that.srcChains)
        this.srcChains.add(cidx);
    } else if(that.hasSource()){
      this.srcIdx = that.srcIdx;
      this.srcIso = that.srcIso;
      this.srcChains = that.srcChains;
    }
    // merge target data
    if(this.hasTarget() && that.hasTarget()){
      assert(this.trgIdx === that.trgIdx
          && this.trgIso === that.trgIso, 'Target isolines do not match');
      for(const cidx of that.trgChains)
        this.trgChains.add(cidx);
    } else if(that.hasTarget()){
      this.trgIdx = that.trgIdx;
      this.trgIso = that.trgIso;
      this.trgChains = that.trgChains;
    }
    // create aliasing
    that.parent = this; // not a root region anymore!
    // return this merged root region
    return this;
  }

  merge(that){
    assert(that && that instanceof Region, 'Invalid argument');
    assert(this.isComplete() && that.isComplete(),
      'Cannot merge incomplete regions, did you mean union?');
    that = that.root();
    if(this.parent !== this)
      return this.root().merge(that);
    else {
      const next = this.trgIso === that.srcIso;
      const prev = this.srcIso === that.trgIso;
      assert(next || prev, 'No valid interface for merging');
      if(prev)
        return that.merge(this);
      if(!next)
        return null; // cannot do anything
    }
    // we're merging the next region
    // and both this and that are root regions
    assert(this.srcChains.size && that.trgChains.size,
      'Next region does not have end chains');
    this.trgIdx = that.trgIdx;
    this.trgIso = that.trgIso;
    this.trgChains = that.trgChains;
    // create aliasing
    that.parent = this;
    // return this merged region
    return this;
  }

  toData(){
    assert(this.isComplete() && this.isRoot(),
      'Should not serialize an incomplete or non-root region');
    assert(!this.isSplitted(),
      'Should not serialize a splitted region');
    return {
      srcIdx: this.srcIdx,
      srcChains: this.srcChains,
      trgIdx: this.trgIdx,
      trgChains: this.trgChains
    };
  }

  static fromData(mesh, data){
    const { srcIdx, srcChains, trgIdx, trgChains } = data;
    const srcIso = mesh.isolines[srcIdx];
    const trgIso = mesh.isolines[trgIdx];
    return new Region({
      srcIdx, srcIso, srcChains,
      trgIdx, trgIso, trgChains
    });
  }
}

module.exports = Region;