// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const rand = require('../../random.js');
const MeshGrid = require('../../ds/meshgrid.js');
const SparseGrid = require('../../ds/sparsegrid.js');
const PackedArray = require('../../ds/packedarray.js');
const Timer = require('../../timer.js');
const M = require('./constants.js');
const { GridSample, BorderSample } = require('./sample.js');
const Delaunator = require('delaunator');
const Constrainautor = require('@kninnug/constrainautor');

// constants
const NONE = 0;
const REGULAR = 1;
const INTERMEDIATE = 2;

/**
 * Piece of mesh raster element
 * associated with a single sketch.
 *
 * @param sketch the associated sketch
 * @param eta the sampling distance
 * @param fgrid the float grid, with channels x,y,u,v
 */
class MeshLayer {
  constructor(
    parent, level, index,
    sketch, extents, eta,
    constrSupport
  ){
    this.parent = parent;
    this.level = level;
    this.index = index;
    // assert(parent instanceof Mesh, 'Invalid parent');

    // irregular samples
    this.gridSamples = null; // SparseGrid<MeshSample>
    this.borderSamples = []; // [BorderSample]
    this.borderIndex = [];   // [{ start, end }]

    // sparse data
    this.errors = [];
    this.warnings = [];

    // traversal grid
    this.tlist = [];              // [{x,y}]
    this.dlist = [ this.tlist ];  // [[{x,y}]]
    this.rlist = null;            // [MeshSample]

    // time information
    this.minT = this.maxT = 0;
    this.tref = { x: -1, y: -1 }; // only within grid, not on borders!

    // sketch-based information
    if(!sketch)
      return;
    assert(eta > 0, 'Invalid eta value');
    this.sketch = sketch;
    this.eta = eta;
    // extents
    const { min, max } = extents;
    this.min = min;
    this.max = max;
    this.mean = geom.meanVector([min, max]);
    this.range = geom.axpby(1, max, -1, min);

    // grid sizes
    this.width  = Math.ceil((max.x - min.x) / eta);
    this.height = Math.ceil((max.y - min.y) / eta);

    // constraint support
    this.constraintSupport = constrSupport || 1;

    this.timer = Timer.create();
  }

  allocate(){
    this.timer.restart();

    // allocate grid and border data

    // grid data
    // - float: k, u, v, t
    this.fgrid = new MeshGrid(
      this.width, this.height, 4, MeshGrid.F32
    );
    this.fgrid.fill(M.K, 1.0);
    this.fgrid.fill(M.T, NaN);
    // grid samples
    this.gridSamples = new SparseGrid(this.width, this.height);

    // timing
    this.timer.measure('alloc');

    // linear border samples
    this.getBorderData();
    this.timer.measure('border');
  }

  initialize(verbose = false){
    this.timer.restart();

    // populate u, v, nh
    // + initial constraint data mask
    const img = this.getRasterData();
    this.timer.measure('raster');

    // border sample initialization
    this.initializeSamples();
    this.timer.measure('sampinit');

    // populate boundary data (nh+seg => boundary samples)
    this.getBoundaryData(img);
    this.timer.measure('boundary');

    // populate constraint data
    this.getConstraintData(img);
    this.timer.measure('constr');

    // show timing
    if(verbose)
      console.log('layer #' + this.sketch.id + '/' + this.level, this.timer.toString());
  }

  check(){
    // check border sample bijectivity
    for(const sample of this.borderSamples){
      for(const lsample of sample.linkSamples){
        assert(lsample.isLinkSample(sample),
          'Border sample has non-bijective link');
      }
    }
    // check general neighbor bijectivity
    for(const sample of this.samples()){
      // direct neighborhood
      for(const nsample of sample.directNeighbors()){
        assert(nsample.isDirectNeighbor(sample),
          'Unidirectional direct neighbor?');
      }
      // indirect neighborhood
      for(const [nsample, lsample] of sample.neighbors()){
        assert(nsample.isDirectNeighbor(lsample),
          'Unidirectional direct neighbor across links');
      }
    }
  }

  getBuffers(){
    return [this.fgrid.data.buffer, this.bdata.buffer];
  }

  toData(){
    const obj = {};
    for(const key in this){
      switch(key){
        case 'sketch':
          obj[key] = this.sketch.id;
          break;

        case 'rlist':
        case 'parent':
          continue; // skip temporary or pointer-based data

        case 'borderSamples':
          obj[key] = this.borderSamples.map(s => s.toData());
          break;

        case 'gridSamples':
          obj[key] = Array.from(this[key].values(), s => {
            return s.toData();
          });
          break;

        default:
          obj[key] = this[key]; // including MeshGrid instances
          break;
      }
    }
    return obj;
  }

