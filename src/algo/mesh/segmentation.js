// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const Timer = require('../../timer.js');
const { Isoline } = require('./isoline.js');
const Region = require('./region.js');
const { NEXT, PREV } = require('./regionnode.js');

/**
 * Segment the time of a mesh into simple regions
 * 
 * @param {Mesh} mesh mesh whose time to segment
 * @param {object} params the segmentation parameters
 * @param {boolean} params.verbose whether to display debug information
 */
function segmentTime(mesh, {
  verbose = false
} = {}){
  const t = Timer.create();
  const layers = mesh.getLayers(mesh.lastLevel);

  // clear current information
  if(mesh.isolines.length || mesh.regions.length)
    mesh.clearRegions();
  else
    mesh.openTopology(verbose);

  // -------------------------------------------------------------------------
  // 1. Go over all border vertices and collect the important ones -----------
  // - local time extrema
  // - corners
  const seeds = []; // BorderSamples[]
  let numCorners = 0;
  let numExtrema = 0;
  for(const layer of layers){
    for(const vertex of layer.borderVertices()){
      // get time profile (measures oriented time extrema)
      const corner = vertex.isCorner();
      const extrem = vertex.isBorderExtremum();
      if(corner || extrem)
        seeds.push(vertex);
      if(corner)
        ++numCorners;
      if(extrem)
        ++numExtrema;
    } // endfor sample of borders
  } // endfor layer
  
  // open vertex singularities by introducing adjacent seeds
  openSingularities(seeds);

  seeds.sort((s1, s2) => s1.time() - s2.time()); // sort by time
  if(verbose)
    console.log(seeds.map(s => s.sampleId));
  t.measure('find');

  // -------------------------------------------------------------------------
  // 2. For each seed vertex, compute its isoline group ----------------------
  // while filtering out vertices that would be in the same isoline
  const isolines = [];            // Isoline[isoID]
  const isoVertices = new Set();  // Set<BorderSample>
  const verToIso = new Map();     // Map<BorderSample, isoID>
  const isoToVer = [];            // Set<BorderSample>[isoID]
  for(const vertex of seeds){
    if(isoVertices.has(vertex))
      continue; // skip, as already part of an isoline
    // compute new isoline from sample
    const isoline = Isoline.fromSample(vertex);

    // compute critical vertices on that isoline
    const vertices = isoline.getVertices();
    if(vertices.size){
      const isoID = isolines.length;
      isolines.push(isoline);
      isoToVer.push(vertices);

      // associate samples with this critical isoline region
      for(const v of vertices){
        if(v.isBorder()){
          assert(!isoVertices.has(v), 'Vertex was already covered');
          isoVertices.add(v);
          verToIso.set(v, isoID);
        }
      }
    } else {
      assert.error('No critical vertex on isoline');
    }
  }
  t.measure('trace');

  // -------------------------------------------------------------------------
  // 3. Compute dependency paths between isolines ----------------------------
  const bmarcher = new BorderMarcher(mesh, isolines, verToIso);
  bmarcher.marchFromVertices();
  bmarcher.checkIsolines();
  bmarcher.checkVertices();
  t.measure('bmarch');

  // -------------------------------------------------------------------------
  // 4. Compute isoline chain regions ----------------------------------------
  // by merging region information along isoline dependencies
  // as well as across adjacent isoline chains
  const rmerger = new RegionMerger(bmarcher);
  rmerger.mergeAll();
  rmerger.checkRegions();
  const prevRegions = rmerger.getRegions(-1);
  const nextRegions = rmerger.getRegions(+1);
  t.measure('imerge');

  // -------------------------------------------------------------------------
  // 5. Filter out non-critical isolines -------------------------------------
  // = all isolines that have #prev=#next=1 and same local circularity
  const keep = new Array(isolines.length);      // boolean[isoID]
  const isoToReg = new Array(isolines.length);  // MeshRegion[isoID]
  const newIsoIdx = new Array(isolines.length); // number[isoID]
  for(let isoIdx = 0; isoIdx < isolines.length; ++isoIdx){
    const currIsoline = isolines[isoIdx];
    const prevRegs = prevRegions[isoIdx];
    const nextRegs = nextRegions[isoIdx];
    // check if non-critical
    // 1) #prev=#next=1
    // 2) topo(prev)=topo(curr)=topo(next) (where topo=flat|circular)
    if(prevRegs.size === 1 && nextRegs.size === 1){
      // this may be a non-critical isoline
      // => check for topological change (none = non-critical)
      const [prevReg] = prevRegs;
      const [nextReg] = nextRegs;
      // check that the implied prev/next course topologies match
      // if they do not, then consider as critical
      const prevCrsPath = prevReg.getCoursePath(currIsoline);
      const nextCrsPath = nextReg.getCoursePath(currIsoline);
      // special case for singularity opening
      let keepForSingularity = false;
      const prevIso = prevReg.otherIsoline(currIsoline);
      if(prevIso && prevIso.isSingular())
        keepForSingularity = true;
      const nextIso = nextReg.otherIsoline(currIsoline);
      if(nextIso && nextIso.isSingular())
        keepForSingularity = true;
      if(prevCrsPath && nextCrsPath 
      && prevCrsPath.isCircular() === nextCrsPath.isCircular()
      && !keepForSingularity
      ){
        // => do not keep, and transfer dependencies
        keep[isoIdx] = false;
        newIsoIdx[isoIdx] = -1;

        // merge the two regions while removing the internal isoline
        const newReg = prevReg.merge(nextReg);
        assert(newReg.isRoot(), 'Merged region is not a root region');
        prevRegions[isoIdx] = new Set([newReg]);
        nextRegions[isoIdx] = new Set([newReg]);

        // do not process as critical
        continue;
      }
      // else the course topology changes => consider as critical!
    } // endif #prev=#next=1

    // otherwise, we keep the isoline as critical
    keep[isoIdx] = true;
    newIsoIdx[isoIdx] = mesh.isolines.length; // updated index

    // create isoline region and assign to associated vertices
    mesh.isolines.push(currIsoline);
    const isoReg = mesh.newRegion({ isoline: currIsoline });
    isoToReg[isoIdx] = isoReg;
    for(const v of isoToVer[isoIdx]){
      v.setRegion(isoReg);
    }
  } // endfor 0 <= isoIdx < #isolines
  t.measure('filt');

  // -------------------------------------------------------------------------
  // 6. Create basic bipartite region graph ----------------------------------
  const regToReg = new Map(); // Map<Region, MeshRegion>
  for(let isoIdx = 0; isoIdx < isolines.length; ++isoIdx){
    if(!keep[isoIdx])
      continue; // skip non-critical isoline
    const isoReg = isoToReg[isoIdx];
    for(const nextReg of nextRegions[isoIdx]){
      assert(nextReg.isRoot(), 'Non-root region');
      assert(nextReg.srcIdx === isoIdx, 'Invalid region order');
      const nextIsoReg = isoToReg[nextReg.trgIdx];
      // create corresponding simple region
      const reg = mesh.newRegion({
        [PREV]: [isoReg], [NEXT]: [nextIsoReg],
        region: nextReg // region data
      });
      isoReg.addNeighbor(reg, NEXT);
      nextIsoReg.addNeighbor(reg, PREV);
      // register mapping
      regToReg.set(nextReg, reg);
      // update region indices to match the final mesh isoline list
      nextReg.srcIdx = newIsoIdx[nextReg.srcIdx];
      nextReg.trgIdx = newIsoIdx[nextReg.trgIdx];
      assert(mesh.isolines[nextReg.srcIdx] === nextReg.srcIso,
        'New srcIdx does not match mesh isolines');
      assert(mesh.isolines[nextReg.trgIdx] === nextReg.trgIso,
        'New trgIdx does not match mesh isolines');
    }
  }
  t.measure('regions');

  // -------------------------------------------------------------------------
  // 7. Set vertex regions by flood-filling over edges -----------------------
  const stack = [];

  // i) filling from border vertices along isoline dependency paths
  pathLoop:
  for(const [vertex, path] of bmarcher.verToPath){
    // compute region associated with path
    // /!\ some paths may be out of date!
    const isoIdx = path.srcIdx;
    if(keep[isoIdx]){
      // the path source is still valid 
      const iso = path.srcIso;
      for(const [chainIdx, chain] of iso.chains.entries()){
        if(path.chainIndex.has(chain)){
          for(const reg of nextRegions[isoIdx]){
            if(!reg.srcChains.has(chainIdx))
              continue;
            const region = regToReg.get(reg.root());
            if(region){
              stack.push({ vertex, region });
              continue pathLoop;

            } else {
              assert.error('Missing region');
            }
          } // endfor reg of nextRegions[isoIdx]
        } // endif path related to chain
      } // endfor 0 <= chainIdx < #chains
    } else {
      // the path is not valid anymore
      // => resolve its region directly (there is only one!)
      assert(nextRegions[isoIdx].size === 1, 'Invalid region count');
      const [reg] = nextRegions[isoIdx];
      const region = regToReg.get(reg.root());
      if(region){
        stack.push({ vertex, region });
        continue pathLoop;
        
      } else {
        assert.error('Missing region');
      }
    }
    assert.error('No resolved region for vertex along a path');
  } // endfor [vertex, path]
  while(stack.length){
    const { vertex, region } = stack.pop();
    if(vertex.region())
      continue; // already processed
    else
      vertex.setRegion(region); // set region (i.e. processed)
    // go over adjacent edges
    for(const edge of vertex.edges()){
      const crossings = getIsolineCrossings(mesh.isolines, edge);
      // if no isoline crossing across edge, then propagate region
      if(crossings.length === 0)
        stack.push({ vertex: edge.target.getVertex(), region });
    }
  }

  // ii) try resolving missing regions from samples
  for(const vertex of mesh.vertices()){
    if(vertex.region())
      continue; // skip vertices that have a region already
    // else vertex has no region
    // => we must figure it out by local search of prev/next
    stack.push({ vertex, region: null });
  }
  while(stack.length){
    let { vertex, region } = stack.pop();
    if(vertex.region()){
      assert(!region || vertex.region() === region,
        'Invalid region assignment');
      continue; // already set, no need to go further
    }
    // list of edge to propagate through
    const t = vertex.time();
    let edges = [];
    if(region){
      // we have a region => set it
      vertex.setRegion(region);

      // propagate in all directions without isoline crossing
      edges = Array.from(vertex.edges()).filter(e => {
        return getIsolineCrossings(mesh.isolines, e).length === 0;
      });
      
    } else {
      // try updating the boundaries of this region
      // by looking at the neighboring edges
      for(const edge of vertex.edges()){
        const crossings = getIsolineCrossings(mesh.isolines, edge);
        if(crossings.length){
          // note: vertex has no region
          // => isoline crossing at edge or other vertex
          const iso = mesh.isolines[crossings[0]];
          const chainIdx = iso.chains.findIndex(chain => {
            return chain.spans(edge);
          });
          if(chainIdx === -1){
            assert.error('Could not find chain for isoline crossing');
            continue;
          }
          // find associated region
          const isoIdx = bmarcher.isoIndexOf(iso);
          assert(isoIdx !== -1, 'Missing isoline');
          const regDeps = iso.time < t ? nextRegions : prevRegions;
          for(const reg of regDeps[isoIdx]){
            const chainDeps = iso.time < t ? reg.srcChains : reg.trgChains;
            if(chainDeps.has(chainIdx)){
              const r = regToReg.get(reg.root());
              if(region)
                assert(region === r, 'Inferring different regions');
              else
                region = r;
              break;
            } // endif chainDeps has chainIdx
          } // endfor reg of regDeps[isoIdx]
          // do not propgate through that edge

        } else {
          edges.push(edge); // worth propagating through
        }
      } // endfor edge of vertex.edges()

      if(region)
        vertex.setRegion(region);
      else
        continue; // nothing worth propagating
    }
    
    // propagate region to edges
    for(const edge of edges)
      stack.push({ vertex: edge.target.getVertex(), region });
  } // endwhile #stack > 0
  rankRegions(mesh);
  t.measure('spread');

  // -------------------------------------------------------------------------
  // 8. Upscale region information -------------------------------------------
  upscaleRegions(mesh);
  t.measure('up');

  // debug
  if(verbose){
    const numAddRegions = mesh.regions.length - mesh.isolines.length;
    console.log(
      'Segmentation: ' + seeds.length + ' local seeds ('
      + numCorners + ' cor, ' + numExtrema + ' ext), '
      + mesh.isolines.length + ' critical isolines and '
      + numAddRegions + ' simple region(s)'
    );
    console.log('Segmentation timings:', t.toString());
  }
}

