// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { SKETCH } = require('./constants.js');
const { SampleEdge } = require('./sample.js');
const IsolineChain = require('./isolinechain.js');

class Isoline {
  constructor(mesh, time, discrete = true){
    // main identifying data
    this.mesh = mesh;
    this.time = time;
    this.discrete = discrete;
    // neighborhood graph
    this.nhMap = new Map();   // Map<heID, SampleEdge>
    this.heToE = new Map();   // Map<heID, eID>
    this.adjMap = new Map();  // Map<eID, Map<eID, [heID, heID]>>
    this.sepSet = new Set();  // Set<eID>
    this.endSet = new Set();  // Set<eID>
    // chains
    this.chains = [];         // IsolineChain[]
  }
  get pixelTime(){
    return this.time * this.mesh.lastEta;
  }

  hasEdge(e){ return this.nhMap.has(e.edgeId); }
  hasSample(s){ return this.nhMap.has(s.vertexId); }
  hasHash(str){ return this.nhMap.has(str); }
  hasEHash(e){ return this.hasHash(Isoline.ehash(e)); }
  hasHEHash(e){ return this.hasHash(Isoline.hehash(e)); }
  length(){
    return this.chains.reduce((sum, chain) => {
      return sum + chain.length();
    }, 0);
  }
  isSingular(){
    return this.chains.length === 1
        && this.chains[0].isSingular();
  }

  /**
   * Compute a hash identifying an edge while taking the sampled value location
   * over the edge into consideration:
   * - if the value is either uniform over the edge, or strictly inside it,
   *   then the hash is that of the edge (permutation invariant identifier)
   * - if the value is at the src, then the hash is its src sample identifier
   * - if the value is at the trg, then the hash is the trg sample identifier
   *
   * This allows identification of edge neighborhoods relative to a time
   * value for an isoline group.
   * Edges around a sample that has the value are all considered the same
   * unless some edge has the same value across its sides, in which case
   * the whole edge is to be considered (both sides matter similarly).
   * 
   * @param {SampleEdge} e an sampling edge
   * @return {string} the sampling edge identifier
   */
  static ehash(e){
    if(e.hasConstantValue()){
      return e.edgeId; // same value over full edge
    } else if(e.hasSourceValue()){
      return e.source.vertexId; // value at source
    } else if(e.hasTargetValue()){
      return e.target.vertexId; // value at target
    } else {
      return e.edgeId; // value strictly inside edge
    }
  }
  ehash(e){ return Isoline.ehash(e); }
  static hehash(e){
    if(e.hasConstantValue()){
      return e.halfEdgeId; // same value over full edge
    } else if(e.hasSourceValue()){
      return e.source.sampleId; // value at source
    } else if(e.hasTargetValue()){
      return e.target.sampleId; // value at target
    } else {
      return e.halfEdgeId; // value strictly inside edge
    }
  }
  hehash(e){ return Isoline.hehash(e); }

  loadData(data){
    // load simple data
    for(const key of [
      'time', 'adjMap', 'sepSet', 'endSet'
    ]){
      assert(key in data, 'Missing field ', key);
      this[key] = data[key];
    }
    // getting samples from data
    const getSample = sampData => {
      const layer = this.mesh.layers[sampData.layer];
      if(sampData.dataIndex !== undefined)
        return layer.borderSamples[sampData.dataIndex];
      else
        return layer.getSample(sampData.y, sampData.x);
    };
    // load nhMap
    this.nhMap = new Map(
      data.nhMap.map(([id, src, trg, alpha, value]) => {
        const edge = new SampleEdge(
          getSample(src),
          getSample(trg),
          alpha,
          s => s.time(),
          value
        );
        return [
          id, edge
        ];
      })
    );
    // load chains
    this.chains = data.chains.map(nhIds => {
      return new IsolineChain(nhIds.map(id => this.nhMap.get(id)));
    });
    return this;
  }

  initializeChains(){
    for(const c of this.chains)
      c.initialize();
  }

  static fromData(mesh, data){
    const ig = new Isoline(mesh, data.time);
    ig.loadData(data);
    return ig;
  }

