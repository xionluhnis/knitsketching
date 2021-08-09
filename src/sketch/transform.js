// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');

/**
 * Regular affine matrix transformation
 * for homogeneous coordinates [x y 1]^T
 *
 *     [kx 0 x]
 * M = [0 ky y]
 *     [0 0  1]
 *
 *            [kx*p_x + x]
 * p' = M p = [ky*p_y + y]
 *            [     1    ]
 *
 * Inverse:
 *              [1 0 0]
 * M^-1 M = I = [0 1 0]
 *              [0 0 1]
 *
 *           [p_x]   [ 1/kx * (kx*p_x + x) - x/kx ]   [1/kx 0  -x/kx] [kx*p_x + x]
 * M^-1 p' = [p_y] = [ 1/ky * (ky*p_y + y) - y/ky ] = [ 0 1/ky -y/ky] [ky*p_y + y]
 *           [ 1 ]   [              1             ]   [ 0   0     1 ] [     1    ]
 * 
 *
 *        [1/k 0 -x/k]
 * M^-1 = [0 1/k -y/k]
 *        [0   0   1 ]
 */
class Transform {
  constructor(x = 0, y = 0, k = 1, mirrorX = false, mirrorY = false){
    this.x = x;
    this.y = y;
    this.k = k;
    assert(this.k > 0, 'Invalid transform');
    this.mirrorX = mirrorX;
    this.mirrorY = mirrorY;
  }

  get kx(){
    return this.mirrorX ? -this.k : this.k;
  }
  get ky(){
    return this.mirrorY ? -this.k : this.k;
  }

  transform(...args){
    switch(args.length){
      // xform.transform(xform)
      // xform.transform(pt)
      case 1:
        if('k' in args[0])
          return this.combineWith(args[0]);
        else {
          assert('x' in args[0] && 'y' in args[0], 'Invalid argument');
          return this.applyTo(args[0]);
        }
        break;

      // xform.transform(x, y)
      case 2:
        return this.applyTo({ x: args[0], y: args[1] });

      // xform.transform(x, y, k)
      case 3:
        return this.combineWith({ x: args[0], y: args[1], k: args[2] });

      // something unexpected
      default:
        assert.error('Invalid arguments');
    }
  }

  applyToX(x){
    return this.x + x * this.kx;
  }

  applyToY(y){
    return this.y + y * this.ky;
  }

  applyTo({ x, y }) {
    return {
      x: x * this.kx + this.x, //this.applyToX(x),
      y: y * this.ky + this.y  //this.applyToY(y)
    };
  }

  // application of inverse mapping
  unapplyFrom({ x, y }){
    const ikx = 1.0 / this.kx;
    const iky = 1.0 / this.ky;
    return {
      x: x * ikx - this.x * ikx,
      y: y * iky - this.y * iky
    };
  }

  /**
   * Transform combination
   *
   * [kx1 0 x1] [kx2 0 x2]   [kx1*kx2 0 kx1*x2+x1]
   * [0 ky1 y1] [0 ky2 y2] = [0 ky1*ky2 ky1*y2+y1]
   * [0   0  1] [0   0  1]   [0       0         1]
   *
   * /!\ Beware: this is not commutative!
   *        T1 * T2 != T2 * T1
   * => the order matters!
   *
   * @param xform the transform to follow
   * @param prepend whether to use the opposite combination direction
   * @return the new transform after combining with the next xform
   */
  combineWith(xform, prepend){
    if(prepend)
      return xform.combineWith(this);
    assert('x' in xform
        && 'y' in xform
        && 'k' in xform,
      'Invalid transform argument');
    return new Transform(
      this.kx * xform.x + this.x,
      this.ky * xform.y + this.y,
      this.k * xform.k,
      this.mirrorX != xform.mirrorX
    );
  }

  // replace with a transform
  reset(xform){
    this.x = xform.x;
    this.y = xform.y;
    this.k = xform.k;
    this.mirrorX = xform.mirrorX;
    return this;
  }

  copy(){
    return new Transform(this.x, this.y, this.k, this.mirrorX);
  }

  translatedBy(dx, dy){
    return this.combineWith(Transform.translation(dx, dy));
  }

  scaledBy(dk){
    return this.combineWith(Transform.scaling(dk));
  }

  prescaledBy(dk){
    return Transform.scaling(dk).combineWith(this);
  }

  mirrored(){
    return this.combineWith(Transform.mirroring());
  }

  inverse(){
    return new Transform(- this.x / this.kx, - this.y / this.ky, 1.0 / this.k, this.mirrorX);
  }

  toArray(){
    return [this.x, this.y, this.k, this.mirrorX];
  }

  matches({ x, y, k, mirrorX = false }){
    return this.x === x
        && this.y === y
        && this.k === k
        && this.mirrorX === mirrorX;
  }

  toJSON(){
    return { x: this.x, y: this.y, k: this.k, mirrorX: this.mirrorX };
  }

  toSVGString(){
    return 'translate(' + this.x + ', ' + this.y + ') scale(' + this.kx + ', ' + this.ky + ')';
  }

  static from({ x = 0, y = 0, k = 1, mirrorX = false, mirrorY }){
    return new Transform(x, y, k, mirrorX, mirrorY);
  }

  static identity(){
    return new Transform();
  }

  static translation(x, y){
    return new Transform(x, y);
  }

  static scaling(k){
    return new Transform(0, 0, k);
  }

  static mirroring(){
    return new Transform(0, 0, 1, true);
  }

  static applySVGTransform(xform, { x, y }){
    return {
      x: xform.a * x + xform.c * y + xform.e,
      y: xform.b * x + xform.d * y + xform.f
    };
  }
}

module.exports = Transform;
