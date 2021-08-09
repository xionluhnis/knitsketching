// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const DistanceSampler = require('./distance.js');
const MeshGrid = require('../../ds/meshgrid.js');
const M = require('./constants.js');
const MeshLayer = require('./layer.js');
const {
  SeamLayerData, getSeamDataFromLayer
} = require('../../sketch/seam.js');
const RegionNode = require('./regionnode.js');
const RegionGraph = require('./regiongraph.js');
const UnionSet = require('../../ds/unionset.js');
const { Isoline } = require('./isoline.js');
const { checkFlowAndTime } = require('./checks.js');
const { segmentTime } = require('./segmentation.js');
const { reduceRegions } = require('./reduction.js');
const {
  subdivideRegions, getSplittingIsolines
} = require('./subdivision.js');
const { HEAT_METHOD } = require('./distance.js');
const Timer = require('../../timer.js');

/**
 * Mesh data structure containing the flow / time / regions
 *
 * @property {number[]} etas the resolution factors per level
 * @property {MeshLayer[][]} levels the different set of layers at each level
 * @property {number} currentLevel the deepest level for which a flow exists
 */
class Mesh {
  constructor({
    etas = [], levels = [],
    currentLevel = 0,
    // general parameters
    debugWasm = false, expertMode = false,
    verbose = false,
    geodesicMode = DistanceSampler.HEAT_METHOD,
    refineThreshold = 3,
    robustMeshing = false
  } = {}){
    this.etas = etas;
    this.levels = levels;
    this.layers = levels[levels.length - 1] || [];
    this.currentLevel = currentLevel;
    // general parameters
    this.debugWasm = debugWasm;
    this.expertMode = expertMode;
    this.verbose = verbose;
    this.geodesicMode = geodesicMode;
    this.refineThreshold = refineThreshold;
    this.robustMeshing = robustMeshing;
    // critical isolines and segmentation regions
    this.isolines = [];
    this.regions = [];
    // reduction
    this.reduction = [];
    this.reducedRegions = [];
    // subdivision
    this.subRegions = [];

    // seam data
    this.seamLayers = [];

    // cache
    this.distSampler = null;
    this.isolineIndex = new Map();

    // issue summaries
    this.errors = [];
    this.warnings = [];
    this.regionErrors = [];
    this.regionWarnings = [];
    this.valid = true; // until proven otherwise
  }
  get lastEta(){ return this.etas[this.etas.length - 1]; }
  get ready(){ return this.reducedRegions.length && this.valid; }

  allocate(numLevels){
    if(this.etas.length != numLevels)
      this.etas = Array.from({ length: numLevels });
    if(this.levels.length != numLevels)
      this.levels = Array.from({ length: numLevels }, () => []);
    // layers are from the last level
    this.layers = this.levels[this.levels.length - 1];
  }

  newRegion(...args){
    const region = new RegionNode(this, this.regions.length, ...args);
    this.regions.push(region);
    return region;
  }

  *subIsolines(){
    for(const isolines of this.subRegions){
      if(isolines.length)
        yield *isolines;
    }
  }
  *allIsolines(){
    yield *this.isolines;
    yield *this.subIsolines();
  }

  get lastLevel(){
    return this.levels.length - 1;
  }

  openTopology(verbose = false, lvl = this.lastLevel){
    // per-vertex opening
    let numOV = 0;
    for(const layer of this.getLayers(lvl)){
      for(const bs of layer.borderSamples){
        bs.markSourcesAndSinks();
        if(bs.isVertexOpen)
          ++numOV;
      }
      // check coherence along same layer borders
      for(const bs of layer.borderSamples)
        assert(bs.prevSample.isNextEdgeOpen === bs.isPrevEdgeOpen,
          'Edge opening is not coherent in same layer', bs.sampleId);
    }
    // check the resulting per-edge opening
    let numOL = 0;
    for(const layer of this.getLayers(lvl)){
      for(const bs of layer.borderSamples){
        if(bs.nextSampleLink && bs.isNextEdgeOpen){
          ++numOL;
          // check reciprocity
          const bs2 = bs.nextSampleLink;
          if(bs2.nextSampleLink.matches(bs)){
            assert(bs2.isNextEdgeOpen,
              'Edge opening is not bidirectional (next)', bs.sampleId);

          } else if(bs2.prevSampleLink.matches(bs)){
            assert(bs2.isPrevEdgeOpen,
              'Edge opening is not bidirectional (prev)', bs.sampleId);

          } else {
            assert.error('Sample edge linking is single-sided');
          }
        }
      }
    }
    assert(numOV % 2 === 0 && numOL % 2 === 0,
      'Odd opening count', numOV, numOL);
    if(verbose){
      console.log(
        'Topological opening: '
      + (numOV/2) + 'v, '
      + (numOL/2) + 'e'
      );
    }
  }

