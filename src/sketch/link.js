// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const geom = require('../geom.js');
const Constraint = require('./constraint.js');
const Curve = require('./curve.js');

// constants
const DEFAULT   = 'default';
const ALIGNED   = 'aligned';
const SAME      = 'same';
const REVERSED  = 'reverse';
const SYMMETRIC = 'symmetric';
const UNRELATED = 'unrelated';
const INVALID   = 'invalid';
const TRANSMISSION_TYPES = [
  DEFAULT, ALIGNED, SAME, REVERSED, SYMMETRIC, UNRELATED
];

// global state
const links = new Set();
let dirty = false;
function register(link){
  links.add(link);
  dirty = true;
}
function unregister(link){
  links.delete(link);
  dirty = true;
}
function updateOrder(){
  // sort links
  const order = Array.from(links);
  order.sort((l1, l2) => {
    if(l1.parent.id !== l2.parent.id)
      return l1.parent.id - l2.parent.id;
    return l1.index - l2.index;
  });
  // update link ranks
  for(const link of order)
    link.order = 0;
  for(let i = 0, ord = 1; i < order.length; ++i){
    const link = order[i];
    if(link.order || link.isParentLink())
      continue; // already ranked or a parent link (without rank)
    link.order = link.otherSide.order = ord; // both sides get same order
    ++ord;
  }
}
const warningChar = String.fromCharCode(0x26A0);

class Link {
  constructor(
    parent, index, target, targetIndex,
    mirror, transmission, noCheck
  ){
    this.parent = parent;
    this.index  = index;
    // target
    this.target = target;
    this.targetIndex = targetIndex;
    // mirror case
    this.mirror = !!mirror;
    // flow transmission mode
    if(this.isParentLink())
      this.transmission = INVALID;
    else
      this.transmission = transmission || DEFAULT;
    // register link
    this.order = 0;
    register(this);
    if(noCheck)
      return;
    assert(this.isParentLink() || (targetIndex >= 0 && targetIndex < target.length), 'Link out-of-bounds');
    assert(!mirror || parent.other == target, 'Invalid mirror link');
  }

  static clear(){
    links.clear();
  }

  toJSON(){
    return {
      parent: this.parent.id,
      index:  this.index,
      target: this.target.id,
      targetIndex: this.targetIndex,
      mirror: !!this.mirror
    };
  }

  resolveTransmissionType(t = 0.5){
    if(this.transmission === DEFAULT){
      return this.hasSeamAt(t) ? UNRELATED : ALIGNED;
    } else {
      return this.transmission;
    }
  }

  hasTransmission(t = 0.5){
    return this.resolveTransmissionType(t) !== UNRELATED;
  }

  setTransmissionType(transmission = DEFAULT, setOtherSide = true){
    assert(this.isBorderLink(),
      'Cannot set transmission type of parent link');
    assert(TRANSMISSION_TYPES.includes(transmission),
      'Unsupported transmission type');
    this.transmission = transmission;
    // update the other side (without recursion)
    if(setOtherSide)
      this.otherSide.setTransmissionType(transmission, false);
  }

  static mergeTransmissionTypes(type0, type1){
    assert(type0 || type1, 'No transmission type');
    if(!type1 || type1 === UNRELATED)
      return type0;
    if(!type0 || type0 === UNRELATED)
      return type1;
    if(type0 === type1)
      return type0;
    const types = [type0, type1];
    // pairs from [ALIGNED, SAME, REVERSED, SYMMETRIC]
    if(types.includes(ALIGNED))
      return ALIGNED;
    // pairs from [SAME, REVERSE, SYMMETRIC]
    if(types.includes(SYMMETRIC))
      return types.find(type => type !== SYMMETRIC);
    // pair from [SAME, REVERSE]
    return ALIGNED; // because it encompasses both
  }

  remove(){
    // remove from this side
    this.parent.links[this.index] = null;
    unregister(this);

    // remove from other side
    if(!this.isParentLink()){
      unregister(this.otherSide);
      this.target.links[this.targetIndex] = null;
    }
  }

  updateIndex(map){
    this.index = map(this.index);
    // links to parent don't need to update
    // the other side, since there is none (implicit)
    if(this.isSelfLink()){
      this.targetIndex = map(this.targetIndex);
      // note: do not update other side since
      // that side will get updated
    } else if(!this.isParentLink()){
      // note: the other side is not updating at the same time
      this.otherSide.targetIndex = this.index; // updated index
    }
    // index changed => order is dirty
    dirty = true;
  }

