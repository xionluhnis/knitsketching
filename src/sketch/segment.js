// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const geom = require('../geom.js');
const Bezier = require('bezier-js');

/**
 * Linear version of bezier
 * to allow generic access to bezier properties
 */
class LinearSegment{
  constructor(ps, pe){
    this.ps = ps;
    this.pe = pe;
    this.len = 0;
    this.points = [ps, pe];
    this.lut = [];
  }

  length(){
    if(!this.len)
      this.len = geom.distBetween(this.ps, this.pe);
    return this.len;
  }

  get(t){
    t = Math.min(1, Math.max(0, t));
    return geom.axpby(1 - t, this.ps, t, this.pe);
  }

  derivative(/* t, normalize */){
    return geom.axpby(-1, this.ps, 1, this.pe);
  }

  tangent(/* t, normalize */){
    return geom.unitVector(this.derivative());
  }

  normal(t, normalize = false){
    const tn = this.tangent(t, normalize);
    return geom.rightNormal(tn);
  }

  project({ x, y }){
    // @see https://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment
    const l2 = this.length() * this.length();
    if(l2 == 0)
      return Object.assign({}, this.ps);
    const t = Math.max(0, Math.min(1,
      ((x - this.ps.x) * (this.pe.x - this.ps.x) + (y - this.ps.y) * (this.pe.y - this.ps.y)) / l2
    ));
    const p = this.get(t);
    p.t = t; // to export t value (like BezierJS)
    return p;
  }

  bbox(){
    const bbox = { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } };
    if(this.ps.x < this.pe.x){
      bbox.x.min = this.ps.x;
      bbox.x.max = this.pe.x;
    } else {
      bbox.x.min = this.pe.x;
      bbox.x.max = this.ps.x;
    }
    if(this.ps.y < this.pe.y){
      bbox.y.min = this.ps.y;
      bbox.y.max = this.pe.y;
    } else {
      bbox.y.min = this.pe.y;
      bbox.y.max = this.ps.y;
    }
    return bbox;
  }

  split(t1, t2){
    assert(t1 !== undefined, 'Invalid arguments');
    const p1 = this.get(t1);
    if(t2 === undefined){
      return {
        left: new LinearSegment(this.ps, p1),
        right: new LinearSegment(p1, this.pe)
      };
    } else {
      const p2 = this.get(t2);
      return new LinearSegment(p1, p2);
    }
  }

  intersects({ p1, p2 }){
    // @see https://en.wikipedia.org/wiki/Line%E2%80%93line_intersection
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const t_u = (this.ps.x - p1.x) * dy - (this.ps.y - p1.y) * dx;
    const t_l = (this.ps.x - this.pe.x) * dy - (this.ps.y - this.pe.y) * dx;
    if(Math.abs(t_l) < 1e-4)
      return []; // mostly parallel, count as no intersection
    const t = t_u / t_l;
    // note: segment is defined as P = this.ps - t * (Dx, Dy)
    if(geom.between(t, 0, 1)){
      // check we are within the boundaries spanned by p1-p2
      const mx = Math.min(p1.x, p2.x);
      const Mx = Math.max(p1.x, p2.x);
      const my = Math.min(p1.y, p2.y);
      const My = Math.max(p1.y, p2.y);
      const p = this.get(t);
      if(geom.between(p.x, mx, Mx) && geom.between(p.y, my, My))
        return [ Math.max(0, Math.min(1, t)) ];
      else
        return [];
    } else
      return [];
  }

  getLUT(steps = 100){
    // same computation as in bezier.js
    if(this.lut.length === steps)
      return this.lut;
    else
      this.lut = [];
    steps--;
    for (let t = 0; t <= steps; t++) {
      this.lut.push(this.get(t / steps));
    }
    return this.lut;
  }
  hull(/* t */){
    assert.error('Hull not available on linear segments');
  }
}

function splitWrap(segment, wrapClass, ...args){
  // wrap split segment with a mirrored segment
  if(args[1] === undefined){
    const { left, right } = segment.split(...args);
    return {
      left:  new wrapClass(left),
      right: new wrapClass(right)
    };

  } else {
    return new wrapClass(segment.split(...args));
  }
}

