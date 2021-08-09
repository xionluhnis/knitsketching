// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const { PairingQueue } = require('../../ds/pqueue.js');
const { LAYER } = require('./constants.js');

class EdgeWindow {
  constructor(he, b0, b1, d0, d1, {
    // previous distance
    ds = 0,
    // previous window
    pw = null,
    // cache data that may already be available
    ps = null, // pseudo source
    te = he.twinEdge() || he.reverseEdge(), // twin edge
    ep0 = null, ep1 = null, // positions within edge
    inward = true, // whether the pseudo-source is inward
    linked = !!he.twinEdge(), // whether the half-edge is linked
    maxDist = -1, minDist = -1,
    corner = false,
  }){
    assert(arguments.length === 6, 'Invalid number of arguments');
    this.he = he;
    this.b0 = b0;
    this.b1 = b1;
    assert(b0 <= b1, 'Invalid window order', b0, b1);
    this.d0 = d0;
    this.d1 = d1;
    this.ds = ds; // pseudo-source distance to actual source
    this.inward = inward; // whether the source is inward
    this.linked = linked; // whether the edge has a link
    this.corner = corner; // whether the window spans from a corner
    // previous window
    this.pw = pw;
    // twin/reverse edge
    this.te = te;
    // position data
    this.ep0 = ep0 || geom.axpby(1 - this.b0, this.eps, this.b0, this.epe);
    this.ep1 = ep1 || geom.axpby(1 - this.b1, this.eps, this.b1, this.epe);
    this.ps  = ps  || this.computeSourcePos();
    // distance data
    if(maxDist !== -1)
      this.maxDist = maxDist;
    else
      this.maxDist = Math.max(this.d0, this.d1) + this.ds;
    if(minDist !== -1)
      this.minDist = minDist;
    else {
      this.minDist = geom.distToSegment(this.ps, [
        this.ep0, this.ep1
      ]) + this.ds;
    }
  }
  get layer(){ return this.he.layer; }
  get eps(){ return this.he.source; }
  get epe(){ return this.he.target; }
  computeSourcePos(){
    const [psMid, psDelta] = geom.circInterCircle([
      this.ep0, this.d0
    ], [
      this.ep1, this.d1
    ], true, true);
    // /!\ psDelta may be undefined if the intersection is invalid
    //  => in such case, use intermediate point psMid on the edge
    //     which may happen when point is very close to the edge 
    if(!psDelta)
      return psMid;
    // else we need to check the direction
    // and ensure we use the proper signed delta
    // inner source => direction matches left normal
    // outer source => direction matches right normal
    const edir = geom.axpby(1, this.epe, -1, this.eps);
    const n = this.inward ? geom.leftNormal(edir) : geom.rightNormal(edir);
    const ddir = Math.sign(geom.dot(n, psDelta) || 1);
    // note: ddir = 1 if matching, -1 otherwise (to make it match)
    return geom.axpby(1, psMid, ddir, psDelta);
  }
  intersects(w){
    // note: the intersection must be more than just an endpoint
    return !(
        w.b0 >= this.b1 // after this window
    ||  w.b1 <= this.b0 // before this window
    );
  }
  isInside(b){ return this.b0 < b && b < this.b1; }
  split(b){
    assert(this.isInside(b),
      'Should not split but clearly when inside');
    const pb = geom.axpby(1 - b, this.eps, b, this.epe);
    const db = geom.distBetween(this.ps, pb);
    return [
      new EdgeWindow(
        this.he, this.b0, b,
        this.d0, db, {
          ds: this.ds, pw: this.pw, ps: this.ps, te: this.te,
          ep0: this.ep0, ep1: pb,
          inward: this.inward, linked: this.linked, corner: this.corner
        }
      ),
      new EdgeWindow(
        this.he, b, this.b1,
        db, this.d1, {
          ds: this.ds, pw: this.pw, ps: this.ps, te: this.te,
          ep0: pb, ep1: this.ep1,
          inward: this.inward, linked: this.linked, corner: this.corner
        }
      )
    ];
  }
  pairedSplits(that){
    // invariants:
    // - the first list has only (sub)windows from this
    // - the second list has only (sub)windows from that
    if(this.b1 <= that.b0){
      // this before that, no overlap ----------------------------------------
      return [
        [this, null],
        [null, that]
      ];

    } else if(this.b0 >= that.b1){
      // this after that, no overlap -----------------------------------------
      return [
        [null, this],
        [that, null]
      ];

    } else if(this.b0 < that.b0){
      // this starts before that ---------------------------------------------
      const [thisPrev, thisRest] = this.split(that.b0);
      if(this.b1 < that.b1){
        // this ends before that
        const [thatCurr, thatNext] = that.split(this.b1);
        return [
          [thisPrev, thisRest, null],
          [null, thatCurr, thatNext]
        ];

      } else if(this.b1 === that.b1){
        // this ends with that ...............................................
        return [
          [thisPrev, thisRest],
          [null, that]
        ];

      } else {
        // this ends after that
        const [thisCurr, thisNext] = thisRest.split(that.b1);
        return [
          [thisPrev, thisCurr, thisNext],
          [null, that, null]
        ];
      }

    } else if(this.b0 === that.b0){
      // this starts with that -----------------------------------------------
      if(this.b1 < that.b1){
        // this ends before that
        const [thatPrev, thatNext] = that.split(this.b1);
        return [
          [this, null],
          [thatPrev, thatNext]
        ];

      } else if(this.b1 === that.b1){
        // this ends with that
        return [ [this], [that] ];

      } else {
        // this ends after that
        const [thisPrev, thisNext] = this.split(that.b1);
        return [
          [thisPrev, thisNext],
          [that, null]
        ];
      }

    } else {
      assert(that.b0 < this.b0, 'Invalid b0 ordering');
      const [thatPrev, thatRest] = that.split(this.b0);
      // this starts after that ----------------------------------------------
      if(this.b1 < that.b1){
        // this ends before that
        const [thatCurr, thatNext] = thatRest.split(this.b1);
        return [
          [null, this, null],
          [thatPrev, thatCurr, thatNext]
        ];

      } else if(this.b1 === that.b1){
        // this ends with that
        return [
          [null, this],
          [thatPrev, thatRest]
        ];

      } else {
        // this ends after that
        const [thisCurr, thisNext] = this.split(that.b1);
        return [
          [null, thisCurr, thisNext],
          [thatPrev, thatRest, null]
        ];
      }
    } // endif comp(this.b0, that.b0)
  }
  traverse(){
    // special case when not crossing a link so we can keep the cache
    if(this.linked){
      // /!\ for orientation contuity (twin edge does sample reversal),
      //     we must invert 0/1 and start/end
      return new EdgeWindow(
        this.te, 1-this.b1, 1-this.b0, this.d1, this.d0,
        {
          ds: this.ds,
          pw: this,
          te: this.he,
          /* (eps, epe, ep0, ep1 and ps) are all changing */
          inward: !this.inward, linked: this.linked,
          minDist: this.minDist, maxDist: this.maxDist
        }
      );
    } else {
      // no link => same embedding
      // = keep cache data
      // /!\ reverse edge => reverse 0/1 and start/end
      return new EdgeWindow(
        this.te, 1-this.b1, 1-this.b0, this.d1, this.d0,
        {
          ds: this.ds, pw: this.pw, ps: this.ps, te: this.he,
          ep0: this.ep1, ep1: this.ep0, // reversed
          inward: !this.inward, linked: this.linked,
          minDist: this.minDist, maxDist: this.maxDist
        }
      );
    } // endif this.linked else
  }
  toString(){
    return 'EW(' + this.he.nhId
      + ', b=[' + this.b0
      + ';' + this.b1
      + '], d0=' + this.d0.toFixed(1)
      + ', d1=' + this.d1.toFixed(1)
      + ', min=' + this.minDist.toFixed(1)
      + ', max=' + this.maxDist.toFixed(1) + ')';
  }

