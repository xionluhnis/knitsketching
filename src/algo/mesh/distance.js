// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const MeshGrid = require('../../ds/meshgrid.js');
const { LAYER, SKETCH } = require('./constants.js');
const geom = require('../../geom.js');
const Timer = require('../../timer.js');
const { FibQueue, PairingQueue } = require('../../ds/pqueue.js');
const RefinedDistanceQueryResult = require('./geodesic.js');
// wasm for heap method
const gd_module = require('../../../libs/geodesic-dist/gdist.js');
let gd = gd_module({
  locateFile: function(path){
    return location.origin + '/libs/geodesic-dist/' + path;
  }
}).then(g => gd = g);

// constants
const MAX_UINT32 = 0xFFFFFFFF;
const FLOYD_WARSHALL = 'floyd';
const DIJKSTRA_FHEAP = 'dijkstra-fibheap';
const DIJKSTRA_PHEAP = 'dijkstra-pairheap';
const HEAT_METHOD    = 'heat';
const MODES = [
  FLOYD_WARSHALL, DIJKSTRA_FHEAP, DIJKSTRA_PHEAP, HEAT_METHOD
];

function checkContextArg(ctx){
  assert([LAYER, SKETCH].includes(ctx),
    'Invalid context argument');
}

/**
 * Data structure for accelerated geodesic distance and path computations
 * on top of a mesh data structure.
 * 
 * Multiple precomputation algorithms:
 * - Floyd Warshall (slow!)
 * - Dijkstra (better)
 * - Heat Method (best)
 * 
 * The Heat Method is from [Keenan17]:
 *    "The Heat Method for Distance Computation"
 *    Keenan Crane, Clarisse Weischedel and Max Wardetzky
 *    Communications of ACM 2017
 *    http://doi.acm.org/10.1145/3131280
 * 
 * @see https://en.wikipedia.org/wiki/Floyd%E2%80%93Warshall_algorithm
 * @see https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm
 * @see https://www.cs.cmu.edu/~kmcrane/Projects/HeatMethod/
 */
class DistanceSampler {
  constructor(mesh, {
    level = mesh.levels.length - 1,
    mode = HEAT_METHOD,
    useUniformTris = true,
    refineThreshold = 3,
    verbose = false,
    expertMode = false,
    debugWasm = false,
    precompute = true
  } = {}){
    this.mesh = mesh;
    this.level = level;
    this.eta = mesh.etas[level];
    this.mode = mode;
    this.useUniformTris = useUniformTris;
    this.verbose = verbose;
    this.expertMode = expertMode;
    this.debugWasm = debugWasm;
    assert(MODES.includes(mode),
      'Unsupported mode', mode);
    
    // unified sample index
    this.vertices = [];
    this.vertexIndex = new Map();
    this.maxDistance = 0.0;
    this.refineThreshold = refineThreshold;

    // initialize index and precomputation data
    if(precompute)
      this.precompute();
  }

  getMaxDistance(ctx){
    checkContextArg(ctx);
    return ctx === LAYER ? this.maxDistance : this.maxDistance * this.eta;
  }
  getMaxSketchDistance(){ return this.getMaxDistance(SKETCH); }
  getMaxLayerDistance(){ return this.getMaxDistance(LAYER); }
  getRefiningDistance(ctx){
    checkContextArg(ctx);
    return ctx === LAYER ? this.refineThreshold : this.refineThreshold * this.eta;
  }

  usesNext(){ return this.mode === FLOYD_WARSHALL; }
  usesPrev(){ return [DIJKSTRA_FHEAP, DIJKSTRA_PHEAP].includes(this.mode); }

  get prev(){
    assert(this.usesPrev() || this.mode === HEAT_METHOD,
      'Prev not available for mode', this.mode);
    return this.link;
  }
  get next(){
    assert(this.usesNext(),
      'Next not available for mode', this.mode);
    return this.link;
  }