function openSingularities(seeds){
  const seedSet = new Set(seeds);
  // add necessary seeds around singularities
  seedLoop:
  for(let i = 0, n = seeds.length; i < n; ++i){
    const v = seeds[i];
    const t = v.time();
    let dtSign = 0;
    let minADT = Infinity;
    let nearSamp = null;
    for(const [s] of v.neighbors()){
      if(!s.isBorder())
        continue; // skip internal samples
      const dt = s.time() - t;
      if(!dt)
        continue seedLoop;
      if(!dtSign
      || Math.sign(dt) === dtSign){
        // first sample
        dtSign = Math.sign(dt);
        const absDT = Math.abs(dt);
        if(absDT < minADT){
          minADT = absDT;
          nearSamp = s;
        }

      } else {
        continue seedLoop; // not a local extremum
      }
    }
    assert(dtSign, 'No border neighbor?');
    // all border neighbors have the same non-zero sign
    // => we're a time extremum on the sketch borders
    const nv = nearSamp.getVertex();
    if(seedSet.has(nv))
      continue; // nothing to do, already there
    else {
      // note: loop uses fixed start-end indices so it's fine
      // to modify the seeds array online!
      seeds.push(nv);
      seedSet.add(nv);
    }
  } // endfor v of seeds
}

/**
 * Computes the list of isolines crossing a given sample edge.
 * The resulting list crosses the edge in order from source to target samples.
 * 
 * @param {Isoline[]} meshIsolines list of isolines ordered by time
 * @param {SampleEdge} edge an edge to check for isoline crossings
 * @return {number[]} a list of isolines (indices) that cross the edge
 */
