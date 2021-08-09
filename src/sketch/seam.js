// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require("../assert");
const geom = require('../geom.js');

// constants
const SEAM_OFF  = -1;
const SEAM_AUTO = 0;
const SEAM_ON   = 1;
const SEAM_MODES = [ SEAM_OFF, SEAM_AUTO, SEAM_ON ];
const SEAM_MODE_NAME = {
  [SEAM_OFF]: 'off',
  [SEAM_AUTO]: 'auto',
  [SEAM_ON]: 'on'
};

function isSeam(curve, segIdx, borderSeamByDefault = false){
  const seamMode = curve.getSeamMode(segIdx);
  // if the mode is not automatic => return whether on or not (off)
  // if no border seam by default, we're off when "automatic"
  if(seamMode !== SEAM_AUTO
  || !borderSeamByDefault)
    return seamMode === SEAM_ON;
  // automatic => need to check if corresponding to sketch border
  if(curve.isRoot())
    return true; // direct border
  // else, can only be a seam
  // iff a PCurve that is a subCurve of a sketch border
  return curve.subCurve
      && curve.firstSample.curve === curve.parent
      && curve.lastSample.curve === curve.parent;
}

function getSeamChildren(sketch, {
  seamByDefault = false
} = {}, withSegments = false){
  const children = [];
  const segments = [];
  for(const skObj of sketch.children){
    if(!skObj.segLength)
      continue; // not of interest
    let hasSeam = false;
    for(let segIdx = 0; segIdx < skObj.segLength; ++segIdx){
      if(isSeam(skObj, segIdx, seamByDefault)){
        hasSeam = true;
        if(withSegments)
          segments.push([skObj, segIdx]);
        else
          break;
      }
    }
    if(hasSeam)
      children.push(skObj);
  }
  return withSegments ? [children, segments] : children;
}

function computeSeamRaster(ctx, layer, children, {
  seamSupport = 1,
  seamByDefault = false
} = {}){
  const eta = layer.eta;
  ctx.strokeStyle = '#00FFFF'; // use R channel (index 0)
  for(const curve of children){
    const transform = curve.transform;
    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.kx, transform.ky);
    ctx.lineWidth = eta * seamSupport / transform.k;
    for(let segIdx = 0; segIdx < curve.segLength; ++segIdx){
      if(!isSeam(curve, segIdx, seamByDefault))
        continue; // skip non-seam
      curve.drawSegment(ctx, segIdx);
      ctx.stroke();
    }
    ctx.restore();
  }
}

class SeamSegment {
  constructor(curve, segIdx){
    this.curve = curve;
    this.segIdx = segIdx;
  }
  get segment(){ return this.curve.getSegment(this.segIdx); }

  toData(){ return [this.curve.id, this.segIdx]; }
  remapData(map){ this.curve = map(this.curve); }
  static fromData([curveId, segIdx]){
    return new SeamSegment(curveId, segIdx);
  }

  sketchToCurve(pos){
    if(this.curve.isRoot())
      return pos; // already in sketch space
    else
      return this.curve.parentToLocal(pos);
  }
  curveToSketch(pos){
    if(this.curve.isRoot())
      return pos;
    else
      return this.curve.localToParent(pos);
  }

  sketchDistTo(q_sketch){
    // go into curve context
    const q_curve = this.sketchToCurve(q_sketch);
    // project onto curve
    const p_curve = this.segment.project(q_curve);
    // go back into sketch context
    const p_sketch = this.curveToSketch(p_curve);
    // compute distance (in sketch space)
    return geom.distBetween(p_sketch, q_sketch);
  }
}

class SeamLayerData {
  constructor(layer){
    this.sketch   = layer.sketch;
    this.layer    = layer;
    this.seamMap  = new Map();
  }

  /**
   * 
   * @param {GridSample} sample a mesh sample
   * @param {SeamSegment[]} seams a list of nearby seam segments
   */
  addSampleSeams(sample, seams){
    const key = sample.sampleId;
    assert(!this.seamMap.has(key),
      'Overwriting seam sample data', key);
    this.seamMap.set(key, seams);
  }

  getSampleSeams(sample){
    return this.seamMap.get(sample.sampleId) || [];
  }

