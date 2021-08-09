// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const StitchProgram = require('../stitchprog.js');
const ParamDescriptor = require('./param.js');
const {
  BasicType, EnumType, StringType, NumberType, BooleanType, UndefinedType
} = ParamDescriptor;

// constant
// - undefined type (e.g. when missing)
const Undefined = new UndefinedType();
// - spread mode
const TILED   = 'tiled';
const SCALED  = 'scaled';

// factory data
class LayerDescriptor {
  constructor(layerType, layerClass, params, parentTypes){
    this.type = layerType;
    this.clazz = layerClass;
    this.params = params;
    this.parentTypes = parentTypes;
  }
  isValidParentType(parentType){
    return this.parentTypes.includes(parentType);
  }
  isValidParent(parent){
    return parent && this.isValidParentType(parent.type);
  }
}
const clsToDescr = new Map();
const strToDescr = new Map();

let lastZIndex = -1;
/**
 * Base sketch layer implementation
 */
class SketchLayer {
  constructor(parent = null){
    this.parent = parent; // sketch parent
    this.params = new Map();
    this.zindex = ++lastZIndex;
    // temporary for layer application
    this.prog = null;
    this.anchorStitch = null;
  }
  get type(){ return 'layer'; }
  get descriptor(){ return clsToDescr.get(this.constructor); }
  get layerType(){
    const descr = this.descriptor;
    assert(descr, 'Unregistered layer type', this);
    return descr ? descr.type : 'invalid';
  }
  fromTrace(){ return true; }
  root(){ return this.parent && this.parent.root(); }
  serialize({ mode = 'data' }){
    assert(['data', 'json'].includes(mode),
      'Unsupported serialization mode');
    const descr = this.descriptor;
    const params = {};
    for(const [name, param] of descr.params){
      if(!this.params.has(name))
        continue; // skip unset parameters
      const value = this.params.get(name);
      if(mode === 'data')
        params[name] = param.toData(value);
      else
        params[name] = param.toJSON(value);
    }
    return {
      parent: this.parent.id,
      type: 'layer',
      layerType: descr.type,
      zindex: this.zindex,
      params
    };
  }
  deserialize(layerData /*, map, useID */){
    // take care of z-index
    assert('zindex' in layerData, 'Layer data without z-index');
    this.zindex = layerData.zindex;
    lastZIndex = Math.max(lastZIndex, this.zindex);
    // take care of other parameters
    for(const [name, param] of this.descriptor.params){
      if(name in layerData.params){
        const value = param.fromData(layerData.params[name]);
        assert(param.isValid(value, this, true), // /!\ before remapping
          'Parameter value is invalid', name, value, param);
        this.params.set(name, value);
      }
    }
    return this;
  }
  remap(map){
    for(const [name, param] of this.descriptor.params){
      if(!param.needsRemapping)
        continue;
      // else we need to call ::remap(data, map)
      // but only if the data exists (not the default)
      if(this.params.has(name)){
        const ref    = this.params.get(name);
        const value  = param.remap(ref, map);
        assert(param.isValid(value, this),
          'Remapped parameter value is invalid',
          name, value, param, ref, map);
        this.params.set(name, value);
      }
    }
  }
  getParamType(pname){
    return this.descriptor.params.get(pname) || Undefined;
  }
  getParam(pname){
    if(this.params.has(pname))
      return this.params.get(pname); // user value
    else
      return this.getParamType(pname).defaultValue; // default value
  }
  getParams(...args){
    assert(args.length, 'Expecting at least one argument');
    return args.map(pname => this.getParam(pname));
  }
  hasParam(pname){
    return this.descriptor.params.has(pname);
  }
  setParam(pname, value){
    const pt = this.getParamType(pname);
    assert(pt.isValid(value, this),
      'Parameter value is invalid', pname, value, pt);
    this.params.set(pname, value);
  }
  setType(newType){
    if(newType === this.layerType)
      return; // nothing to do
    // change layer type while keeping parameters
    // that are not in conflict (or disjoint ones)
    const ld = SketchLayer.create(this.parent, newType);
    const layerIdx = this.parent.layerData.indexOf(this);
    assert(layerIdx !== -1, 'Setting type from detached layer data');
    this.parent.layerData[layerIdx] = ld; // replaces this layer data
    // const thisDesc = this.descriptor;
    const thatDesc = ld.descriptor;
    for(const [name, value] of this.params){
      if(!thatDesc.params.has(name))
        ld.params.set(name, value); // disjoint => keep temporarily
      else if(thatDesc.params.get(name).isValid(value, this))
        ld.params.set(name, value); // valid in new settings
      // else it's invalid in the new settings
      // => discard (will use default value instead)
    }
    ld.zindex = this.zindex;
  }