  toData(){
    const data = {};
    // store simple data
    for(const key of [
      'time', 'adjMap', 'sepSet', 'endSet'
    ]){
      data[key] = this[key];
    }
    // getting sample data
    const getSampleData = sample => {
      if(sample.isBorder()){
        return {
          layer: sample.layer.index,
          dataIndex: sample.dataIndex
        };
      } else {
        return {
          layer: sample.layer.index,
          x: sample.x, y: sample.y
        };
      }
    };
    // do not store mesh parent
    // store nh map so we can reconstruct it
    data.nhMap = Array.from(this.nhMap.entries(), ([id, nh]) => {
      return [
        id,
        getSampleData(nh.source),
        getSampleData(nh.target),
        nh.alpha,
        nh.value
      ];
    });
    // store chains by replacing nhs with their ids
    data.chains = this.chains.map(chain => {
      return chain.nhs.map(nh => Isoline.hehash(nh));
    });

    return data;
  }

  link(src, trg, checkConst = true){
    assert(src.samples && trg.samples,
      'Arguments must be neighborhoods');

    // gather neighborhoods
    const es = [src, trg];

    // check for special constant edge cases
    if(checkConst){
      // if any argument is constant
      // then we need a special treatment
      const constNhs = es.filter(e => e.hasConstantValue());
      if(constNhs.length){
        // enforce special topology
        for(const constNh of constNhs){
          this.linkConst(constNh);
        }
        // we do not link the original neighborhoods
        return;
      }
      // else both edges are not constant

      // /!\ if they are in between a constant edge
      //     then, special treatment again!
      const csamples = es.flatMap(e => e.valueSamples());
      assert(csamples.length <= 2,
        'Neither edge should be constant');
      if(csamples.length === 2
      && csamples[0].isNeighbor(csamples[1])){
        const constEdge = new SampleEdge(
          csamples[0], csamples[1], 0, s => s.time(), this.time
        );
        this.linkConst(constEdge);
        // we do not link the original neighborhoods
        return;
      }
    }

    // update adjacency on each side
    const srcEID = Isoline.ehash(src);
    const trgEID = Isoline.ehash(trg);
    const srcHEID = Isoline.hehash(src);
    const trgHEID = Isoline.hehash(trg);
    // check for self-linking
    if(src === trg
    || srcEID === trgEID){
      if(!this.nhMap.has(srcHEID)){
        this.nhMap.set(srcHEID, src);
        this.heToE.set(srcHEID, srcEID);
        if(!this.adjMap.has(srcEID))
          this.adjMap.set(srcEID, new Map()); // no neighbor so far
      }
      if(!this.nhMap.has(trgHEID)){
        this.nhMap.set(trgHEID, trg);
        this.heToE.set(trgHEID, trgEID);
        if(!this.adjMap.has(trgEID))
          this.adjMap.set(trgEID, new Map()); // no neighbor so far
      }
      // self-linking is an artifact of the tracing algorithm
      // that alternates between faces and sample-edges
      // note: we could enforce that it never happens,
      // but it's simpler to just prevent self-linking here
      return;
    }
    const eids = [srcEID, trgEID];
    const heids = [srcHEID, trgHEID];
    for(let i = 0; i < 2; ++i){
      const eid0 = eids[i];
      const eid1 = eids[1-i];
      const heid0 = heids[i];
      const heid1 = heids[1-i];

      // register half-edge
      if(!this.nhMap.has(heid0)){
        this.nhMap.set(heid0, es[i]);  // add to map of heid->nh
        this.heToE.set(heid0, eid0);   // add to map of heid->eid
      }

      // register adjacency information
      // @type Map<eID, [heID, heID]>
      // (e target, [he target, he source])
      let linkMap = this.adjMap.get(eid0);
      if(!linkMap){
        linkMap = new Map();
        this.adjMap.set(eid0, linkMap);
      }
      // add neighbor if not already there
      if(!linkMap.has(eid1)){
        linkMap.set(eid1, [heid1, heid0]);
      }
    } // endfor i < 2
  }

  findNCEdgeAt(sample){
    // check if an edge is already registered for the sample
    // in which case we can use it directly
    const ncEdge = this.nhMap.get(sample.sampleId);
    if(ncEdge)
      return ncEdge;
    // else we need to register one (beware of link crossings)
    for(const e of sample.asNeighborhood().getTimeEdges(this.time)){
      // if non-constant
      // and including the original sample (i.e. not across link)
      // then it's a valid candidate!
      if(!e.hasConstantValue()
      && e.samples.includes(sample)){
        return e; // found one!
      }
    }
    // didn't find any valid candidate!
    console.warn('All samples around have constant time');
    return null;
  }