  stack(map = w => w){
    const stack = [map(this)];
    let parent = this.pw;
    while(parent){
      stack.push(map(parent));
      parent = parent.pw;
    }
    return stack;
  }

  matches(that){
    return geom.approximately(this.d0, that.d0)
        && geom.approximately(this.d1, that.d1)
        && geom.approximately(this.ds, that.ds);
  }
  point(b){ return geom.axpby(1-b, this.eps, b, this.epe); }
  dist(b){ return this.ds + geom.distBetween(this.point(b), this.ps); }
}

/**
 * Implementation based on the exact geodesic from source to target of
 *    "Fast Exact and Approximate Geodesics on Meshes"
 *    V. Surazhsky, T. Surazhsky, D. Kirsanov, S. Gortler and H. Hoppe
 *    Siggraph 2015
 * 
 * @see http://hhoppe.com/proj/geodesics/
 */
class RefinedDistanceQueryResult {
  constructor(
    parent,
    [cps, ss, nhs],
    [cpe, se, nhe],
    ctx  
  ){
    this.parent = parent;
    this.cps = cps; // source position in context
    this.cpe = cpe; // target position in context
    this.ss  = ss;
    this.se  = se;
    this.nhs = nhs;
    this.nhe = nhe;
    this.context = ctx;
    // layer scaling factor
    this.eta = parent.eta;
    // layer positions
    this.ps = Object.assign({ layer: nhs.layer }, nhs.projQuery);
    this.pe = Object.assign({ layer: nhe.layer }, nhe.projQuery);
    // start / end faces
    this.endFids = new Set();
    this.lastW   = null;
    // algorithm data storage
    this.vertexMap    = new Map();
    this.regVertexSet = new Set();
    this.hedgeMap     = new Map();
    this.hedgeWindows = new Map();
    this.edgeMap      = new Map();
    this.heToFMap     = new Map();
    this.faceMap      = new Map();
    this.fToHEsMap    = new Map();
    this.computeDomain(ss, se, ctx);
    this.queue = new PairingQueue(); // queue based on window distance
    // upper bound on distance (in layer units)
    this.upperDist = this.approxDist(this.ps, ss, se, this.pe) * 1.001;
    // smallest distance (in context units)
    this.dist = this.computeDist(nhs, nhe);
    // cached back trace
    this.trace = null;
    // verbosity
    this.verbose = parent.verbose && parent.expertMode;
  }
  get path(){ return this.dpath; }
  get dpath(){
    if(!this.trace)
      this.trace = this.backtrace();
    return this.trace;
  }
  faceId(nh){
    assert(nh.isArea(), 'Argument is not a face');
    return nh.areaId;
  }
  assert(...args){
    if(this.verbose)
      assert(...args);
  }
  warn(...args){
    if(this.verbose)
      console.warn(...args);
  }