  loadData(data, keepSketch){
    for(const key in data){
      switch(key){

        case 'fgrid':
          this[key] = data[key] ? MeshGrid.fromData(data[key]) : null; // mesh grid instances
          break;

        case 'bdata':
          this[key] = data[key] ? PackedArray.fromData(data[key]) : null;
          break;

        case 'sketch':
          this[key] = typeof data[key] == 'number' || keepSketch ? data[key] : data[key].id; // only transfer id
          break;

        case 'borderSamples':
          this[key] = data[key].map(sData => {
            return BorderSample.fromData(this, sData);
          });
          break;

        default:
          this[key] = data[key]; // direct copy of the rest
          break;
      }
    }

    // load full grid samples
    this.gridSamples = new SparseGrid(this.width, this.height);
    for(const sData of data.gridSamples) // first, allocate all samples
      this.gridSamples.set(sData.y, sData.x, GridSample.fromData(this, sData));
    for(const sData of data.gridSamples) // then, load the data (connections)
      this.gridSamples.get(sData.y, sData.x).loadData(sData);

    // load full data for border samples
    for(let i = 0; i < data.borderSamples.length; ++i)
      this.borderSamples[i].loadData(data.borderSamples[i]);

    return this;
  }

  remapData(map){
    this.sketch = map(this.sketch);
    return this;
  }

  initializeSamples(){
    // initialize links of border samples
    // /!\ requires allocated samples across layers
    for(const sample of this.borderSamples)
      sample.initialize();
    return this;
  }

  crossInitializeSamples(){
    // initialize indirect links of border samples
    // /!\ requires initialized samples across layers
    for(const sample of this.borderSamples)
      sample.crossInitialize();
    return this;
  }

  copy(parent, level, index){
    const layer = new MeshLayer(parent, level || 0, index || 0);
    layer.loadData(this, true);
    // create mesh grid copies
    for(let key of ['fgrid', 'bdata']){
      if(layer[key])
        layer[key] = layer[key].copy();
    }
    return layer;
  }

  getBorderData(){
    let i = 0;
    for(let segIdx = 0; segIdx < this.sketch.segLength; ++segIdx){
      const segment = this.sketch.getSegment(segIdx);
      const segLength = segment.length();
      // compute number of samples (may depend on other link side)
      let numSamples;
      const link = this.sketch.getLink(segIdx);
      if(link){
        const linkSegment = link.getOtherSegment();
        const linkSegLength = linkSegment.length();
        numSamples = Math.ceil(
          Math.max(segLength, linkSegLength) / this.eta
        ) || 1;
      } else {
        numSamples = Math.ceil(segLength / this.eta) || 1;
      }
      const p0 = this.sketchToGrid(segment.get(0));
      const i0 = i++;
      // note: first sample shares two segments (previous and current)
      const prevSeg = segIdx === 0 ? this.sketch.segLength - 1 : segIdx - 1;
      this.borderSamples.push(
        new BorderSample(this, p0.y, p0.x, [
          prevSeg, segIdx
        ], [1, 0], i0, 0)
      );
      const dt = 1 / numSamples;
      for(let j = 1; j < numSamples; ++j, ++i){
        const t = dt * j;
        const p = this.sketchToGrid(segment.get(t));
        this.borderSamples.push(
          new BorderSample(this, p.y, p.x, [segIdx], [t], i, j)
        );
      }

      // build index
      assert(i-1 >= i0, 'Invalid index entry');
      this.borderIndex.push({
        start: i0,
        end: i - 1
      });
    }

    // linear border data
    // - float: u, v, t
    this.bdata = new PackedArray([
      [M.K, PackedArray.F32],
      [M.U, PackedArray.F32],
      [M.V, PackedArray.F32],
      [M.T, PackedArray.F32]
    ], i, true);
    const withDir = this.parent.hasDirectionalConstraint();
    this.bdata.fill([
      1.0, // default curvature
      0.0, // default u
      withDir ? 0.0 : -1.0, // default v
      NaN // default time
    ]);
  }

