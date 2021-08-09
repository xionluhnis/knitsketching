// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const Transform = require('./transform.js');
const geom = require('../geom.js');

// sketch element id
let __maxID = -1;

// constants
const HIT_OBJECT_MASK = 0xFFF;  // 1/2g + b
const HIT_DATA_MASK   = 0xFFF;  // r + 1/2g
const HIT_DATA_SHIFT  = 12;     // rgb => 24 bits, half is 12
const DATA_MODE = 'data';
const JSON_MODE = 'json';
const SERIALIZATION_MODES = [DATA_MODE, JSON_MODE];

/**
 * Generic sketch object
 *
 * Properties:
 *  - id = unique identifier
 *  - name = string that users can use as visual label
 *  - transform = Transform mapping local context to global context
 *    -> transform.applyTo(pt) maps pt (in local object context) to the global context
 *    -> transform.unapplyFrom(globalPos) maps a global position to the local object context
 *  - parent = the parent object (or null by default, when not parented)
 *  - children = the list of children objects
 *
 * For now, we will only support single-parenting and not further relationship.
 * This is because sketches as children layers should use the same wale flow as their parents.
 * Otherwise, it will become very hard to ensure reasonable knittability constraints.
 */
class SketchObject {
  constructor(name, transform, parent, children){
    this.id = ++__maxID;
    this.name = name || '';
    this.transform = transform || Transform.identity(); // 2d transformation
    this.parent = parent || null; // parent context
    this.children = children || []; // sub-objects
  }

  static resetUUID(maxID = -1){
    __maxID = maxID;
  }

  /**
   * Returns whether the object is x-mirrored
   */
  hasMirrorX(){
    return this.transform.mirrorX;
  }

  /**
   * Indirect transform update
   * that triggers udpateTransform
   *
   * @param transform the new transform
   */
  setTransform(transform){
    assert(transform, 'Invalid transform');
    this.transform = transform;
    this.updateTransform();
  }

  /**
   * Hook for transform updates
   */
  updateTransform(){}

  root(){
    return this.parent ? this.parent.root() : this;
  }

  isRoot(){ return this.parent === null; }
  hasParent(){ return !this.isRoot(); }

  // constrained movements
  isConstrained(){ return false; }

  get type(){
    return 'object';
  }

  copy(newObj){
    if(!newObj)
      newObj = new SketchObject(this.name);
    else
      newObj.name = this.name;
    // apply transforms of parents onto to this
    if(this.parent){
      assert(!this.parent.parent, 'Supporting only single-level parenting');
      newObj.setTransform(this.parent.transform.combineWith(this.transform));
    } else {
      // same transformation
      newObj.setTransform(this.transform.copy());
    }
    // copy children and assign new parent
    for(let child of this.children){
      const newChild = child.copy();
      newChild.setParent(newObj);
    }
    return newObj;
  }
  toData(opts = {}){
    return this.serialize(Object.assign({ mode: 'data' }, opts));
  }
  toJSON(opts = {}){
    return this.serialize(Object.assign({ mode: 'json' }, opts));
  }
  serialize(opts){
    assert('mode' in opts, 'Serialize requires a `mode` option');
    assert(SERIALIZATION_MODES.includes(opts.mode),
      'Invalid serialization `mode`');
    return {
      id: this.id, type: this.type, name: this.name,
      transform: this.transform.toJSON(),
      parent: this.parent ? this.parent.id : null,
      children: this.children.map(c => c.serialize(opts))
    };
  }
  deserialize(data, map, useID){
    assert('id' in data, 'Missing id');
    // special case
    if(useID) {
      // preserve sketch id so we can map nicely back
      // /!\ means that the IDs are wrong on this side
      // so no new sketch should be created
      this.id = data.id;
      // make sure static maxID is at list this id
      __maxID = Math.max(__maxID, this.id);
    }
    // register us in map
    if(map) {
      // /!\ the data maps to the old object id
      // => we must use the id from the data
      assert(!(data.id in map), 'Non-bijective mapping');
      map[data.id] = this;
    }
    // /!\ type is read-only
    // load name and transform
    this.name = data.name || "";
    assert('transform' in data, 'Missing transform');
    this.setTransform(Transform.from(data.transform));
    // set parent id for now
    this.parent = data.parent;
  }
  remap(map){
    // remap parent
    if(this.parent !== null){
      this.parent = map(this.parent);
    }
    // remap children
    for(const child of this.children){
      child.remap(map);
    }
  }

  freeChild(/* skObj */){
    // nothing to do in this case
    // this is to be re-implemented by parent
  }

  setParent(parent){
    // check it's not already our parent
    if(this.parent === parent)
      return;
    // remove any current parent
    if(this.parent){
      assert(!this.parent.parent, 'Only supporting single-level parenting');
      assert(!this.children.length, 'Only supporting single-level parenting');
      // apply transform
      this.setTransform(this.parent.transform.combineWith(this.transform));
      // remove from parent's children
      this.parent.children.splice(this.parent.children.indexOf(this), 1);
      // call free method
      this.parent.freeChild(this);
      // unset parent link
      this.parent = null;
    }

    // set new parent
    if(parent){
      assert(!parent.parent, 'Only supporting single-level parenting');
      assert(parent.children.indexOf(this) === -1, 'Already within children?');
      // must remove all children first
      // because we only support single-level parenting
      while(this.children.length){
        const c = this.children[0];
        c.setParent(null);
      }
      // set new parent
      this.parent = parent;
      // undo parent's transformation on self
      this.setTransform(this.parent.transform.inverse().combineWith(this.transform));
      // add to parent's children
      this.parent.children.push(this);
    }
  }

