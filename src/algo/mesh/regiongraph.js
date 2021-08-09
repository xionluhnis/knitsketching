// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const RegionNode = require('./regionnode.js');
const { PREV, NEXT } = RegionNode;

class RegionEdge {
  constructor(source, target, index){
    this.source = source;
    this.target = target;
    this.index  = index;
    // sided reduced regions
    this.itfSide  = [source, target].find(r => r.isInterface());
    this.areaSide = [source, target].find(r => r.isArea());
    assert(this.itfSide && this.areaSide,
      'Edge is not bipartite');
    // underlying data
    if(this.areaSide){
      this.region   = this.areaSide.getOriginal().region;
      if(this.region){
        if(this.areaSide.isPrev(this.itfSide))
          this.isoline = this.region.srcIso;
        else if(this.areaSide.isNext(this.itfSide))
          this.isoline = this.region.trgIso;
        else {
          assert.error('Invalid edge, neither before or after area');
          this.isoline = null;
        }
      }
    } else {
      this.region = this.isoline = null;
      // this is not a valid state
    }
    // cache
    this.crsPath      = undefined;
    this.crsWidth     = -1;
  }
  area(withOther = false){
    return withOther ? [this.areaSide, this.itfSide] : this.areaSide;
  }
  interface(withOther = false){
    return withOther ? [this.itfSide, this.areaSide] : this.itfSide;
  }
  *isolines(){
    if(this.region)
      yield *this.region.isolines();
  }
  getCoursePath(){
    if(this.crsPath === undefined){
      if(this.isoline && this.region)
        this.crsPath = this.region.getCoursePath(this.isoline);
      else
        this.crsPath = null;
    }
    return this.crsPath;
  }
  isCircular(){
    const crsPath = this.getCoursePath();
    if(crsPath)
      return crsPath.isCircular();
  }
  isFlat(){
    const crsPath = this.getCoursePath();
    if(crsPath)
      return crsPath.isFlat();
  }
  courseWidth(){
    if(this.crsWidth >= 0)
      return this.crsWidth;
    // get course path
    const crsPath = this.getCoursePath();
    let length = 0;
    if(crsPath){
      for(const chain of crsPath.chains()){
        // add chain's length
        length += chain.length();
      }
    }
    this.crsWidth = Math.max(0, length);
    return this.crsWidth;
  }
}

class RegionGraph {
  constructor(nodes, oriRegions, redRegions, oriToNew, redToNew){
    this.nodes = nodes; // RedRegion[]
    this.edges = [];    // RegionEdge[]

    // graph connectivity
    this.nodeIndex  = new Map(nodes.map((n, i) => [n, i]));
    this.inpEdges   = nodes.map(() => []);
    this.outEdges   = nodes.map(() => []);
    for(let i = 0; i < nodes.length; ++i){
      const src = nodes[i];
      for(const trg of src.next){
        const edge = new RegionEdge(src, trg, this.edges.length);
        this.edges.push(edge);
        // add to next/prev
        this.outEdges[i].push(edge);
        this.inpEdges[this.nodeIndex.get(trg)].push(edge);
      }
    }
    // check inp/out with boundary information
    for(let i = 0; i < nodes.length; ++i){
      const node = nodes[i];
      assert(this.inpEdges[i].length === node.prev.size,
        'Input edge count does not match prev nodes');
      assert(this.outEdges[i].length === node.next.size,
        'Output edge count does not match next nodes');
      if(!this.inpEdges[i].length
      || !this.outEdges[i].length)
        assert(node.isBoundary(), 'Invalid boundary information');
    }

    // base region data
    this.rnodes = redRegions; // RedRegion[]
    this.onodes = oriRegions; // MeshRegion[]
    this.oriToNew = oriToNew; // Map<MeshRegion, [MeshRegion]>
    this.redToNew = redToNew; // Map<RedRegion, [RedRegion]>
  }

  get mesh(){ return this.nodes[0].mesh; }

  node(index){
    assert(0 <= index && index < this.nodes.length, 'Invalid node index');
    return this.nodes[index];
  }
  edge(index){
    assert(0 <= index && index < this.edges.length, 'Invalid edge index');
    return this.edges[index];
  }

