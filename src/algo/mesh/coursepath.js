// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { NONE, CW, CCW, SKETCH } = require('./constants.js');
const geom = require('../../geom.js');

class CoursePath {
  constructor(isoline, chainIndex, chainDirs, dt = 0, orient = NONE){
    this.isoline    = isoline;
    this.chainIndex = chainIndex;
    this.chainDirs  = chainDirs;
    this.dt = dt;
    // get orientation
    if(!orient){
      orient = this.firstChain.orientation * chainDirs[0];
    }
    this.orient = orient;
    // cache
    this.totalLen = -1;

    assert(this.chainIndex.length === this.chainDirs.length,
      'Index and directions do not match in length');
  }
  get numChains(){ return this.chainIndex.length; }
  get firstChain(){
    const firstIndex = this.chainIndex[0];
    return this.isoline.chains[firstIndex];
  }
  get firstDir(){ return this.chainDirs[0]; }
  get first(){
    if(this.firstDir === 1)
      return this.firstChain.first;
    else /* this.firstDir === -1 */
      return this.firstChain.last;  
  }
  get firstHash(){
    if(this.firstDir === 1)
      return this.firstChain.firstHash;
    else
      return this.firstChain.lastHash;
  }
  get lastChain(){
    const lastIndex = this.chainIndex[this.chainIndex.length - 1];
    return this.isoline.chains[lastIndex];
  }
  get lastDir(){ return this.chainDirs[this.chainDirs.length - 1]; }
  get last(){
    if(this.lastDir === 1)
      return this.lastChain.last;
    else
      return this.lastChain.first;
  }
  get lastHash(){
    if(this.lastDir === 1)
      return this.lastChain.lastHash;
    else
      return this.lastChain.firstHash;
  }
  isCircular(){ return !this.isFlat(); }
  isFlat(){
    // check for obvious flat case
    if(this.firstHash !== this.lastHash)
      return true;

    // else firstHash === lastHash
    if(this.dt !== 0){
      // check for special flat sided cases based on side topology
      const [sample] = this.first.valueSamples();
      if(sample && sample.isBorder() && sample.isOnShapeBoundary()){
        const t = this.isoline.time;
        for(const [nsample] of sample.neighbors()){
          if(nsample.isBorder()
          && Math.sign(nsample.time() - t) === this.dt
          && nsample.isOnShapeBoundary()){
            return true; // treat as flat
          }
        } // endfor nsample of sample.neighbors
      } // endif border sample
    } // endif dt not 0

    // treat as circular by default since firstHash === lastHash
    return false;
  }
  get orientation(){
    const firstOrient = this.firstChain.orientation;
    return firstOrient * this.chainDirs[0];
  }
  isSingular(){
    return this.numChains === 1  && this.firstChain.isSingular();
  }
  isCW(){ return this.orientation === CW; }
  isCCW(){ return this.orientation === CCW; }
  reverse(){
    this.chainIndex.reverse();
    this.chainDirs.reverse();
    for(let i = 0; i < this.numChains; ++i)
      this.chainDirs[i] = -this.chainDirs[i];
    this.orient = -this.orient;
    return this;
  }
  copy(){
    return new CoursePath(
      this.isoline,
      this.chainIndex,
      this.chainDirs,
      this.dt,
      this.orient
    );
  }
  inverse(){
    return this.copy().reverse();
  }
  reorient(newOrient){
    assert([CW, CCW].includes(newOrient), 'Invalid orientation');
    if(this.orient !== newOrient)
      this.reverse();
    return this;
  }
  makeCCW(){ return this.reorient(CCW); }
  makeCW(){ return this.reorient(CW); }
  *chains(withDir = false){
    for(let i = 0; i < this.chainIndex.length; ++i){
      const cidx = this.chainIndex[i];
      const chain = this.isoline.chains[cidx];
      if(withDir)
        yield [chain, this.chainDirs[i]];
      else
        yield chain;
    }
  }
  length(){
    if(this.totalLen < 0.0){
      this.totalLen = 0.0;
      for(const c of this.chains())
        this.totalLen += c.length();
    }
    return this.totalLen;
  }
  *layers(){
    const set = new Set();
    for(const c of this.chains()){
      for(const nh of c.nodes()){
        const layer = nh.layer;
        if(set.has(layer))
          continue;
        // else, remember and yield
        set.add(layer);
        yield layer;
      } // endfor nh of c.nodes()
    } // endfor c of this.chains()
  }
  sample(t, ctx = SKETCH){
    assert(typeof t === 'number', 'Invalid argument', t);
    // we need the total length
    const totalLen = this.length();
    // without length, we have a singular case
    if(!totalLen){
      const chain = this.isoline.chains[this.chainIndex[0]];
      const e = chain.first;
      return [e.layer, e.getPosition(ctx), t];
    }
    // else we must go over the chains
    let currLen = 0.0;
    for(const [chain, dir] of this.chains(true)){
      const delta = chain.length();
      const nextLen = currLen + delta;
      const nextT = nextLen / totalLen;
      // if within chain, then use chain's sampling algorithm
      if(t <= nextT){
        const currT = currLen / totalLen;
        const dt = delta / totalLen;
        // we must transform t into the chain's context
        const alpha = Math.max(0, Math.min(1, (t - currT) / dt));
        const [l, p] = chain.sample(dir, alpha, ctx);
        return [l, p, t]; // append time for reference
      }
      currLen += delta;
    }
    // return last possible sample
    const [l, p] = this.lastChain.sampleLast(this.lastDir, ctx);
    return [l, p, t];
  }