  getRasterData(computeChildRaster = this.constraintRaster.bind(this)){
    const eta = this.eta;
    assert(eta, 'Missing eta value');
    const canvas = document.createElement('canvas');
    canvas.width = this.fgrid.width;
    canvas.height = this.fgrid.height;
    // XXX switch to OffscreenCanvas with web worker when possible
    const ctx = canvas.getContext('2d', { alpha: false });

    // init: (minX,minY) -> (minX,minY)
    //       (maxX,maxY) -> (maxX,maxY)
    //
    // note: transformPoint =
    //          [sx, 0, dx] [x] = [sx*x+dx]
    //          [0, sy, dy] [y]   [sy*y+dy]
    //          [0,  0,  1] [1]   [   1   ]
    //
    // translate(a, b) => dx += sx * a
    //                    dy += sy * b
    //
    // scale(a, b) => sx *= a
    //                sy *= b
    //
    // final: (minX,minY) -> (0,0)
    //        (maxX,maxY) -> (width,height)
    //
    // with  width  = (maxX - minX) / eta
    //       height = (maxY - minY) / eta
    //

    // normal case
    const dc = 0; // global shift
    if(!this.sketch.transform.mirrorX){
      /*
      X side, unknowns sx+dx:
      (a) minX*sx+dx = 0
      (b) maxX*sx+dx = width-1
      (b)-(a) = (maxX-minX)*sx = width-1
         => sx=(width-1)/(maxX-minX)
         => dx=-minX*sx=-minX*(width-1)/(maxX-minX)

      Y side, unknowns sy+dy:
      ... similarly
         => sy=(height-1)/(maxY-minY)
         => dy=-minY*sy=-minY*(height-1)/(maxY-minY)
      */
      // or from (0,0) to (width,width):
      // sx = 1/eta
      // sy = 1/eta
      // dx = -min.x/eta = -min.x*sx
      // dy = -min.y/eta = -min.y*sy
      //
      // check: (minX,minY) -> (minX/eta - minX/eta, minY/eta - minY/eta) = (0,0)
      //        (maxX,maxY) -> (maxX/eta - minX/eta, maxY/eta - minX/eta) = (width,height)
      //
      const sx = this.width/ this.range.x; // (this.width - 1) / this.range.x;  // instead of 1/eta
      const dx = dc - this.min.x * sx;
      const sy = this.height / this.range.y; // (this.height - 1) / this.range.y; // instead of 1/eta
      const dy = dc - this.min.y * sy;
      ctx.setTransform(sx, 0, 0, sy, dx, dy);

    } else {
      // in this case, we want instead
      // final: (minX,minY) -> (width,0)
      //        (maxX,maxY) -> (0,height)
      //        (maxX,minY) -> (0,0)
      // with a sx negative for mirrorX
      //
      // /!\ intuitively, the scale is the same, except for the sign of sx
      // so we just need to get the correct shifts
      //
      //
      // sx = -1/eta
      // sy = 1/eta
      // dx = max.x/eta  = -max.x*sx
      // dy = -min.y/eta = -min.y*sy 
      //
      // check: (minX,minY) -> (-minX/eta + maxX/eta, minY/eta - minY/eta) = (width,0)
      //        (maxX,maxY) -> (-maxX/eta + maxX/eta, maxY/eta - minY/eta) = (0,height)
      //        (maxX,minY) -> (0,0)
      const sx = -this.width / this.range.x; // -(this.width - 1) / this.range.x;
      const dx = dc - this.max.x * sx;
      const sy = this.height / this.range.y; // (this.height - 1) / this.range.y;
      const dy = dc - this.min.y * sy;
      ctx.setTransform(sx, 0, 0, sy, dx, dy);
    }

    // at this point, drawing from min to max
    // should end up within [0;width-1]x[0;height-1]
    ctx.fillStyle = '#FFFFFF';
    this.sketch.drawPath(ctx);
    ctx.fill();

    // clip region to draw constraints
    constraints: {
      ctx.clip();
      // draw child data
      if(computeChildRaster)
        computeChildRaster(ctx);
    }

    // draw edges with gray color (=> intermediary samples)
    /*
    ctx.strokeStyle = '#FF99FF';
    ctx.lineWidth = eta;
    for(let segIdx = 0; segIdx < this.sketch.segLength; ++segIdx){
      this.sketch.drawSegment(ctx, segIdx);
    }
    ctx.stroke();
    */

    // extract image data
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  constraintRaster(ctx){
    const eta = this.eta;
    for(const constr of this.sketch.constraints){
      const transform = constr.target.transform;
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.kx, transform.ky);
      ctx.lineWidth = eta * this.constraintSupport * 2 / transform.k;
      ctx.strokeStyle = '#00FFFF';
      constr.target.drawPath(ctx);
      ctx.stroke();
      ctx.restore();
    }
  }

