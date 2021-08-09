// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const {
  SKETCH, /* LAYER, */ CW, CCW, NONE
} = require('./constants.js');
const { SampleEdge } = require('./sample.js');

/**
 * Check whether a pair of sample edges represents
 * a link crossing (either across layers or within the same layer).
 * 
 * @param {SampleEdge} src first sample edge
 * @param {SampleEdge} trg second sample edge
 */
function isLinkCrossing(src, trg){
  assert(src !== trg, 'Testing link crossing between self?');
  const srcSamples = src.valueSamples();
  const trgSamples = trg.valueSamples();
  if(srcSamples.length !== trgSamples.length
  || srcSamples.length === 2
  || trgSamples.length === 2){
    // cannot be a crossing
    assert(src.layer === trg.layer, 'Invalid layer crossing');
    return false;

  } else if(srcSamples.length === 1){
    // value-sample to value-sample
    // => a link crossing if both samples are not the same, but match
    return srcSamples[0] !== trgSamples[0]
        && srcSamples[0].matches(trgSamples[0]);

  } else {
    // sample-edge to sample-edge
    // <=> a link crossing if both are twins
    // <=> same edge, but different halfedges
    if(src.edgeId === trg.edgeId
    && src.halfEdgeId !== trg.halfEdgeId)
      return true;
    else {
      assert(src.layer === trg.layer, 'Invalid layer crosing');
      return false;
    }
  }
}

function ehash(e){
  if(e.hasConstantValue())
    return e.edgeId;
  else if(e.hasSourceValue())
    return e.source.vertexId;
  else if(e.hasTargetValue())
    return e.target.vertexId;
  else
    return e.edgeId;
}

class ChainLink {
  constructor(src, trg, srcT, trgT){
    this.src  = src;
    this.trg  = trg;
    this.low  = srcT;
    this.high = trgT;
    this.dt = this.high - this.low;
    assert(this.dt > 0, 'Null or negative link time delta', this.dt);
  }

  includes(t){ return this.low <= t && t <= this.high; }
  get(t, ctx = SKETCH){
    const alpha = (t - this.low) / this.dt;
    return [
      this.src.layer,
      geom.axpby(
        1 - alpha, this.src.getPosition(ctx),
        alpha, this.trg.getPosition(ctx)
      )
    ];
  }
}

class IsolineChain {
  constructor(nhs, orient = NONE){
    this.nhs = nhs;
    // cache
    this.orient    = orient;
    this.firstHash = null; // ehash(nhs[0]);
    this.lastHash  = null; // ehash(nhs[nhs.length - 1]);
    this.totalLen  = -1;   // number
    this.timeLinks = null; // ChainLink[]
  }

  initialize(){
    this.firstHash = ehash(this.nhs[0]);
    this.lastHash  = ehash(this.nhs[this.nhs.length - 1]);
    // normalize the orientation of constant edges
    return this.normalize();
  }

  get first(){ return this.nhs[0]; }
  get last(){ return this.nhs[this.nhs.length - 1]; }
  get nhLength(){ return this.nhs.length; }
  get time(){ return this.nhs[0].value; }
  get orientation(){
    if(!this.orient)
      this.orient = this.getForwardOrientation();
    return this.orient;
  }
  isSingular(){ return this.nhLength === 1; }
  isCW(){ return this.orientation === CW; }
  isCCW(){ return this.orientation === CCW; }
  orientationFrom(nh, defaultOrient = CCW){
    let eid;
    if(nh instanceof SampleEdge)
      eid = ehash(nh);
    else if(typeof nh === 'string')
      eid = nh;
    else {
      assert.error('Unsupported neighborhood argument type');
      return NONE;
    }

    // compare hashes
    if(this.firstHash === this.lastHash){
      assert(eid === this.firstHash,
        'Orientation from a non-endpoint neighborhood');
      // /!\ we can go either way
      // => just use provided default
      return defaultOrient;

    } else if(eid === this.firstHash){
      return this.orientation;

    } else if(eid === this.lastHash){
      return -this.orientation;

    } else {
      assert.error('Argument is neither the first nor last chain edge');
      return NONE;
    }
  }
  getOrientedFirst(dir){
    if(dir === 1)
      return this.first;
    else
      return this.last;
  }
  getOrientedLast(dir){
    return this.getOrientedFirst(-dir);
  }
  getForwardOrientation(){
    // special singular case
    if(this.nhs.length === 1)
      return CCW; // default orientation
    // compute orientation given sequence of edges
    const counts = {
      [CW]:   0,
      [CCW]:  0,
      [NONE]: 0
    };
    for(let i = 1; i < this.nhs.length; ++i){
      const pnh = this.nhs[i-1];
      const cnh = this.nhs[i+0];
      if(isLinkCrossing(pnh, cnh))
        continue; // skip link-traversal pairs
      const ori = pnh.orientationTo(cnh);
      counts[ori]++;
    }
    if(counts[CW] > counts[CCW])
      return CW;
    else if(counts[CCW] > counts[CW])
      return CCW;
    else
      return NONE;
  }
  findHashIndex(eh){
    for(let i = 0; i < this.nhLength; ++i){
      if(ehash(this.nhs[i]) === eh)
        return i;
    }
    return -1;
  }
  isLinkCrossing(src, trg){ return isLinkCrossing(src, trg); }
  isCircular(){ return this.firstHash === this.lastHash; }