  computeDomain(ss, se){
    // get approximate path to constrain mesh region to explore
    const vertices = this.parent.verticesBetween(ss, se);
    // XXX should we expand the domain to the neighbors of v?
    for(const v of vertices){
      this.vertexMap.set(v.vertexId, v);
      if(!v.isBorder()){
        this.regVertexSet.add(v.vertexId);
      }
      for(const uface of v.areaNeighborhoods()){
        // get CCW oriented face
        const face = uface.oriented();
        const fid = this.faceId(face);
        if(this.faceMap.has(fid))
          continue;

        // store face data
        this.faceMap.set(fid, face);
        const fToHEs = [];
        this.fToHEsMap.set(fid, fToHEs);

        // go over half-edges of face, in CCW order
        for(const he of face.halfEdges()){
          // oriented half-edge
          const heID = he.nhId; // take into account orientation
          assert(!this.hedgeMap.has(heID),
            'Oriented half-edge coming from two faces');
          this.hedgeMap.set(heID, he);
          this.hedgeWindows.set(heID, []);
          // aliasing edge
          const eID = he.edgeId;
          if(!this.edgeMap.has(eID))
            this.edgeMap.set(eID, he);
          // map from oriented half-edge to face
          this.heToFMap.set(heID, face);
          // map from face to oriented half-edges
          fToHEs.push(he);
        } // endfor he of face.halfEdges()
      } // endfor uface of v.areaNeighborhoods()
    } // endfor v of vertices
  }
  approxDist(ps, ss, se, pe){
    let dist = geom.distBetween(ps, ss);
    for(const [, d] of this.parent.samplesBetween(ss, se, LAYER, true)){
      dist += d;
    }
    dist += geom.distBetween(se, pe);
    return dist;
  }
  isBoundaryHalfEdge(he){
    const te = he.twinEdge() || he.reverseEdge();
    return !this.heToFMap.has(te.nhId);
  }
  /** @deprecated  */
  isBoundaryVertex(v){
    // not in set of inner vertices 
    return !this.vertexMap.has(v.vertexId)
        || v.isOnShapeBoundary();
  }
  /** @deprecated  */
  isSaddleVertex(v){
    // check whether angle around vertex is above 2pi
    return geom.above(v.angleSum, 2 * Math.PI);
  }
  /** @deprecated  */
  isSpecialVertex(v){
    return this.isBoundaryVertex(v) || this.isSaddleVertex(v);
  }
  isIrregularVertex(v){
    return !this.regVertexSet.has(v.vertexId);
  }
  layerDist(cdist, ctx = this.context){
    if(ctx === LAYER)
      return cdist;
    else
      return cdist / this.eta;
  }
  contextDist(ldist, ctx = this.context){
    if(ctx === LAYER)
      return ldist;
    else
      return ldist * this.eta;
  }
  contextPos(lp, ctx = this.context){
    if(ctx === LAYER)
      return lp;
    else {
      const { x, y } = lp.layer.gridToSketch(lp);
      return { layer: lp.layer, x, y };
    }
  }
  computeDist(startNh, endNh){
    // do not try if the upper bound is near 0
    if(geom.approximately(this.upperDist, 0))
      return; // special case
    // /!\ startNh may not be a face, it can be:
    // - a sample
    // - an edge
    // - a triangle (face)
    // - a quad (face)
    this.setupWindows(startNh);
    this.setupEndFaces(endNh);

    // propagate windows using priority queue based on window distance
    while(!this.queue.isEmpty()){
      const w = this.queue.pop();
      // do not propagate if we cannot beat the upper bound
      if(w.minDist >= this.upperDist)
        continue; // already above upper bound
      // get face of other side for propagation
      const f = this.heToFMap.get(w.te.nhId);
      assert(f, 'Propagating to non-existing face');

      // stop if we reach the end face
      const fid = this.faceId(f);
      if(this.endFids.has(fid)){
        // measure distance from pseudo-source
        // using that window, and potentially replace
        // the current upper bound on the distance
        const iw = w.traverse();
        let d;
        // note: two cases
        // 1) pseudo-source is within window fan range
        // 2) pseudo-source is outside window fan range
        // => check window range intersection
        const ray = [iw.ps, this.pe];
        const seg = [iw.ep0, iw.ep1];
        const e = geom.lineInterSegment(ray, seg);
        if(e){
          // case 1 = within window fan range
          d = geom.distBetween(iw.ps, this.pe) + iw.ds;

        } else {
          // case 2 = outside window fan range
          // => use best side of fan
          const d0 = geom.distBetween(iw.ep0, this.pe) + iw.d0 + iw.ds;
          const d1 = geom.distBetween(iw.ep1, this.pe) + iw.d1 + iw.ds;
          d = Math.min(d0, d1);
        }
        if(d < this.upperDist){
          this.upperDist = d; // better distance found!
          this.lastW = iw;    // for backtracing

        } else if(!this.lastW && geom.approximately(d, this.upperDist)){
          // path to target with approximation distance found!
          // = ensure we have one last window
          this.lastW = iw; // for backtracing
        }
        continue;
      }

      // else, propagate window
      this.propagateWindow(w, fid);
    }
    this.assert(this.lastW, 'No window reached the target');

    // the distance is the last (tightest) upper distance bound
    // modulated by the context scale
    return this.contextDist(this.upperDist);
  }

