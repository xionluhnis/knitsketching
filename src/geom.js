// Alexandre Kaspar <akaspar@mit.edu.
"use strict";

// modules
const assert = require('./assert.js');
const epsilon = 1e-6;
const sqrtEpsilon = 1e-3;

/**
 * Squared Euclidean distance between two points
 *
 * @param p1 { x, y }
 * @param p2 { x, y }
 * @return |p1-p2|^2
 */
function sqDistBetween(p1, p2){
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}

/**
 * Distance between two points
 *
 * @param p1 { x, y }
 * @param p2 { x, y }
 * @param norm type of norm (linf, l0, l1, l2)
 * @return the specific norm of the vector from p1 to p2
 */
function distBetween(p1, p2, norm){
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  switch((norm || '').toLowerCase()){

    case 'linf':
      return Math.max(Math.abs(dx), Math.abs(dy));

    case 'l0':
      return !!dx + !!dy;

    case 'l1':
      return Math.abs(dx) + Math.abs(dy);

    case 'l22':
      return dx * dx + dy * dy;

    case 'l2':
      /* falls through */
    default:
      return Math.sqrt(dx * dx + dy * dy);
  }
}

function distBetweenBelow(p1, p2, maxDist = sqrtEpsilon){
  return sqDistBetween(p1, p2) < maxDist * maxDist;
}

function distBetweenAbove(p1, p2, minDist = sqrtEpsilon){
  return sqDistBetween(p1, p2) > minDist * minDist;
}

/**
 * Project a point onto an infinite line
 *
 * @param q the query point
 * @param [p, d] the line (p is a point, d is a unit direction)
 * @return the projection { x, y }
 */
function projToLine(q, [p, d]){
  const diff = axpby(1, q, -1, p);
  const ratio = dot(d, diff); // ratio of d along line from p
  return axpby(1, p, ratio, d);
}

/**
 * Distance from a point to an infinite line given by a point and one unit direction vector
 *
 * @param q { x, y }
 * @param line [p, d] where p is a point { x, y }, and d is a unit direction { x, y }
 * @return the L2 distance between the point and that line
 */
function distToLine(q, [p, d]){
  const h = projToLine(q, [p, d]);
  return distBetween(q, h);
}

/**
 * Project a point onto a segment
 *
 * @param {{x,y}} q point to project
 * @param {{x,y}[]} seg the segment to project onto
 * @return the projection of q onto the segment, together with a time annotation { x, y, t } (ratio from p1 to p2)
 */
function projToSegment(q, [ p1, p2 ]){
  // @see https://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const l2 = dx * dx + dy * dy;
  if(l2 == 0) 
    return Object.assign({ t: 0 }, p1);
  const t = Math.max(0, Math.min(1,
    ((q.x - p1.x) * dx + (q.y - p1.y) * dy) / l2
  ));
  return {
    x: p1.x + t * dx, // (1 - t) * p1.x + t * p2.x,
    y: p1.y + t * dy, // (1 - t) * p1.y + t * p2.y,
    t
  };
}

/**
 * Distance from a point to a segment given by two points
 *
 * @param q { x, y }
 * @param seg [p1, p2]
 * @return the l2 distance from q to the closest point on seg
 */
function distToSegment(q, [p1, p2]){
  const h = projToSegment(q, [p1, p2]);
  return distBetween(q, h);
}

/**
 * Checks whether two value are mostly the same up to precision
 *
 * @param a the first fp value
 * @param b the second fp value
 * @param precision the fp precision
 * @return whether a is like b up to precision
 */
function approximately(a, b, precision = epsilon) {
  return Math.abs(a - b) <= precision;
}

/**
 * Check whether a floating point value is within two bounds up to epsilon
 *
 * @param v the fp value
 * @param v0 the first bound
 * @param v1 the second bound
 * @param precision the fp precision to use
 * @return whether val \in [min(v0,v1);max(v0,v1)] up to precision
 */
function between(v, v0, v1, precision = epsilon){
  if(v0 > v1)
    [v0, v1] = [v1, v0]; // swap so that v0 <= v1
  return (v0 <= v && v <= v1)
      || approximately(v, v0, precision)
      || approximately(v, v1, precision);
}

function below(v, w, precision = epsilon){
  return v < w + precision;
}
function belowOrEqualTo(v, w, precision = epsilon){
  return v <= w + precision;
}
function above(v, w, precision = epsilon){
  return v > w - precision;
}
function aboveOrEqualTo(v, w, precision = epsilon){
  return v >= w - precision;
}