  getBoundaryData(raster){
    const t = this.timer.subtimer('bnd');

    const rasterOccupancy = (y, x) => {
      const index = (y * raster.width + x) * 4;
      return raster.data[index + 1]; // green (could also use blue = +2)
    };

    // segment map
    const segMap = new Map(); // Map<y/x, [{segIdx,proj}]
    const getSegments = (y, x) => {
      const key = [y, x].join('/');
      if(!segMap.has(key)){
        const p = this.pointAt(y, x);
        const list = this.sketch.getNearbySegments(p, this.eta * Math.SQRT2, true);
        segMap.set(key, list);
      }
      return segMap.get(key);
    };
    const getSegProj = (y, x) => {
      return getSegments(y, x).find(({closest}) => closest) || {};
    };

    // build approximation polygon
    const poly = [];
    for(let segIdx = 0; segIdx < this.sketch.segLength; ++segIdx){
      const { start, end } = this.borderIndex[segIdx];
      // always add first segment sample
      const b0 = this.borderSamples[start];
      poly.push(b0.getLayerPos());
      // only add more points if in need of approximation
      if(this.sketch.getDegree(segIdx) > 1){
        // add remaining border samples
        for(let i = start + 1; i <= end; ++i){
          const b = this.borderSamples[i];
          poly.push(b.getLayerPos());
        }
      }
    } // endfor segIdx < sketch.segLength
    t.measure('poly');

    // occupancy pass 1 ------------------------------------------------------
    const occupancy = new MeshGrid(this.width, this.height, 1, 'u8');
    // = remove false positives due to alignment
    for(let y = 0; y < raster.height; ++y){
      for(let x = 0; x < raster.width; ++x){

        // get occupancy information from raster data
        const occ = rasterOccupancy(y, x);
        if(!occ){
          // outside => invalid
          continue;

        } else if(occ !== 0xFF){
          // check non-full regions as they could be invalid "inside"
          // due to the discretization at the boundaries
          // => find closest segment
          const { segIdx, proj } = getSegProj(y, x);
          if(proj){
            // and check whether delta to projection is on correct sketch side
            // by comparing it with the segment outward normal
            const seg = this.sketch.getSegment(segIdx);
            const n = seg.normal(proj.t, true);
            const d = geom.axpby(1, this.pointAt(y, x), -1, proj);
            const isInward  = this.sketch.isInward();
            const isAligned = geom.dot(n, d) >= 0;
            if(isInward !== isAligned){
              // outside sketch!
              continue;
            }
          }
          // else, no need to check for projection
          // since the segment is too far
        }
        occupancy.set(y, x, 0, REGULAR);
      }
    }
    t.measure('occ1');

    // neighborhood computation (based on occupancy)
    const getNH = (y, x, nlist = M.N8) => {
      let nh = 0;
      for(const { dx, dy, mask } of nlist){
        const nx = x + dx;
        const ny = y + dy;
        if(nx < 0 || nx >= raster.width
        || ny < 0 || ny >= raster.height)
          continue; // skip because outside
        if(occupancy.get(ny, nx, 0)){
          nh |= mask;
        }
      } // endfor nhood
      return nh;
    };
    const isIntermediate = nh => (nh & M.N4_MASK) !== M.N4_MASK;
    // initialize flow if parent has no directional constraint
    const initFlow = !this.parent.hasDirectionalConstraint();

    // occupancy pass 2 ------------------------------------------------------
    // = remove intermediate cells that are too close from segments
    for(let y = 0; y < raster.height; ++y){
      for(let x = 0; x < raster.width; ++x){
        if(!occupancy.get(y, x, 0))
          continue; // skip invalid cells

        // get current neighborhood
        const nh4 = getNH(y, x, M.N4);
        const occ = rasterOccupancy(y, x);

        // for intermediate cases, check that they are not too close
        // to their corresponding border
        if(isIntermediate(nh4) || occ < 0xFF){
          const pos = this.pointAt(y, x);
          const { proj } = getSegProj(y, x);
          if(proj){
            const dist = geom.distBetween(pos, proj);
            if(dist < 0.25 * this.eta){
              // too close => discard
              occupancy.set(y, x, 0, NONE);
              continue;
            }
          }

          // extra caution: test whether inside polygon approximation
          if(!geom.polyContains(poly, { x, y })){
            // outside polygon => discard
            occupancy.set(y, x, 0, NONE);
            continue;
          }
        }

        // add to traversal list (valid occupancy)
        this.tlist.push({ x, y });
        this.gridSamples.set(y, x, new GridSample(this, y, x));

        // flow initialization when no direction constraint available
        if(initFlow){
          // assume flow goes towards the top
          this.fgrid.set(y, x, M.U, 0);
          this.fgrid.set(y, x, M.V, -1);
        }
      }
    }
    t.measure('occ2');

    // sample triangulation --------------------------------------------------
    const samples = Array.from(this.samples()); // only regular + border
    const del = Delaunator.from(samples, s => s.x, s => s.y);
    t.measure('dt');

    // constrain border ------------------------------------------------------
    if(this.parent.robustMeshing){
      const con = new Constrainautor(del);
      const borderStart = samples.length - this.borderSamples.length;
      const edges = Array.from({ length: this.borderSamples.length }, (_, i) => {
        if(i + 1 < this.borderSamples.length)
          return [borderStart + i, borderStart + i+1];
        else
          return [borderStart + i, borderStart];
      }); // only keep disjoint half
      try {
        con.constrainAll(edges.slice());
        
      }catch(err){
        console.warn('Constraining error, sketch='
        + this.sketch.id + ', level=' + this.level);
        console.log('points=[' + samples.map(s => '[' + s.x + ', ' + s.y + ']').join(', ') + '];');
        console.log('edges=[' + edges.map(e => '[' + e[0] + ', ' + e[1] + ']').join(', ') + '];');
      }
      t.measure('econ');
    }

    // get triangle list
    const { triangles } = del;

    // mark intermediate and connect -----------------------------------------
    const regulars = [];
    const others = [[1,2], [2,0], [0,1]];
    const isBorderHalfEdgeInside = (b1, b2) => {
      // use ordering to infer whether inside or outside
      const sketchCCW  = this.sketch.isCCW();
      const likeSketch = b1.nextSample === b2;
      assert(likeSketch || b1.prevSample === b2,
        'Adjacent neighbors are not valid');
      // two options for being inside
      // i) sketch is CCW, and half-edge matches sketch order
      // ii) sketch is CW, and half edge does not match sketch order
      //     because then the reverse order is CW (like the sketch)
      return sketchCCW === likeSketch;
    };
    const areAdjacentBorderSamples = (bs1, bs2) => {
      return bs1.nextSample === bs2
          || bs1.prevSample === bs2;
    };
    for(let i = 0; i < triangles.length; i += 3){
      // note: triangle is in CCW order
      const is = [
        triangles[i + 0], triangles[i + 1], triangles[i + 2]
      ];
      const ts = [
        samples[is[0]], samples[is[1]], samples[is[2]]
      ];
      // get triangle information
      const bs = new Set(ts.filter(s => s.isBorder()));
      const borderCount = bs.size;
      
      // filter collapsed triangle
      const triArea = geom.area(ts.map(s => s.getLayerPos()));
      if(triArea < 1e-3){
        // we should skip such triangle!
        // /!\ those should only happen as border-border-border
        assert(borderCount === 3,
          'Collapsed triangle to the inside?');
        continue;
      }

      // action depends on border count
      switch(borderCount){

        // border-border-border
        case 3: {
          // can be inside or outside
          // - inside  => add non-adjacent border connections
          // - outside => ignore triangle
          // 1 = look for adjacent samples
          let adj;
          for(const [s1, s2] of geom.circularPairs(ts)){
            if(areAdjacentBorderSamples(s1, s2)){
              adj = [s1, s2];
              break;
            }
          }
          // 2 = get inside/outside information
          let inside = true;
          if(adj){
            const [s1, s2] = adj;
            inside = isBorderHalfEdgeInside(s1, s2);

          } else {
            // check whether any mid-point is outside
            for(const [s1, s2] of geom.circularPairs(ts)){
              const p = geom.axpby(
                0.5, s1.getLayerPos(),
                0.5, s2.getLayerPos()
              );
              if(!geom.polyContains(poly, p)){
                inside = false; // proof we're outside!
                break; // only need one occurrence
              }
            }
          }
          // 3 = if inside, then connect border samples
          if(inside){
            ts[0].addNeighbors(ts[1], ts[2]);
            ts[1].addNeighbor(ts[2]);
          }

        } break;

        // border-border-intermediate (2)
        // border-intermediate-intermediate (1)
        case 2: {
          // border-border-intermediate
          // if two borders are adjacent, check
          // whether the triangle has valid orientation
          
          let [b1, b2] = bs;
          if(areAdjacentBorderSamples(b1, b2)){
            // ensure same order as in triangle
            // [b1, b2, ?] => no change
            // [?, b1, b2] => no change
            // [b1, ?, b2] => change!
            if(!ts[1].isBorder())
              [b1, b2] = [b2, b1]; // because initially [b1, ?, b2]
            if(!isBorderHalfEdgeInside(b1, b2))
              break; // skip triangle since outside
          }
          
        } /* falls through */
        case 1: {
          let inside = true;
          triangleInter:
          for(let idx = 0; idx < 3; ++idx){
            if(ts[idx].isBorder())
              continue;
            // else it is not a border sample
            // => search for intersection with border
            for(const nidx of others[idx]){
              for(const b of bs){
                if(ts[nidx] === b)
                  continue; // need other for intersection test
                for(const nb of [b.nextSample, b.prevSample]){
                  if(bs.has(nb))
                    continue; // skip border-border-intermediate case
                  if(geom.segInterSegment(
                    [ts[idx], ts[nidx]],
                    [b, nb]
                  )){
                    // triangle is outside
                    inside = false;
                    break triangleInter;
                  }
                } // endfor nb of b.segmentNeighbors
              } // endfor b of bs
            } // endfor nidx of others[idx]
          } // endfor idx < 3
          if(!inside)
            break; // skip triangle
          
          // check if not intersecting border
          // - add 2/1 border-intermediate connections
          // - add 1/2 border-border connection if not adjacent
          // 1) Make non-border samples intermediate samples
          for(let idx = 0; idx < 3; ++idx){
            if(!ts[idx].isBorder() && !ts[idx].isIntermediate()){
              // make intermediate sample
              const s = ts[idx].asIntermediateSample();
              occupancy.set(s.y, s.x, 0, INTERMEDIATE);
              this.gridSamples.set(s.y, s.x, s);
              // update current arrays
              samples[triangles[i + idx]] = s;
              ts[idx] = s;
            }
          }
          // 2) Add neighbors (0->1+2 and 1->2)
          ts[0].addNeighbors(ts[1], ts[2]);
          ts[1].addNeighbor(ts[2]);
        } break;

        // regular/intermediate triangle
        case 0: {
          // if fully regular, then nothing to do
          // otherwise, we must add intermediate connections
          // /!\ but we don't know that at this stage yet
          // => just remember triangle, and go over those
          //    after the nh+intermediate pass is done
          regulars.push(is);
        } break;
      }
    }
    // go over regular triangles and add connections
    // to any intermediate sample that might have been created
    // unless this connection is across a regular quad neighborhood
    for(const is of regulars){
      const ts = is.map(i => samples[i]);
      for(const s of ts){
        if(s.isRegular())
          continue; // skip regular samples
        assert(s.isIntermediate(), 'Border sample in regular triangle');

        // possibly add two connections
        for(const n of ts){
          if(n === s)
            continue; // skip self
          // check whether neighbor is at a diagonal
          // that crosses a regular quad
          // => in that case, do not add
          if(n.x !== s.x
          && n.y !== s.y
          && occupancy.get(n.y, s.x, 0) !== NONE
          && occupancy.get(s.y, n.x, 0) !== NONE){
            // this is a diagonal with valid off-diagonals
            // => crosses a regular quad neighborhood
            continue; // skip connection
          }
          // else, we add the connection
          s.addNeighbor(n);
        } // endfor n of ts
      } // endfor s of ts
    } // endfor is of regulars
    t.measure('edges');

    // copy middle point of tlist as time reference
    if(this.index == 0){
      if(this.tlist.length)
        this.tref = Object.assign({}, this.tlist[Math.floor(this.tlist.length / 2)]);
      else
        this.tref = this.borderSamples[0].getLayerPos(); // in case no inner sample
    }
  }