  setupWindows(startNh){
    // compute initial faces
    const startPairs = []; // { face, ps }
    // neighborhood cases
    switch(startNh.degree){

      // from vertex
      case 1: {
        const s = startNh.baseSample;
        for(const face of s.areaNeighborhoods()){
          startPairs.push([
            face,
            face.baseSample
          ]);
        }
      } break;

      // from edge
      case 2: {
        const [s0, s1] = startNh.samples;
        for(const he of [s0.edgeTo(s1), s1.edgeTo(s0)]){
          const face = this.heToFMap.get(he.nhId);
          if(!face)
            continue; // invalid direction
          // direct face
          startPairs.push([
            face, this.ps
          ]);
          // potential other face
          const te = he.twinEdge() || he.reverseEdge();
          const rface = this.heToFMap.get(te.nhId);
          if(rface){
            const { t } = he.projectFrom(this.ps, LAYER);
            const tps = geom.axpby(
              t, te.source,
              1-t, te.target
            );
            startPairs.push([
              face, tps, te
            ]);
          }
        } // endfor he of [s0->s1, s1->s0]
      } break;

      // from face
      default:
        // 3 or 4 => face!
        startPairs.push([startNh, this.ps]);
        break;
    }
    assert(startPairs.length, 'No starting face-pos pair');

    // compute initial windows
    for(const [uface, ps] of startPairs){
      const face = uface.oriented();
      const fid = this.faceId(face);
      // go over half-edges of face
      for(const he of this.fToHEsMap.get(fid)){
        if(this.isBoundaryHalfEdge(he))
          continue; // no need to propagate through
        const s0 = he.samples[0];
        const s1 = he.samples[1];
        const eps = s0;
        const epe = s1;
        const d0 = geom.distBetween(eps, ps);
        const d1 = geom.distBetween(epe, ps);
        this.assignWindow(new EdgeWindow(
          he, 0, 1, d0, d1, {
            ds: 0, ps, // initial pseudo source
            eps, epe, ep0: eps, ep1: epe
          }
        ));
      } // endfor he
    } // endfor [face, ps] of startPairs
  }