/**
 * Compute the intersection between two lines
 *
 * @param {{x,y}[]} line1 the first line (extends infinitely)
 * @param {{x,y}[]} line2 the second line (extends infinitely)
 * @param {number} [precision=epsilon] the fp precision
 * @return { x, y, t } if any intersection, else null
 */
function lineInterLine([p1, p2], [p3, p4], precision = epsilon){
  // @see https://en.wikipedia.org/wiki/Line%E2%80%93line_intersection
  const dx = p3.x - p4.x;
  const dy = p3.y - p4.y;
  const Dx = p1.x - p2.x;
  const Dy = p1.y - p2.y;
  const t_l = Dx * dy - Dy * dx;
  if(Math.abs(t_l) < precision)
    return null; // mostly parallel, count as no intersection
  const t_u = (p1.x - p3.x) * dy - (p1.y - p3.y) * dx;
  const t = t_u / t_l;
  // note: segment is defined as P = p1 - t * (Dx, Dy)
  // check we are within the boundaries spanned by p3-p4
  return {
    x: p1.x - t * Dx,
    y: p1.y - t * Dy,
    t
  };
}

/**
 * Compute the intersection between two segment
 *
 * @param {{x,y}[]} line the first line (extends infinitely)
 * @param {{x,y}[]} seg the second segment boundaries
 * @param {number} [precision=epsilon] the fp precision
 * @return { x, y, t } if any intersection, else null
 */
function lineInterSegment(line, seg, precision = epsilon){
  const p = lineInterLine(seg, line, precision);
  if(!p)
    return null;
  // note: intersection defined as P = p1 - t * (Dx, Dy)
  // check we are within the boundaries spanned by segment
  // <=> p.t in [0;1]
  if(between(p.t, 0, 1, precision)){
    return p; // inside
  } else
    return null; // outside
}

/**
 * Compute the intersection between two segment
 *
 * @param {{x,y}[]} seg1 the first segment boundaries
 * @param {{x,y}[]} seg2 the second segment boundaries
 * @param {number} [precision=epsilon] the fp precision
 * @return { x, y, t } if any intersection, else null
 */
function segInterSegment(seg1, seg2, precision = epsilon){
  const p = lineInterSegment(seg1, seg2, precision);
  if(!p)
    return null;
  // check that the parameterization t of the intersection
  // on the first segment is contained within its boundary
  // <=> t in [0;1]
  if(between(p.t, 0, 1, precision)){
    // check we are within the boundaries spanned by segment p3-p4
    const [p3, p4] = seg2;
    const mx = Math.min(p3.x, p4.x);
    const Mx = Math.max(p3.x, p4.x);
    const my = Math.min(p3.y, p4.y);
    const My = Math.max(p3.y, p4.y);
    if(between(p.x, mx, Mx, precision)
    && between(p.y, my, My, precision))
      return p; // within p3-p4!
    else
      return null; // outside!
  } else
    return null; // not contained!
}

function segInterPolygon(seg, poly){
  const bbox = extents(seg);
  // go over all segments of polygon
  for(const [p1, p2] of circularPairs(poly)){
    // we can skip segment intersection
    // if the bboxes do not intersect
    if(!bboxIntersect(bbox, extents([p1, p2])))
      continue;
    // else we need to check for segment intersection
    if(segInterSegment(seg, [p1, p2]))
      return true;
  }
  return false;
}

/**
 * Computes the intersection between two circles
 * 
 * @param {{x,y}}   p1 center of first circle
 * @param {number}  r1 radius of first circle
 * @param {{x,y}}   p2 center of second circle
 * @param {number}  r2 radius of second circle
 * @param {boolean} [retParts=false] whether to return [p3,dr] or [p3l,p3r]
 * @return {{x,y}[]} the intersection points
 * @see http://paulbourke.net/geometry/circlesphere/
 */
function circInterCircle(
  [p1, r1], [p2, r2],
  retParts = false,
  retPartial = false
){
  // distance between centers
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const d = Math.sqrt(dx * dx + dy * dy);

  // checks for solvability
  const invalid = (
    d > r1 + r2             // circles do not intersect
  || d < Math.abs(r1 - r2)  // one circle contained in other
  );
  if(invalid && !retPartial)
    return [];
  
  // compute pm: point on [p1,p2], orthogonal to the solution p3
  // - distance from p1 to pm
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  // - pm
  const a_d = a/d;
  const pmx = p1.x + dx * a_d;
  const pmy = p1.y + dy * a_d;

  // partial return
  if(invalid)
    return [{ x: pmx, y: pmy }];

  // compute h: distance from pm to intersection point p3
  const h = Math.sqrt(r1 * r1 - a * a);

  // compute offset from pm to p3
  const rx = -dy * (h/d);
  const ry = dx * (h/d);
  if(retParts){
    return [
      { x: pmx, y: pmy }, // pm
      { x: rx, y: ry }    // r
    ];
  } else {
    return [
      { x: pmx - rx, y: pmy - ry }, // cl (left normal from p0 to p1)
      { x: pmx + rx, y: pmy + ry }  // cr (right normal from p0 to p1)
    ];
  }
}