  moveChildToBack(skobj){
    assert(skobj.parent === this, 'Not a child of this object', skobj, this);
    const idx = this.children.indexOf(skobj);
    assert(idx !== -1, 'Could not find the child');
    // move to last
    if(idx !== this.children.length - 1){
      this.children.splice(idx, 1);
      this.children.push(skobj);
      return true;
    } else {
      // nothing to do as already at back
      return false;
    }
  }

  moveChildToFront(skobj){
    assert(skobj.parent === this, 'Not a child of this object', skobj, this);
    const idx = this.children.indexOf(skobj);
    assert(idx !== -1, 'Could not find the child');
    // move to last
    if(idx !== 0){
      this.children.splice(idx, 1);
      this.children.unshift(skobj);
      return true;
    } else {
      // nothing to do as already at front
      return false;
    }

  }

  hitTest(/* q */){ return false; }
  withinExtents(p){
    const bbox = this.extents();
    return geom.bboxContains(bbox, p);
  }

  /**
   * Returns the list of SketchObject instances to the global parent-most one,
   * including this object as first one.
   *
   * This corresponds to the inverse of the stack to enter this context.
   */
  getContextStack(){
    const stack = [this];
    let parent = this.parent;
    while(parent){
      stack.push(parent);
      parent = parent.parent;
    }
    return stack;
  }

  get fullTransform(){
    if(!this.parent)
      return this.transform.copy();
    // else use stack
    const stack = this.getContextStack();
    let xform = stack[stack.length - 1].transform.copy();
    for(let i = stack.length - 2; i >= 0; --i)
      xform = xform.combineWith(stack[i].transform);
    return xform;
  }

  get fullScale(){
    if(this.parent)
      return this.parent.fullScale * this.transform.k;
    else
      return this.transform.k;
  }

  /**
   * Transform a position from this object's local coordinate system
   * into the parent coordinate system (global if root)
   * 
   * @param {{x,y}} pos position in local coordinates
   * @return {{x,y}} the position in parent coordinates (global if root)
   */
  localToParent(pos){
    return this.transform.applyTo(pos);
  }
  /**
   * Transform a position from the parent coordinate system (global if root)
   * into this object's local coordinate system
   * 
   * @param {{x,y}} pos position in parent coordinates
   * @return {{x,y}} the position in local coordinates
   */
  parentToLocal(pos){
    return this.transform.unapplyFrom(pos);
  }
  /**
   * Transform a position from this object's local coordinate system
   * into the global coordinate system
   * 
   * @param {{x,y}} pos position in local coordinates
   * @return {{x,y}} the position in global coordinates
   */
  localToGlobal(pos){
    return this.fullTransform.applyTo(pos);
  }
  /**
   * Transform a position from the global coordinate system
   * into this object's local coordinate system
   * 
   * @param {{x,y}} pos position in global coordinates
   * @return {{x,y}} the position in local coordinates
   */
  globalToLocal(pos){
    return this.fullTransform.unapplyFrom(pos);
  }

  /**
   * Compute the global-domain centroid of this object
   *
   * This assumes the object implements the local centroid property / getter.
   *
   * @return { x, y }
   */
  globalCentroid(){
    return this.localToGlobal(this.centroid);
  }

  /**
   * Compute global-domain extents of this object.
   *
   * This assumes the object implements its local extents() method.
   *
   * @param {{min,max}} [currExt=null] global extents to extend (for accumulation)
   * @return the updated global extents
   */
  globalExtents(currExt = null){
    return this.transformedExtents(currExt, this.fullTransform);
  }
  parentExtents(currExt){
    return this.transformedExtents(currExt, this.transform);
  }
  transformedExtents(currExt, xform){
    // /!\ cannot directly pass currExt as accumulator since different contexts
    // unless we bring it in the same context by undoing this context's
    // full transform (may lead to errors through accumulation)
    const { min, max } = this.extents();
    const newExt = {
      min: xform.applyTo(min),
      max: xform.applyTo(max)
    };
    if(xform.mirrorX){
      // may need to switch minX and maxX because of mirroring
      const minX = Math.min(newExt.min.x, newExt.max.x);
      // const minY = Math.min(newExt.min.y, newExt.max.y);
      const maxX = Math.max(newExt.min.x, newExt.max.x);
      // const maxY = Math.max(newExt.min.y, newExt.max.y);
      newExt.min = { x: minX, y: newExt.min.y };
      newExt.max = { x: maxX, y: newExt.max.y };
    }
    if(currExt){
      // instead of unapplying the transform onto the global accumulator,
      // we just merge the two contexts after they are in the global context
      return {
        min: {
          x: Math.min(newExt.min.x, currExt.min.x),
          y: Math.min(newExt.min.y, currExt.min.y)
        },
        max: {
          x: Math.max(newExt.max.x, currExt.max.x),
          y: Math.max(newExt.max.y, currExt.max.y)
        }
      };
    } else {
      return newExt;
    }
  }

  get hitValue(){
    return (this.id + 1) & HIT_OBJECT_MASK;
  }

  get hitColor() {
    let str = this.hitValue.toString(16);
    while(str.length != 6)
      str = '0' + str;
    return '#' + str;
  }

  getHITColor(data){
    let str = (this.hitValue | (data & HIT_DATA_MASK) << HIT_DATA_SHIFT).toString(16);
    while(str.length != 6)
      str = '0' + str;
    return '#' + str;
  }

  getHITData(hit){
    if(this.hitValue === (hit & HIT_OBJECT_MASK)){
      return (hit >> HIT_DATA_SHIFT) & HIT_DATA_MASK;
    } else {
      return -1;
    }
  }
}

module.exports = Object.assign(SketchObject, {
  // serialization modes
  DATA_MODE,
  JSON_MODE,
  // hit masks and shifts
  HIT_DATA_MASK,
  HIT_DATA_SHIFT,
  HIT_OBJECT_MASK
});