  querySeamDistance(pos){
    const nh = this.layer.sketchQuery(pos, 1, true);
    assert(nh, 'Invalid seam query');

    // compute minimum distance to the nearby samples
    let minDist = Infinity;
    for(const sample of nh.samples){
      for(const seamSeg of this.getSampleSeams(sample)){
        const sketchDist = seamSeg.sketchDistTo(pos);
        minDist = Math.min(minDist, sketchDist);
      }
    }
    return minDist;
  }

  toData(){
    return {
      sketch: this.sketch.id,
      layer: this.layer.index,
      seamMap: Array.from(this.seamMap, ([key, seams]) => {
        return [key, seams.map(ss => [ss.curve.id, ss.segIdx])];
      })
    };
  }
  loadData({ seamMap }){
    this.seamMap.clear();
    for(const [key, seams] of seamMap){
      this.seamMap.set(key, seams.map(seamData => {
        return SeamSegment.fromData(seamData);
      }));
    }
    return this;
  }
  remapData(map){
    for(const seams of this.seamMap.values()){
      for(const seam of seams)
        seam.remapData(map);
    }
  }
  static fromData(layer, data){
    return new SeamLayerData(layer).loadData(data);
  }
}

function getSeamDataFromLayer(layer, params = {}){
  const [children, seamIndex] = getSeamChildren(layer.sketch, params, true);
  const raster = layer.getRasterData(ctx => {
    computeSeamRaster(ctx, layer, children, params);
  });
  const checkSeam = (y, x) => {
    const index = (y * raster.width + x) * 4;
    return raster.data[index] < 0xFF;
  };
  // complement seamIndex with borders of sketch
  for(let segIdx = 0; segIdx < layer.sketch.segLength; ++segIdx){
    if(isSeam(layer.sketch, segIdx, params.seamByDefault)){
      seamIndex.push([layer.sketch, segIdx]);
    }
  }
  // compute segment and their bounding boxes
  const segments  = new Array(seamIndex.length);
  const bboxes    = new Array(seamIndex.length); // in sketch context
  for(const [i, [curve, segIdx]] of seamIndex.entries()){
    const seg  = segments[i] = curve.getSegment(segIdx);
    const bbox = seg.bbox(); // as { x: {min,max}, y: {min,max}}
    const min = { x: bbox.x.min, y: bbox.y.min };
    const max = { x: bbox.x.max, y: bbox.y.max };
    // transform bbox to sketch context
    const tbbox = {
      min: curve.isRoot() ? min : curve.localToParent(min),
      max: curve.isRoot() ? max : curve.localToParent(max)
    };
    // special case for mirrorX
    if(layer.sketch.transform.mirrorX){
      // update bbox minX/maxX
      const x1 = tbbox.min.x;
      const x2 = tbbox.max.x;
      tbbox.min.x = Math.min(x1, x2);
      tbbox.max.x = Math.max(x1, x2);
    }
    bboxes[i] = tbbox;
  }

  // range of support in pixels
  const delta = layer.eta * (params.seamSupport || 1);

  // create data
  const seamData = new SeamLayerData(layer);
  for(const sample of layer.samples()){
    // extract location
    const { y, x } = sample;
    
    // consider all borders, and internal samples marked in raster
    if(!sample.isBorder() && !checkSeam(y, x))
      continue; // no seam nearby

    // get sketch location of sample
    const q_sketch = sample.getSketchPos();
    
    // nearby seam data of sample
    const seams = [];
    // find all near-enough seam segments
    // while avoiding queries based on bbox
    for(let i = 0; i < seamIndex.length; ++i){
      // skip if outside of bbox
      if(geom.outsideBBox(q_sketch, bboxes[i], delta))
        continue;
      // curve of seam
      const [curve, segIdx] = seamIndex[i];
      const seam = new SeamSegment(curve, segIdx);
      if(seam.sketchDistTo(q_sketch) < delta)
        seams.push(seam);
    } // endfor 0 <= i < #segments
    if(seams.length)
      seamData.addSampleSeams(sample, seams);
  }
  return seamData;
}

module.exports = {
  // classes
  SeamSegment,
  SeamLayerData,
  // methods
  isSeam,
  getSeamChildren,
  computeSeamRaster,
  getSeamDataFromLayer,
  // seam mode
  SEAM_OFF, SEAM_AUTO, SEAM_ON,
  // lists and maps
  SEAM_MODES, SEAM_MODE_NAME
};