/**
 * Computes the signed area of a closed polygon
 * 
 * @param {{x,y}[]} points array of points (at least 3) forming a polygon
 * @return {number} the signed area of the polygon
 * @see https://en.wikipedia.org/wiki/Shoelace_formula
 */
function signedArea(points){
  const N = points.length;
  assert(N > 2, 'Area requires at least three points', N);
  // assume a closed 1st-order polygon
  return points.reduce((sum, p, index) => {
    const q = points[index === 0 ? N-1 : index-1];
    const dA = (p.x - q.x) * (p.y + q.y);
    return sum + dA;
  }, 0) * 0.5;
}

/**
 * Computes the area of a closed polygon
 * 
 * @param {{x,y}[]} points array of points (at least 3) forming a polygon
 * @return {number} the area of the polygon
 */
function area(points){
  return Math.abs(signedArea(points));
}

function barycentricComponents(q, [p1, p2, p3]){
  // barycentric interpolation (with arbitrary locations)
  // @see https://en.wikipedia.org/wiki/Barycentric_coordinate_system
  // @see https://gamedev.stackexchange.com/questions/23743/whats-the-most-efficient-way-to-find-barycentric-coordinates

  // assume triangle in order [p1, p2, p3]
  // compute sub-triangle areas, together with full area
  // /!\ we compute signed areas, assuming the same orientation
  //     of the triangle AND subtriangles (either CW or CCW)
  //  => subtriangles must keep same orientation
  //
  // Note: rotations are fine, but swappings are not
  //   signedArea([p1,p2,p3])
  // = signedArea([p2,p3,p1])
  // = signedArea([p3,p1,p2])
  // but = -signedArea([p1, p3, p2])
  // 
  // /!\ for sub-triangles to have same orientation,
  //     we can keep [p1, p2, p3] as order, and just replace one by q

  return [
    signedArea([q, p2, p3]),
    signedArea([p1, q, p3]), // /!\ the order is important
    signedArea([p1, p2, p3])
  ];
}



/**
 * Computes barycentric coordinates for a query point
 * 
 * @param {{x,y}} q query point
 * @param {{x,y}[]} triangle list of three points forming a triangle
 * @param {boolean} [clip=true] whether to clip coordinates (true by default) 
 */
function barycentricCoordinates(q, [p1, p2, p3], clip = true){
  // barycentric interpolation (with arbitrary locations)
  // @see https://en.wikipedia.org/wiki/Barycentric_coordinate_system
  
  // get components
  const [l1det, l2det, det] = barycentricComponents(q, [p1, p2, p3]);

  // clip or not
  let l1 = l1det / det;
  let l2 = l2det / det;
  if(clip){
    //
    // note: we project coordinates within simplex of three elements
    // /!\ projection is done by clipping l1 and l2 within [0,1]
    //     This may NOT be natural.
    //
    l1 = Math.max(0, Math.min(1, l1));
    l2 = Math.max(0, Math.min(1, l2));
  }
  
  // last coordinate
  const l3 = 1 - l1 - l2;
  return [l1, l2, l3];
}

/**
 * Checks whether a query point q is within a triangle [p1, p2, p3].
 * Being on edges (or vertex) is considered "inside".
 */
function inTriangle(q, [p1, p2, p3]){
  // compute unclipped barycentric coordinates
  const [l1, l2, l3] = barycentricCoordinates(q, [p1, p2, p3], false);
  // inside if all coordinates are positive
  return l1 >= 0 && l2 >= 0 && l3 >= 0;
}

/**
 * Align a point with a given axis constraint argument
 *
 * @param { x, y } the input point
 * @param arg a partial point constraint { ?x, ?y }
 * @return the if the constraint is partial, then the projection of the input to that constraint,
 *         else the projection of the input to the closest axis given by the constraint
 */
function alignPoint({ x, y }, arg){
  if('x' in arg){
    if('y' in arg){
      const px = { x: arg.x, y };
      const py = { x, y: arg.y };
      return Math.abs(x - arg.x) <= Math.abs(y - arg.y) ? px : py;
    } else {
      return { x: arg.x, y };
    }
  } else {
    assert('y' in arg, 'Invalid alignment');
    return { x, y: arg.y };
  }
}