function getIsolineCrossings(meshIsolines, edge){
  assert('edgeId' in edge && 'source' in edge && 'target' in edge,
    'Invalid edge argument');
  const { source, target } = edge;
  // order time of edge
  let minT = source.time();
  let maxT = target.time();
  const reverseTime = minT > maxT;
  if(reverseTime)
    [minT, maxT] = [maxT, minT];
  // go over isolines
  const crossings = [];
  for(let i = 0; i < meshIsolines.length; ++i){
    const ig = meshIsolines[i];
    if(ig.time < minT)
      continue; // too early => go to next one
    if(ig.time > maxT)
      break; // beyond target => stop searching
    // else we're within time range
    // ig.hasEdge(e)
    if(ig.hasEdge(edge)
    || ig.hasSample(source)
    || ig.hasSample(target))
      crossings.push(i);
    // else not a matching isoline
  }
  // align list order with edge time direction
  if(reverseTime)
    crossings.reverse();
  // return ordered list
  return crossings;
}

/**
 * Upscale the region information from the last level to the coarser levels
 * 
 * @param {Mesh} mesh the mesh
 */
function upscaleRegions(mesh){
  for(let lvl = mesh.lastLevel - 1; lvl >= 0; --lvl){
    const upperLayers = mesh.getLayers(lvl + 1);
    const lowerLayers = mesh.getLayers(lvl);
    for(const layer of lowerLayers){
      for(const sample of layer.samples()){
        const q = sample.getSketchPos();
        const snh = upperLayers[layer.index].sketchQuery(q, 1, true);
        const r = snh.baseSample.region();
        if(r)
          sample.setRegion(r);
      } // endfor sample
    } // endfor layer
  } // endfor lastLevel > lvl >= 0
}