class BezierSegment {
  constructor(bezier){
    if(Array.isArray(bezier) && bezier.length >= 3)
      bezier = new Bezier(bezier);
    assert(bezier instanceof Bezier,
      'Argument must be a bezier object or an array of points');
    this.segment = bezier;
    this.order = bezier.order;
    this.singularStart = false;
    this.singularEnd   = false;
    // tangent data
    if(this.order === 2){
      const [ps, pc, pe] = bezier.points;
      if(geom.distBetweenBelow(ps, pc)
      || geom.distBetweenBelow(pc, pe)){
        // replace with a simple segment
        this.segment = new LinearSegment(ps, pe);
      }
    } else if(this.order === 3){
      // check if any side is singular
      const [ps, c1, c2, pe] = bezier.points;
      this.singularStart = geom.distBetweenBelow(ps, c1);
      this.singularEnd   = geom.distBetweenBelow(c2, pe);
      // special aliasing case
      if((this.singularStart || this.singularEnd)
      && geom.distBetweenBelow(c1, c2)){
        this.singularStart = this.singularEnd = true;
      }
      // if doubly singular, approximate with linear segment
      if(this.singularStart && this.singularEnd){
        this.segment = new LinearSegment(ps, pe);
        // no need to mark singularities anymore
        this.singularStart = this.singularEnd = false;
      }
    }
  }
  get points(){ return this.segment.points; }

  derivative(t){ return this.segment.derivative(t); }
  tangent(t){
    if((this.singularStart && geom.approximately(t, 0))
    || (this.singularEnd && geom.approximately(t, 1))){
      // dp = dpoints[0]
      // d = ~ dp[0] for t=0, which is (0,0)
      // d = ~ dp[2] for t=1, which is (0,0)
      // => use dp[1] as derivative
      // i.e. use the difference between the control points
      return geom.unitVector(this.segment.dpoints[0][1]);

    } else {
      return geom.unitVector(this.derivative(t));
    }
  }

  normal(t){
    return geom.rightNormal(this.tangent(t));
  }
  length(){ return this.segment.length(); }
  get(t){ return this.segment.get(t); }
  project(p){ return this.segment.project(p); }
  bbox(){ return this.segment.bbox(); }
  split(...args){ return splitWrap(this.segment, BezierSegment, ...args); }
  intersects(line){ return this.segment.intersects(line); }
  getLUT(steps = 100){ return this.segment.getLUT(steps); }
  hull(t){ return this.segment.hull(t); }
}

class MirroredSegment {
  constructor(segment){
    this.segment = segment;
  }

  get points(){ return this.segment.points; }

  derivative(t, normalize){
    const d = this.segment.derivative(t);
    return normalize ? geom.mirrorX(d) : d;
  }
  tangent(t, normalize){
    const d = this.segment.tangent(t);
    return normalize ? geom.mirrorX(d) : d;
  }
  normal(t, normalize){
    return geom.rightNormal(this.tangent(t, normalize));
  }

  length(){   return this.segment.length(); }
  get(t){     return this.segment.get(t); }
  project(p){ return this.segment.project(p); }
  bbox(){     return this.segment.bbox(); }
  split(...args){ return splitWrap(this.segment, MirroredSegment, ...args); }
  intersects(line){ return this.segment.intersects(line); }
  getLUT(steps = 100){ return this.segment.getLUT(steps); }
  hull(t){ return this.segment.hull(t); }
}

function segmentFrom(points, mirror = false){
  let segment;
  switch(points.length){
    case 2:
      segment = new LinearSegment(points[0], points[1]);
      break;

    case 3:
    case 4:
      segment = new BezierSegment(points);
      break;

    default:
      assert('Invalid number of points: 2,3 or 4 needed', points.length);
      return null;
  }
  return mirror ? new MirroredSegment(segment) : segment;
}

function autoSmoothBezier(prev, curr, next){
  //
  // @see https://gitlab.com/inkscape/inkscape/blob/master/src/ui/tool/node.cpp#L860
  // "dir" is an unit vector perpendicular to the bisector of the angle created
  // by the previous node, this auto node and the next node.
  //    Geom::Point dir = Geom::unit_vector((len_prev / len_next) * vec_next - vec_prev);
  // Handle lengths are equal to 1/3 of the distance from the adjacent node.
  //   _back.setRelativePos(-dir * (len_prev / 3));
  //   _front.setRelativePos(dir * (len_next / 3));
  
  // relative vectors and length
  const toPrev = geom.axpby(1, prev, -1, curr);
  const toNext = geom.axpby(1, next, -1, curr);
  const prevLen = geom.length(toPrev); // distBetween(prev, curr);
  const nextLen = geom.length(toNext); // geom.distBetween(curr, next);
  // ratio direction
  const dir = geom.unitVector(geom.axpby(prevLen / nextLen, toNext, -1, toPrev));

  // output control points for curr
  return [
    geom.axpby(1, curr, +nextLen / 3, dir),
    geom.axpby(1, curr, -nextLen / 3, dir)
  ];
}