  initializeIndex(){
    // unified sample index
    this.vertices = Array.from(this.mesh.vertices(this.level));
    this.vertexIndex = new Map(this.vertices.map((s, i) => [s, i]));
  }

  checkDimensions(){
    // check that the dimensions are appropriate
    for(const grid of [this.dist, this.link]){
      assert(grid.width === this.vertices.length
          && grid.height === this.vertices.length,
        'Data grid with invalid dimensions, does not match vertices');
    }
  }

  precompute(){
    const t = Timer.create();

    // initialize index
    this.initializeIndex();

    // allocate data
    const N = this.vertices.length;
    this.dist = new MeshGrid(N, N, 1, MeshGrid.F64);
    this.dist.reset(Infinity);
    this.link = new MeshGrid(N, N, 1, MeshGrid.U32);
    this.link.reset(MAX_UINT32);
    t.measure('alloc');

    // inter-sample distance precomputation
    switch(this.mode){
      case FLOYD_WARSHALL:
        this.floydPrecompute(t);
        break;
      case DIJKSTRA_FHEAP:
      case DIJKSTRA_PHEAP:
        this.dijkstraPrecompute(t);
        break;
      case HEAT_METHOD:
        this.heatPrecompute(t);
        break;
      default:
        assert.error('Unsupported mode', this.mode);
    }

    // compute maximum geodesic distance between any two samples
    this.maxDistance = this.dist.reduce((max, [dist]) => {
      return Math.max(max, dist);
    }, 0.0);
    
    if(this.verbose)
      t.debug('Dist sampler');
  }

  floydPrecompute(t){
    // compute self and edge distances
    const N = this.vertices.length;
    for(let i = 0; i < N; ++i){
      // self
      this.dist.set(i, i, 0, 0.0);
      this.next.set(i, i, 0, i);

      // edges across layers
      for(const [j, d] of this.neighborsOf(i)){
        this.dist.set(i, j, 0, d);
        this.next.set(i, j, 0, j);
      }
    } // endfor i < N
    t.measure('init');

    // standard Floyd-Warshall implementation
    for(let k = 0; k < N; ++k){
      for(let i = 0; i < N; ++i){
        for(let j = 0; j < N; ++j){
          // direct distance
          const d_i_j = this.dist.get(i, j, 0);
          // indirect distance through k
          const d_i_k = this.dist.get(i, k, 0);
          const d_k_j = this.dist.get(j, k, 0);
          const d_i_k_j = d_i_k + d_k_j; // discretization approximation
          if(d_i_k_j < d_i_j){
            this.dist.set(i, j, 0, d_i_k_j);
            this.next.set(i, j, 0, this.next.get(i, k));
          } // endif
        } // endfor j < N
      } // endfor i < N
    } // endfor k < N
    t.measure('precomp');
  }

  dijkstraPrecompute(t){
    // compute self and edge distances
    const N = this.vertices.length;
    const neighbors = Array.from({ length: N }, () => []);
    for(let i = 0; i < N; ++i){
      // self
      this.dist.set(i, i, 0, 0.0);
      this.prev.set(i, i, 0, i);

      // edges across layers
      for(const [j, d] of this.neighborsOf(i)){
        this.dist.set(i, j, 0, d);
        this.prev.set(i, j, 0, i); // not j!
        neighbors[i].push(j);
      }
    } // endfor i < N
    t.measure('init');

    // Dijkstra for each sample
    for(let i = 0; i < N; ++i){
      // the source is i
      // we're solving for dist[i,j] for all j (and prev[i,j])
      const queue = this.getInitialQueue(i);
      // /!\ our initial dist[i,j] matrix already contains the neighbor information
      //  => we use a different logic for the neighbors of the initial sample
      init: {
        const j = queue.pop();
        for(const k of neighbors[j]){
          queue.insert(k, this.dist.get(j, k, 0));
        }
      }
      // the original standard Dijkstra
      while(!queue.isEmpty()){
        const j = queue.pop();
        const baseDist = this.dist.get(i, j, 0);
        for(const k of neighbors[j]){
          const deltaDist = this.dist.get(j, k, 0); // = length(j,k)
          const newDist = baseDist + deltaDist;
          const prevDist = this.dist.get(i, k, 0);
          if(newDist < prevDist){
            // update distance
            this.dist.set(i, k, 0, newDist);
            this.prev.set(i, k, 0, j);
            // decrease distance-based priority (or insert if not yet reached)
            if(Number.isFinite(prevDist))
              queue.decrease(k, newDist);
            else
              queue.insert(k, newDist);
          } // endif newDist < prevDist
        } // endfor k of neighbors(j)
      } // endwhile #queue
    } // endfor i < N
    t.measure('precomp');
  }