/**
 * Rank the regions of a mesh by computing the associated samples
 * and ranking from largest to smallest.
 * 
 * Critical and simple regions get their own separate rankings, whether reduced or not.
 * 
 * @param {Mesh} mesh the mesh
 * @param {boolean} [reduced] whether to rank the reduced regions (false by default)
 */
function rankRegions(mesh, reduced = false){
  for(const layer of mesh.getLayers(mesh.lastLevel)){
    for(const sample of layer.samples()){
      const r = reduced ? sample.reducedRegion() : sample.region();
      if(r){
        r.sampleCount += 1;
      } else {
        // all samples should have a region by now
        console.warn('Sample ', sample.sampleId, ' without region');
        // note: not all regions have a sample though!
      }
    }
  }
  // compute ranking from largest sample count to lowest
  const regionList = reduced ? mesh.reducedRegions : mesh.regions;
  const ranking = regionList.slice().sort((r1, r2) => {
    return r2.sampleCount - r1.sampleCount;
  });
  for(let i = 0, irank = 0, nrank = 0; i < ranking.length; ++i){
    const region = ranking[i];
    if(region.isInterface()){
      region.rank = irank++; // interface rank
    } else {
      region.rank = nrank++; // normal rank
    }
  }
}

class IsolineIsolinePath {
  constructor(srcIdx, srcIso, srcEdge, dt = srcEdge.dt()){
    // input = path start
    this.srcIdx   = srcIdx;
    this.srcIso   = srcIso;
    this.srcEdge  = srcEdge;
    this.timeDir  = Math.sign(dt);
    assert(this.timeDir,
      'Isoline isoline paths must have some non-zero direction');
    // output = path end
    this.trgIdx   = -1;
    this.trgIso   = null;
    this.trgEdge  = null;
    // state
    this.lastEdge = srcEdge;
    // chain spanning cache
    this.chainIndex = null;
  }

  finish(trgIdx, trgIso, trgEdge){
    assert(trgIdx !== this.srcIdx && trgIso !== this.srcIso,
      'Path from isoline to itself');
    assert(!this.isComplete(),
      'Cannot end already complete path');
    this.trgIdx   = trgIdx;
    this.trgIso   = trgIso;
    this.trgEdge  = trgEdge;
    assert(Math.sign(trgEdge.dt()) === this.timeDir,
      'Ending edge has invalid direction');
    return this;
  }

  isComplete(){ return !!this.trgIso; }

  reversePath(){
    assert(this.isComplete(),
      'Cannot reverse an incomplete path');
    return new IsolineIsolinePath(
      this.trgIdx, this.trgIso, this.trgEdge.reverseEdge(), -this.timeDir
    ).finish(
      this.srcIdx, this.srcIso, this.srcEdge.reverseEdge()
    );
  }

  static from(srcIdx, srcIso, srcEdge, trgIdx, trgIso, trgEdge){
    return new IsolineIsolinePath(
      srcIdx, srcIso, srcEdge
    ).finish(
      trgIdx, trgIso, trgEdge
    );
  }

  computeSpan(){
    if(this.chainIndex)
      return this.chainIndex;
    assert(this.isComplete(),
      'Span can only be computed when complete');
    // create chain cache
    this.chainIndex = new Map();
    for(const [isoIdx, iso, edge] of [
      [this.srcIdx, this.srcIso, this.srcEdge],
      [this.trgIdx, this.trgIso, this.trgEdge]
    ]){
      for(const [chainIdx, chain] of iso.chains.entries()){
        if(chain.spans(edge))
          this.chainIndex.set(chain, [isoIdx, chainIdx, edge]);
        // else we don't span it
      }
    }
    return this.chainIndex;
  }

  spans(isoChain){
    return this.computeSpan().has(isoChain);
  }
}

class BorderMarcher {
  constructor(mesh, isolines, verToIso){
    // inputs
    this.mesh = mesh;         // Mesh
    this.isolines = isolines; // Isoline[isoIdx]
    this.verToIso = verToIso; // Map<GridSample, isoIdx>
    // internal
    this.isoIndex = new Map(isolines.map((iso, idx) => [iso, idx]));
    // states
    this.isoNextPaths = isolines.map(() => new Map()); // Map<eID, Path>[isoIdx]
    this.isoPrevPaths = isolines.map(() => new Map()); // Map<eID, Path>
    this.verToPath    = new Map(); // Map<BorderSample, IIPath>
    this.pendingPaths = [];
  }

