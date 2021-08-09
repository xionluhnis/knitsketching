// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const Curve = require('./curve.js');
const PCurve = require('./pcurve.js');
const Link = require('./link.js');
const KappaConstraint = require('./kappa.js');
const FlowConstraint = require('./constraint.js');
const SketchAnchor = require('./anchor.js');
const SketchRectangle = require('./rectangle.js');
const S = FlowConstraint.constants;
// const Bezier = require('bezier-js');

function normIndex(idx, len){
  if(idx < 0)
    idx += len;
  if(idx >= len)
    idx -= len;
  return idx;
}

class Sketch extends Curve {
  constructor(){
    super();
    // properties
    this.links  = [];
    this.constraints = [];
    this.kappas = [];
    // back sketch
    this.other  = null;
  }

  get type(){
    return 'sketch';
  }

  copy(newSketch){
    newSketch = super.copy(newSketch || new Sketch());
    newSketch.links   = Array.from({ length: this.length });
    // XXX transfer constraints?
    newSketch.other   = null;
    return newSketch;
  }
  serialize(opts){
    return Object.assign(super.serialize(opts), {
      links: this.links.map(link => link ? link.toJSON() : null),
      constraints: this.constraints.map(constr => constr.toJSON()),
      kappas: this.kappas.map(k => k.toJSON()),
      other: this.other ? this.other.id : null
    });
  }
  deserialize(data, map, useID){
    super.deserialize(data, map, useID);
    // load links without check
    assert(Array.isArray(data.links) && data.links.length == this.length,
      'Invalid links data');
    this.links = data.links.map((link, i) => {
      if(!link)
        return null;
      // constructor(parent, index, target, targetIndex, mirror, noCheck){
      return new Link(this, i,
        link.target, link.targetIndex, link.mirror, link.transmission, true
      );
    });
    // load constraints without check
    assert(Array.isArray(data.constraints), 'Constraints must be an array');
    this.constraints = data.constraints.map(constr => {
      // constructor(parent, mode, type, target, dir, noCheck){
      return new FlowConstraint(this,
        constr.target, constr.type,
        constr.dir, constr.weight,
        true // we want to check the data is valid!
      );
    });
    // load kappa constraints without check
    this.kappas = (data.kappas || []).map(k => {
      const kappa = new KappaConstraint(this, k.target, k.p1, k.p2);
      kappa.setKappa(k.kappa);
      kappa.setInfluence(k.alpha);
      return kappa;
    });
    // load other's id
    this.other = data.other;

    // load children
    for(const child of data.children){
      let skObj;
      switch(child.type){
        case 'sketch':
          skObj = new Sketch();
          break;
        case 'curve':
          skObj = new Curve();
          break;
        case 'pcurve':
          skObj = new PCurve();
          break;
        case 'anchor':
          skObj = new SketchAnchor();
          break;
        case 'rectangle':
          skObj = new SketchRectangle();
          break;
        default:
          assert.error('Unsupported child type', child.type);
          break;
      }
      skObj.deserialize(child, map, useID);
      this.children.push(skObj);
    }
  }
  remap(map){
    super.remap(map);
    // remap link targets
    for(const link of this.links){
      if(link){
        link.target = map(link.target);
      }
    }
    // remap constraint targets (which are children nodes)
    for(const constr of this.constraints){
      constr.target = map(constr.target);
    }
    // remap kappa constraints
    for(const k of this.kappas){
      if(k.isConstrained())
        k.target = map(k.target);
    }
    // remap other side
    if(this.other !== null)
      this.other = map(this.other);
  }

  addPoint(...args){
    super.addPoint(...args);
    this.links.push(null);
  }

  insertPoint(index, ...args){
    // remove related link
    // /!\ this splits the previous segment
    // into two sections (the previous and the new one)
    // => the only related link (that is affected)
    //    is the previous link (at index - 1)
    this.setLink(index - 1, null);

    // actually insert point
    super.insertPoint(index, ...args);
    this.links.splice(index, 0, null);
    const map = i => {
      if(i >= index)
        return i + 1; // new index is increased by 1
      else
        return i;
    };

    // update links
    for(let i = index + 1; i < this.length; ++i){
      if(this.links[i])
        this.links[i].updateIndex(map);
    }

    // update border constraints
    this.updateBorderConstraints(index, false);
  }

  removePoint(index, ...args){
    index = normIndex(index, this.length);
    // remove links around point
    // /!\ should happen before removing point
    //     since the indexing will change
    if(this.links[index])
      this.links[index].remove();
    const prevLink = this.getLink(index - 1);
    if(prevLink)
      prevLink.remove();
    // remove point
    super.removePoint(index, ...args);
    // reduce size
    this.links.splice(index, 1);
    const map = i => {
      if(i >= index)
        return i - 1; // new index is decreased by 1
      else
        return i;
    };
    // reset indices of further links
    for(let i = index; i < this.length; ++i){
      if(this.links[i])
        this.links[i].updateIndex(map);
    }
    // reset border constraints
    this.updateBorderConstraints(index, true);
  }

