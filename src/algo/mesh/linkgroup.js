// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const Link = require('../../sketch/link.js');

function canChange(sample){
  const cw = sample.constraints.reduce((sum, constr) => {
    if(constr.dir)
      return sum + constr.weight;
    else
      return sum;
  }, 0);
  return cw < 1.0;
}

class LinkSampleGroup {
  constructor(baseSample, linkIndex, transmission){
    this.baseSample   = baseSample;
    this.linkIndex    = linkIndex;
    this.transmission = transmission;
    // internal
    this.samples  = [ baseSample ];
    this.rots     = [ geom.zeroRotationVector() ];
    this.invRots  = [ geom.zeroRotationVector() ];
    this.canChange = [ canChange(baseSample) ];
    for(const li of linkIndex){
      const sample = baseSample.linkSamples[li];
      this.samples.push(sample);
      const rot = baseSample.rotations[li];
      this.rots.push(rot);
      this.invRots.push(geom.conjugate(rot));
      this.canChange.push(canChange(sample));
    }
    assert(this.canChange.some(c => c),
      'Linking group without possible flow change');
  }

  projectFlow(){
    let minDot = 1;
    const valid = [];
    const ouvs = [], uvs = [];
    let validFlowIdx = -1;
    let hasInvalid = false;
    for(let i = 0; i < this.samples.length; ++i){
      const sample = this.samples[i];
      const uv = sample.flow();
      ouvs.push(uv);
      uvs.push(geom.rotateVector(uv, this.rots[i]));
      if(uv.x || uv.y){
        validFlowIdx = i;
        valid.push(true);
      } else {
        hasInvalid = true;
        valid.push(false);
      }
    }
    if(validFlowIdx === -1)
      return; // nothing we can do yet
    else if(hasInvalid){
      const uv = uvs[validFlowIdx];
      // transfer flow from valid sample to invalid ones
      for(let i = 0; i < this.samples.length; ++i){
        if(valid[i])
          continue;
        uvs[i] = Object.assign({}, uv); // deep copy
      }
    }
    switch(this.transmission){

      // towards the same flow
      // = models through-flow
      case Link.SAME: {
        let uv = geom.meanVector(uvs);
        const len = geom.length(uv);
        if(len < 1e-3)
          uv = uvs[0]; // pick first uv value
        else
          uv = geom.scale(uv, 1/len); // normalize by length
        // transfer average back to all samples
        for(let i = 0; i < this.samples.length; ++i){
          const ruv = geom.rotateVector(uv, this.invRots[i]);
          this.samples[i].setFlow(ruv);
        }
      } break;

      case Link.REVERSED: {
        assert(uvs.length === 2,
          'Reverse transmission only supported for single link');
        let uv = geom.meanVector([
          uvs[0], geom.scale(uvs[1], -1) // reverse second flow
        ]);
        const len = geom.length(uv);
        if(len < 1e-3)
          uv = uvs[0]; // pick first uv value
        else
          uv = geom.scale(uv, 1/len); // normalize by length
        // transfer average back to samples, with proper reversal
        for(let i = 0; i < this.samples.length; ++i){
          const ruv = geom.rotateVector(
            i > 0 ? geom.scale(uv, -1) : uv,
            this.invRots[i]
          );
          this.samples[i].setFlow(ruv);
        }
      } break;

      case Link.ALIGNED: {
        const sign = uvs.map(uv => {
          return geom.dot(uv, uvs[0]) >= 0 ? 1 : -1;
        });
        let uv = geom.meanVector(uvs.map((uv, i) => {
          return geom.scale(uv, sign[i]);
        }));
        const len = geom.length(uv);
        if(len < 1e-3)
          uv = uvs[0]; // pick first uv value
        else
          uv = geom.scale(uv, 1/len); // normalize by length
        // transfer average back to all samples
        for(let i = 0; i < this.samples.length; ++i){
          const ruv = geom.rotateVector(
            geom.scale(uv, sign[i]),
            this.invRots[i]
          );
          this.samples[i].setFlow(ruv);
        }
      } break;

      case Link.SYMMETRIC: {
        assert(uvs.length === 2,
          'Symmetric transmission only supported for single link');
        // get rotation vector from inner normal to base flow
        const in_to_uv0 = geom.rotationVectorBetween(
          this.samples[0].innerNormal, uvs[0]
        );
        const on_to_uv1 = geom.rotationVectorBetween(
          geom.scale(this.samples[0].innerNormal, -1), uvs[1]
        );
        // if symmetric, then both rotations are the opposite angles
        // i.e. they are conjugates of each others
        // => compute different between conjugates, and measure half vector
        //    then apply that discrepancy to both sides
        const delta = geom.rotationVectorBetween(
          in_to_uv0, geom.conjugate(on_to_uv1)
        );
        const half_delta = geom.halfRotationVector(delta);
        // transfer half-rotation back
        for(let i = 0; i < this.samples.length; ++i){
          // get correction
          const drot = geom.scale(half_delta, i === 0 ? 1 : -1);
          const ruv = geom.rotateVector(
            geom.rotateVector(uvs[i], drot), // correcting for symmetry
            this.invRots[i] // rotating back to frame field
          );
          this.samples[i].setFlow(ruv);
        }
      } break;

      default:
        assert.error('Unsupported transmission type',
          this.transmission);
        break;
    }
    // compute minimum dot product of the change
    for(let i = 0; i < this.samples.length; ++i){
      const nuv = this.samples[i].flow();
      minDot = Math.min(minDot, geom.dot(ouvs[i], nuv));
    }
    return minDot;
  }

  static from(baseSample){
    assert(baseSample.isBorder() && baseSample.hasLinks(),
      'Invalid base sample for linking samples');
    // get map of associations from base sample
    // but only to reachable link samples (i.e. related through flow)
    const linkMap = baseSample.getLinkMap(true);
    assert(linkMap.size, 'Empty link map');
    if(linkMap.size === 1)
      return null; // no need for a linking group
    // else there is a linking group

    // compute link index from base sample
    const linkIndex = [];
    let transmission;
    if(linkMap.size > 2){
      // more than two link samples
      // => assume simplest mergeable model
      // note: if all are SAME, then it stays as such
      //       else, it goes to the widest model = ALIGNED
      transmission = Link.SAME;
    }
    let someCanChange = canChange(baseSample);
    for(const [lsample, [srcSample, li]] of linkMap.entries()){
      if(lsample === baseSample)
        continue; // skip base sample

      // check possibility of change
      if(canChange(lsample))
        someCanChange = true;

      // resolve index in baseSample
      const idx = baseSample.linkSamples.indexOf(lsample);
      assert(idx !== -1, 'Could not find link sample');
      linkIndex.push(idx);

      // resolve group transmission
      const link  = srcSample.links[li];
      const alpha = srcSample.linkAlphas[li];
      const xtype = link.resolveTransmissionType(alpha);
      assert(xtype !== Link.UNRELATED, 'Unrelated link');
      if(!transmission)
        transmission = xtype;
      else
        transmission = Link.mergeTransmissionTypes(transmission, xtype);
    }
    assert(transmission, 'No transmission type');
    // if no sample is free to change
    // there is no point in a linking group
    if(!someCanChange)
      return null;

    // actual group with a possible change
    return new LinkSampleGroup(
      baseSample, linkIndex, transmission
    );
  }
}

module.exports = LinkSampleGroup;