  marchFromVertices(){
    for(const [v, isoIdx] of this.verToIso)
      this.marchFrom(isoIdx, v);
  }

  isoIndexOf(iso){
    if(this.isoIndex.has(iso))
      return this.isoIndex.get(iso);
    else
      return -1;
  }

  isoPaths(iso, dt){
    const isoIdx = iso instanceof Isoline ? this.isoIndexOf(iso) : iso;
    assert(typeof isoIdx === 'number',
      'Invalid isoline argument');
    assert(typeof dt === 'number' && dt !== 0,
      'Invalid dt argument');
    const isoPaths = dt > 0 ? this.isoNextPaths : this.isoPrevPaths;
    return isoPaths[isoIdx];
  }

  marchFrom(isoIdx, vertex){
    assert(this.isolines[isoIdx].hasSample(vertex),
      'Marching from a vertex that is not within the corresponding isoline');
    for(const n of this.borderNeighborsOf(vertex)){
      this.startPathFrom(isoIdx, vertex.edgeTo(n));
    }
    this.march();
  }

  *borderNeighborsOf(vertex){
    const set = new Set();
    for(const s of vertex.family()){
      for(const n of s.segmentNeighbors())
        set.add(n.getVertex());
    }
    yield *set;
  }

  startPathFrom(isoIdx, edge, addPending = true){
    const dt = edge.dt();
    // check for within-isoline moves
    if(geom.approximately(dt, 0)){
      // move within isoline
      const target = edge.target.getVertex();
      assert(this.verToIso.has(target),
        'Missing target of same isoline');
      const trgIdx = this.verToIso.get(target);
      assert(trgIdx === isoIdx,
        'Invalid isoline assignment');
      // do not create an interior path
      return null;
    }

    // only consider positive paths
    // /!\ we get the negative ones from finishing the positive ones
    if(dt < 0)
      return;

    // check if a corresponding path exists already
    const isoPaths = this.isoPaths(isoIdx, dt);
    if(isoPaths.has(edge.edgeId))
      return null;

    // create new path
    const newPath = new IsolineIsolinePath(isoIdx, this.isolines[isoIdx], edge, dt);
    isoPaths.set(edge.edgeId, newPath);

    // add to pending
    if(addPending)
      this.pendingPaths.push(newPath);
    
    // return actual path
    return newPath;
  }

  endPathAt(path, isoIdx){
    path.finish(isoIdx, this.isolines[isoIdx], path.lastEdge);
    assert(path.isComplete(), 'Finished, but incomplete');
    // store reverse path
    const revPath = path.reversePath();
    assert(revPath.isComplete(),
      'Reverse of complete path must be complete');
    const reid = revPath.srcEdge.edgeId;
    const revIsoPaths = this.isoPaths(isoIdx, -path.timeDir);
    assert(!revIsoPaths.has(reid), 'A reverse path already exists');
    revIsoPaths.set(reid, revPath);
  }

  addShortPath(srcIdx, trgIdx, edge){
    // get reverse edge
    const revEdge = edge.reverseEdge();
    // check that path does not exist yet
    const eid = edge.edgeId;
    const reid = revEdge.edgeId;
    const dt = edge.dt();
    const srcIsoPaths = this.isoPaths(srcIdx, dt);
    const trgIsoPaths = this.isoPaths(trgIdx, -dt);
    // check for existence
    if(srcIsoPaths.has(eid)){
      // check that the other side is also there
      assert(trgIsoPaths.has(reid), 'Single-sided path');

    } else {
      assert(!trgIsoPaths.has(reid), 'Reverse single-sided path');
      // create this side's path
      const newPath = IsolineIsolinePath.from(
        srcIdx, this.isolines[srcIdx], edge,
        trgIdx, this.isolines[trgIdx], edge
      );
      assert(newPath.isComplete(), 'Short path is incomplete');
      srcIsoPaths.set(eid, newPath);
      // create the reverse side's path
      const revPath = newPath.reversePath();
      trgIsoPaths.set(reid, revPath);
    }
  }