  get length(){
    return this.parent.getSegmentLength(this.index);
  }

  get prev(){
    return this.parent.getLink(this.index - 1);
  }

  get next(){
    return this.parent.getLink(this.index + 1);
  }

  get degree(){
    return this.parent.getDegree(this.index);
  }

  get maxDegree(){
    return this.isParentLink() ? this.degree : Math.max(this.degree, this.otherSide.degree);
  }

  get otherSide(){
    return this.isParentLink() ? null : this.target.getLink(this.targetIndex);
  }

  getSegment(){
    return this.isBorderLink() ? this.parent.getSegment(this.index) : null;
  }
  getOtherSegment(){
    return this.isBorderLink() ? this.target.getSegment(this.targetIndex) : null;
  }

  isParentLink(){ return this.target === this.parent.parent; }
  isSelfLink(){ return this.target === this.parent; }
  isBorderLink(){ return this.target !== this.parent.parent; }
  isMirrorLink(){ return this.mirror; }

  checkMirrorLink(){
    // mirror link valid if
    // - linked to other side of parent, and
    // - has same end points and end control points in both local contexts

    // 1) check link to other side of parent
    if(this.target !== this.parent.other)
      return false;
    // 2) check endpoints
    if(geom.distBetween(this.parent.getPoint(this.index), this.target.getPoint(this.targetIndex), 'l1') > 1e-3)
      return false;
    if(geom.distBetween(this.parent.getPoint(this.index + 1), this.target.getPoint(this.targetIndex + 1), 'l1') > 1e-3)
      return false;
    // 3) check degrees
    const d0 = this.parent.getDegree(this.index);
    const d1 = this.target.getDegree(this.targetIndex);
    if(d0 != d1)
      return false;
    // 3) check control points
    const cs0 = this.parent.getControlPoint(this.index, Curve.CTRL_START);
    const cs1 = this.target.getControlPoint(this.targetIndex, Curve.CTRL_START);
    if(cs0 && geom.distBetween(cs0, cs1, 'l1') > 1e-3)
      return false;
    const ce0 = this.parent.getControlPoint(this.index + 1, Curve.CTRL_END);
    const ce1 = this.target.getControlPoint(this.targetIndex + 1, Curve.CTRL_END);
    if(ce0 && geom.distBetween(ce0, ce1, 'l1') > 1e-3)
      return false;
    // otherwise, it's a valid mirror link
    return true;
  }

  canMirror(){ return !this.isParentLink() && this.target.hasBack(); }
  setMirror(){
    if(this.isMirrorLink())
      return; // nothing to do, already a mirror link
    if(!this.canMirror()){
      assert.error('Cannot mirror the link');
      return;
    }
    // get point indices of this side
    const i0 = this.index;
    const i1 = this.index + 1;
    // get link on other side
    const other = this.otherSide;
    // mark as linked
    other.mirror = this.mirror = true;
    // reset points and control points
    const curve = this.parent;
    const cps = curve.getControlPoint(i0, Curve.CTRL_START);
    const cpe = curve.getControlPoint(i1, Curve.CTRL_END);
    // reset points
    curve.setPoint(i0, curve.getPoint(i0), false);
    curve.setPoint(i1, curve.getPoint(i1), false);
    // reset control points
    curve.setControlPoint(i0, Curve.CTRL_START, cps && cps.pos(), false);
    curve.setControlPoint(i1, Curve.CTRL_END,   cpe && cpe.pos(), false);
  }
  breakMirror(){
    assert(this.isMirrorLink(),
      'Cannot break the mirroring of a non-mirror link');
    this.mirror = false;
    const link = this.otherSide;
    if(link)
      link.mirror = false;
  }

  /**
   * Returns whether the link inverts time.
   *
   * /!\ This inversion happens when both sides have the same orientation,
   * since the "inward"-ness would then be inverted across both sides.
   *
   * Example:
   *
   *     +      +
   *   / | <--> | \
   *  /  | <--> |  \
   * +---+      +---+
   *
   * CW - CCW => the vertical link in between matches
   *          => not inverting (time is compatible)
   *
   * But
   * CW - CW or CCW - CCW
   *          => the vertical link does not match
   *          => inverting time
   *
   * @return whether both sides have the same orientation
   */
  isInverting(){
    return this.parent.orientation == this.target.orientation;
  }