  computeSeamLayers(params = {}){
    this.seamLayers = this.layers.map(layer => {
      return getSeamDataFromLayer(layer, params);
    });
    return this.seamLayers;
  }
  resetSeamLayers(seamLayers){
    assert(Array.isArray(seamLayers)
        && seamLayers.length === this.layers.length,
      'Seam data does not match the layer cardinality');
    assert(seamLayers.every(sl => sl instanceof SeamLayerData),
      'Invalid layer data type');
    this.seamLayers = seamLayers;
  }

  getDistanceSampler(){
    // only return for last level
    if(this.currentLevel !== this.lastLevel){
      return null;
    }
    // create sampler if not available
    if(!this.distSampler){
      this.distSampler = new DistanceSampler(this, {
        mode: this.geodesicMode,
        refineThreshold: this.refineThreshold,
        verbose: this.verbose,
        expertMode: this.expertMode,
        debugWasm: this.debugWasm
      });
    }
    // return cached sampler
    return this.distSampler;
  }
  updateDistanceParameters({
    geodesicMode = HEAT_METHOD,
    refineGeodesics = true,
    refineThreshold = 3
  }){
    this.geodesicMode = geodesicMode;
    if(refineGeodesics)
      this.refineThreshold = refineThreshold;
    else
      this.refineThreshold = -Infinity;
    // clear cached sampler
    this.distSampler = null;
  }

  *samples(meshLevel = this.lastLevel, traversalType = 0){
    for(const layer of this.getLayers(meshLevel))
      yield *layer.samples(traversalType);
  }

  *vertices(meshLevel = this.lastLevel){
    for(const layer of this.getLayers(meshLevel))
      yield *layer.vertices();
  }
  *borderVertices(meshLevel = this.lastLevel){
    for(const layer of this.getLayers(meshLevel))
      yield *layer.borderVertices();
  }

  *faces(triangulate = false, meshLevel = this.lastLevel){
    const faceSet = new Set();
    for(const s of this.vertices(meshLevel)){
      for(const nh of s.areaNeighborhoods()){
        const fid = nh.areaId;
        if(faceSet.has(fid))
          continue; // skip
        else
          faceSet.add(fid); // ensure we don't process again
        // normalize orientation
        const onh = nh.oriented();
        // yield face as-is unless we need triangulation
        if(triangulate)
          yield *onh.triangles();
        else
          yield onh;
      } // endfor nh of s.areaNeighborhoods
    } // endfor s of samples
  }

  invertTime(){
    for(let lvl = 0; lvl <= this.lastLevel; ++lvl){
      for(const layer of this.getLayers(lvl)){
        const { minT, maxT } = layer;
        // invert flow and time of each sample
        for(const s of layer.samples()){
          const uv = s.flow();
          const t  = s.time();
          s.setFlow(uv, -1);
          s.setTime(maxT - (t - minT), false); // do not propagate
        } // endfor s of layer.samples()
      } // endfor layer
    } // endfor 0 <= lvl <= lastLevel
  }

  checkFlowAndTime(verbose = true){ checkFlowAndTime(this, verbose); }

  resetRegions(){
    this.isolines = [];
    this.isolineIndex = new Map();
    this.regions = [];
    for(let lvl = 0; lvl <= this.lastLevel; ++lvl){
      for(const layer of this.getLayers(lvl)){
        for(const vertex of layer.vertices()){
          vertex.clearRegion();
        } // endfor sample of layer.vertices()
      } // endfor layer of this.getLayers
    } // endfor lvl < #lastLevel
  }

  resetReduction(){
    this.reduction = [];
    this.reducedRegions = [];
    this.subRegions = [];
  }

  isolineIndexOf(iso){
    if(this.isolineIndex.has(iso))
      return this.isolineIndex.get(iso);
    else
      return -1;  
  }