  march(){
    while(this.pendingPaths.length){
      const path = this.pendingPaths.pop();
      assert(!path.isComplete(), 'Complete path is pending');
      const edge = path.lastEdge;
      // get crossings (except for starting isoline)
      const crossings = getIsolineCrossings(this.isolines, edge).filter(i => {
        return i !== path.srcIdx;
      });
      let lastPath;
      if(crossings.length){
        // we reached some isoline
        // 1) finish this path
        this.endPathAt(path, crossings[0]);

        // 2) create intermediate paths
        for(let i = 0, j = 1; j < crossings.length; ++i, ++j){
          this.addShortPath(crossings[i], crossings[j], edge);
        }
        // 3) start path from last isoline, unless it's at the target vertex
        const lastIsoIdx = crossings[crossings.length - 1];
        const lastIso = this.isolines[lastIsoIdx];
        if(lastIso.hasSample(edge.target))
          continue; // we stop here since the last isoline is at a vertex
        
          // else the vertex has no isoline => create intermediate path
        assert(!this.verToIso.has(edge.target.getVertex()),
          'Vertex on isoline without isoline crossing');
        lastPath = this.startPathFrom(lastIsoIdx, edge, false);

      } else {
        // set last path as current one
        lastPath = path;
      }

      assert(lastPath, 'No last path');
      // we can continue
      const v = edge.target.getVertex();
      if(!this.verToPath.has(v))
        this.verToPath.set(v, lastPath);
      else {
        // merge paths
        const currPath = this.verToPath.get(v);
        assert(lastPath === currPath, 'Two different paths to a vertex');
        continue; // do not try again
      }

      // update path's last edge
      const tt = edge.target.time();
      let nextEdge;
      for(const next of this.borderNeighborsOf(edge.target)){
        const nt = next.time();
        if(Math.sign(nt - tt) === lastPath.timeDir){
          nextEdge = edge.target.edgeTo(next);
          break;
        }
      }
      assert(nextEdge, 'No next edge to march to');
      lastPath.lastEdge = nextEdge;
      // add our path back to the pending paths (if any next target)
      if(nextEdge)
        this.pendingPaths.push(lastPath);
    } // endwhile #pendingPaths
  }

  checkIsolines(){
    // check that each isoline has some dependency
    // and that those dependencies are topologically meaningful
    for(let isoIdx = 0; isoIdx < this.isolines.length; ++isoIdx){
      const nextPaths = this.isoNextPaths[isoIdx];
      const prevPaths = this.isoPrevPaths[isoIdx];
      // each isoline needs at least one dependency path
      assert(nextPaths.size || prevPaths.size,
        'Isoline without dependency path');
      // each path must be complete by now
      for(const path of nextPaths.values())
        assert(path.isComplete(), 'Incomplete next path');
      for(const path of prevPaths.values())
        assert(path.isComplete(), 'Incomplete previous path');
      // each path must have a reverse path
      for(const path of nextPaths.values()){
        assert(path.srcIdx === isoIdx, 'Invalid path entry');
        const nextPrevPaths = this.isoPrevPaths[path.trgIdx];
        if(!path.trgEdge || !nextPrevPaths)
          continue;
        const redge = path.trgEdge.reverseEdge();
        const reid = redge.edgeId;
        const revPath = nextPrevPaths.get(reid);
        assert(revPath, 'No reverse path of complete path');
        if(revPath){
          assert(revPath.trgIdx === isoIdx, 'Reverse path does not match');
        }
      } // endfor path of nextPaths.values()
    } // endfor 0 <= isoIdx < #isolines
  }

  checkVertices(){
    // check that each border vertex is either on an isoline
    // or on some isoline dependency path
    for(const vertex of this.mesh.borderVertices()){
      // two options:
      // 1 = on an isoline
      // 2 = on some isoline dependency path
      if(!this.verToIso.has(vertex)){
        // check that there is an isoline dependency path
        assert(this.verToPath.has(vertex),
          'Border vertex has no isoline dependency path');
      } else {
        // check that there is no dependency path
        assert(!this.verToPath.has(vertex),
          'Isoline vertex has an isoline dependency path');
      }
    } // endfor vertex of mesh.borderVertices
  }
}

class RegionMerger {
  constructor(bm){
    // inputs
    this.bm = bm;
    assert(bm instanceof BorderMarcher,
      'Invalid argument: must be a BorderMarcher');
    // internal
    this.nextSep = new Set(); // Set<BorderSample>
    this.prevSep = new Set(); // Set<BorderSampel>
    // outputs
    this.chainPrev = this.allocateRegions(-1); // Region[isoIdx][cIdx]
    this.chainNext = this.allocateRegions(+1); // Region[isoIdx][cIdx]
  }
  get isolines(){ return this.bm.isolines; }
  allocateRegions(dt){
    return this.isolines.map((iso, isoIdx) => {
      return iso.chains.map((_, chainIdx) => {
        return this.createRegion(isoIdx, chainIdx, dt);
      });
    });
  }

  getChainSide(sign){
    assert([-1, +1].includes(sign), 'Invalid sign argument');
    return sign > 0 ? this.chainNext : this.chainPrev;
  }

  isSeparator(s, dt){
    assert(typeof dt === 'number' && dt, 'Invalid dt argument');
    return (dt > 0 ? this.nextSep : this.prevSep).has(s.getVertex());
  }

  setSeparator(s, dt){
    assert(typeof dt === 'number' && dt, 'Invalid dt argument');
    return (dt > 0 ? this.nextSep : this.prevSep).add(s.getVertex());
  }