  heatPrecompute(t){
    const N = this.vertices.length;

    // get triangle faces + edge lengths data
    const faces = [];
    const edges = [];
    if(this.useUniformTris){
      // subdivide quads into 4 triangles
      // = uniform orientations of the triangles
      // => reduce directional bias
      let midVertexIdx = this.vertices.length;
      for(const nh of this.mesh.faces(false)){
        if(nh.degree === 3){
          // note: may be along the border
          // => need to convert samples to vertices
          //    and use average edge length
          faces.push(nh.samples.map(s => {
            return this.vertexIndex.get(s.getVertex());
          }));
          edges.push(Array.from(nh.halfEdges(), e => e.avgLength()));

        } else {
          // register new mid vertex
          const midIdx = midVertexIdx++;

          // generate faces
          for(const [s0, s1] of geom.circularPairs(nh.samples)){
            faces.push([
              this.vertexIndex.get(s0.getVertex()),
              this.vertexIndex.get(s1.getVertex()),
              midIdx
            ]);
            edges.push([1, Math.SQRT1_2, Math.SQRT1_2]);
          }
        }
      } // endfor nh of mesh.faces

    } else {
      for(const face of this.mesh.faces(true)){
        assert(face.degree === 3, 'Face is not a triangle');
        faces.push({
          vertices: face.samples.map(s => s.getVertex())
        });
        // compute edge lengths for the triangular face
        edges.push(Array.from(face.halfEdges(), e => e.avgLength()));
      }
    }

    // heat method precomputations
    gd.precompute(faces, edges, {
      robust: true,
      timeStep: 0.1,
      verbose: this.debugWasm,
    });
    t.measure('init');

    // Dijkstra for each sample
    for(let i = 0; i < N; ++i){
      // the source is i
      const darr = gd.distancesTo(i);
      assert(geom.approximately(darr[i], 0.0),
        'Self distance is non-zero!');
      for(let j = 0; j < N; ++j){
        this.dist.set(i, j, 0, darr[j]);
      }
      // use exact 1-ring distance
      this.dist.set(i, i, 0, 0);
      for(const [j, d] of this.neighborsOf(i))
        this.dist.set(i, j, 0, d);
      
    } // endfor i < N
    t.measure('precomp');
  }

  getInitialQueue(i){
    // create queue with the following operations:
    // - pop() returns the minimum target (and removes it from the queue)
    // - insert(i, val) adds an entry with its priority
    // - decrease(i, newVal) updates the priority of an entry
    // - isEmpty() returns whether the queue is empty
    const N = this.vertices.length;
    switch(this.mode){
      case DIJKSTRA_FHEAP:
        return new FibQueue(N).insert(i, 0.0);

      case DIJKSTRA_PHEAP:
        return new PairingQueue(N).insert(i, 0.0);

      default:
        assert.error('No initial queue for mode', this.mode);
        return null;
    }
  }