  setupEndFaces(endNh){
    // compute ending faceIDs
    switch(endNh.degree){
      // sample => any adjacent face, not across links
      case 1:
        for(const uface of endNh.baseSample.areaNeighborhoods(false)){
          const face = uface.oriented();
          this.endFids.add(this.faceId(face));
        }
        break;
      
      // edge => any adjacent face, not across links
      case 2: {
        const [s0, s1] = endNh.samples;
        for(const he of [s0.edgeTo(s1), s1.edgeTo(s0)]){
          const face = this.heToFMap.get(he.nhId);
          if(face)
            this.endFids.add(this.faceId(face));
        }
      } break;

      // face => that same face
      default :
        this.endFids.add(this.faceId(endNh));
    }
    assert(this.endFids.size, 'No ending face found');
  }

  propagateWindow(iw, fid){
    // get window within face
    const w = iw.traverse();

    // store on half-edge, so we can use in backtracing
    this.assignWindow(w, false);

    // propagate to each other face edge
    const hes = this.fToHEsMap.get(fid);
    for(const he of hes){
      // do not propagate to windows that cannot propagate further
      // including the initial half-edge
      if(this.isBoundaryHalfEdge(he)
      || he.matches(w.he))
        continue;
      
      // intersect rays with edge
      this.projectWindow(w, he);

      // special boundary/saddle cases
      // note: we avoid projecting onto lateral edges
      // because this leads to singular windows (straight edge beam)
      if(w.b0 === 0
      && this.isIrregularVertex(w.he.source)){
        this.assignWindow(new EdgeWindow(he, 0, 1, 
          geom.distBetween(w.eps, he.source),
          geom.distBetween(w.eps, he.target), {
            ds: w.d0 + w.ds, pw: w, ps: w.eps, // new pseudo-source
            ep0: he.source, ep1: he.target,
            corner: true // corner window
          }
        ));
      }
      if(w.b1 === 1
      && this.isIrregularVertex(w.he.target)){
        this.assignWindow(new EdgeWindow(he, 0, 1, 
          geom.distBetween(w.epe, he.source),
          geom.distBetween(w.epe, he.target), {
            ds: w.d1 + w.ds, pw: w, ps: w.epe, // new pseudo-source
            ep0: he.source, ep1: he.target,
            corner: true // corner window
          }
        ));
      }
    } // endfor he of hes
  }