  /**
   * Return the corresponding time across the link
   *
   * @param t the time on this side of the link (within [0;1])
   * @return t or 1-t depending on the relative orientation
   */
  linkedTime(t){
    //
    // /!\ For the other side, we need to know whether both sides connect directly
    // or in the opposite direction (in which case, the location is at (1-t)).
    // => use curve orientation to check that
    return this.isInverting() ? 1 - t : t;
  }

  /**
   * Get the vector rotation induced by going from the other side of this link to this side.
   *
   * @param t the location where to check the induced rotation along the link
   * @return { x, y } a vector rotation from the other side to this side
   */
  getRotation(t){
    assert(!this.isParentLink(), 'Not rotation for parent links');
    // compute rotation from other side to this side
    // = rotate to take orientation difference between
    //   two curve's sides into account
    const tng = geom.unitVector(this.parent.getSegment(this.index).derivative(t, true));
    // get the time on the other side of the link
    const lt = this.linkedTime(t);
    const ltng = geom.unitVector(this.target.getSegment(this.targetIndex).derivative(lt, true));
    // rotation depends on relative orientations
    // note: zero-angle is rot=[1,0]
    if(this.isInverting()){
      // zero angle when tng == -ltng
      const rot = geom.rotateVector(tng, geom.conjugate(geom.scale(ltng, -1)));
      return rot;
    } else {
      // zero angle when tng == ltng
      const rot = geom.rotateVector(tng, geom.conjugate(ltng));
      return rot;
    }
  }

  getDirection(t){
    assert(!this.isParentLink(), 'Not rotation for parent links');
    const n = this.parent.getSegment(this.index).normal(t, true);
    assert(!Number.isNaN(n.x) && !Number.isNaN(n.y),
      'Invalid direction');
    return this.parent.isInward() ? geom.scale(n, -1) : n;
  }

  hasSeamAt(t, checkOtherSide = true){
    const constr = this.parent.getBorderConstraint(this.index, t);
    if(constr && constr.type === Constraint.SEAM){
      return true; // seam on this side

    } else if(checkOtherSide){
      // check potential seam on other side (unless arg=false)
      const lt = this.linkedTime(t);
      return this.otherSide.hasSeamAt(lt, false);

    } else {
      return false; // no seam on this side
    }
  }

  static check(sketch1, segIdx1, sketch2, segIdx2, invalidThrow = false){
    if(sketch1.parent === sketch2){
      return Link.check(sketch2, segIdx2, sketch1, segIdx1);

    } else if(sketch2.parent === sketch1){
      // parent linking => as a layer
      // XXX could measure overlap and if outside parent, classify as bad
      
      // for now, we classify as no-error
      return {
        valid: true,
        error: 0.0
      };

    } else if(!sketch1.isRoot() || !sketch2.isRoot()) {
      // link from a child layer to another sketch
      // /!\ this should NOT happen
      assert(!invalidThrow, 'Invalid link across non-parent sketches');
      return {
        valid: false,
        error: Infinity,
        message: 'Link from child layer to non-parent sketch'
      };

    } else {
      // traditional link from root sketch to root sketch
      // no error, but quality depends on matching edge lengths
      const len1 = sketch1.getSegmentLength(segIdx1);
      const len2 = sketch2.getSegmentLength(segIdx2);
      const delta = Math.abs(len1 - len2);
      const minLen = Math.min(len1, len2);
      const error = 2 * delta / (len1 + len2); // relative error
      let message;
      if(delta >= minLen * 2)
        message = 'Large deformation! Consider darts or pleats.';
      else if(delta >= minLen * 1.5)
        message = 'Medium deformation. Flow may become unstable.';
      return {
        valid: true,
        error, message
      };
    }
  }
  check(){
    return Link.check(
      this.parent, this.index,
      this.target, this.targetIndex,
      true
    );
  }

  get label(){
    const { message } = this.check();
    if(this.isParentLink())
      return message ? '= ' + warningChar : '=';
    if(dirty)
      updateOrder();
    const str = this.order.toString(16).toUpperCase();
    return message ? str + ' ' + warningChar : str;
  }
}

module.exports = Object.assign(Link, {
  DEFAULT, ALIGNED, SAME, REVERSED, SYMMETRIC, UNRELATED, INVALID,
  TRANSMISSION_TYPES
});