  linkConst(constEdge){
    assert(constEdge.hasConstantValue(),
      'Invalid non-constant edge argument');

    // link constant edge to some non-constant edge from each side
    // /!\ there should be one, else it's a bad local extremum,
    //     or the topology is insufficient to have coherent chains
    //     that support constant chains alternating between
    //      -singular-constant-singular- structures
    for(const sample of constEdge.samples){
      // find non-constant edge
      const ncEdge = this.findNCEdgeAt(sample);
      if(ncEdge){
        // link constant edge to singular edge
        // /!\ checkConst=false to avoid infinite recursion
        this.link(constEdge, ncEdge, false);
      } // endif ncEdge
    } // endfor sample of constEdge.samples
  }

  addChain(
    nhIds, rawNhs = false,
    subdivide = true,
    discrete = this.discrete
  ){
    const nhs = rawNhs ? nhIds : nhIds.map(id => this.nhMap.get(id));
    // subdivide chain at manifold boundary locations
    if(subdivide){
      // locate neighborhoods on manifold boundary
      const onBoundary = nhs.map(nh => {
        const samples = nh.valueSamples();
        if(samples.length)
          return samples.every(s => s.isOnShapeBoundary());
        else
          return false; // not on boundary
      });
      // split at boundary locations when entering or exiting the boundary
      let currNhs = [ nhs[0] ];
      let lastBoundary = onBoundary[0];
      const subChains = [];
      for(let i = 1; i < nhs.length; ++i){
        if(onBoundary[i] === lastBoundary
        || currNhs.length === 1){
          // continue
          currNhs.push(nhs[i]);

        } else if(onBoundary[i]){
          assert(!nhs[i].hasConstantValue(),
            'Inside-to-boundary change on constant edge');
          // from non-boundary to boundary
          // => add boundary neighborhood, then commit
          currNhs.push(nhs[i]);
          subChains.push(currNhs);
          // create new chain start
          currNhs = [ nhs[i] ];

        } else {
          assert(!nhs[i-1].hasConstantValue(),
            'Boundary-to-inside change after constant edge');
          // from boundary to non-boundary
          // => commit without adding current, then restart from last boundary nh
          subChains.push(currNhs);
          // create new chain start
          currNhs = [ currNhs[currNhs.length - 1], nhs[i] ];
        }
        lastBoundary = onBoundary[i];
      }
      // close last chain
      if(currNhs.length > 1 || subChains.length === 0){
        // note: if this is the only sub-chain (subChains === 0)
        // then we don't need to check for discrete endpoints
        // since we're not changing the location of topological events
        subChains.push(currNhs);
      }

      // filter singular-looking subchains or keep only one if only singular-looking
      // but then explicitly make it be singular (single neighborhood)
      const looksSingular = seq => {
        if(seq.length === 1)
          return true;
        const v0 = seq[0].valueSamples()[0];
        if(!v0)
          return false;
        return seq.every(e => e.isValueSample() && v0.matches(e.valueSamples()[0]));
      };
      const nonSingular = [];
      let firstSingular = null;
      for(const sc of subChains){
        if(!looksSingular(sc))
          nonSingular.push(sc);
        else if(!firstSingular)
          firstSingular = sc;
      }
      if(nonSingular.length){
        // only add non-singular subchains
        for(const sc of nonSingular)
          this.addChain(sc, true, false, discrete && nonSingular.length > 1);

      } else {
        // use the first singular subchain, but make explicitly singular
        const v0 = firstSingular[0].valueSamples()[0];
        assert(v0, 'First singular looking without value sample');
        const e = this.nhMap.get(v0.vertexId);
        assert(e, 'Missing edge from singular chain sample');
        this.addChain([e], true, false, true);
      }

    } else {
      // in case the isoline is "discrete"
      // we check that one side is a value sample
      // note: only one side is required since a flat course
      // from a value sample can end up at an edge on the other side
      if(discrete){
        assert(nhs[0].isValueSample()
            || nhs[nhs.length - 1].isValueSample(),
          'No chain endpoint is a value sample');
      }
      // create final chain
      const chain = new IsolineChain(nhs);
      chain.initialize(); // safe to do here since the mesh is ready
      this.chains.push(chain);
    }
  }