  dt(index, inPixels = true){
    const dt = this.node(index).timeRange();
    return inPixels ? dt * this.mesh.lastEta : dt;
  }

  cw(index){
    return this.edges(index).courseWidth(this);
  }

  getNodeEdges(node){
    const idx = typeof node === 'number' ? node : this.nodeIndex.get(node);
    assert(typeof idx === 'number', 'Invalid node index');
    return [ this.inpEdges[idx], this.outEdges[idx] ];
  }

  static from(mesh){
    const arrayMap = a => {
      return r => {
        assert(r.index >= 0 && r.index < a.length,
          'Invalid remapping, out-of-bounds');
        return a[r.index];
      };
    };
    const oriRegions = mesh.regions.map(r => r.copy()).map((r,_,a) => {
      return r.remap(arrayMap(a));
    });
    const oriMap = arrayMap(oriRegions);
    const redRegions = mesh.reducedRegions.map(r => {
      return r.copy(oriMap);
    }).map((r,_,a) => {
      return r.remap(arrayMap(a));
    });
    const oriToNew = new Map();
    const redToNew = new Map();
    for(let i = 0; i < mesh.subRegions.length; ++i){
      const redRegion = redRegions[i];
      const isolines = mesh.subRegions[i].map(ig => {
        return new RegionNode(mesh, -1, { isoline: ig });
      });

      // no subdivision case
      if(!isolines.length){
        continue;
      }
      // else we need to subdivide

      // get original simple regon
      const oriRegion = redRegion.getOriginal();
      assert(oriRegion.isArea() && oriRegion.region,
        'Cannot split a non-area region');
      const baseReg = oriRegion.region;
      if(!baseReg)
        continue;
      const regData = isolines.reduce((regs, { isoline }) => {
        const lastReg = regs.pop();
        const [rl, rr] = lastReg.split(isoline);
        regs.push(rl, rr);
        return regs;
      }, [baseReg]);

      // create division chain, as well as its trivial reduction
      const regChain = [
        new RegionNode(mesh, -1, {
          [NEXT]: [isolines[0]],
          region: regData[0]
        })
      ];
      const redChain = [ regChain[0].reduced() ];
      for(let i = 0; i < isolines.length; ++i){
        // regular chain
        regChain.push(isolines[i]);
        regChain.push(
          new RegionNode(mesh, -1, {
            [PREV]: [isolines[i]],
            [NEXT]: i < isolines.length - 1 ? [isolines[i+1]] : [],
            region: regData[i+1]
          })
        );
        const g = regChain.length - 2;
        // connect regions
        regChain[g - 1].addNeighbor(regChain[g + 0], NEXT);
        regChain[g + 0].addNeighbor(regChain[g + 1], NEXT);

        // reduced chain
        redChain.push(regChain[g + 0].reduced());
        redChain.push(regChain[g + 1].reduced());
        // connect reduced regions
        const k = redChain.length - 3;
        redChain[k + 0].addNeighbor(redChain[k + 1], NEXT);
        redChain[k + 1].addNeighbor(redChain[k + 2], NEXT);
      }

      // replace original region (connections)
      oriRegion.replaceWith(regChain[0], regChain[regChain.length - 1]);
      oriToNew.set(oriRegion, regChain);
      // copy original region index (for mapping back)
      for(const r of regChain)
        r.index = oriRegion.index;

      // replace reduced region (connections)
      redRegion.replaceWith(redChain[0], redChain[redChain.length - 1]);
      redToNew.set(redRegion, redChain);
      // copy original region index (for mapping back)
      for(const r of redChain)
        r.index = redRegion.index;
    }

    // create clean list of nodes
    const nodes = redRegions.flatMap(r => {
      if(redToNew.has(r))
        return redToNew.get(r);
      else
        return [ r ];
    });

    return new RegionGraph(
      nodes,
      // intermediate data
      oriRegions, redRegions,
      oriToNew, redToNew
    );
  }
}

module.exports = RegionGraph;