  updateBorderConstraints(index, remove){
    for(let i = 0; i < this.constraints.length; ++i){
      const constr = this.constraints[i];
      // only consider border constraints
      if(constr.isBorder()){
        if(constr.target == index){
          if(remove){
            // remove constraint
            this.constraints.splice(i, 1);
            --i;
          } else {
            // update index
            constr.target += 1;
          }
        } else if(constr.target > index){
          // update index
          if(remove)
            constr.target -= 1;
          else
            constr.target += 1;
        }
        // else constr.target < index // not affected
      } // endif isBorder
    } // endfor i < #constraints
  }

  freeChild(child){
    // if any child has an associated constraint
    // remove that constraint
    for(let i = 0; i < this.constraints.length; ++i){
      const constr = this.constraints[i];
      if(constr.target == child){
        this.constraints.splice(i, 1);
        --i;
      }
    }
  }

  setParent(parent){
    assert(!parent || !this.hasBack(), 'Cannot change parent of sketch with back');
    assert(!parent || !this.constraints.length, 'Cannot change parent with constraints');
    // remove links
    for(const link of this.links){
      if(link)
        link.remove();
    }
    // remove kappa constraints
    this.kappas = [];
    // associate parent
    super.setParent(parent);
  }

  setConstraint(
    target, type = FlowConstraint.ISOLINE,
    dir = FlowConstraint.FORWARD,
    weight = 0
  ){
    if(type === undefined)
      type = S.DIRECTION;
    else if(type === null)
      return this.removeConstraint(target);
    // check if we just update an existing constraint
    const prev = this.getConstraint(target);
    if(prev) {
      prev.setType(type, dir);
      if(weight === 'auto')
        prev.weight = 0.0;
      else if(!isNaN(weight))
        prev.weight = weight;
      return prev;

    } else {
      // we create the constraint
      if(target.parent){
        assert(target.parent == this, 'Invalid parenting');
      } else {
        target.setParent(this);
      }
      assert(this.children.find(c => c == target), 'Target curve is not a child');
      this.constraints.push(new FlowConstraint(this,
        target, type, dir, weight
      ));
      return this.constraints[this.constraints.length - 1];
    }
  }

  getConstraint(target){
    return this.constraints.find(constr => constr.target === target);
  }

  getBorderConstraints(segIdx = -1){
    return this.constraints.filter(constr => {
      if(!constr.target.subCurve)
        return false; // Curve or PCurve with ::subCurve=false
      assert(constr.target instanceof PCurve,
        'Border constraints come from PCurve data', constr.target);
      if(segIdx === -1)
        return true; // when not searching for a specific segment
      // else we need to make sure the segment matches
      // the samples of that constraint
      return constr.target.firstSample
          && constr.target.firstSample.matchesSegment(this, segIdx);
    });
  }

  getBorderConstraint(segIdx, t = -1){
    assert(typeof segIdx === 'number' && segIdx !== -1,
      'Invalid segment index', segIdx);
    const bcs = this.getBorderConstraints(segIdx);
    if(!bcs.length)
      return null;
    // else, we may need to check the t value falls within
    if(t !== -1){
      assert(t >= 0 && t <= 1, 'Invalid t value', t);
      return bcs.find(constr => {
        // t value should be within constraint
        const { firstSample, lastSample } = constr.target;
        return firstSample.sampT <= t
            && t <= lastSample.sampT;
      });

    } else {
      // use first matching one
      return bcs[0];
    }
  }