  computeChains(){

    // mark chain ending (and separating) neighborhoods
    for(const [heid, eid] of this.heToE){
      assert(this.adjMap.has(eid), 'Invalid linking');

      const linkMap = this.adjMap.get(eid) || new Map();
      switch(linkMap.size){
        // skip empty neighborhoods (should not exist)
        case 0: {
          // special chain
          this.endSet.add(eid);
          // add singleton chain
          // /!\ but only if at the "vertex"
          const nh = this.nhMap.get(heid);
          const samples = nh.valueSamples();
          if(samples.length === 1){

            const s = samples[0];
            if(s.isVertex())
              this.addChain([nh], true);
            // else it's a copy, so no need to add!

          } else {
            assert.error('Singular chain must have a single sample');
          }
        } break;

        case 1:
          // end neighborhood
          this.endSet.add(eid);
          break;

        case 2:
          // in the middle of a chain
          break;

        default: // > 2
          // = a chain separator
          this.endSet.add(eid);
          this.sepSet.add(eid);
          break;
      }
    } // endfor [heid, eid] of heToE

    // if end set is empty, select one border nh
    if(this.endSet.size === 0){
      let found = false;
      let firstId;
      for(const [heid, nh] of this.nhMap){
        // only consider value samples for starting chains
        if(this.discrete && !nh.isValueSample())
          continue; // not a value sample
        // pick at border if possible
        if(nh.someBorder()){
          found = true;
          const eid = this.heToE.get(heid);
          this.endSet.add(eid);
          break;
        } else if(!firstId) {
          firstId = this.heToE.get(heid);
        }
      }
      if(!found){
        // pick first one
        // note: there should be one, else we're empty!
        if(firstId){
          this.endSet.add(firstId);

        } else {
          assert.error('Empty isoline group, no value sample!');
        }
      }
    } // endif endSet empty

    // compute chains from their ends
    const processed = new Set();
    for(const startId of this.endSet){
      if(processed.has(startId))
        continue;
      else
        processed.add(startId);
      // compute all potential chains from that starting point
      // @type Map<eid, [heid, heid]>
      const startLinkMap = this.adjMap.get(startId);
      const chains = Array.from(startLinkMap.values(), ([trgHEID, srcHEID]) => {
        return [srcHEID, trgHEID];
      });
      while(chains.length){
        const chain = chains.pop();
        const lastHEID = chain[chain.length - 1];
        const lastEID = this.heToE.get(lastHEID);
        const prevHEID = chain[chain.length - 2];
        const prevEID = this.heToE.get(prevHEID);

        // check if last nh is the start, or an end neighborhood
        if(lastEID === startId){
          // cyclic chain => must add processing information
          // within the chain to prevent double-processing
          if(!processed.has(prevEID)){
            processed.add(prevEID);
            const postStartEID = this.heToE.get(chain[1]);
            processed.add(postStartEID); // needed for symmetry
            this.addChain(chain); // start loop => cyclic chain
          }
          // else we reject this chain

        } else if(this.endSet.has(lastEID)){
          // check if not processed already
          if(!processed.has(lastEID)){
            // not processed yet => add chain
            this.addChain(chain);
          }
          // else we reject this chain

        } else {
          // find next nh
          const linkMap = this.adjMap.get(lastEID);
          assert(linkMap.size === 2, 'Irregular NH should be an end');
          // const nextId = nhIds.find(id => id !== prevId);
          let foundNext = false;
          for(const [nextEID, [trgHEID, srcHEID]] of linkMap){
            if(prevEID !== nextEID){
              // check if the source HEID is the same as the last HEID
              // if not, then we need to do an explicit link traversal
              if(srcHEID !== lastHEID){
                chain.push(srcHEID);
                // check that it does still match the EID (valid link)
                const srcEID = this.heToE.get(srcHEID);
                assert(lastEID === srcEID, 'Invalid link traversal');
              }
              // actual move
              chain.push(trgHEID);
              // put chain back for processing = not done!
              chains.push(chain);
              // mark as found and stop iterating
              foundNext = true;
              break;
            }
          }
          assert(foundNext, 'Could not find a next neighborhood');
        }
      } // endwhile chains
    } // endfor startId of endSet
  }

  getVertices(){
    const samples = new Set();
    for(const e of this.nhMap.values()){
      for(const s of e.valueSamples()){
        samples.add(s.getVertex());
      }
    }
    return samples;
  }

  static fromSample(sample, maxIter = 10000, verbose = true){
    const t = sample.time();
    const mesh = sample.layer.parent;
    return Isoline.from({
      mesh, t, maxIter, discrete: true, verbose,
      sources: Array.from(sample.areaNeighborhoods())
    });
  }