  *neighborsOf(i){
    const v = this.vertices[i];
    for(const edge of v.edges()){
      if(edge !== edge.baseEdge())
        continue; // skip twin edge
      const j = this.vertexIndex.get(edge.target.getVertex());
      assert(typeof j === 'number', 'Missing neighbor sample');
      // use average length over half-edge sides
      yield [j, edge.avgLength(LAYER)];
    }
    // consider diagonals of quads to get better distance approximation
    // /!\ only if base sample is not a border sample
    if(v.isBorder())
      return;
    for(const [dy, dx] of [
      [-1, -1],
      [-1, +1],
      [+1, -1],
      [+1, +1]
    ]){
      const nd = v.layer.getSample(v.y + dy, v.x + dx);
      if(!nd)
        continue;
      const nx = v.layer.getSample(v.y, v.x + dx);
      if(!nx)
        continue;
      const ny = v.layer.getSample(v.y + dy, v.x);
      if(!ny)
        continue;
      if(nd.isNeighbor(nx) && nd.isNeighbor(ny)
      && v.isNeighbor(nx) && v.isNeighbor(ny)){
        const j = this.vertexIndex.get(nd);
        assert(typeof j === 'number', 'Missing diagonal neighbor sample');
        yield [j, Math.SQRT2];
      }
    }
  }

  distBetween(s1, s2, ctx){
    checkContextArg(ctx);
    const i = this.vertexIndex.get(s1.getVertex());
    const j = this.vertexIndex.get(s2.getVertex());
    assert(typeof i === 'number' && typeof j === 'number',
      'Invalid sample indices, are the argument valid samples?');
    const d = this.dist.get(i, j, 0);
    return ctx === SKETCH ? d * this.eta : d;
  }

  verticesBetween(s, e){
    s = s.getVertex();
    e = e.getVertex();
    let i = this.vertexIndex.get(s);
    let j = this.vertexIndex.get(e);
    assert(typeof i === 'number' && typeof j === 'number',
      'Invalid sample indices, are the argument valid samples?');
    const path = [];
    if(this.usesNext()){
      path.push(s);
      while(i !== j){
        i = this.next.get(i, j, 0);
        assert(0 <= i && i < this.vertices.length,
          'Index out-of-bounds', i, this.vertices.length);
        path.push(this.vertices[i]);
      }

    } else if(this.usesPrev()){
      // construct reverse path
      path.push(e);
      while(i !== j){
        j = this.prev.get(i, j, 0);
        assert(0 <= j && j < this.vertices.length,
          'Index out-of-bunds', j, this.vertices.length);
          path.push(this.vertices[j]);
      }
      path.reverse(); // reverse path to expected order

    } else {
      // gradient marching back from end
      path.push(e);
      while(i !== j){
        const prev = this.prev.get(i, j, 0);
        if(0 <= prev && prev < this.vertices.length){
          // the pointer better be different than self
          assert(j !== prev, 'Self-pointer before reaching end?');
          // we can use the pointer already
          j = prev;

        } else {
          // we must find the previous pointer by looking at the neighbors
          let minDist = Infinity;
          let minPtr  = MAX_UINT32;
          for(const [k, ] of this.neighborsOf(j)){
            const dist = this.dist.get(i, k, 0);
            if(dist < minDist){
              minDist = dist;
              minPtr = k;
            }
          }
          assert(Number.isFinite(minDist), 'Could not find direction');
          this.prev.set(i, j, 0, minPtr);
          j = minPtr; // go to lowest distance pointer
        }
        path.push(this.vertices[j]);
      }
      path.reverse(); // reverse path to expected order
    }
    return path;
  }

