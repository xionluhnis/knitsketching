// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const Timer = require('../../timer.js');
const { checkRegions, checkRegionGraph } = require('./checks.js');
const { rankRegions } = require('./segmentation.js');

function reduceRegions(mesh, {
  minRegionDT = 0,
  openSingularities = false,
  verbose = true
}){
  const t = Timer.create();
  const reduced = mesh.regions.map(r => r.reduced());
  for(const rr of reduced){
    rr.computeNeighbors(r => {
      assert(0 <= r.index && r.index < reduced.length,
        'Outsider region', r.index);
      return reduced[r.index];
    });
  }
  t.measure('create');

  // 1. Check regions
  const valid = checkRegions(mesh);

  // 2. If valid, do merge-reduction
  if(!valid){
    console.log('Invalid initial region graph. Not reducing.');
  } else {
    // collapse all areas that have a time range below some threshold
    mergeRegions(reduced, minRegionDT, openSingularities);
    t.measure('merge');
  }

  // 3. Compute full reverse mapping
  mesh.reduction = reduced.map(r => {
    while(reduced[r.index] !== r)
      r = reduced[r.index]; // replace with pointed region
    return r;
  });

  // 4. Create reduced region list, except for subdivisions
  mesh.reducedRegions = [];
  for(let i = 0; i < reduced.length; ++i){
    const r = reduced[i];
    if(r.index === i){
      r.index = mesh.reducedRegions.length;
      mesh.reducedRegions.push(r);
    }
  }

  // 5. Compute ranking of new reduced regions
  rankRegions(mesh, true);

  // 6. Validate graph
  mesh.valid = valid && checkRegionGraph(mesh);

  if(valid && verbose){
    const redSimple = mesh.reducedRegions.reduce((sum, r) => {
      return r.isInterface() ? sum : sum + 1;
    }, 0);
    const redTotal = mesh.reducedRegions.length;
    console.log(
      'Reduction: ' + redSimple + ' simple node(s) and '
      + (redTotal - redSimple) + ' critical node(s)'
    );
    for(const rs of [mesh.regions, mesh.reducedRegions]){
      const countRegions = f => rs.reduce((sum, r) => {
        return f(r) ? sum + 1 : sum;
      }, 0);
      const bndNum = countRegions(r => r.isBoundary());
      const intNum = countRegions(r => r.isInternal());
      const srcNum = countRegions(r => r.isSource());
      const snkNum = countRegions(r => r.isSink());
      const ordNum = countRegions(r => r.isWellOrdered());
      console.log(
        'Regions (' + (rs === mesh.regions ? 'ori' : 'red') + '):'
        + ' boundary=' + bndNum
        + ' internal=' + intNum
        + ' sources=' + srcNum
        + ' sinks=' + snkNum
        + ' ordered=' + ordNum
      );
    }
    console.log('Reduction timings:', t.toString());
  }
}

function mergeRegions(
  regions, minRegionDT = 0,
  openSingularities = false
){
  // recursively collapse simple area regions below the min region DT
  let done = false;
  const regionDone = regions.map(r => r.isInterface());
  while(!done){

    // search for valid application of R1 / R2
    let minDT = Infinity;
    let minMerge = null;
    for(let i = 0; i < regions.length; ++i){
      if(regionDone[i])
        continue;
      else
        regionDone[i] = true; // assume done by default

      // region not marked as done yet => check R1 / R2
      const reg = regions[i];
      if(reg.isArea()){
        const dt = reg.timeRange();
        let merge = dt < minRegionDT;
        if(!merge && openSingularities)
          merge = reg.getOriginal().region.hasSingularity();
        if(merge){
          regionDone[i] = false; // not done yet
          if(dt < minDT){
            minDT = dt;
            minMerge = [reg.getPrev(), reg.getNext()];
          } // endif dt < minDT
        } // endif dt < minRegionDT
      } // endif reg.isArea()
    } // endfor i < #reduced

    done = !minMerge;
    if(!done){
      const [pre, nex] = minMerge;
      const merged = pre.mergeNext(nex);
      // replace all merged regions with pre in the global index
      for(const r of merged){
        regions[r.index] = pre;
        regionDone[r.index] = true; // nothing to try again there
      }
      // mark new merged region as not done
      regionDone[pre.index] = false;
    }
  } // endwhile !done
}

module.exports = {
  reduceRegions,
  mergeRegions
};