  segment(params = {}, reset = false){
    const t = Timer.create();
    if(reset){
      this.resetRegions();
      this.resetReduction();
    }

    // critical segmentation
    segmentTime(this, params);

    // isoline indexing
    this.isolineIndex = new Map(this.isolines.map((iso, i) => [iso, i]));

    // reduction
    reduceRegions(this, params);

    // subdivision
    subdivideRegions(this, params);

    if(params.verbose){
      t.measure('reg_segment');
      t.debug('Region');
    }
  }

  reduce(params = {}){
    // reset reduction
    this.resetReduction();

    // reduction
    reduceRegions(this, params);

    // subdivision
    subdivideRegions(this, params);
  }

  getReduction(region){
    assert(!region.isReduced(), 'Argument must be an original region');
    if(this.reduction.length){
      assert(0 <= region.index && region.index < this.reduction.length,
        'Region index is out of bounds');
    } else {
      return null; // no reduction available
    }
    return this.reduction[region.index];
  }

  getSubRegions(region){
    if(!region.isReduced())
      region = this.getReduction(region);
    return this.subRegions[region.index];
  }

  getSplittingIsolines(splitMap){
    return getSplittingIsolines(this, splitMap);
  }

  getRegionGraph(){ return RegionGraph.from(this); }

  toRegionGraphString({
    graphName = 'regions',
    reduced = false,
    exportCW = false,
    timeString = t => t.toFixed(3),
    widthString = w => w.toFixed(1)
  } = {}){
    const lines = [
      'digraph ' + graphName + ' {'
    ];
    const regName = r => {
      return (r.isInterface() ? 'i' : 'r') + r.index;
    };
    let regionList;
    let edges;
    if(reduced){
      const graph = this.getRegionGraph();
      regionList = graph.nodes;
      edges = graph.edges;
      for(let i = 0; i < regionList.length; ++i)
        graph.nodes[i].index = i; // set index
    } else {
      regionList = this.regions;
    }
    for(const r of regionList){
      const id = regName(r);
      let params;
      if(r.isInterface()){
        let tparam;
        if(r.isReduced()){
          const tmin = r.minTime();
          const tmax = r.maxTime();
          if(tmin === tmax)
            tparam = 't=' + timeString(tmin);
          else {
            tparam = 't=[' + timeString(tmin)
                     + ';' + timeString(tmax) + ']';
          }
        } else { 
          tparam = 't=' + timeString(r.time);
        }
        params = 'label="' + tparam + '",color="#85bdff"';
      } else {
        params = 'color="#008a5c"';
      }
      lines.push(id + ' [' + params + ']');
      // if no edge list, we generate it on the fly here
      if(!edges){
        for(const pr of r.prev)
          lines.push(regName(pr) + ' -> ' + id);
        for(const nr of r.next)
          lines.push(id + ' -> ' + regName(nr));
      }
    }
    if(edges){
      for(const e of edges){
        const src = regName(e.source);
        const trg = regName(e.target);
        let lparam;
        if(exportCW){
          const cw = e.courseWidth();
          lparam = ' [label=" cw=' + widthString(cw) + ' "]';
        }
        lines.push(src + ' -> ' + trg + lparam);
      }
    }
    lines.push('}');
    return lines.join('\n');
  }

  /**
   * Return the layer correpsonding to a sketch
   *
   * @param sketch the query sketch
   * @param level the level to look at (the current level by default)
   * @return the correpsonding layer
   */
  getLayer(sketch, level){
    if(level === undefined)
      level = this.currentLevel;
    return this.levels[level].find(layer => layer.sketch == sketch);
  }

  /**
   * Generator over all layer warnings and errors
   */
  *issues(){
    for(const issue of this.regionErrors)
      yield Object.assign({ type: 'error' }, issue);
    for(const issue of this.regionWarnings)
      yield Object.assign({ type: 'warning' }, issue);
    for(const issue of this.errors)
      yield Object.assign({ type: 'error' }, issue);
    for(const issue of this.warnings)
      yield Object.assign({ type: 'warning' }, issue);
  }

  /**
   * Check whether this mesh has at least one directional constraints
   *
   * If it does, then the initialization can be empty and we use the existing constraints
   * to transmit the flow.
   * If it does not, we must assume some direction (upward) to solve for the flow.
   */
  hasDirectionalConstraint(){
    return this.levels[0].some(layer => {
      return layer.sketch.constraints.some(constr => {
        return constr.isDirectional();
      });
    });
  }

  hasTimeConstraint(){
    return this.levels[0].some(layer => {
      return layer.sketch.constraints.some(constr => {
        return constr.isTimeConstraint();
      });
    });
  }