  getConstraintData(raster){
    const checkConstr = (y, x) => {
      const index = (y * raster.width + x) * 4;
      return raster.data[index] < 0xFF;
    };
    const children = this.sketch.constraints.flatMap((constr, index) => {
      const curve = constr.target;
      if(curve.type === 'pcurve' && !curve.isComplete())
        return []; // an incomplete (or invalid) PCurve = skip
      const segments = [];
      const bboxes = [];
      for(let i = 0; i < curve.segLength; ++i){
        const seg = curve.getSegment(i);
        segments.push(seg);
        const bbox = seg.bbox(); // as { x: {min,max}, y: {min,max} }
        const min = { x: bbox.x.min, y: bbox.y.min };
        const max = { x: bbox.x.max, y: bbox.y.max };
        // transform bbox to sketch context
        // as { min: {x,y}, max: {x,y} }
        const tbbox = {
          min: curve.localToParent(min),
          max: curve.localToParent(max)
        };
        bboxes.push(tbbox);
        // special case for mirrorX
        if(this.sketch.transform.mirrorX){
          // update bbox minX/maxX
          const x1 = tbbox.min.x;
          const x2 = tbbox.max.x;
          tbbox.min.x = Math.min(x1, x2);
          tbbox.max.x = Math.max(x1, x2);
        }
      }
      return [{
        curve, index, segments, bboxes
      }];
    });

    // range delta
    const delta = this.eta * this.constraintSupport;

    // curvature data
    const kdata = this.sketch.kappas.map(k => {
      return {
        k: k.kappa,
        alpha: k.alpha, // in sketch units
        pos: k.getPosition() // in sketch units
      };
    });

    // query for closest constraint
    for(const sample of this.samples()){

      // get sketch location
      const q_sketch = sample.getSketchPos();

      // set curvature data
      let kSum = 0.0;
      let wSum = 0.0;
      for(const { k, alpha, pos } of kdata){
        const d = geom.distBetween(pos, q_sketch);
        if(d <= alpha){
          const w = alpha / d;
          kSum += k * w;
          wSum += w;
        }
      }
      if(wSum > 0.0){
        const k = kSum / wSum;
        assert(!isNaN(k) && k > 0, 'Invalid curvature');
        if(!isNaN(k))
          sample.setKappa(Math.max(1e-3, Math.min(10, k)));
      } else {
        assert(sample.kappa() === 1.0, 'Invalid default curvature');
      }

      // extract location
      const { y, x } = sample;

      // check if point of interest from initial constraint map
      if(!sample.isBorder() && !checkConstr(y, x))
        continue; // no constraint nearby

      // find closest child curve's segment
      // while avoiding queries based on bbox
      for(const { curve, index, segments, bboxes } of children){
        for(let i = 0; i < segments.length; ++i){
          // skip if outside of bbox
          if(geom.outsideBBox(q_sketch, bboxes[i], delta))
            continue;
          // check distance
          // - go into curve context
          const q_curve = curve.parentToLocal(q_sketch);
          // - project onto curve
          const p_curve = segments[i].project(q_curve);
          // - go back into sketch context
          const p_sketch = curve.localToParent(p_curve);
          // - compute distance
          const d = geom.distBetween(p_sketch, q_sketch);
          if(d < delta){
            sample.addConstraint(index, i, this.constraintSupport);
          }
        } // endfor i < #segments
      } // endfor child
    } // endfor sample
  }