  projectWindow(w, he){
    // intersect rays with edge
    const ray0 = [w.ps, w.ep0];
    const ray1 = [w.ps, w.ep1];
    const seg  = [he.source, he.target];
    // check validity of each ray / segment intersection
    // = must meet in opposing directions (dot < 0)
    // note: CCW => inner normal of segment is left normal
    const segn = geom.leftNormal(geom.axpby(1, he.target, -1, he.source));
    const isValid = ([s,t]) => {
      return geom.dot(geom.axpby(1, t, -1, s), segn) < 0;
    };
    const val0 = isValid(ray0);
    const val1 = isValid(ray1);

    // stop if no possible projection
    if(!val0 && !val1)
      return; // projection is empty

    // get valid projections
    const rs = [ray0, ray1];
    const vs = [val0, val1];
    const qs = vs.map((v, i) => v ? geom.lineInterLine(seg, rs[i]) : null);
    if(qs.every(q => !q))
      return; // every sample was actually invalid to precision
    // we have some valid location
    // => complement any invalid one
    const ts = qs.map((q, i) => {
      if(q)
        return q.t;
      else
        return [Infinity, -Infinity][i]; // based on CCW setting
    });

    // get intersection of window with [0;1]
    // /!\ [r0, r1] on start edge becomes [i0, i1] on other edge
    // but the range is inverted on that receiving edge (t(i1) <= t(i0))
    const [tmax, tmin] = ts; // tmin <= tmax
    if(geom.approximately(tmin, tmax))
      return; // singular intersection, do not consider
    assert(tmin <= tmax, 'Invalid ordering');
    if(tmax <= 0 || tmin >= 1 || tmin === tmax)
      return; // empty or singular intersection
    
    // bring back to [0;1]
    let t0, t1;
    let ep0, ep1;
    if(tmin <= 0){
      t0 = 0;
      ep0 = he.source;
    } else {
      t0 = tmin;
      ep0 = qs[1]; // /!\ because of out-in inversion, t0 is ts[1]
      assert(t0 < 1, 'Invalid tmin');
    }
    if(tmax >= 1){
      t1 = 1;
      ep1 = he.target;
    } else {
      t1 = tmax;
      ep1 = qs[0]; // /!\ because of out-in inversion, t1 is ts[0]
      assert(t1 > 0, 'Invalid tmax');
    }

    // assign new window
    this.assignWindow(new EdgeWindow(
      he, t0, t1,
      geom.distBetween(w.ps, ep0),
      geom.distBetween(w.ps, ep1), {
        ds: w.ds, pw: w, ps: w.ps, // same pseudo source
        ep0, ep1
      }
    ));
  }

  assignWindow(w, enqueue = true){
    // only consider window if below upper bound on distance
    if(w.minDist > this.upperDist)
      return; // that window is not worth considering
    if(geom.approximately(w.b0, w.b1))
      return; // do not store singular windows
    const heID = w.he.nhId;
    const ws = this.hedgeWindows.get(heID);
    if(!ws.length){
      // directly insert
      ws.push(w);
      // enqueue based on minimum distance
      if(enqueue)
        this.queue.insert(w, w.minDist);

    } else {
      // merge window with current list
      // assume it forms sorted intervals on [0;1] from 0 to 1
      const uws = []; // updated list
      for(let i = 0; i < ws.length && w; ++i){
        // split pair into up to three pairs
        const [nws, cws] = w.pairedSplits(ws[i]);
        assert(nws.length === cws.length,
          'Different cardinalities');
        w = null; // assume there is no more window by default
        for(let j = 0; j < nws.length; ++j){
          const nw = nws[j];
          const cw = cws[j];
          if(!nw){
            uws.push(cw);

          } else if(!cw){
            if(j === nws.length - 1)
              w = nw; // keep as next window
            else {
              uws.push(nw);
              if(enqueue)
                this.queue.insert(nw, nw.minDist);
            }
          } else {

            // both nw and cw
            // = merge of two windows (of same [b0;b1] interval)
            for(const [mw, sw] of this.mergeWindows(cw, nw)){
              uws.push(mw);
              // only enqueue if from the new window
              if(enqueue && sw === nw)
                this.queue.insert(mw, mw.minDist);
            }
          }
        } // endfor 0 <= j < #nws
      } // endfor 0 <= i < #ws
      // insert potential last rightmost window (if any)
      if(w){
        uws.push(w);
        if(enqueue)
          this.queue.insert(w, w.minDist);
      }

      // update list of windows
      this.hedgeWindows.set(heID, uws);
    } // endif #ws === 0 else
  }