  /**
   * Generate stitches uniformly distributed over the course path
   * in order of course connectivity.
   * 
   * @param {number} N number of stitches to sample
   * @param {LAYER|SKETCH} ctx the position context
   * @yields {[MeshLayer,{x,y},t]} the stitch layer, position and t-param
   */
  *sampleStitches(N, ctx = SKETCH){
    assert(N && Number.isInteger(N),
      'Number of stitch must be a strictly positive integer');

    // circular vs flat cases
    const circular = this.isCircular();
    const steps = circular ? N+1 : N;
    let numSteps = 0;
    for(const t of geom.linspace(0, 1.0, steps, !circular)){
      yield this.sample(t, ctx);
      ++numSteps;
    }
    // check that we yielded sufficiently
    assert(numSteps <= N, 'Yielded too many samples', numSteps, N);
    assert(numSteps >= N, 'Yielded too few samples', numSteps, N);
  }

  static from(isoline, chainIndex, dt = 0){
    if(chainIndex.length <= 1){
      return new CoursePath(isoline, chainIndex, [1], dt);
    }
    // else we need to ensure the chains form a valid path
    const chains = chainIndex.map(idx => isoline.chains[idx]);
    const nhMap  = new Map(); // Map<heID, nh>
    const adjMap = new Map(); // Map<eID, [[IsolineChain, heID]]>
    for(const c of chains){
      for(const nh of [c.first, c.last]){
        const eid = isoline.ehash(nh);
        nhMap.set(eid, nh);
        if(adjMap.has(eid))
          adjMap.get(eid).push(c);
        else
          adjMap.set(eid, [c]);
      }
    }
    // to be valid, we can only have degrees
    // - deg=1 => another deg=1 or deg=3, the rest is even
    // - deg=2 => no restriction
    // - deg=3 => another deg=1, the rest is even
    // - deg=4 => no restriction
    // - deg>4 => invalid!!!
    let odds = [];
    let evens = [];
    let firstEid = null;
    let orient = CCW;
    for(const [eid, adjChains] of adjMap.entries()){
      const deg = adjChains.length;
      if(deg > 4){
        console.warn('Course path with vertex degree', deg);
        return null;
      }
      if(deg % 2){
        odds.push(eid);
        if(odds.length > 2){
          console.warn('Course path with more than 2 odd degrees');
          return null;
        }
      } else {
        evens.push(eid);
      }
      if(!firstEid)
        firstEid = eid;
    }
    if(odds.length === 1){
      console.warn('Course path with single odd degree');
      return null;
    } else if(odds.length === 2){
      // must check that those two are compatible
      // <=> not both deg=3
      const [e1, e2] = odds;
      const [n1, n2] = odds.map(eid => adjMap.get(eid).length);
      if(n1 + n2 === 6){
        console.warn('Course path with two degree 3 nodes');
        return null;
      }
      
      // start at e1 or e2, whichever has degree 1
      if(n1 === 1)
        firstEid = e1;
      else {
        assert(n2 === 1, 'Invalid pair', n1, n2);
        firstEid = e2;
      }

      // update first orientation based on initial chain
      const firstChain = adjMap.get(firstEid)[0];
      orient = firstChain.orientationFrom(firstEid);
      assert(orient, 'Invalid first orientation');
    }

    // create directed graph given selected traversal orientation
    const ptrMap  = new Map(); // Map<eID, Set<IsolineChain>>
    for(const [ptr, options] of adjMap){
      const opts = new Set(options.filter(c => {
        return c.orientationFrom(ptr, orient) === orient;
      }));
      // there has to be "some" option
      // unless it's an endpoint node
      if(!opts.size && options.length > 1){
        console.warn('Course path with invalid single-orientation node');
        return null;

      } else if(opts.size){
        ptrMap.set(ptr, opts);
      }
      // else it's an endpoint node
    }
    const nextPtr = (c, fromHash) => {
      assert(fromHash, 'Missing hash argument');
      return c.firstHash === fromHash ? c.lastHash : c.firstHash;
    };

    // compute oriented traversal path if #odds=2 (or cycle if #odds=0)
    let next = firstEid;
    let remCount = chains.length;
    const order = [];
    const dirs  = [];
    const chainMap = new Map(chains.map((c, i) => [c, i]));
    while(remCount && ptrMap.has(next)){
      const optSet = ptrMap.get(next); // set of next isoline chains
      assert(optSet.size, 'Empty option set');

      // pick option that is not a bridge
      let chain;
      for(const c of optSet){
        if(c.isCircular()){
          // cannot be a bridge since it circles back to the same pointer
          chain = c;
          break;

        } else {
          // must check that it's not a bridge
          const visited = new Set();
          const stack = [ [c, next] ]; // DFS reach stack
          while(stack.length){
            // visit chain
            const [currChain, prevPtr] = stack.pop();
            visited.add(currChain);
            const currPtr = nextPtr(currChain, prevPtr);

            // get options from new pointer
            const ptrs = ptrMap.get(currPtr) || new Set();
            for(const pick of ptrs){
              if(!visited.has(pick))
                stack.push([pick, currPtr]); // to be visited
            }
          }
          // check if we visited all chains
          if(visited.size === remCount){
            chain = c;
          }
          // else it's a bridge!
        }
      }
      if(!chain){
        console.warn('No Eulerian path can be found');
        return null;
      }
      // else we go over that chain
      assert(chainMap.has(chain), 'Invalid chain');
      const chainIdx = chainMap.get(chain);
      order.push(chainIdx);
      const chainDir = chain.orientation * orient;
      dirs.push(chainDir);
      --remCount;

      // remove from options
      optSet.delete(chain);
      if(!optSet.size){
        ptrMap.delete(next);
      }

      // go to next pointer node
      next = nextPtr(chain, next);
    }
    // check that we traversed the entire graph
    assert(ptrMap.size === 0 && remCount === 0,
      'Did not traverse entire chain graph');

    // return course path
    return new CoursePath(
      isoline,
      order.map(i => chainIndex[i]), // pass re-ordered chain index
      dirs,
      dt,
      orient
    );
  }
}

module.exports = CoursePath;