  getInnerList(colwise = false, yinv = false, xinv = false){
    const list = [];
    const [xs, xe, xdir] = xinv ? [this.width - 1, 0, -1] : [0, this.width - 1, 1];
    const [ys, ye, ydir] = yinv ? [this.height - 1, 0, -1] : [0, this.height - 1, 1];
    if(colwise){
      for(let x = xs; x !== xe; x += xdir){
        for(let y = ys; y !== ye; y += ydir){
          if(this.isValid(y, x))
            list.push({ x, y });
        }
      }
      
    } else {
      for(let y = ys; y !== ye; y += ydir){
        for(let x = xs; x !== xe; x += xdir){
          if(this.isValid(y, x))
            list.push({ x, y });
        }
      }
    }
    return list;
  }

  *innerSamples(traversalType = 0){
    const ind = traversalType % 8;
    if(!this.dlist[ind]){
      // 0bXYZ
      // X = xinv
      // Y = yinv
      // Z = colwise
      this.dlist[ind] = this.getInnerList(
        ind & 0b001, ind & 0b010, ind & 0b100
      );
    }
    const list = this.dlist[ind];
    for(let i = 0; i < list.length; ++i)
      yield this.getSample(list[i].y, list[i].x);
  }

  *samples(traversalType = 0){
    if(typeof traversalType === 'number'){
      // go over grid samples
      yield *this.innerSamples(traversalType);

      // go over border samples
      yield *this.borders(traversalType % 2 === 1);

    } else {
      // if no list yet, create initial traversal list
      if(!this.rlist)
        this.rlist = Array.from(this.samples()); // note: includes borders
      
      // inline online shuffling
      yield *rand.shuffled(this.rlist);
    }
  }
  *vertices(traversalType = 0){
    yield *this.innerSamples(traversalType);
    yield *this.borderVertices(traversalType % 2 === 1);
  }
  *borders(backward = false){
    if(backward){
      // backward
      for(let i = this.borderSamples.length - 1; i >= 0; --i)
        yield this.borderSamples[i];
    } else {
      // forward
      for(let i = 0; i < this.borderSamples.length; ++i)
        yield this.borderSamples[i];
    }
  }
  *borderVertices(backward = false){
    if(backward){
      // backward
      for(let i = this.borderSamples.length - 1; i >= 0; --i){
        if(this.borderSamples[i].isVertex())
          yield this.borderSamples[i];
      }
    } else {
      // forward
      for(let i = 0; i < this.borderSamples.length; ++i){
        if(this.borderSamples[i].isVertex())
          yield this.borderSamples[i];
      }
    }
  }