  /**
   * Return the layers for a given level
   * @param lvl the level (defaults to the current one)
   * @return [MeshLayer|LegacyMeshLayer]
   */
  getLayers(lvl){
    if(lvl === undefined)
      lvl = this.currentLevel;
    assert(lvl < this.levels.length, 'Invalid level', lvl);
    return this.levels[lvl];
  }

  computeEtas(extents, resolution, numLevels, factor, useMax){
    this.etas = Mesh.getEtas(extents, resolution, numLevels, factor, useMax);
  }

  /**
   * Get the list of buffers associated with the underlying layers
   *
   * @return a list of TypedArray::buffer objects
   */
  getBuffers(){
    const list = [];
    // else the buffers come from each layer (of each level)
    for(let level of this.levels){
      for(let layer of level){
        list.push(...layer.getBuffers());
      }
    }
    return list;
  }

  toData(minimal){
    const data = {};
    for(const key in this){
      switch(key){

        case 'levels':
          data[key] = this.levels.map((level, index) => {
            if(minimal && this.currentLevel < index)
              return []; // skip serialization
            else
              return level.map(layer => layer.toData());
          });
          break;

        case 'isolineIndex':
        case 'layers':
          continue; // skip

        case 'seamLayers':
        case 'isolines':
        case 'regions':
        case 'reducedRegions':
          data[key] = this[key].map(r => r.toData());
          break;

        case 'subRegions':
          data[key] = this[key].map(index => index.map(r => r.toData()));
          break;
        
        case 'reduction':
          data[key] = this.reduction.map(r => r.index);
          break;

        case 'distSampler':
          data[key] = this.distSampler ? this.distSampler.toData() : null;
          break;

        default:
          data[key] = this[key];
          break;
      }
    }
    return data;
  }

  loadData(data){
    for(let key in data){
      switch(key){

        case 'levels':
          this.levels = data[key].map((levelData, lvl) => levelData.map((layerData, idx) => {
            return new MeshLayer(this, lvl, idx).loadData(layerData);
          }));
          // layers points to the last level
          this.layers = this.levels[this.levels.length - 1];
          break;

        case 'seamLayers':
        case 'isolines':
        case 'regions':
        case 'reducedRegions':
        case 'subRegions':
        case 'reduction':
        case 'distSampler':
          continue; // do after all layers are created with their samples

        default:
          this[key] = data[key];
          break;
      }
    }

    // rebuild seam layers given layers
    if(data.seamLayers){
      this.seamLayers = data.seamLayers.map((seamData, i) => {
        return SeamLayerData.fromData(this.layers[i], seamData);
      });
    }

    // rebuild regions
    if(data.regions){
      assert(data.isolines.length <= data.regions.length,
        'Isoline count larger than region count');
      // recreate isolines
      this.isolines = data.isolines.map(isoData => {
        return Isoline.fromData(this, isoData);
      });
      this.isolineIndex = new Map(this.isolines.map((iso, i) => [iso, i]));
      
      // recreate subregions isolines
      this.subRegions = data.subRegions.map(index => index.map(rData => {
        return Isoline.fromData(this, rData);
      }));

      // recreate regions
      this.regions = data.regions.map((regData, idx) => {
        return new RegionNode(this, idx, { check: false });
      });
      
      // recreate reduced regions
      this.reducedRegions = data.reducedRegions.map((rData, idx) => {
        return new RegionNode.Reduced(
          Array.from(rData.regions, idx => this.regions[idx]), idx,
          Array.from(rData.top, idx => this.regions[idx]),
          Array.from(rData.bottom, idx => this.regions[idx])
        );
      });
      
      // load data
      for(let i = 0; i < this.regions.length; ++i){
        this.regions[i].loadData(data.regions[i]);
      }
      for(let i = 0; i < this.reducedRegions.length; ++i){
        this.reducedRegions[i].loadData(data.reducedRegions[i]);
      }

      // remap reduction
      this.reduction = data.reduction.map(idx => this.reducedRegions[idx]);
    }

    // distance sampler
    if(data.distSampler){
      this.distSampler = DistanceSampler.fromData(this, data.distSampler);
    }

    // post-checks
    assert(this.etas && Array.isArray(this.etas), 'Invalid etas value');
    assert(this.levels.length == this.etas.length, 'Cardinality is uneven');
    return this;
  }