  *samplesBetween(ss, se, ctx = SKETCH, withDist = false){
    yield withDist ? [ss, 0] : ss;
    let prev = ss;
    for(const v of this.verticesBetween(ss, se)){
      if(v.matches(prev))
        continue; // co-located with previous sample
      else {
        // two different vertices!
        // => find smallest distance across matching
        //    family samples from the pair of vertices
        let minDist = Infinity;
        let minPair = null;
        for(const src of prev.family()){
          for(const trg of v.family()){
            if(src.layer !== trg.layer)
              continue; // not matching
            // matching!
            let d;
            if(withDist){
              if(ctx === LAYER)
                d = geom.distBetween(src, trg);
              else {
                d = geom.distBetween(
                  src.getSketchPos(), trg.getSketchPos()
                );
              }

            } else
              d = geom.sqDistBetween(src, trg); // can use squared distance
            if(d < minDist){
              minDist = d;
              minPair = [src, trg];
            }
          } // endfor trg
        } // endfor src
        assert(minPair, 'No same-layer pair found!');
        const [src, trg] = minPair;

        // yield source if a link sample of the previous one
        if(src.isBorder() && src.isLinkSample(prev))
          yield withDist ? [src, 0] : src;
        // else it's already been yielded in the past
        
        // yield target and remember as previous sample
        yield withDist ? [trg, minDist] : trg;
        prev = trg;
      } // endif v matches prev else
    } // endfor v
    
    // check for potential link crossing at the end
    if(prev.isBorder() && prev.isLinkSample(se))
      yield withDist ? [se, 0] : se;
    else {
      assert(prev.matches(se),
        'Must match, else we did not reach end');
    }
  }

  *pathBetween(ss, se, ctx, withDist = false, d0 = 0.0){
    checkContextArg(ctx);
    if(withDist){
      let dist = d0;
      let first = true;
      for(const [s, d] of this.samplesBetween(ss, se, ctx, true)){
        const { x, y } = s.getPos(ctx);
        dist += d;
        yield {
          x, y, layer: s.layer,
          sample: s, fromLink: !d && !first, dist
        };
        first = false;
      }
    } else {
      let past;
      for(const s of this.samplesBetween(ss, se, ctx, false)){
        const { x, y } = s.getPos(ctx);
        yield {
          x, y, layer: s.layer,
          sample: s, fromLink: past && s.matches(past)
        };
        past = s;
      }
    }
  }

  static sameFace(nhs, nhe){
    // must be in the same layer
    if(nhs.layer !== nhe.layer)
      return false;
    // sort by degree (higher to lower)
    if(nhs.degree < nhe.degree)
      [nhs, nhe] = [nhe, nhs];
    // depends on degrees
    if(nhs.degree >= 3){
      // source is a face
      if(nhe.degree >= 3){
        // target is a face (tri or quad)
        // => must be of the same degree and with same samples
        return nhs.degree === nhe.degree
            && nhe.samples.every(s => nhs.samples.includes(s));
        // nhs.areaId === nhe.areaId;

      } else if(nhe.degree === 2){
        // target is an edge
        // => both samples must be part of the source face
        return nhe.samples.every(s => nhs.samples.includes(s));

      } else {
        assert(nhe.degree === 1, 'Unexpected degree', nhe.degree);
        // target is a sample
        // => sample must be part of source face
        return nhs.samples.includes(nhe.baseSample);
      }

    } else if(nhs.degree === 2){
      // source is an edge
      // => target is either an edge or a sample
      const [source, target] = nhs.samples;
      const faces = Array.from(source.sharedRegions(target));
      if(nhe.degree === 2){
        // target is an edge
        // => both edges must be part of a common face
        return faces.some(f => nhe.samples.every(s => {
          return f.samples.includes(s); // face includes edge sample
        }));
      
      } else {
        assert(nhe.degree === 1, 'Unexpected degree', nhe.degree);
        // target is a sample
        // => sample must be part of common face with the edge
        return faces.some(f => f.samples.includes(nhe.baseSample));
      }

    } else {
      // source is a sample
      // => target also a sample, must be direct neighbors
      return nhs.baseSample.isDirectNeighbor(nhe.baseSample);
    }
  }

