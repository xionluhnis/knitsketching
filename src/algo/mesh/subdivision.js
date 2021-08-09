// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const Timer = require('../../timer.js');
const { checkRegionGraph } = require('./checks.js');
const { Isoline } = require('./isoline.js');

function subdivideRegions(mesh, {
  verbose = true, maxRegionDT = 10, uniformRegionSplit = true
}){
  // check mesh validity
  if(!mesh.valid)
    return; // do not even try
  // measure timing
  const t = Timer.create();

  // 1. Compute map from region to splitting times
  const N = mesh.reducedRegions.length;
  const B = 0.5;
  const splitMap = new Map(); // Map<ReducedRegion, number[]>
  for(let i = 0; i < N; ++i){
    const region = mesh.reducedRegions[i];
    if(region.isInterface())
      continue; // no subdivision for critical regions
    // else we must check the time range
    const [minT, maxT] = region.timeRange(true);
    const dt = maxT - minT;
    if(dt <= maxRegionDT)
      continue; // no need to subdivide
    // else, we subdivide the region!

    // collect associated isoline hints
    const hintTimes = []; // XXX get real user hints

    // generate default split times
    const splitNum = Math.floor(dt / maxRegionDT);
    const unifTimes = uniformRegionSplit ? Array.from(
      geom.linspace(minT, maxT, 2 + splitNum)
    ) : [];

    // select splitting times
    const splitTimes = [];
    const times = hintTimes.concat(unifTimes).reverse().filter(t => {
      return Math.abs(minT - t) >= B * maxRegionDT
          && Math.abs(maxT - t) >= B * maxRegionDT; 
    });
    while(times.length){
      const t = times.pop();
      // check that t does not conflict with current split times
      if(splitTimes.every(st => Math.abs(t - st) >= B * maxRegionDT)){
        splitTimes.push(t);
      }
    }

    // store splitting times for later processing
    if(splitTimes.length)
      splitMap.set(region, splitTimes);
  }
  t.measure('map');

  // 2. Find and compute splitting isolines for all split regions
  const isoMap = mesh.getSplittingIsolines(splitMap);
  t.measure('split');

  // 3. Store isolines
  mesh.subRegions = mesh.reducedRegions.map(r => {
    return isoMap.get(r) || [];
  });
  t.measure('map');

  // 4. Validate graph
  mesh.valid = checkRegionGraph(mesh);

  // debug
  if(verbose){
    console.log('Subdivide timings:', t.toString());
    const numSpl = mesh.subRegions.reduce((sum, rs) => {
      return sum + (rs.length ? 1 : 0);
    }, 0);
    const numSub = mesh.subRegions.reduce((sum, rs) => {
      return sum + rs.length;
    }, 0);
    console.log(
      'Subdivision: '
      + numSpl + ' region(s), '
      + numSub + ' isoline(s)'
    );
  }
}

function getSplittingIsolines(mesh, splitMap){
  // create the isoline map
  const isoMap = new Map(); // Map<ReducedRegion, IsolineGroup[]>

  // trivial no-splitting case
  if(splitMap.size === 0)
    return isoMap;

  // generator to traverse border samples and then inner samples
  const sampGen = function*(mesh){
    const layers = mesh.getLayers(mesh.lastLevel);
    // go over all border samples first
    for(const layer of layers)
      yield *layer.borders();
    // /!\ note: this should NOT be needed since isolines should
    // always cross borders (else not a valid time function)
    console.warn('Some split was not found across border samples');
    // then go over all inner samples if needed
    for(const layer of layers)
      yield *layer.innerSamples();
  };
  // splitting procedure for an edge given a matching region 
  const splitEdge = (e, r) => {
    // check if the edge contains a time we're interested in
    const times = splitMap.get(r);
    assert(times.length, 'Empty time list');
    timeLoop:
    for(let i = 0; i < times.length; ++i){
      const t = times[i];
      if(e.hasTime(t)){
        // found initial neighborhood
        // => trace isoline from here!
        const sources = e.getTimeEdges(t);
        const discrete = sources.some(e => e.isValueSample());
        const iso = Isoline.from({
          mesh, sources, discrete, t
        });

        // remember isoline
        if(isoMap.has(r))
          isoMap.get(r).push(iso);
        else
          isoMap.set(r, [iso]);
        
        // remove from search list
        times.splice(i, 1);
        --i;

        // if times empty, remove region entry
        if(!times.length){
          splitMap.delete(r);
          return; // nothing more to do with that edge
        }
      } // endif e includes t
    } // endfor i < #times
  };
  sampleLoop:
  for(const sample of sampGen(mesh)){
    const r = sample.reducedRegion();
    if(splitMap.has(r)){
      // simple case: the sample has a desired region to split
      for(const e of sample.edges()){
        splitEdge(e, r);
        if(!splitMap.size)
          break sampleLoop; // done splitting
      }
    } else if(r.isInterface()){
      // potentially harder interface case to check:
      // the sample may contain an interface region to the region
      // we are looking to split
      // note: we only consider regions that have no sample here
      const isolines = Array.from(r.isolines());
      
      // 1 = we go over the "next" regions
      for(const nr of r.next){
        if(splitMap.has(nr)
        && nr.sampleCount === 0
        && nr.next.size){
          const nnr = nr.getNext();
          const nextIsolines = Array.from(nnr.isolines());
          for(const e of sample.edges()){
            // check that one interface isoline contains it
            // from both sides of the region boundaries
            if(isolines.some(iso => iso.hasEdge(e) || iso.hasSample(e.source))
            && nextIsolines.some(iso => iso.hasEdge(e) || iso.hasSample(e.target))){
              splitEdge(e, nr);
              if(!splitMap.size)
                break sampleLoop; // done splitting
            }
          }
        }
      }
      // 2 = we go over the "prev" regions
      for(const pr of r.prev){
        if(splitMap.has(pr)
        && pr.sampleCount === 0
        && pr.prev.size){
          const ppr = pr.getPrev();
          const prevIsolines = Array.from(ppr.isolines());
          for(const e of sample.edges()){
            // check that one interface isoline contains it
            if(isolines.some(iso => iso.hasEdge(e) || iso.hasSample(e.source))
            && prevIsolines.some(iso => iso.hasEdge(e) || iso.hasSample(e.target))){
              splitEdge(e, pr);
              if(!splitMap.size)
                break sampleLoop; // done splitting
            }
          }
        }
      }// endfor pr of r.prev
    } // endif r is interface
  } // endfor sample
  assert(splitMap.size === 0,
    'Could not create some splitting isolines');

  // order isolines for later processing
  for(const isolines of isoMap.values()){
    isolines.sort((i1, i2) => i1.time - i2.time);
  }
  return isoMap;
}

module.exports = {
  subdivideRegions,
  getSplittingIsolines
};