  *nodes(dir = 1, includeRepeat = true){
    let N = this.nhs.length;
    if(!includeRepeat
    && N > 1
    && this.first === this.last){
      --N;
    }
    let start, end;
    if(dir === 1){
      start = 0;
      end = N;
    } else {
      assert(dir === -1, 'Invalid direction');
      start = N - 1;
      end = -1;
    }
    for(let i = start; i !== end; i += dir){
      const node = this.nhs[i];
      if(!node.hasConstantValue())
        yield node;
    }
  }
  everyNode(pred){
    for(const node of this.nodes(1, false)){
      if(!pred(node))
        return false;
    }
    return true;
  }
  someNode(pred){
    for(const node of this.nodes(1, false)){
      if(pred(node))
        return true;
    }
    return false;
  }
  *links(dir = 1){
    let prev = null;
    for(const curr of this.nodes(dir)){
      if(prev && !isLinkCrossing(prev, curr))
        yield [prev, curr];
      prev = curr;
    }
  }
  length(){
    if(this.totalLen < 0){
      this.totalLen = 0;
      for(const [src, trg] of this.links()){
        this.totalLen += src.distTo(trg, SKETCH);
      }
    }
    return this.totalLen;
  }

  sampleFirst(dir, ctx = SKETCH){
    const e = dir === 1 ? this.first : this.last;
    return [e.layer, e.getPosition(ctx)];
  }
  sampleLast(dir, ctx = SKETCH){ return this.sampleFirst(-dir, ctx); }
  sample(dir, t, ctx = SKETCH){
    // normalize call direction
    if(dir === -1)
      return this.sample(-dir, 1-t, ctx);
    else if(t <= 0)
      return this.sampleFirst(dir, ctx);
    else if(t >= 1.0)
      return this.sampleLast(dir, ctx);
    // create link times if not cached
    if(!this.timeLinks){
      // create array of time links
      this.timeLinks = [];
      const totalLen = this.length();
      let currLen = 0.0;
      for(const [src, trg] of this.links()){
        const delta = src.distTo(trg);
        const nextLen = currLen + delta;
        this.timeLinks.push(new ChainLink(
          src, trg, currLen / totalLen, nextLen / totalLen
        ));
        currLen = nextLen;
      }
    }
    // else we better be going forward (normalized)
    assert(dir === 1 && typeof t === 'number' && 0 <= t && t <= 1.0,
      'Invalid direction or time parameter', dir, t);
    // use bisection to find link that includes time
    let left = 0, right = this.timeLinks.length - 1;
    while(left <= right){
      const mid = Math.floor((left + right) / 2);
      const midLink = this.timeLinks[mid];
      if(t < midLink.low){
        // set mid-link as right boundary
        right = mid - 1;

      } else if(t > midLink.high){
        // set mid-link as left boundary
        left = mid + 1;

      } else {
        assert(midLink.includes(t), 'Invalid situation');
        return midLink.get(t, ctx);
      }
    }
    assert.error('Binary search failed', t);
    return this.sampleLast(dir, ctx);
  }
  *renderSteps(layer = null){
    if(layer){
      // only yield steps of that layer
      let start = true;
      let lastNh = null;
      for(const nh of this.nhs){
        if(nh.layer !== layer){
          start = true;
        } else {
          if(lastNh && isLinkCrossing(lastNh, nh))
            start = true; // force restart
          yield [layer, nh.getSketchPos(), start];
          start = false;
        }
        lastNh = nh;
      } // endfor nh of nhs

    } else {

      // yield steps of all layers (but in between layers)
      let lastLayer = null;
      let lastNh = null;
      for(const nh of this.nhs){
        if(!lastNh
        || isLinkCrossing(lastNh, nh)){
          yield [nh.layer, nh.getSketchPos(), true]; // start of render
          lastLayer = nh.layer;

        } else {
          // nh.layer === lastLayer
          yield [nh.layer, nh.getSketchPos(), false];
        }
        lastNh = nh;
      } // endfor nh of nhs
    } // endif layer else
  }