  // layer base implementation (does nothing)
  getHook(){ return null; }
  getModifier(){ return null; }

  // generic stitch filtering
  static stitchGeometryTest(sketches, skobj){
    const rootSketch  = skobj.root();
    const layerIdx = sketches.indexOf(rootSketch);
    assert(layerIdx !== -1, 'Invalid layer index');
    return stitch => {
      // 1 = test layer
      if(stitch.stitch.getLayerIndex() !== layerIdx)
        return false;
      // 2 = test position within layer
      const p_sketch = stitch.getPosition();
      const p_layer  = skobj.parentToLocal(p_sketch);
      return skobj.hitTest(p_layer);
    };
  }
  *maskedStitches(stitchGraph, ...skobjs){
    assert(skobjs.length > 0, 'Needs at least one mask object');
    const tests = skobjs.map(skobj => {
      return SketchLayer.stitchGeometryTest(stitchGraph.sketches, skobj);
    });
    const test = stitch => tests.every(t => t(stitch));
    for(const stitch of stitchGraph.stitches()){
      if(test(stitch))
        yield stitch;
    }
  }

  select(prog){
    switch(this.parent.type){
      case 'rectangle':
        this.prog = this.selectStencil(prog);
        break;

      case 'anchorgrid':
        [this.prog, this.anchorStitch] = this.selectGrid(prog);
        break;

      case 'sketch':
        this.prog = this.selectMask(prog);
        break;

      default:
        assert.error('Unsupported layer container',
          this, this.parent, this.parent.type);
        break;
    }
  }

  selectMask(prog){
    const test = SketchLayer.stitchGeometryTest(
      prog.sketches, this.parent
    );
    if(this.hasParam('clipping')){
      const clipping = this.getParam('clipping');
      if(clipping){
        const clip = SketchLayer.stitchGeometryTest(
          prog.sketches, clipping
        );
        return prog.filter(s => test(s) && clip(s));
      }
    }
    // default simple test
    return prog.filter(s => test(s));
  }
  selectStencil(prog){ return this.selectMask(prog); }
  selectGrid(prog){ return this.parent.getStitchGrid(prog, true); }

  mark(layers){
    switch(this.parent.type){
      case 'rectangle':
        this.markStencil(this.prog, layers);
        break;

      case 'anchorgrid':
        this.markGrid(this.prog, layers);
        break;

      case 'sketch':
        this.markMask(this.prog, layers);
        break;

      default:
        assert.error('Unsupported layer container',
          this, this.parent, this.parent.type);
        break;
    }
  }

  unsupported(){
    assert.error('Unsupported container type for given layer',
      this, this.parent, this.parent.type);
  }
  markMask(/* prog */){}
  markStencil(prog){
    const rect = this.parent;
    // pattern parameters
    const [
      pattern, mapping
    ] = this.getParams('pattern', 'mapping');
    const intmap = (idx, n) => {
      return Math.max(0, Math.min(n-1, // <-- /!\ important bound
        Math.floor(idx * n) // /!\ not (n-1)
      ));
    };
    prog.eachDo((sprog, s) => {
      const p = s.getPosition();
      const { x, y } = rect.query(p, true); // from parent = sketch
      const px = intmap(x, pattern.width);
      const py = intmap(1 - y, pattern.height);
      const v = pattern.pixel(px, py);
      const value = mapping.get(v) || 0;
      // apply program
      if(value)
        this.markStitch(sprog, value, px, py, px, py);
    });
  }
  markGrid(grid){
    // pattern parameters
    const [
      pattern, mapping, clipping, mode
    ] = this.getParams('pattern', 'mapping', 'clipping', 'spreadMode');
    // stitch index for clipping
    let stitchIndex;
    if(clipping){
      const filter = SketchLayer.stitchGeometryTest(grid.trace, clipping);
      stitchIndex = new Set(grid.indices.filter(idx => {
        return filter(grid.stitches[idx]);
      }));
    }
    const spread = mode === SCALED;
    let doFun;
    if(spread)
      doFun = grid.stretchDo.bind(grid);
    else
      doFun = grid.tileDo.bind(grid);
    doFun(pattern.data, (v, sprog, s, px, py, gx, gy) => {
      const value = mapping.get(v) || 0;
      if(!value)
        return; // nothing to do
      // apply potential clipping
      if(clipping && !stitchIndex.has(s.index))
        return; // clipped out
      // apply program
      this.markStitch(sprog, value, px, py, gx, gy);

    }, pattern.width);
  }
  markStitch(/* sprog, value, px, py, gx, gy */){}