/**
 * Reflect a point around a possibly partial axis constraint
 *
 * @param {{x,y}} p the input point
 * @param {{x?,y?}} arg theaxis to reflect around (individually for each existing dimension
 * @return the reflected point
 */
function reflectPoint({ x, y }, arg){
  return {
    x: 'x' in arg ? arg.x + (arg.x - x) : x,
    y: 'y' in arg ? arg.y + (arg.y - y) : y
  };
}

/**
 * Reflect a point across a line
 * 
 * @param {{x,y}} p the point to reflect
 * @param {{x,y}[]} line the line to use as reflector (point and unit dir)
 * @return {{x,y}} the reflected point 
 */
function reflectPointAcrossLine(p, [p0, d]){
  const proj = projToLine(p, [p0, d]);
  // r = proj + (proj - p) = 2 * proj - p
  return axpby(2, proj, -1, p);
}

/**
 * Return the length of a vector
 *
 * @param { x, y }
 * @return ||{ x, y }||
 */
function length({ x, y }){
  return Math.sqrt(x * x + y * y);
}

/**
 * Get a unit vector
 *
 * @param { x, y } the vector
 * @return { x, y } / ||{ x, y }||
 */
function unitVector({ x, y }){
  const len = Math.max(1e-6, Math.sqrt(x * x + y * y));
  return {
    x: x / len,
    y: y / len
  };
}

/**
 * Inline add a vector contribution to an existing one
 * 
 * @param v the output vector to add to 
 * @param a the scalar
 * @param w the input vector to add
 * @return the input vector v
 */
function pax(v, a, w){
  v.x += a * w.x;
  v.y += a * w.y;
  return v;
}

/**
 * Weighted sum of two vectors for general vector combinations
 *
 * @param a the first vector's scale parameter
 * @param x the first vector (with x and y components)
 * @param b the second vector's scale parameter
 * @param y the second vector (with x and y components)
 * @return the weighted sum (a*x + b*y) where x and y are 2d vectors
 */
function axpby(a, v, b, w){
  return {
    x: a * v.x + b * w.x,
    y: a * v.y + b * w.y
  };
}

/**
 * Weight sum of three vectors
 * 
 * @param {number}  a scalar 1
 * @param {{x,y}}   u vector 1
 * @param {number}  b scalar 2
 * @param {{x,y}}   v vector 2
 * @param {number}  c scalar 3
 * @param {{x,y}}   w vector 3
 * @return {{x,y}} the weight sum (a*x + b*y + c*z) where x,y,z are 2d vectors
 */
function axpbypcz(a, u, b, v, c, w){
  return {
    x: a * u.x + b * v.x + c * w.x,
    y: a * u.y + b * v.y + c * w.y
  };
}

/**
 * Check whether two bboxes intersect
 *
 * @param box1 first bbox
 * @param box2 second bbox
 * @return true if they intersect, false otherwise
 */
function bboxIntersect(box1, box2){
  // @see https://gamedev.stackexchange.com/questions/586/what-is-the-fastest-way-to-work-out-2d-bounding-box-intersection
  // = check for clear non-intersection
  return !(
     box2.min.x > box1.max.x
  || box2.max.x < box1.min.x
  || box2.min.y > box1.max.y
  || box2.max.y < box1.min.y
  );
}

/**
 * Check whether a point is outside of a bounding box
 * and beyond some delta margin
 *
 * @param pt { x, y }
 * @param bbox { min: {x,y}, max: {x,y} }
 * @param precision margin
 * @return whether pt is outside of bbox expanded by delta
 */
function outsideBBox({ x, y }, bbox, precision = epsilon){
  return x < bbox.min.x - precision
      || x > bbox.max.x + precision
      || y < bbox.min.y - precision
      || y > bbox.max.y + precision;
}

/**
 * Check whether a bbox contains a point
 *
 * @param bbox the bbox { min, max }
 * @param p the point { x, y }
 * @param precision the outside margin of error
 * @return whether p is within bbox
 */
function bboxContains(bbox, p, precision = epsilon){
  return !outsideBBox(p, bbox, precision);
}

/**
 * Checks whether the query point is within the given polygon
 * 
 * This uses the simple ray-casting algorithm variant.
 * For some robustness details, the winding algorithm is another variant.
 * 
 * @param {array} poly array of {x,y} points
 * @param {{x,y}} q query point
 * @return {boolean} true if the query is (strictly) inside the polygon
 * @see https://github.com/substack/point-in-polygon
 * @see http://geomalgorithms.com/a03-_inclusion.html
 */
