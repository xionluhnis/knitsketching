// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { Isoline } = require('./isoline.js');
const Region = require('./region.js');

// constants
const NONE = 0;
const PREV = -1;
const NEXT = 1;
const OK = 0;
const WARNING = 1;
const ERROR = 2;

class Node {
  constructor({
    [PREV]: prev = [],
    [NEXT]: next = []
  } = {}){
    // node neighbors
    this.next = new Set(next);
    this.prev = new Set(prev);
    
    // weight information
    this.sampleCount = 0;
    this.rank = Infinity;
    this.status = OK;
  }
  clearStatus(){ this.status = OK; }
  hasStatus(status){ return this.status === status; }
  hasError(){ return this.hasStatus(ERROR); }
  hasWarning(){ return this.hasStatus(WARNING); }
  setStatus(status){
    this.status = Math.max(this.status, status);
  }
  getStatus(){ return this.status; }
  setError(/* msg */){ this.setStatus(ERROR); }
  setWarning(/* msg */){ this.setStatus(WARNING); }
  remap(map){
    this.next = new Set(Array.from(this.next, map));
    this.prev = new Set(Array.from(this.prev, map));
    return this;
  }
  toData(){
    return {
      next: Array.from(this.next, r => r.index),
      prev: Array.from(this.prev, r => r.index),
      sampleCount: this.sampleCount,
      rank: this.rank
    };
  }

  loadData(data, rlist){
    for(const key of ['sampleCount', 'rank'])
      this[key] = data[key];
    for(const key of ['next', 'prev']){
      this[key] = new Set(data[key].map(idx => {
        assert(idx >= 0 && idx < rlist.length, 'Invalid index');
        return rlist[idx];
      }));
    }
    return this;
  }

  getRelation(reg, checkReg = true){
    assert(this.getClass() === reg.getClass(),
      'Node class does not match');
    if(this.next.has(reg))
      return NEXT;
    if(this.prev.has(reg))
      return PREV;
    if(checkReg){
      assert(reg.getRelation(this, false) === NONE,
        'Relation is unidirectional');
    }
    return NONE;
  }
  
  *neighbors(){
    yield *this.prev;
    yield *this.next;
  }
  get neighborCount(){ return this.next.size + this.prev.size; }
  getNeighbors(){ return Array.from(this.neighbors()); }
  isNeighbor(reg){ return this.getRelation(reg) !== NONE; }
  isPrev(reg){ return this.prev.has(reg); }
  isNext(reg){ return this.next.has(reg); }
  getClass(){ return Object.getPrototypeOf(this).constructor; }
  isAbstract(){ return this.getClass() === Node; }
  isReduced(){ return false; }
  isInterface(){ return false; }
  isArea(){ return false; }
  hasPrev(){ return this.prev.size > 0; }
  hasNext(){ return this.next.size > 0; }
  isInternal(){ return this.hasPrev() && this.hasNext(); }
  isBoundary(){ return !this.isInternal(); }
  isSource(){ return !this.hasPrev(); }
  isSink(){ return !this.hasNext(); }

  getNext(){
    assert(this.next.size === 1, 'Ambiguous next region');
    const [next] = this.next;
    return next;
  }
  getPrev(){
    assert(this.prev.size === 1, 'Ambiguous previous region');
    const [prev] = this.prev;
    return prev;
  }

  addNeighbor(reg, rel, andBack = true){
    assert(this.getClass() === reg.getClass(),
      'Region class does not match');
    assert(reg !== this, 'Self neighbor');
    if(rel === NEXT){
      assert(!this.isPrev(reg),
        'Adding previous region as next region');
      this.next.add(reg);
      
    } else if(rel === PREV){
      assert(!this.isNext(reg),
        'Adding next region as previous region');
      this.prev.add(reg);

    } else {
      assert.error('Invalid region relation', rel);
    }
    // add backward relation pointer
    if(andBack)
      reg.addNeighbor(this, -rel, false);
  }
  removeNeighbor(reg, needsEffect = false, andBack = true){
    assert(this.getClass() === reg.getClass(),
      'Region class does not match');
    if(this.prev.has(reg)){
      this.prev.delete(reg);
      return andBack ? reg.removeNeighbor(this, needsEffect, false) : true;

    } else if(this.next.has(reg)){
      this.next.delete(reg);
      return andBack ? reg.removeNeighbor(this, needsEffect, false) : true;

    } else {
      assert(!needsEffect, 'Removing non-neighbor');
      return false;
    }
  }
  replaceWith(first, last = first){
    // create copies for safe iteration while modifying those
    const prev = Array.from(this.prev);
    const next = Array.from(this.next);
    // update neighbor sets
    for(const pre of prev){
      this.removeNeighbor(pre, true);
      pre.addNeighbor(first, NEXT);
    }
    for(const nex of next){
      this.removeNeighbor(nex, true);
      nex.addNeighbor(last, PREV);
    }
  }
}