/**
 * Compute a control point for
 * a Catmull-Rom sequence of three points.
 * 
 * The code directly translates the
 * parameterization given in:
 * 
 * "On the parameterization of Catmull-Rom curves."
 * by Cem Yuksel et al.
 * 2009 SIAM/ACM Joint Conference on Geometric and Physical Modeling.
 * 
 * @param {{x,y}} p0 left point
 * @param {{x,y}} p1 center point
 * @param {{x,y}} p2 right point
 * @param {number} d1 left distance
 * @param {number} d2 right distance
 * @param {number} alpha power parameter
 */
function catmullRomControl(p0, p1, p2, d1, d2, alpha){
  const d1_a = Math.pow(d1, alpha);
  const d1_a2 = Math.pow(d1, alpha * 2);
  const d2_a = Math.pow(d2, alpha);
  const d2_a2 = Math.pow(d2, alpha * 2);
  const div = 3 * d1_a * (d1_a + d2_a);
  return geom.axpbypcz(
    -d2_a2 / div, p0,
    (2 * d1_a2 + 3 * d1_a * d2_a + d2_a2) / div, p1,
    d1_a2 / div, p2
  );
}

function catmullRomStartControl(p0, p1, p2, dl, dr, alpha){
  return catmullRomControl(p0, p1, p2, dl, dr, alpha);
}
function catmullRomEndControl(p0, p1, p2, dl, dr, alpha){
  return catmullRomControl(p2, p1, p0, dr, dl, alpha);
}

/**
 * Computes the two control points associated with a node
 * assumed to be part of a Catmull-Rom spline.
 * 
 * This a node-based implementation which requires knowledge
 * about the previous and next points (besides the current one).
 * 
 * Based on the bezier parameterization as written in:
 * 
 * "On the parameterization of Catmull-Rom curves."
 * by Cem Yuksel et al.
 * 2009 SIAM/ACM Joint Conference on Geometric and Physical Modeling.
 * 
 * @param {{x,y}} prev previous node
 * @param {{x,y}} curr current node
 * @param {{x,y}} next next node
 * @param {number} alpha power parameter
 * @return {{cs, ce}} the two control points of the node
 * @see catmullRomToBezier
 */
function catmullRomControls(prev, curr, next, alpha = 0.5){
  const dp = geom.distBetween(curr, prev);
  const dn = geom.distBetween(curr, next);
  return {
    cs: catmullRomStartControl(prev, curr, next, dp, dn, alpha),
    ce: catmullRomEndControl(prev, curr, next, dp, dn, alpha)
  };
}

/**
 * Computes the control points for a bezier segment
 * starting at p1, and ending at p2.
 * 
 * The pre-/post-points assume we are dealing with
 * a sequence of points, and here we generate the control
 * points for a given segment (p1-p2).
 * 
 * Based on the bezier parameterization as written in:
 * 
 * "On the parameterization of Catmull-Rom curves."
 * by Cem Yuksel et al.
 * 2009 SIAM/ACM Joint Conference on Geometric and Physical Modeling.
 * 
 * @param {{x,y}} p0 pre-point
 * @param {{x,y}} p1 segment first point
 * @param {{x,y}} p2 segment second point
 * @param {{x,y}} p3 post-point
 * @param {number} alpha power parameter
 * @return {[cs, ce]} the start and end control points of the segment
 * @see catmullRomControls
 */
function catmullRomToBezier(p0, p1, p2, p3, alpha = 0.5){
  const d1 = geom.distBetween(p1, p0);
  const d2 = geom.distBetween(p2, p1);
  const d3 = geom.distBetween(p3, p2);

  // output control points for segment [p1, p2]
  return [
    catmullRomControl(p0, p1, p2, d1, d2, alpha),
    catmullRomControl(p3, p2, p1, d3, d2, alpha)
  ];
}

function linearStartControl(ps, pe, scale){
  const dir = geom.axpby(1, pe, -1, ps);
  return geom.axpby(
    1, ps,
    scale, dir
  );
}

function linearEndControl(ps, pe, scale){
  const dir = geom.axpby(1, ps, -1, pe);
  return geom.axpby(
    1, pe,
    scale, dir
  );
}

function hermiteToBezier(p0, p1, p2, p3, w = 1/3){
  return [
    p0,
    geom.axpby(1, p0, w, p1),
    geom.axpby(1, p3, -w, p2),
    p3
  ];
}

module.exports = {
  // classes
  LinearSegment, MirroredSegment, Bezier, BezierSegment,
  // methods
  segmentFrom,
  autoSmoothBezier,
  catmullRomStartControl,
  catmullRomEndControl,
  catmullRomControls,
  catmullRomToBezier,
  hermiteToBezier,
  linearStartControl,
  linearEndControl
};