function polyContains(poly, q){
  const { x, y } = q; // extract query components
  let inside = false;
  let { x: xp, y: yp } = poly[poly.length - 1]; // prev point
  for (let i = 0; i < poly.length; ++i) {
    const { x: xn, y: yn } = poly[i]; // next point
    
    // check segment intersection
    if((yn > y) !== (yp > y) // only can cross along x axis if y between (yp;yn)
    && x < (xp - xn) * (y - yn) / (yp - yn) + xn // segment crossing test
    ){
      // /!\ the division by yp - yn won't be computed
      // unless we're actually crossing a non-horizontal segment
      // => relatively safe (though may be off for bad mostly flat segments)
      inside = !inside;
    }

    // update last point
    [xp, yp] = [xn, yn];
  }
  return inside;
}

/**
 * Dot-product in R2
 *
 * @return v dot w
 */
function dot(v, w){
  return v.x * w.x + v.y * w.y;
}

/**
 * Cross-product in R3 with inputs set to Z=0.
 * The result is not returned as a vector like the usual cross product
 * but only the Z value is returned (since we only really need it).
 *
 * Useful trigonometric information:
 * 1. Sine value:
 *   | a cross b | = |a| |b| sin(theta)
 *
 * 2. Cross(a,b)_z = det(| a.x a.y |) = a.x b.y - b.x a.y
 *                     | b.x b.y |
 *
 * @return the z value of the cross product assuming both inputs have z=0
 */
function cross(v, w){
  return v.x * w.y - v.y * w.x;
}

/**
 * Scale a vector with a scalar
 *
 * @param { x, y } the vector
 * @param scaleX the scalar for the first dimension (or both if single given)
 * @param scaleY the scalar for the second dimension
 * @return the rescaled vector
 */
function scale({ x, y }, scaleX, scaleY){
  if(scaleY === undefined)
    scaleY = scaleX;
  return {
    x: scaleX * x,
    y: scaleY * y
  };
}

/**
 * Vector projection onto another vector serving as direction
 *
 * @param v { x, y }
 * @param dir { x, y }
 * @return the project of v onto dir
 */
function project(v, dir){
  return scale(unitVector(dir), dot(v, dir));
}

/**
 * Projection using only the sign of the dot-product
 * to decide whether to use the given direction as-is or reversed.
 * Tie cases are solved through a sign function provided by the user.
 *
 * @param u { x, y }
 * @param dir the direction to output (either as-is or reversed)
 * @param signFunc a sign function in case of zero projection
 */
function signProject(u, dir, signFunc){
  assert(signFunc, 'User must specify how to treat ties with a given sign function');
  if(typeof signFunc == 'number'){
    assert([1, -1].includes(signFunc), 'Cannot pass a number as sign function, unless it is exactly +/- 1');
    const sign = signFunc;
    signFunc = () => sign;
  }
  const d = dot(u, dir);
  return scale(dir, Math.sign(d) || signFunc());
}

/**
 * Project a 2D vector onto a basis (two orthonglal 2D vectors)
 * 
 * @param {{x,y}} v the vector to project
 * @param {{x,y}} ex the basis x vector
 * @param {{x,y}} ey the basis y vector
 * @return {{x,y}} the projection
 */
function projToBasis(v, ex, ey){
  return {
    x: dot(v, ex),
    y: dot(v, ey)
  };
}

/**
 * Linear interpolation
 *
 * @param a the minimum value at t=0
 * @param b the maximum value at t=1
 * @param t the time value
 * @return the interpolated value
 */
function lerp(a, b, t){
  return a + (b - a) * t;
}

/**
 * Reflect a ray through a normal interface
 *
 * @param ray the ray direction { x, y }
 * @param normal the interface direction { x, y }
 * @param invert whether to invert the outcome's direction (to do vector reflection around a line)
 * @return the reflected vector
 */
function reflectVector(ray, normal, invert){
  const d = dot(ray, normal); // the relative projection of {ray} with {normal}
  if(invert){
    return axpby(2*d, normal, -1, ray);
  } else {
    return axpby(1, ray, -2*d, normal);
  }
}

function rotatePoint({ x, y }, { angle = 0, cosa = -2, sina = -2 }){
  if(cosa === -2)
    cosa = Math.cos(angle);
  if(sina === -2)
    sina = Math.sin(angle);
  return {
    x: cosa * x - sina * y,
    y: sina * x + cosa * y 
  };
}