  isValid(yi, xi){ return this.gridSamples.has(yi, xi); }

  getSample(yi, xi, requiresIntermediate = false){
    const sample = this.gridSamples.get(yi, xi);
    if(!sample){
      assert(!requiresIntermediate, 'Missing intermediate sample', yi, xi);
      return null;
    } else {
      assert(!requiresIntermediate || sample.isIntermediate(),
        'Grid sample is a regular sample');
      return sample;
    }
  }

  getBorderSample(segIdx, alpha){
    assert(geom.between(alpha, 0, 1), 'Invalid alpha value', alpha);
    // take care of alpha=1
    if(alpha === 1){
      segIdx += 1;
      alpha = 0;
    }
    // correct segIdx
    if(segIdx < 0)
      segIdx += this.borderIndex.length;
    else if(segIdx >= this.borderIndex.length)
      segIdx -= this.borderIndex.length;
    // get index bounds
    const { start, end } = this.borderIndex[segIdx];
    const steps = end + 1 - start;
    const i = start + Math.round(steps * alpha);
    const sample = this.borderSamples[i];
    assert(sample.alphas.some(a => geom.approximately(alpha, a)),
      'Border sample does not match alpha value');
    return sample;
  }

  query(q, context, r = 1, project = false){
    if(context === M.SKETCH)
      q = this.sketchToGrid(q);
    else
      assert(context === M.LAYER, 'Invalid context', context);
    const yi = Math.round(q.y);
    const xi = Math.round(q.x);

    let nh;
    if(this.isValid(yi, xi)){
      // return neighborhood around this cell
      // by using the sample that lives here
      const sample = this.getSample(yi, xi);
      assert(sample, 'Missing sample at valid cell?');
      nh = sample.query(q);

    } else {
      // search in block defined by r around here
      let closestSample = null;
      let closestDist = Infinity;
      for(let dy = -r; dy <= r; ++dy){
        for(let dx = -r; dx <= r; ++dx){
          const n = { x: xi + dx, y: yi + dy };
          if(!this.isValid(n.y, n.x))
            continue;
          const dist = geom.distBetween(q, n); // in layer domain
          if(dist < closestDist){
            closestSample = this.getSample(n.y, n.x);
            closestDist = dist;
          }
        } // endfor dx
      } // endfor dy
      nh = closestSample ? closestSample.query(q) : null;
    } // endif

    // check if no need for projection
    if(nh && !nh.someBorder())
      return nh;
    
    // potential projection to closer border sample
    if((!nh || nh.projected) && project){
      let closestSample;
      let closestSqDist = Infinity;
      for(const sample of this.borderSamples){
        const sqDist = geom.sqDistBetween(q, sample.getLayerPos());
        if(sqDist < closestSqDist){
          closestSqDist = sqDist;
          closestSample = sample;
        }
      }
      assert(closestSample, 'No closest border sample');
      const nhProj = closestSample.query(q);
      // check that it's closer to any previous solution
      if(nh){
        // pick closest solution
        const oriSqD = geom.sqDistBetween(q, nh.getLayerPos());
        if(geom.sqDistBetween(q, nhProj.getLayerPos()) < oriSqD)
          nh = nhProj;

      } else {
        nh = nhProj;
      }
    }
    return nh;
  }
  sketchQuery(q, r = 1, p = false){ return this.query(q, M.SKETCH, r, p); }
  layerQuery(q, r = 1, p = false){ return this.query(q, M.LAYER, r, p); }