class RegionNode extends Node {
  constructor(mesh, index, {
    [PREV]: prev = [],
    [NEXT]: next = [],
    isoline = null,
    region = null,
    check = true
  } = {}){
    super({ [PREV]: prev, [NEXT]: next });

    // region data
    this.mesh     = mesh;
    this.index    = index;
    this.isoline  = isoline;
    this.region   = region;
    
    // data checks
    if(check){
      assert(isoline || region,
        'Empty region: no isoline nor region');
      assert(!isoline || !region,
        'Mixed region: an isoline and a region');
      assert(!isoline || isoline instanceof Isoline,
        'Isoline has invalid type');
      assert(!region || region instanceof Region,
        'Region has invalid type');
    }
  }
  copy(){
    return new RegionNode(
      this.mesh,
      this.index, {
        isoline: this.isoline,
        region: this.region,
        [NEXT]: this.next,
        [PREV]: this.prev
      }
    );
  }
  toData(){
    return Object.assign(super.toData(), {
      isoline: this.mesh.isolineIndexOf(this.isoline),
      region:  this.region ? this.region.toData() : null
    });
  }
  loadData(data){
    super.loadData(data, this.mesh.regions);
    this.isoline = this.mesh.isolines[data.isoline] || null;
    this.region  = data.region ? Region.fromData(this.mesh, data.region) : null;
    assert(this.isoline || this.region, 'Empty region');
    assert(!this.isoline || !this.region, 'Mixed region');
    return this;
  }
  get time(){
    if(this.isoline)
      return this.isoline.time;
    assert.error('Time of non-isoline region');
    return NaN;
  }
  isInterface(){ return !!this.isoline; }
  isArea(){ return !!this.region; }
  isWellOrdered(){
    for(const pre of this.prev){
      if(!pre.isInterface())
        continue;
      for(const nex of this.next){
        if(!nex.isInterface())
          continue;
        if(nex.time < pre.time)
          return false;
      }
    }
    return true;
  }

  reduced(){
    if(this.isInterface())
      return new ReducedNode([this], this.index, [this], [this]);
    else
      return new ReducedNode([this], this.index, [], []);
  }
  reduction(){ return this.isReduced() ? this : this.mesh.getReduction(this); }
}

class ReducedNode extends Node {
  constructor(regions, index, top, bottom, links = {}){
    super(links);

    // mesh data
    this.mesh = regions[0].mesh;
    this.index = index;

    // summary regions
    this.regions = new Set(regions);

    // boundary interface sets
    this.top    = new Set(top || []);
    this.bottom = new Set(bottom || []);

    // checks
    for(const r of regions)
      assert(!r.isReduced(), 'Reducing a reduced region');
  }

  copy(map){
    return new ReducedNode(
      Array.from(this.regions, map),
      this.index,
      Array.from(this.top, map),
      Array.from(this.bottom, map),
      {
        [PREV]: this.prev,
        [NEXT]: this.next
      }
    );
  }
  toData(){
    return Object.assign(super.toData(), {
      regions: Array.from(this.regions, r => r.index),
      top: Array.from(this.top, r => r.index),
      bottom: Array.from(this.bottom, r => r.index)
    });
  }

  loadData(data){
    super.loadData(data, this.mesh.reducedRegions);
    this.regions  = new Set(data.regions.map(i => this.mesh.regions[i]));
    this.top      = new Set(data.top.map(i => this.mesh.regions[i]));
    this.bottom   = new Set(data.bottom.map(i => this.mesh.regions[i]));
  }
  getOriginal(){
    assert(this.regions.size === 1, 'No original of group');
    const [region] = [...this.regions];
    return region;
  }
  getStatus(onlyThis = false){
    let status = this.status;
    if(onlyThis)
      return status;
    // check children for largest status
    for(const r of this.regions)
      status = Math.max(status, r.status);
    return status;
  }
  hasStatus(status, onlyThis = false){
    if(super.hasStatus(status))
      return true;
    // check underlying regions
    // unless argument to not do so
    if(onlyThis)
      return false; // do not check original regions
    for(const r of this.regions){
      if(r.hasStatus(status))
        return true;
    }
    return false;
  }