  unify(layers){
    switch(this.parent.type){
      case 'rectangle':
        this.unifyStencil(this.prog, layers);
        break;

      case 'anchorgrid':
        this.unifyGrid(this.prog, layers);
        break;

      case 'sketch':
        this.unifyMask(this.prog, layers);
        break;

      default:
        assert.error('Unsupported layer container',
          this, this.parent, this.parent.type);
        break;
    }
  }

  unifyStencil(/* prog, layers */){}
  unifyGrid(/* prog, layers */){}
  unifyMask(/* prog, layers */){}

  static applyTo(stitchGraph, nodeIndex){
    const layers = SketchLayer.fromSketches(
      stitchGraph.sketches, !!stitchGraph.sampler
    );
    if(!layers.length)
      return [];
    // create base stitch selection
    const prog = new StitchProgram(stitchGraph, nodeIndex);
    // use layer information to select interaction domain
    for(const layer of layers)
      layer.select(prog);
    // store layer data into selected stitches
    for(const layer of layers)
      layer.mark(layers);
    // unify layer data into stitch programs
    for(const layer of layers)
      layer.unify(layers);
    
    return layers;
  }

  static register(layerType, layerClass, paramList, parentTypes){
    assert(!clsToDescr.has(layerClass),
      'Layer class is already registered');
    assert(!strToDescr.has(layerType),
      'Layer type is already registered', layerType);

    // create parameter descriptors
    assert(paramList && Array.isArray(paramList),
      'Layer without parameters');
    const params = new Map();
    for(let [pname, ptype, pdef] of paramList){
      if(Array.isArray(ptype)){
        if(pdef)
          ptype = new EnumType(ptype, pdef);
        else
          ptype = new EnumType(ptype);
      } else if(typeof ptype === 'function')
        ptype = pdef ? new ptype(pdef) : new ptype();
      else {
        if(pdef === undefined)
          pdef = ptype;
        if(typeof ptype === 'string')
          ptype = new StringType(pdef);
        else if(typeof ptype === 'number')
          ptype = new NumberType(pdef);
        else if(typeof ptype === 'boolean')
          ptype = new BooleanType(pdef);
        else {
          assert(ptype instanceof BasicType,
            'Invalid arguments', pname, ptype, pdef);
        }
      }
      // create mapping from name to type
      params.set(pname, ptype);
    }
    const ld = new LayerDescriptor(
      layerType, layerClass, params, parentTypes
    );
    clsToDescr.set(layerClass, ld);
    strToDescr.set(layerType, ld);

    // return class to allow inline-export
    return layerClass;
  }

  static types(){ return strToDescr.keys(); }
  static descriptors(){ return strToDescr.values(); }
  static getClass(layerType){
    const descr = strToDescr.get(layerType);
    assert(descr, 'Unregistered layer type');
    return descr ? descr.clazz : null;
  }
  static canCreate(parent, layerType){
    assert(parent, 'Require layer container / parent');
    const descr = strToDescr.get(layerType);
    assert(descr, 'Unregistered layer type');
    if(typeof parent === 'string')
      return parent && descr && descr.isValidParentType(parent);
    else
      return parent && descr && descr.isValidParent(parent);
  }
  static create(parent, layerType){
    assert(parent, 'Require layer container / parent');
    assert(SketchLayer.canCreate(parent, layerType),
      'Invalid parent for layer type', parent, layerType);
    const clazz = SketchLayer.getClass(layerType);
    return new clazz(parent);
  }

  static fromData(parent, layerData, map, useID){
    assert('layerType' in layerData,
      'Invalid layer data without layer type');
    return SketchLayer.create(
      parent, layerData.layerType
    ).deserialize(layerData, map, useID);
  }

  static fromSketches(sketches, fromTrace = true){
    assert(Array.isArray(sketches), 'Invalid argument');
    const layers = [];
    for(const sk of sketches){
      for(const child of sk.children){
        const layerData = child.layerData;
        if(layerData && layerData.length){
          layers.push(...layerData.filter(ld => {
            return ld.fromTrace() === fromTrace;
          }));
        }
      }
    }
    layers.sort((l1, l2) => l1.zindex - l2.zindex);
    return layers;
  }
}

module.exports = Object.assign(SketchLayer, {
  TILED, SCALED
});