  createRegion(isoIdx, chainIdx, sign){
    assert([-1, +1].includes(sign),
      'Invalid dt argument');
    assert(typeof isoIdx === 'number' && typeof chainIdx === 'number',
      'Invalid argument type(s)');
    // check that there is a need for a region!
    const iso = this.isolines[isoIdx];
    assert(0 <= chainIdx && chainIdx < iso.chains.length,
      'Chain index out-of-bounds');
    const chain = iso.chains[chainIdx];
    const timeSign = t => {
      if(geom.approximately(t, iso.time))
        return 0;
      else
        return Math.sign(t - iso.time);
    };
    let hasSome = 0;
    let hasNone = 0;
    for(const e of chain.nhs){
      const vs = e.valueSamples();
      let valid = false;
      let count = 0;
      if(vs.length === 2){
        // constant value => check for face on correct side
        valid = e.getSideRegions().some(([face]) => {
          return face.samples.some(s => timeSign(s.time()) === sign);
        });
        count = 3;

      } else if(vs.length === 1){
        // sample value => check for neighbor
        valid = Array.from(vs[0].neighbors(), ([n]) => {
          return n.time();
        }).some(t => timeSign(t) === sign);
        count = 1; // side samples can be across regions => uncertain

      } else {
        // edge value => check edge samples
        valid = e.samples.some(s => timeSign(s.time()) === sign);
        count = 3;
      }
      if(valid)
        hasSome += count;
      else
        hasNone += count;
    }
    assert(hasSome || hasNone, 'Isoline without data');
    if(hasSome === hasNone)
      console.warn('Region is split between void and existence');
    else if(hasSome && hasNone && hasSome > 2)
      console.warn('Odd region');
    if(hasNone > hasSome)
      return null; // consider as no region necessary

    // allocate corresponding region
    if(sign > 0)
      return Region.afterIsoline(isoIdx, this.isolines[isoIdx], chainIdx);
    else
      return Region.beforeIsoline(isoIdx, this.isolines[isoIdx], chainIdx);
  }

  mergeAll(){
    // merge along forward paths and compute separating vertices
    // note: backward paths are redundant reverse copies
    for(const isoIdx of this.isolines.keys()){
      for(const path of this.bm.isoPaths(isoIdx, 1).values())
        this.mergeAlongPath(path, 1);
    }

    // merge across isoline chains (except across separating vertices)
    for(const [isoIdx, iso] of this.isolines.entries()){
      for(const sign of [-1, +1]){
        for(const [chainIdx, chain] of iso.chains.entries()){
          this.mergeAcrossChains(isoIdx, chainIdx, chain, sign);
        }
      } // endfor sign = -/+1
    } // endfor 0 <= isoIdx < #isolines

    // trace from incomplete chains
    for(const isoIdx of this.isolines.keys()){
      for(const side of [this.chainPrev, this.chainNext]){
        for(const region of side[isoIdx]){
          if(!region || region.isComplete())
            continue; // skip, nothing to resolve
          // else we need to resolve the region
          this.resolveRegion(region);
        } // endfor [chainIdx, region] of side.entries()
      } // endfor side of [prev/next]
    } // endfor 0 <= isoIdx < #isolines
  }

  mergeAlongPath(path){
    // compute potential separating vertices (of each side)
    for(const [edge, iso, dt] of [
      [path.srcEdge, path.srcIso, path.timeDir],
      [path.trgEdge, path.trgIso, -path.timeDir] 
    ]){
      const e = edge.at(iso.time);
      assert(e, 'Dependency path does not intersect isoline');
      const vs = e.valueSamples();
      assert(vs.length < 2,
        'Dependency edge with two value samples');
      for(const s of vs)
        this.setSeparator(s, dt);
    }

    // unify regions spanned by dependency path
    let firstReg;
    for(const reg of this.regionsOfPath(path)){
      if(firstReg)
        firstReg.union(reg);
      else
        firstReg = reg;
    }
  }

  *regionsOfPath(path){
    const span = path.computeSpan();
    for(const [isoIdx, chainIdx] of span.values()){
      let sign;
      if(isoIdx === path.srcIdx)
        sign = path.timeDir;
      else if(isoIdx === path.trgIdx)
        sign = -path.timeDir;
      const reg = this.getChainSide(sign)[isoIdx][chainIdx];
      assert(reg, 'Region does not exist but is spanned?');
      if(reg)
        yield reg;
      else
        assert.error('Region does not exist but is spanned?');
    }
  }

  mergeAcrossChains(isoIdx, chainIdx, chain, sign){
    const iso = this.isolines[isoIdx];
    const chainSide = this.getChainSide(sign);
    const isoRegions = chainSide[isoIdx];
    const chainReg = isoRegions[chainIdx];
    // consider the chain's endpoint vertices
    // for computing adjacent chains (always at vertices!)
    for(const v of chain.endVertices()){
      // skip if it's a separating vertex
      if(this.isSeparator(v, sign)
      || this.isSeparator(v, -sign))
        continue;
      // else it's not a separating case
      // => we can propagate to any adjacent chain
      const hash = v.vertexId;
      for(const [cidx, ch] of iso.chains.entries()){
        if(cidx === chainIdx)
          continue; // skip same chain
        // check if chain starts or end at that vertex
        if(ch.firstHash === hash || ch.lastHash === hash){
          // it does! merge that region if it exists
          const sreg = isoRegions[cidx];
          if(sreg)
            chainReg.union(sreg);
        }
      } // endfor [cidx, ch] of iso.chains
    } // endfor v of chain.endVertices
  }