/**
 * Rotate a vector using a sequence of rotations
 * given either by scalars or vectors.
 *
 * Scalar rotation is done using the matrix transformation
 *
 * rot(a) = [cos(a) -sin(a)]
 *          [sin(a)  cos(a)]
 *
 * whereas vector rotation is done by assuming vectors
 * represent complex numbers, in which case rotation is just
 * a complex multiplication:
 *
 * v = vx + i * vy
 * w = wx + i * wy
 *
 * v * w = (vx * wx - vy * wy) + i (vx * wy + vy * wx)
 *
 * or
 *
 * v rot w = [vx] rot [wx] = [vx * wx - vy * wy]
 *           [vy]     [wy]   [vx * wy + vy * wx]
 *
 * About the scale:
 * The scale of that vector matters since pure rotations should have scale 1.
 * This means that you want to use a unit vector for vector rotation.
 * The input doesn't have to be a unit vector though.
 *
 * About the inverse:
 * Inverting a unit vector rotation is done by taking the conjugate
 * of that unit vector:
 *
 * v rot conj(v) == [1, 0] (zero angle)
 * <=> x: vx * vx - vy * (-vy) = vx * vx + vy * vy = 1 (unit v)
 *     y: vx * (-vy) + vy * vx = 0
 *
 * @param v the original vector
 * @param ...rots a sequence of rotations as scalar or vectors
 * @return the rotated vector
 */
function rotateVector(v, ...rots){
  let r = v;
  for(let rot of rots){
    if(typeof rot == 'number'){
      // scalar rotation
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      r = {
        x: cr * r.x - sr * r.y,
        y: sr * r.x + cr * r.y
      };
    } else {
      // complex (vector) rotation
      r = {
        x: r.x * rot.x - r.y * rot.y,
        y: r.x * rot.y + r.y * rot.x
      };
    }
  }
  return r;
}

function zeroRotationVector(){
  return { x: 1, y: 0 };
}

/**
 * Computes the rotation vector that rotates
 * an initial vector into a target vector.
 * 
 * @param {{x,y}} v initial vector
 * @param {{x,y}} w target vector
 * @return {{x,y}} the rotation vector from v to w
 */
function rotationVectorBetween(v, w){
  return rotateVector(v, conjugate(w));
}

/**
 * Compute the half-rotation vector from of a rotation vector
 * 
 * @param {{x,y}} v rotation vector
 * @return {{x,y}} the half-rotation vector
 */
function halfRotationVector(v){
  // some cases depending on where v is
  if(approximately(v.x, -1, 1e-3)){
    // v ~ rot(pi) = [-1, 0]
    return { x: 0, y: 1 };

  } else if(approximately(v.x, 1, 1e-3)){
    // v ~ rot(0) = [1, 0]
    return { x: 1, y: 0 };

  } else if(v.y >= 0){
    // v in rot([0;pi])
    const w = axpby(0.5, v, 0.5, { x: 1, y: 0 });
    return unitVector(w);

  } else {
    // v in rot([pi;2pi])
    // => rotate to rot([0;pi]),
    //    then take half vector,
    //    and finally add half of pi ~ [0, 1]
    const vm = rotateVector(v, { x: -1, y: 0 });
    const hvm = halfRotationVector(vm);
    return rotateVector(hvm, { x: 0, y: 1 });
  }
}

/**
 * Return the vector 90deg on the right of the argument
 *
 * @param { x, y } input vector
 * @return 90deg right vector
 */
function rightNormal({ x, y }){
  return {
    x: -y, y: x
  };
}

/**
 * Return the vector 90deg on the left of the argument
 *
 * @param { x, y } input vector
 * @return 90deg left vector
 */
function leftNormal({ x, y }){
  return {
    x: y, y: -x
  };
}

/**
 * Return the complex conjugate of a vector,
 * which corresponds to its rotation along the x-axis
 *
 * @param { x, y } input vector
 * @return { x, y: -y } conjugate
 */
function conjugate({ x, y }){
  return {
    x, y: -y
  };
}

/**
 * Return the X-mirrored version of a vector
 *
 * @param { x, y } input vector
 * @return { x: -x, y }
 */
function mirrorX({ x, y }){
  return {
    x: -x,
    y
  };
}

/**
 * Mean of multiple vectors
 *
 * @param ...vs the multiple vector arguments
 * @return the average of the input vectors
 */
function meanVector(vs){
  let x = 0;
  let y = 0;
  for(let v of vs){
    x += v.x;
    y += v.y;
  }
  const n = vs.length || 1;
  return {
    x: x / n,
    y: y / n
  };
}

/**
 * Compute the extents of a list of points
 *
 * @param {{x,y}[]} vs a list of points points
 * @param {{min,max}?} [initExt=null] the initial extents to reduce from
 * @return { min, max }
 */