  isReduced(){ return true; }
  isInterface(){ return this.top.size || this.bottom.size; }
  isArea(){ return !this.isInterface(); }
  isSingleton(){ return this.regions.size === 1; }
  addNeighbor(reg, rel, andBack = true){
    assert(reg.isReduced(),
      'The neighbors of a reduced region must be reduced too');
    super.addNeighbor(reg, rel, andBack);
  }
  *interfaces(){
    for(const r of this.regions){
      if(r.isInterface())
        yield r;
    }
  }
  *isolines(){
    for(const r of this.regions){
      if(r.isInterface())
        yield r.isoline;
    }
  }
  computeNeighbors(mapFun){
    assert(this.isSingleton(),
      'Should compute neighbors of singletons region reductions only');
    const [region] = [...this.regions];
    // add neighbors based on reduced region
    // /!\ the map must return a valid reduced region!
    for(const nex of region.next)
      this.addNeighbor(mapFun(nex), NEXT);
    for(const pre of region.prev)
      this.addNeighbor(mapFun(pre), PREV);
  }
  topTime(redFun = Math.max){
    if(!this.isInterface())
      return NaN;
    return Array.from(this.top, r => r.time).reduce(
      (red, t) => redFun(red, t)
    );
  }
  bottomTime(redFun = Math.min){
    if(!this.isInterface())
      return NaN;
    return Array.from(this.bottom, r => r.time).reduce(
      (red, t) => redFun(red, t)
    );
  }
  reduceTime(redFun){
    let time = NaN;
    for(const r of this.regions){
      if(r.isInterface()){
        if(Number.isNaN(time))
          time = r.time;
        else
          time = redFun(time, r.time);
      }
    }
    return time;
  }
  minTime(){ return this.reduceTime(Math.min); }
  maxTime(){ return this.reduceTime(Math.max); }
  timeRange(minMax = false){
    if(this.isInterface()){
      if(minMax)
        return [ this.minTime(), this.maxTime() ];
      else
        return this.maxTime() - this.minTime();
      
    } else {
      const simple = this.getOriginal();
      const prevT = simple.getPrev().time;
      const nextT = simple.getNext().time;
      assert(prevT < nextT, 'Wrong time order');
      return minMax ? [prevT, nextT] : nextT - prevT;
    }
  }
  isWellOrdered(){
    for(const pre of this.prev){
      if(!pre.isInterface())
        continue;
      for(const nex of this.next){
        if(!nex.isInterface())
          continue;
        if(nex.bottomTime(Math.max) < pre.topTime(Math.min))
          return false;
      }
    }
    return true;
  }

  mergeNext(nextRegion){
    assert(nextRegion instanceof ReducedNode,
      'Node has invalid type');
    assert(this.isInterface() && nextRegion.isInterface(),
      'Merging should happen between interface regions');
    // list of merged regions (may grow with intermediate regions)
    const merged = [ nextRegion ];
    // note: we assume that region is after this
    for(const nex of this.next){
      if(nex.isNext(nextRegion)){
        // found intermediate region
        merged.push(nex);
      }
    }
    // update current regions set
    for(const redRegion of merged){
      for(const oriRegion of redRegion.regions){
        this.regions.add(oriRegion);
      }
    }
    // update (or recreate) top/bottom sets
    this.top.clear();
    this.bottom.clear();
    for(const r of this.regions){
      for(const n of r.next){
        if(!this.regions.has(n)){
          assert(r.isInterface(), 'Non-interface top region');
          this.top.add(r);
          break;
        }
      }
      for(const p of r.prev){
        if(!this.regions.has(p)){
          assert(r.isInterface(), 'Non-critical bottom region');
          this.bottom.add(r);
          break;
        }
      }
    } // endfor r of this.regions

    // update neighbor relationships
    const mergedSet = new Set(merged);
    const newPrev = new Set(merged.flatMap(r => {
      return Array.from(r.prev);
    }).concat(Array.from(this.prev)).filter(r => {
      return !mergedSet.has(r) && r !== this;
    }));
    const newNext = new Set(merged.flatMap(r => {
      return Array.from(r.next);
    }).concat(Array.from(this.next)).filter(r => {
      return !mergedSet.has(r) && r !== this;
    }));
    for(const [nset, bset, rel] of [
      [newPrev, this.prev, PREV],
      [newNext, this.next, NEXT]
    ]){
      for(const r of bset){
        if(!nset.has(r))
          this.removeNeighbor(r);
      }
      for(const r of nset){
        if(!bset.has(r))
          this.addNeighbor(r, rel, true);
      }
    }

    // remove relations to merged regions
    // since they shouldn't have any reference anymore
    for(const r of merged){
      for(const n of r.neighbors()){
        r.removeNeighbor(n);
      }
    }

    return merged;
  }
}



module.exports = Object.assign(RegionNode, {
  NEXT, PREV, NONE,
  Reduced: ReducedNode
});