  queryBetween(ls, qs, le, qe, ctx, { k = 1, refine = false } = {}){
    checkContextArg(ctx);
    // get query neighborhoods
    const nhs = ls.query(qs, ctx, 1, true);
    const nhe = le.query(qe, ctx, 1, true);
    if(!nhs || !nhe){
      console.warn('Missing valid source or target neighborhood');
      return {};
    }

    // get start/end positions with layer information
    const ps = { layer: ls, x: qs.x, y: qs.y };
    const pe = { layer: le, x: qe.x, y: qe.y };

    // if in same neighborhood, use direct Euclidean distance
    let dist = Infinity;
    let samplePair;
    if(DistanceSampler.sameFace(nhs, nhe)){
      dist = geom.distBetween(ps, pe); // in the same face
    } else {
      // go over k-ring of each neighborhood samples
      // and compute minimum distance approximation
      const getSampleGroup = (nh) => {
        return nh.samples.flatMap(s => {
          const list = Array.from(s.extendedNeighbors(k));
          list.push(s);
          return list;
        });
      };
      const sources = getSampleGroup(nhs);
      const targets = getSampleGroup(nhe);
      for(const ss of sources){
        const ds = ss.distToPoint(ps, ctx);
        for(const se of targets){
          const baseDist = this.distBetween(ss, se, ctx);
          const de = se.distToPoint(pe, ctx);
          const newDist = ds + baseDist + de;
          if(newDist < dist){
            dist = newDist;
            samplePair = [ss, se]; // record pair
          }
        }
      }
      // if to be refined, or below threshold,
      // then refine using algorithm for exact distance
      if(refine || dist < this.getRefiningDistance(ctx)){
        return new RefinedDistanceQueryResult(this,
          [ps, samplePair[0], nhs],
          [pe, samplePair[1], nhe],
          ctx
        );
      }
    }
    assert(Number.isFinite(dist), 'No connected path?');
    return new DistanceQueryResult(this, ps, pe, dist, samplePair, ctx);
  }

  sketchQueryBetween(ls, qs, le, qe, params = {}){
    return this.queryBetween(ls, qs, le, qe, SKETCH, params);
  }
  layerQueryBetween(ls, qs, le, qe, params = {}){
    return this.queryBetween(ls, qs, le, qe, LAYER, params);
  }

  toData(){
    const data = {};
    for(const key in this){
      switch(key){
        // skip those
        case 'mesh':
        case 'vertices':
        case 'vertexIndex':
          continue;

        default:
          data[key] = this[key];
          break;
      }
    }
    return data;
  }
  loadData(data){
    for(const key in data){
      const value = data[key];
      switch(key){
        // special cases
        case 'dist':
        case 'link':
          this[key] = MeshGrid.fromData(value);
          break;
        
        // rest = direct copy
        default:
          this[key] = value;
          break;
      }
    }
    return this;
  }

  static fromData(mesh, data){
    const ds = new DistanceSampler(mesh, { precompute: false });
    ds.loadData(data);
    return ds;
  }
}

class DistanceQueryResult {
  constructor(parent, ps, pe, dist, samplePair, context){
    this.parent = parent;
    this.ps = ps;
    this.pe = pe;
    this.dist = dist;
    this.samplePair = samplePair;
    this.context = context;
  }
  get path(){
    if(this.samplePair){
      const [ss, se] = this.samplePair;
      return [
        this.ps,
        ...this.parent.pathBetween(ss, se, this.context),
        this.pe
      ];

    } else {
      return [ this.ps, this.pe ];
    }
  }
  get dpath(){
    if(this.samplePair){
      const [ss, se] = this.samplePair;
      const d0 = ss.distToPoint(this.ps, this.context);
      return [
        Object.assign({
          dist: 0
        }, this.ps),
        ...this.parent.pathBetween(ss, se, this.context, true, d0),
        Object.assign({
          dist: this.dist
        }, this.pe)
      ];

    } else {
      return [
        Object.assign({
          dist: 0
        }, this.ps),
        Object.assign({
          dist: this.dist
        }, this.pe)
      ];
    } // endif this.samplePair else
  }
}

module.exports = Object.assign(DistanceSampler, {
  FLOYD_WARSHALL,
  DIJKSTRA_FHEAP,
  DIJKSTRA_PHEAP,
  HEAT_METHOD,
  MODES: MODES.slice()
});