  static from({
    mesh, sources, t,
    maxIter = 10000,
    discrete = false,
    verbose = true
  }){
    // check arguments
    assert(mesh && Array.isArray(sources) && sources.length,
      'Some arguments are invalid or missing');
    assert(!isNaN(t), 'Invalid isoline time', t);

    // create isoline group
    const ig = new Isoline(mesh, t, discrete);

    // search continuously (but limitedly)
    const nhSet = new Set();
    const edgeSet = new Set();
    const stack = sources.map(nh => {
      return { nh };
    });
    let iter = 0;
    while(stack.length){
      const { nh, src } = stack.pop();

      // process neighborhood only if not already done
      // as long as we come from a source edge (else we may need to visit twice)
      if(src){
        const id = nh.areaId; // use permutation-invariant id
        if(nhSet.has(id))
          continue;
        else
          nhSet.add(id);
      }

      // process neighborhood
      const edges = nh.getTimeEdges(t);
      for(const e of edges){
        // if coming from another edge, then we can create a link
        // and we may not propagate further if edges are already seen
        // /!\ if no source, then we may need to come back later => do not remember
        if(src){
          // link source to edge
          ig.link(src, e);

          // check if already processed once
          // /!\ this should NOT use ehash(e) since it would prevent
          // a correct neighborhood traversal around samples that hold the value
          if(edgeSet.has(e.halfEdgeId))
            continue; // skip since already processed
          else
            edgeSet.add(e.halfEdgeId); // else remember it
        }
        
        // compute adjacent neighborhood(s) and add to stack
        for(const [nnh, src] of e.getSideRegions(nh)){
          stack.push({ nh: nnh, src });
        }
      }

      // catch special singular cases
      if(!stack.length && ig.nhMap.size === 0){
        assert(edges.length, 'Initial sample had no time edge around');
        if(edges.length)
          ig.link(edges[0], edges[0]);
      }

      if(++iter >= maxIter){
        if(verbose)
          console.warn('Stopped isoline tracing after ' + iter + ' iterations');
        break;
      }
    }

    // compute chains
    ig.computeChains();

    return ig;
  }
}

/**
 * Isoline sampling algorithm
 *
 * /!\ the output list must contain points within the sketch domain (not the layer domain)
 *
 * @param layer a MeshLayer instance within which to start sampling an isoline
 * @param q the query position (should be part of the isoline)
 * @param ctx the context of the query (typically SKETCH)
 * @param {boolean} [verbose] whether to display debug information (false)
 * @param {number} [maxIter] maximum number of iterations (2000)
 * @return a list of quadruplets [layer, { x, y }, start, t] in sketch domain
 */
function sampleIsoline(layer, q, ctx = SKETCH, verbose = false, maxIter = 1000){

  // get query neighborhood
  const snh = layer.query(q, ctx, 1, true);
  if(!snh)
    return [];

  // get base time
  const t = snh.time();
  assert(!isNaN(t), 'Invalid time for isoline sampling', t);

  // isoline creation
  const isoline = [ [snh, true] ]; // [[e, start]]

  // search continuously (but limitedly)
  const nhSet = new Set();
  const edgeSet = new Set();
  const stack = [ { nh: snh, src: snh } ]; // [{nh, src}]
  let iter = 0;
  while(stack.length){
    const { nh, src } = stack.pop();

    // isoline building
    const addSegment = e => {
      const last = isoline[isoline.length - 1][0];
      if(last !== src){
        isoline.push([ src, true ]);
        isoline.push([ e, false ]);
      } else {
        isoline.push([ e, false ]);
      }
    };

    // process neighborhood only if not already done
    const id = nh.nhId;
    if(nhSet.has(id))
      continue;
    else
      nhSet.add(id);

    // process neighborhood
    const edges = nh.getTimeEdges(t);
    for(const e of edges){
      // augment isoline
      addSegment(e);

      // check if already processed once
      if(edgeSet.has(e.edgeId))
        continue; // skip since already processed
      else
        edgeSet.add(e.edgeId); // else remember it
      
      // compute adjacent neighborhood(s) and add to stack
      for(const [nnh, src] of e.getSideRegions(nh)){
        stack.push({ nh: nnh, src });
      }
    }

    if(++iter >= maxIter){
      if(verbose)
        console.warn('Stopped isoline tracing after ' + iter + ' iterations');
      break;
    }
  }

  // [[layer, { x, y }, t]]
  return isoline.map(([e, start]) => {
    return [
      e.layer, e.getSketchPos(), start, verbose ? e.time() : t
    ];
  });
}

module.exports = {
  // methods
  sampleIsoline,
  // class
  Isoline,
  IsolineChain
};