  resolveRegion(region){
    assert(region && !region.isComplete(),
      'Cannot resolve the region argument');
    // get necessary inputs
    let isoIdx, iso, chainIdx, sign;
    if(region.hasSource()){
      isoIdx = region.srcIdx;
      iso = region.srcIso;
      [chainIdx] = region.srcChains;
      sign = +1;

    } else {
      isoIdx = region.trgIdx;
      iso = region.trgIso;
      [chainIdx] = region.trgChains;
      sign = -1;
    }
    const chain = iso.chains[chainIdx];
    // assert(!chain.isSingular(), 'Singular chains should not need resolving');
    // find value sample on chain, or pick random edge sample if none
    let startEdge;
    // go over samples (except constant edges)
    chainLoop:
    for(const nh of chain.nodes()){
      // check if value sample or not
      if(nh.isValueSample()){
        const v = nh.valueSamples()[0];
        assert(v, 'Value sample without value sample');
        // find edge on correct side, which is spanned by this chain
        for(const e of v.edges()){
          const dt = e.dt();
          if(geom.approximately(dt, 0))
            continue; // skip edge
          if(Math.sign(dt) === sign
          && chain.spans(e)){
            startEdge = e;
            break chainLoop;
          }
        } // endfor [e] of v.edges
      } else {
        // nh is an edge across the isoline
        // => use can use it directly!
        startEdge = nh;
        // /!\ however we'll prefer edges value samples
        // => we keep searching for one
      } // endif value sample else
    } // endfor nh of chain.nodes

    // no starting edge = no resolution possible
    if(!startEdge){
      assert.error('No starting edge found for region resolution');
      return;
    }

    // follow time until either
    // 1) we cross an isoline => get chain and unify its region
    // 2) we reach a border vertex => use dep path to unify region
    let edge = startEdge;
    while(edge){
      // check if we cross an isoline beyond the source one
      const crossings = getIsolineCrossings(this.isolines, edge);
      const crossIdx = crossings.indexOf(isoIdx);
      const nextIdx = crossIdx + 1; // -1 => 0, i => i+1 
      if(nextIdx < crossings.length){
        // we found our isoline!
        const isoDepIdx = crossings[nextIdx];
        // find corresponding chain
        const isoDep = this.isolines[isoDepIdx];
        for(const [chainIdx, chain] of isoDep.chains.entries()){
          if(chain.spans(edge)){
            // found it!
            const oreg = this.getChainSide(-sign)[isoDepIdx][chainIdx];
            if(oreg){
              oreg.union(region); // resolved here!
              return;

            } else {
              assert.error('Missing chain region');
            }
          } // endif chain spans edge
        } // endfor [chainIdx, chain]
        assert.error('Reached isoline without resolving a region');
        return;
      }

      // get target vertex to restart tracing
      const v = edge.target.getVertex();
      if(v.isBorder()){
        // get the corresponding dependency path
        const path = this.bm.verToPath.get(v);
        assert(path, 'Border vertex, not on isoline, without path');
        if(path){
          for(const oreg of this.regionsOfPath(path)){
            // found valid region!
            oreg.union(region); // resolved here
            return;
          }
          assert.error('No valid region from dependency path');
        }
      }

      // find next edge
      edge = null;
      let maxAbsDT = -Infinity;
      for(const e of v.edges()){
        const dt = e.dt();
        if(geom.approximately(dt, 0))
          continue; // skip
        if(Math.sign(dt) === sign){
          const absDT = Math.abs(dt);
          // only keep edge of maximum abs(dt) to speed up tracing
          if(absDT > maxAbsDT){
            edge = e;
            maxAbsDT = absDT;
          } // endif absDT > maxAbsDT
        } // endif sign(dt) === sign
      } // endfor e of v.edges
    } // endfor edge
    assert.error('Region resolution failed');
  }

  checkRegions(){
    for(let isoIdx = 0; isoIdx < this.chainPrev.length; ++isoIdx){
      const prev = new Set(this.chainPrev[isoIdx].flatMap(r => {
        return r ? [r.root()] : [];
      }));
      const next = new Set(this.chainNext[isoIdx].flatMap(r => {
        return r ? [r.root()] : [];
      }));
      assert(prev.size || next.size,
        'Isoline without adjacent region');
      for(const r of prev)
        assert(r.isComplete(), 'Incomplete previous region');
      for(const r of next)
        assert(r.isComplete(), 'Incomplete next region');
    }
  }

  getRegions(dt){
    assert(dt && typeof dt === 'number', 'Invalid dt argument');
    const chainSide = dt > 0 ? this.chainNext : this.chainPrev;
    return chainSide.map(chainRegions => {
      return new Set(chainRegions.flatMap(reg => {
        return reg ? [reg.root()] : [];
      }));
    });
  }
}

module.exports = {
  // classes
  IsolineIsolinePath,
  BorderMarcher,
  // functions
  segmentTime,
  getIsolineCrossings,
  upscaleRegions,
  rankRegions
};