  remapData(map){
    // remap sketches
    for(const level of this.levels){
      for(const layer of level){
        layer.remapData(map);
      }
    }
    // reinit the data (for sample initialization)
    for(const level of this.levels){
      for(const layer of level)
        layer.initializeSamples();
      for(const layer of level)
        layer.crossInitializeSamples();
    }
    // initialize isoline chains
    for(const isoline of this.allIsolines())
      isoline.initializeChains();

    // remap curves from seam layer data
    for(const slayer of this.seamLayers)
      slayer.remapData(map);

    // initialize distance sampler
    if(this.distSampler){
      this.distSampler.initializeIndex();
      this.distSampler.checkDimensions();
    }
    // ready
    return this;
  }

  static getEtas(extents, minResolution, levels, factor, useMax = true){
    const extValue = useMax ? 
      extents.reduce((val, ext) => {
        return Math.max(val,
               Math.max(ext.max.x - ext.min.x,
                        ext.max.y - ext.min.y));
      }, -Infinity) :
      extents.reduce((val, ext) => {
        return Math.min(val,
               Math.min(ext.max.x - ext.min.x,
                        ext.max.y - ext.min.y));
      }, Infinity);
    const maxResolution = minResolution * Math.pow(factor, levels - 1);
    const baseEta = extValue / maxResolution;
    const etas = Array.from({ length: levels });
    etas[etas.length - 1] = baseEta;
    for(let level = levels - 2; level >= 0; --level)
      etas[level] = etas[level+1] * factor;
    return etas;
  }

  static fromSketchGroup(sketches, {
    minResolution = 8, meshLevels = 3, levelFactor = 2,
    constraintSupport = 1,
    geodesicMode = DistanceSampler.HEAT_METHOD,
    robustMeshing = false,
    refineGeodesics = true,
    refineThreshold = 3,
    verbose = false, expertMode = false, debugWasm = false
  } = {}){
    if(!meshLevels)
      meshLevels = 3;
    if(!minResolution)
      minResolution = 8;
    const extents = sketches.map(sketch => sketch.extents());
    const mesh = new Mesh({
      verbose, debugWasm, expertMode,
      geodesicMode, robustMeshing,
      refineThreshold: refineGeodesics ? refineThreshold : -Infinity
    });
    mesh.allocate(meshLevels);
    mesh.computeEtas(extents, minResolution, meshLevels, levelFactor, true);
    for(let i = 0; i < sketches.length; ++i){
      const sketch = sketches[i];
      assert(sketch.transform.k == 1, 'Sketch has non-unit scale');
      // compute layers
      for(let l = 0; l < meshLevels; ++l){
        assert(l < mesh.levels.length, 'Invalid level', l);
        assert(Array.isArray(mesh.levels[l]), 'Levels not allocated');
        mesh.levels[l].push(new MeshLayer(
          mesh, l, i,
          sketch, extents[i], mesh.etas[l],
          constraintSupport
        ));
      }
    }
    // allocate and initialize the layers
    for(let l = 0; l < meshLevels; ++l){
      for(const layer of mesh.levels[l])
        layer.allocate(verbose); // allocate grid + border data
      for(const layer of mesh.levels[l])
        layer.initialize(verbose); // initialize content and samples
      for(const layer of mesh.levels[l])
        layer.crossInitializeSamples(); // cross-layer initialization
      if(!verbose)
        continue;
      for(const layer of mesh.levels[l])
        layer.check(); // check layer data
    }
    return mesh;
  }

  static getClusters(sketches){
    if(!sketches.length)
      return [];
    const clu = new UnionSet.Clustering(sketches);
    // assign links between singleton sets
    for(let i = 0; i < sketches.length; ++i){
      const sketch = sketches[i];
      assert(!sketch.parent, 'Not a root sketch');

      // create connection from links
      for(let link of sketch.links){
        if(link){
          assert(!link.isParentLink(), 'Parent link for root sketch');
          clu.union(sketch, link.target);
        }
      }
    }
    // get sketch clusters using union find data structure
    return clu.getClusters();
  }

  static fromSketches(sketches, params = {}){
    const groups = Mesh.getClusters(sketches);
    return groups.map(skGrp => Mesh.fromSketchGroup(skGrp, params));
  }

  static fromData(data){
    return new Mesh().loadData(data);
  }
}

module.exports = Object.assign(Mesh, M, { Grid: MeshGrid });