  static normalizeDir(nhs){
    for(let i = 0; i < nhs.length; ++i){
      const nh = nhs[i];
      assert(nh instanceof SampleEdge, 'Invalid neighborhood type');
      // if the edge is not constant, no normalization needed
      if(!nh.hasConstantValue())
        continue;
      // constant value edges need to be oriented like the rest
      // of the chain (they are not necessarily by construction)
      let onh;
      let expShared;
      if(i > 0){
        onh = nhs[i-1]; // use previous neighborhood
        expShared = nh.source;
      } else {
        onh = nhs[i+1]; // use next neighborhood
        expShared = nh.target;
        assert.error('First neighborhood should not be constant');
      }
      assert(onh, 'Chain from single constant edge');
      assert(!onh.hasConstantValue(),
        'Chain with consecutive constant edges');

      // find matching sample
      // /!\ find sample modulo linking equivalence
      const shared = nh.getSharedSampleWith(onh);
      assert(shared, 'No shared sample between successive edges');

      // if not the expected shared sample
      // then we must reverse this constant edge
      // /!\ must match, not equal!
      if(!shared.matches(expShared)){
        nhs[i] = nh.reverseEdge();
      }
    } // endfor i < #nhs
    return nhs;
  }

  normalize(){
    IsolineChain.normalizeDir(this.nhs);
    return this;
  }

  *ends(onlyDiff = true){
    yield this.first;
    if(!onlyDiff || this.firstHash !== this.lastHash)
      yield this.last;
  }

  *endSamples(){
    if(this.isSingular())
      yield *this.nhs[0].valueSamples();
    else {
      for(const nh of this.ends()){
        yield *nh.valueSamples();
      }
    }
  }
  *endVertices(){
    for(const s of this.endSamples())
      yield s.getVertex();
  }

  spans(edge){
    const t = this.time;
    const e = edge.at(t);
    if(!e)
      return false; // edge does not include the given time

    // two cases: singular or normal chain
    if(this.isSingular()){
      // singular case
      // => we span the edge if one endpoint of the edge
      //    matches this singular sample
      const samples = this.first.valueSamples();
      assert(samples.length === 1, 'Singular chain is not at a vertex');
      const v = samples[0];
      return edge.includes(v);

    } else {
      // default case
      // => we span the edge if either
      // 1) it has no value sample, and is included in the chain
      // 2) it has one value sample of this chain, AND
      //    the other sample is part of a face spanned by this chain
      
      const samples = e.valueSamples();
      if(samples.length === 2)
        return true; // though it's an odd case!
      if(samples.length === 1){
        // i) check that the value sample is part of this chain
        // by verifying the existence of its hash in the chain
        const v = samples[0];
        const hash = v.vertexId;
        const idx = this.findHashIndex(hash);
        if(idx === -1)
          return false; // the edge is not spanned by this chain

        // ii) if the value sample is not a border sample
        // then we're inside a chain (not at the boundaries)
        // => it must be spanned
        if(!v.isBorder())
          return true;
        
        // iii) check that the other sample is part of
        // a well-defined face sequence up to chain intersection
        // = traverse triangle-fan neighborhood in both directions
        //   until we reach (or pass) the isoline time, and test
        //   for non-trivial face intersection of the chain
        const s0 = edge.samples.find(s => !s.matches(v));
        const t0 = s0.time();
        const dtSign = Math.sign(t - t0);
        for(const back of [false, true]){
          // go over fan in one direction
          let crossEdge;
          let prevSample = s0;
          for(const fe of edge.traverseFan(v, back)){
            const s = fe.target;
            const st = s.time();
            if(geom.approximately(st, t)){
              // = we just reached the isoline
              // use radial edge (though could use side edge too?)
              crossEdge = v.edgeTo(s);
              assert(crossEdge, 'Missing radial fan edge');
              break;

            } else if(Math.sign(t - st) === -dtSign){
              // = we just crossed the isoline
              // use side edge
              crossEdge = prevSample.edgeTo(s);
              assert(crossEdge, 'Missing side fan edge');
              break;
            }
            // else we have yet to cross the isoline
            // => continue marching around the fan
            prevSample = s;
          }
          if(crossEdge){
            // check if it's in the chain
            const xe = crossEdge.at(t);
            assert(xe, 'Crossing edge does not contain time');
            const xhash = ehash(xe);
            assert(xhash !== hash, 'Invalid edge to test');
            if(this.findHashIndex(xhash) !== -1)
              return true; // found intersection!
          } // endif crossEdge
        } // endfor back of [false, true]
        // no face sequence to the chain => edge not spanned
        return false;

      } else {
        // check whether the edge matches one of this chain
        const hash = e.edgeId;
        return this.findHashIndex(hash) !== -1;
      } // endif #samples = 2, 1, 0
    } // endif isSingular else
  }
}
module.exports = IsolineChain;