function extents(vs, initExt = null){
  assert(vs.length, 'Needs at least one input');
  return vs.reduce((ext, p) => {
    return {
      min: {
        x: Math.min(ext.min.x, p.x),
        y: Math.min(ext.min.y, p.y)
      },
      max: {
        x: Math.max(ext.max.x, p.x),
        y: Math.max(ext.max.y, p.y)
      }
    };
  }, initExt || { min: vs[0], max: vs[0] });
}

/**
 * Convert radians to degrees, with an optional rounding
 *
 * @param rad the radians
 * @param round whether to round the degree output
 * @return the corresponding degree angle
 */
function radToDegree(rad, round){
  const deg = rad * 180 / Math.PI;
  return round ? Math.round(deg) : deg;
}

/**
 * Helper function to get degree of an angle given by a unit direction vector
 *
 * @param dir { x, y } unit vector
 * @param asDeg whether to output as degree (true) or radian (falsy)
 * @param round whether to round the output (only for degree mode)
 * @return the scalar angle
 */
function vectorAngle(dir, asDeg, round){
  const rad = Math.atan2(dir.y, dir.x);
  return asDeg ? radToDegree(rad, round) : rad;
}

class RunningMean {
  constructor(){
    this.mean = 0;
    this.samples = 0;
  }
  reset(mean, samples){
    this.mean = mean || 0;
    this.samples = samples || 0;
    assert(this.samples >= 0, 'Invalid sample count');
  }
  push(sample){
    this.mean = (this.samples * this.mean + sample) / (this.samples + 1);
    this.samples += 1;
  }
  get value(){
    return this.mean;
  }
}

function runningMean(){
  return new RunningMean();
}

function min(args){
  return args.reduce((min, arg) => Math.min(min, arg));
}

function argmin(f, args, withValue){
  if(Array.isArray(f))
    [args, f] = [f, args];
  const { arg, value } = args.reduce((min, arg) => {
    const value = f(arg);
    if(value < min.value)
      return { arg, value };
    else
      return min;
  }, { arg: args[0], value: Infinity });
  return withValue ? [arg, value] : arg;
}

function max(args){
  return args.reduce((max, arg) => Math.max(max, arg));
}

function argmax(f, args, withValue){
  if(Array.isArray(f))
    [args, f] = [f, args];
  const { arg, value } = args.reduce((max, arg) => {
    const value = f(arg);
    if(value > max.value)
      return { arg, value };
    else
      return max;
  }, { arg: args[0], value: -Infinity });
  return withValue ? [arg, value] : arg;
}

function minmax(args){
  return args.reduce(({ min, max }, arg) => {
    return {
      min: Math.min(min, arg),
      max: Math.max(max, arg)
    };
  }, {
    min: args[0],
    max: args[0]
  });
}

function argminmax(f, args, withValue){
  if(Array.isArray(f))
    [args, f] = [f, args];
  const { min, max } = args.reduce((acc, arg) => {
    const value = f(arg);
    if(value < acc.value)
      acc.min = { arg, value };
    if(value > acc.value)
      acc.max = { arg, value };
    return acc;
  }, {
    min: { arg: args[0], value: Infinity },
    max: { arg: args[0], value: -Infinity }
  });
  if(withValue)
    return { min: min.arg, max: max.arg };
  else
    return { min: [min.arg, min.value], max: [max.arg, max.value] };
}

function sum(args){
  return args.reduce((sum, arg) => sum + arg, 0);
}

function mean(args){
  return sum(args) / (args.length || 1);
}

function variance(args){
  const avg = mean(args);
  return args.reduce((sum, arg) => {
    const delta = arg - avg;
    return sum + delta * delta;
  }, 0) / (args.length || 1);
}

function svariance(args){
  const avg = mean(args);
  return args.reduce((sum, arg) => {
    const delta = arg - avg;
    return sum + delta * delta;
  }, 0) / Math.max(args.length - 1, 1);
}

function stddev(args){
  return Math.sqrt(variance(args));
}

function sstddev(args){
  return Math.sqrt(svariance(args));
}

function median(args){
  args.sort((a,b) => a - b);
  if(args.length % 2)
    return args[Math.ceil(args.length / 2)];
  else {
    const i = Math.floor(args.length / 2);
    return (args[i] + args[i + 1]) * 0.5;
  }
}

/**
 * Create a single-time evaluation function
 * that will return the value of the call to the argument
 * and then memorize it so as to not recompute it again.
 *
 * @param f a function generating a value
 * @return a memoized version of f
 */
function lazy(f){
  let value;
  let computed = false;
  return (...args) => {
    assert(args.length === 0, 'Lazy invokation should not have any argument');
    if(!computed){
      value = f();
      computed = true;
    }
    return value;
  };
}