  removeConstraint(target){
    for(let i = 0; i < this.constraints.length; ++i){
      const constr = this.constraints[i];
      if(constr.target === target){
        this.constraints.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  newKappaConstraint(kappa = 1.0, alpha = 10){
    assert(this.isRoot(), 'Kappa constraint on child sketch');
    const k = new KappaConstraint(
      this, null, 0, 0
    );
    k.setKappa(kappa);
    k.setInfluence(alpha);
    this.kappas.push(k);
    return k;
  }

  *kappaConstraints(){
    yield *this.kappas;
  }

  isFree(index){
    index = normIndex(index, this.length);
    return this.isSegmentFree(index) && this.isSegmentFree(index - 1);
  }

  isSegmentFree(index){
    const link = this.getLink(index);
    return !link || link.isParentLink();
  }

  setLink(
    index, targetCurve, targetIndex,
    mirror, transmission = Link.DEFAULT
  ){
    index = normIndex(index, this.length);
    // previous link
    const link = this.getLink(index);
    if(!targetCurve){
      // clearing link if any
      if(link){
        link.remove();
        return true;
      } else
        return false;
    } else {
      // check we're not creating the same link again
      if(link){
        // if same, then nothing to do
        if(link.target == targetCurve && link.targetIndex == targetIndex)
          return false;
        // else we need to remove it
        link.remove();
      }

      // check validity
      const { valid } = Link.check(this, index, targetCurve, targetIndex);
      if(!valid)
        return false; // cannot create link
      // else, it's okay (though it may not be perfect depending on error)

      // create new link
      this.links[index] = new Link(
        this, index, targetCurve, targetIndex, mirror, transmission
      );

      // in case it's a two-sided link,
      // we must create a similar link on the other side
      if(targetCurve !== this.parent){
        // create corresponding link on other side
        targetCurve.setLink(targetIndex, this, index, mirror, transmission);
      }
      return true;
    }
  }

  getLink(index){
    index = normIndex(index, this.length);
    return this.links[index];
  }

  setPoint(index, pos, ...args){
    // note: may impact multiple link's control points
    // if mode == AUTOMATIC, but this is taken care of by the individual setControlPoint calls
    // here we only care about the two links around this point
    const links = [index - 1, index].map(i => this.getLink(i));
    const mirrors = links.map(link => link && link.isMirrorLink());
    // actually set point
    super.setPoint(index, pos, ...args);
    // for mirror case, do not check constraint
    // directly transfer position
    for(let i = 0; i < 2; ++i){
      if(mirrors[i]){
        // get point index across mirror link
        // note: links[0] => links[0].targetIndex + 1
        //       links[1] => links[1].targetIndex
        const mirPtIdx = links[i].targetIndex + 1 - i;
        // transfer new position to mirror side
        links[i].target.setMirrorPoint(
          mirPtIdx, // the index on the other side
          Object.assign({}, pos), // copy of position to assign
          ...args // rest of arguments
        );
      }
    }
  }

  setMirrorPoint(index, ...args){
    // this is used by setPoint to prevent ping pong during mirror update
    super.setPoint(index, ...args);
  }

  setControlPoint(index, side, pos, ...args){
    const link = this.getLink(side == Curve.CTRL_START ? index : index - 1);
    const mirror = link && link.isMirrorLink();
    super.setControlPoint(index, side, pos, ...args);
    // control point can only invalidate this link
    // update links given constraints
    // if mirror, transfer to other side
    if(mirror){
      // apply transformation on back
      // /!\ this side's link is either at { index, index - 1 }
      // but the other side's link is either at { link.targetIndex, link.targetIndex + 1 }
      link.target.setMirrorControlPoint(
        side == Curve.CTRL_START ? link.targetIndex : link.targetIndex + 1,
        side,
        pos ? Object.assign({}, pos) : null, // use copy
        ...args
      );
    }
  }

  setMirrorControlPoint(index, side, ...args){
    // similar to setMirrorPoint, used to prevent ping pong during mirror update
    super.setControlPoint(index, side, ...args);
  }

  hasBack(){ return !!this.other; }
  isBack(){ return this.hasBack() && this.transform.mirrorX; }

  createBack(){
    // do nothing if already with a back
    if(this.hasBack()){
      return null;
    }

    // ensure local transform matches the centroid
    // /!\ this is only necessary to ensure that the mirrored
    // sketch of the back is by default at the same location
    // since the mirror of the centroid-centered sketch has the same extents
    // => we know where it ends up and can easily move it automatically
    this.shiftAll(this.centroid, -1);

    // copy sketch
    const sketch = this.copy();

    // link sketches together
    this.other = sketch;
    sketch.other = this;

    // mirror transform (= set as back)
    sketch.setTransform(sketch.transform.mirrored());

    // link unlinked segments
    for(let i = 0; i < this.length; ++i){
      const link = this.links[i];
      if(!link){
        this.setLink(i, sketch, i, true, Link.DEFAULT); // mirror links
      }
    }
    return sketch;
  }

  clear(){
    // unlink segments
    for(let i = 0; i < this.length; ++i){
      this.setLink(i, null);
    }
    // if there is a back, unlink
    if(this.hasBack()){
      if(this.other.isBack())
        this.other.setTransform(this.other.transform.mirrored()); // unset as back
      else
        this.setTransform(this.transform.mirrored());
      this.other.other = null;
      this.other = null;
    }

    // unlink any child that connects to it as parent link
    for(let c of this.children){
      if(c instanceof Sketch){
        for(let i = 0; i < c.length; ++i){
          const link = c.getLink(i);
          if(link && link.isParentLink())
            link.remove();
        }
      }
    }
  }

  get label(){
    if(this.hasBack()){
      assert(this.isBack() !== this.other.isBack(),
        'Recursive back link');
      if(this.name.length)
        return this.name;
      if(this.other.name.length)
        return this.other.name + ' (2)';
      if(this.isBack())
        return '#' + this.id + ' (mirror of #' + this.other.id + ')';
      else
        return '#' + this.id;
    }
    if(this.name)
      return this.name;
    else
      return '#' + this.id;
  }

  static fromCurve(curve){
    const sketch = curve.copy(new Sketch());
    sketch.links = Array.from({ length: sketch.length });
    return sketch;
  }

}

module.exports = Object.assign(Sketch, S, {
  // classes
  Constraint: FlowConstraint,
  Link,
  // methods
  checkLink: Link.check
});