  /**
   * Merge two windows of same coverage
   * 
   * @param {EdgeWindow} w0 the first edge window
   * @param {EdgeWindow} w1 the second edge window
   * @return {[[merged, src]]} ordered list of windows (with their source window)
   */
  mergeWindows(w0, w1){
    // remember original window
    const wo = w0;
    // if both windows match each other,
    // then keep the first one only
    if(w0.matches(w1))
      return [[wo, wo]];
    // get intersection range
    const b0 = Math.max(w0.b0, w1.b0);
    const b1 = Math.min(w0.b1, w1.b1);
    assert(geom.approximately(b0, Math.min(w0.b0, w1.b0)),
      'Merging windows with different b0');
    assert(geom.approximately(b1, Math.max(w0.b1, w1.b1)),
      'Merging windows with different b1');

    // check special coverage cases:
    if(geom.below(w0.maxDist, w1.minDist)){
      return [[w0, w0]]; // w0 covers w1 better, up to precision

    } else if(geom.below(w1.maxDist, w0.minDist)){
      return [[w1, w1]]; // w1 covers w0 better
    }

    // side checks
    // = one side must favor each window
    const closerLeft  = w0.d0 + w0.ds <= w1.d0 + w1.ds ? 0 : 1;
    const closerRight = w0.d1 + w0.ds <= w1.d1 + w1.ds ? 0 : 1;
    if(closerLeft === closerRight){
      // both sides favor the same window
      // => the other window is overshadowed, ambiguously with min/max
      // => keep the favored window only
      return closerLeft === 0 ? [[w0, w0]] : [[w1, w1]];

    } else if(closerLeft === 1){
      // inverse the order, so 0 represent the left window
      [w0, w1] = [w1, w0];
    }

    // find middle point, and return two parts [wl, wr]
    
    // 1) project ps0 and ps1 into edge-aligned x axis
    // /!\ we need to shift the system to have origin at the edge start
    const e  = geom.distBetween(w0.eps, w0.epe);
    const ex = geom.axpby(1/e, w0.epe, -1/e, w0.eps);
    const ey = geom.leftNormal(ex); // because inner-CCW
    const s0 = geom.projToBasis(
      geom.axpby(1, w0.ps, -1, w0.eps), ex, ey
    );
    const s1 = geom.projToBasis(
      geom.axpby(1, w1.ps, -1, w0.eps), ex, ey
    );

    // 2) form quadratic equation for location px
    //    corresponding to a same distance to both (s0, s1)
    // <=> sqrt((px - s0.x)^2 + s0.y^2) + ds0
    //   = sqrt((px - s1.x)^2 + s1.y^2) + ds1
    // <=> A*px^2 + B*px + C = 0
    //     with
    //        A = (alpha^2 - beta^2)
    //        B = gamma*alpha + 2*s1.x*beta^2
    //        C = (gamma^2)/4 - |s1|^2 * beta^2
    //     with
    //        alpha = s1.x - s0.x
    //        beta  = ds1 - ds0
    //        gamma = |s0|^2 - |s1|^2 - beta^2
    const alpha = s1.x - s0.x;
    const beta  = w1.ds - w0.ds;
    const gamma = geom.dot(s0, s0) - geom.dot(s1, s1) - beta * beta;
    const A = alpha * alpha - beta * beta;
    const B = alpha * gamma + 2 * s1.x * beta * beta;
    const C = gamma * gamma / 4 - beta * beta * geom.dot(s1, s1);

    // 3) get equation solution (in intersection of windows)
    //    or provide the middle of that range as default
    const minPx = b0 * e;
    const maxPx = b1 * e;
    let px = NaN;
    // check value of A (before dividing by it)
    if(geom.approximately(A, 0)){
      // check value of B (before dividing by it)
      if(geom.approximately(B, 0)){
        return [[wo, wo]];
      }

      // this is safe to do
      px = -C/B;

    } else {
      // assume A != 0, use px = (-b+/-sqrt(b^2-4*a*c))/(2*a)
      const deltaSq = B * B - 4 * A * C;
      // note: allow for delta^2 values close to 0
      if(deltaSq >= -1){
        const delta = Math.sqrt(Math.max(0, deltaSq));
        const pxp = (-B + delta) / (2 * A);
        const pxm = (-B - delta) / (2 * A);
        if(geom.between(pxp, minPx, maxPx))
          px = pxp;
        else {
          this.assert(geom.between(pxm, minPx, maxPx),
            'No valid quadratic solution within [b0;b1]');
          px = pxm;
        }
      }
    }

    // compute splitting location
    let b;
    if(Number.isNaN(px)
    || !geom.between(px, minPx, maxPx)){
      this.warn('No valid solution to quadratic equation');
      // compute location numerically by subdivision
      b = b0;
      for(const bi of geom.linspace(b0, b1, 10)){
        const d0 = w0.dist(bi);
        const d1 = w1.dist(bi);
        if(d0 <= d1)
          b = bi;
        if(d0 >= d1)
          break; // we crossed the splitting location
      }

    } else {
      b = px / e;
    }
    // if below fp-precision at boundary
    // then return the window that cover the full side
    if(geom.below(b, b0))
      return [[w1, w1]];
    else if(geom.above(b, b1))
      return [[w0, w0]];
    // else, split at b location
    const [wl, ] = w0.split(b);
    const [ ,wr] = w1.split(b);
    return [[wl, w0], [wr, w1]];
  }