function memoize(f, idFun){
  if(!idFun)
    idFun = args => args.join('@');
  const map = {};
  return (...args) => {
    assert(args.length > 0, 'Memoized invokation should have some argument, else use lazy(f) instead');
    const id = idFun(args);
    if(id in map)
      return map[id];
    else {
      const value = f(...args);
      map[id] = value;
      return value;
    }
  };
}


function toDecimal(x, d){
  const p = Math.pow(10, d);
  return Math.round(x * p) / p;
}

function toDecimalString(x, d){
  const y = toDecimal(x, d).toString();
  const idx = y.indexOf('.');
  return idx != -1 ? y.slice(0, idx + 1 + d) : y;
}

function toParString(v, dec = -1){
  if(dec !== -1)
    return '(' + toDecimalString(v.x, dec) + ', ' + toDecimalString(v.y, dec) + ')';
  else
    return '(' + v.x + ', ' + v.y + ')';
}

function dx(p, d){
  return {
    x: p.x + d, y: p.y
  };
}
function dy(p, d){
  return {
    x: p.x, y: p.y + d
  };
}

function *circularPairs(list){
  for(let i = 0, j = list.length - 1; i < list.length; j = i++)
    yield [list[j], list[i]];
}

function *linspace(a, b, n, includeLast = true){
  const d = (b-a) / (n-1);
  const N = includeLast ? n : n-1;
  for(let i = 0, x = a; i < N; ++i, x += d)
    yield x;
}

function *logspace(a, b, n, base = 2){
  for(const x of linspace(a, b, n))
    yield Math.pow(base, x);
}

function *geomspace(a, b, n){
  const logA = Math.log2(a);
  const logB = Math.log2(b);
  yield *logspace(logA, logB, n, 2);
}

function *permutations(N, circular = false, offset = 0){
  assert(N > 0, 'Invalid permutation number');
  if(N === 1){
    // base case
    yield [ offset ];

  } else if(circular){
    // circular case with intial perm[0]=0 fixed
    for(const perm of permutations(N-1, false, offset + 1)){
      yield [0].concat(perm);
    }

  } else {
    // general case
    // = generate in lexicographical order
    // @see https://en.wikipedia.org/wiki/Permutation#Algorithms_to_generate_permutations
    const perm = Array.from({ length: N }, (_, i) => offset + i);
    yield perm.slice();
    let k = N-2, l = N-1;
    do {

      // swap perm[k] and perm[l]
      const t = perm[k];
      perm[k] = perm[l];
      perm[l] = t;

      // reverse subsequence after k
      for(let i = k + 1, j = N - 1; i < j; ++i, --j){
        const m = perm[i];
        perm[i] = perm[j];
        perm[j] = m;
      }

      // yield new permutation
      yield perm.slice();

      // find k
      k = -1;
      for(let i = 1; i < N; ++i){
        if(perm[i-1] < perm[i])
          k = i-1;
      }
      if(k >= 0){
        // find l (it must exist since k exists)
        l = k + 1; // smallest l value
        for(let i = k + 2; i < N; ++i){
          if(perm[k] < perm[i])
            l = i; // later l value
        }
      }
    } while(k >= 0);
  }
}

module.exports = {
  // distances
  distBetween, sqDistBetween, distBetweenBelow, distBetweenAbove,
  distToSegment,
  distToLine,
  // point operations
  alignPoint,
  reflectPoint,
  reflectPointAcrossLine,
  rotatePoint,
  // vector operations
  dot, length, extents,
  cross,
  reflectVector,
  rotateVector, zeroRotationVector,
  rotationVectorBetween,
  halfRotationVector,
  unitVector, meanVector,
  project, signProject, projToBasis,
  pax, axpby, axpbypcz, scale,
  rightNormal, leftNormal, conjugate, mirrorX,
  vectorAngle,
  projToLine, projToSegment,
  lineInterLine,
  lineInterSegment,
  segInterSegment,
  segInterPolygon,
  circInterCircle,
  dx, dy,
  // polygon operations
  signedArea, area,
  barycentricComponents,
  barycentricCoordinates,
  inTriangle,
  // bbox operations
  bboxIntersect, bboxContains, outsideBBox,
  // polygon operations
  polyContains,
  // scalar operations
  lerp, radToDegree,
  approximately, between, below, above,
  belowOrEqualTo, aboveOrEqualTo,
  epsilon,
  min, max, minmax,
  argmin, argmax, argminmax,
  mean, median,
  variance, stddev, svariance, sstddev,
  toDecimal, toDecimalString, toParString,
  // series
  runningMean, RunningMean,
  // spaces
  linspace, logspace, geomspace,
  // iterators
  circularPairs, permutations,
  // memoization
  lazy, memoize
};