  isLastLevel(){
    return this.level == this.parent.levels.length - 1;
  }

  sketchToGridX(x, mirrorX = this.sketch.transform.mirrorX){
    // transformation from sketch context
    // to grid context
    const dc = 0.0;
    if(mirrorX){
      if(this.width > 1){
        return dc + (this.max.x - x) / this.range.x * (this.width - 1);
      } else {
        return dc + (this.mean.x - x) / this.range.x;
      }
    } else {
      if(this.width > 1){
        return dc + (x - this.min.x) / this.range.x * (this.width - 1);
      } else {
        return dc + (x - this.mean.x) / this.range.x;
      }
    }
  }

  sketchToGridY(y){
    const dc = 0.0;
    if(this.height > 1)
      return dc + (y - this.min.y) / this.range.y * (this.height - 1);
    else
      return dc + (y - this.mean.y) / this.range.y;
  }

  sketchToGrid({ x, y }){
    return {
      x: this.sketchToGridX(x),
      y: this.sketchToGridY(y)
    };
    // transformation from sketch context
    // to grid context
    /*
    const dc = 0.0;
    return this.sketch.transform.mirrorX ? {
      x: dc + (this.max.x - x) / (this.max.x - this.min.x) * (this.width - 1),
      y: dc + (y - this.min.y) / (this.max.y - this.min.y) * (this.height - 1)
    } : {
      x: dc + (x - this.min.x) / (this.max.x - this.min.x) * (this.width - 1),
      y: dc + (y - this.min.y) / (this.max.y - this.min.y) * (this.height - 1)
    };
    */
  }

  pointAt(yi, xi){
    return this.gridToSketch({ x: xi, y: yi });
  }

  gridToSketchX(xi, mirrorX = this.sketch.transform.mirrorX){
    // transformation from sketch context
    // to grid context
    const dc = 0.0;
    if(mirrorX){
      if(this.width > 1){
        return this.max.x - (xi-dc) * this.range.x / (this.width - 1);
      } else {
        return this.mean.x - (xi-dc) * this.range.x;
      }
    } else {
      if(this.width > 1){
        return this.min.x + (xi-dc) * this.range.x / (this.width - 1);
      } else {
        return this.mean.x + (xi-dc) * this.range.x;
      }
    }
  }

  gridToSketchY(yi){
    const dc = 0.0;
    if(this.height > 1)
      return this.min.y + (yi-dc) * this.range.y / (this.height - 1);
    else
      return this.mean.y + (yi-dc) * this.range.y;
  }

  gridToSketch({ x: xi, y: yi }){
    // (0,0) goes to 
    // - mirror  = maxX,minY  (on the top-left)
    // - default = minX,minY  (on the top-left)
    // (w,h) goes to
    // - mirror  = minX,maxY  (on the bot-right)
    // - default = maxX,maxY  (on the bot-right)
    return {
      x: this.gridToSketchX(xi),
      y: this.gridToSketchY(yi)
    };
    /*
    const dc = 0.0;
    return this.sketch.transform.mirrorX ? {
      x: this.max.x - (xi-dc) * (this.max.x - this.min.x) / (this.width - 1),
      y: this.min.y + (yi-dc) * (this.max.y - this.min.y) / (this.height - 1)
    } : {
      x: this.min.x + (xi-dc) * (this.max.x - this.min.x) / (this.width - 1),
      y: this.min.y + (yi-dc) * (this.max.y - this.min.y) / (this.height - 1)
    };
    */
  }

  visualizeFlow(blobCallback, clearInvalid = true){
    const colors = require('../../ui/colors.js');
    const isValid = clearInvalid ? vecIdx => {
      const [y, x,] = this.fgrid.pos(vecIdx);
      return this.isValid(y, x) > 0;
    } : () => true;
    return this.fgrid.visualize(([u,v,], vecIdx) => {
      if(isValid(vecIdx))
        return colors.getFlowColor(u, v, true, 0xFF);
      else
        return [0xFF, 0xFF, 0xFF, 0x00];
    },blobCallback);
  }

  visualizeTime(blobCallback, clearInvalid = true){
    const colors = require('../../ui/colors.js');
    const isValid = clearInvalid ? vecIdx => {
      const [y, x,] = this.fgrid.pos(vecIdx);
      return this.isValid(y, x) > 0;
    } : () => true;
    return this.fgrid.visualize(([,,t], vecIdx) => {
      if(!isValid(vecIdx))
        return [0xFF, 0xFF, 0xFF, 0x00];
      else if(isNaN(t))
        return [0x00, 0x00, 0x00, 0xFF]; // mark as special for debug
      const [r,g,b] = colors.getTimeColor(t, this.minT, this.maxT, false).rgb();
      return [r, g, b, 0xFF];
    }, blobCallback);
  }
}

module.exports = Object.assign(MeshLayer, M, { constants: M, Grid: MeshGrid });