  backtrace(ctx = this.context){
    if(ctx !== LAYER){
      const lpath = this.backtrace(LAYER); // [{layer,x,y,dist,fromLink}]
      const path = [
        Object.assign({
          dist: 0, fromLink: false
        }, this.contextPos(this.ps, ctx))
      ];
      for(let i = 1; i < lpath.length; ++i){
        const last = path[i-1];
        const { layer, x, y, fromLink } = lpath[i];
        const p = layer.gridToSketch({ x, y });
        let dist = last.dist;
        if(!fromLink)
          dist += geom.distBetween(last, p);
        path.push({ layer, x: p.x, y: p.y, dist, fromLink });
      }
      return path;
    }
    // else in layer context
    // = basic implementation

    // check for last window
    if(!this.lastW){
      // use approximation path ----------------------------------------------
      // since we cannot backtrace from nothing
      const path = [ {
        dist: 0, fromLink: false,
        x: this.ps.x, y: this.ps.y, layer: this.ps.layer
      } ];
      const d0 = geom.distBetween(this.ps, this.ss);
      for(const p of this.parent.pathBetween(
        this.ss, this.se, LAYER, true, d0
      )){
        path.push(p);
      }
      const dse = path[path.length - 1].dist;
      path.push({
        dist: dse + geom.distBetween(this.pe, this.se),
        fromLink: false, layer: this.pe.layer,
        x: this.pe.x, y: this.pe.y
      });
      return path;
    }

    // backtrack from the last window ----------------------------------------
    const path = [
      Object.assign({
        dist: this.layerDist(this.dist), fromLink: false
      }, this.pe)
    ];
    // start from last window
    let lastW = this.lastW;
    let lastP = this.pe;
    while(lastW){
      // trace from last position to window
      const layer = lastW.layer;
      const ray = [lastP, lastW.ps];
      const seg = [lastW.eps, lastW.epe];
      lastP = geom.lineInterLine(seg, ray);
      // special race case for ray parallel to window (at corner)
      if(!lastP){
        // we need a solution => use better side of window
        if(lastW.d0 <= lastW.d1)
          lastP = { x: lastW.ep0.x, y: lastW.ep0.y, t: lastW.b0 };
        else
          lastP = { x: lastW.ep1.x, y: lastW.ep1.y, t: lastW.b1 };
      } else 
      // check that it's within window
      // and project onto it if outside
      if(lastP.t < lastW.b0){
        lastP = { x: lastW.ep0.x, y: lastW.ep0.y, t: lastW.b0 };
      } else if(lastP.t > lastW.b1){
        lastP = { x: lastW.ep1.x, y: lastW.ep1.y, t: lastW.b1 };
      }
      assert(lastP, 'No valid intersection or projection');
      // annotate location with layer / dist / fromLink
      lastP.layer = layer;
      lastP.dist = geom.distBetween(lastP, lastW.ps);
      lastP.fromLink = !!lastW.linked;
      path.push(lastP);

      // potentially cross a link
      if(lastW.linked){
        // switch to other side
        lastW = lastW.pw;
        const t = 1 - lastP.t;
        const d = lastP.dist;
        lastP = geom.axpby(1-t, lastW.eps, t, lastW.epe);
        lastP.layer = lastW.layer;
        lastP.dist = d;
        lastP.fromLink = false;
        path.push(lastP);
      }

      // move to previous window
      lastW = lastW.pw;
    }
    path.push(Object.assign({ dist: 0, fromLink: false }, this.ps));
    path.reverse();
    return path;
  }
}

module.exports = RefinedDistanceQueryResult;