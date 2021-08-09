// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const PatternImage = require('./image.js');

class BasicType {
  constructor(type, defVal){
    this.type = type;
    this.val0 = defVal;
  }
  get defaultValue(){ return this.val0; }
  isValid(input){ return typeof input === this.type; }
  toJSON(data){ return this.toData(data); }
  toData(data){ return data; }
  fromData(data){ return data; }
  get needsRemapping(){ return false; }
  remap(/* data, map */){}
}

class UndefinedType extends BasicType {
  constructor(){
    super('undefined', undefined);
  }
}

class NullType extends BasicType {
  constructor(){
    super('null', null);
  }
}

class NumberType extends BasicType {
  constructor(defVal = 0, subtypeName = 'number'){
    super(subtypeName, defVal);
  }
}

class StringType extends BasicType {
  constructor(defVal = ''){
    super('string', defVal);
  }
}

class BooleanType extends BasicType {
  constructor(defVal = false){
    super('boolean', defVal);
  }
  get values(){ return [false, true]; }
}

class EnumType extends BasicType {
  constructor(values, defVal = values[0]){
    super('enum', defVal);
    this.values = values;
    assert(Array.isArray(values),
      'Argument must be an array of enumeration options');
    assert(values.includes(defVal),
      'Default value is not valid');
  }
  isValid(input){ return this.values.includes(input); }
}

class ImageType extends BasicType {
  constructor(defVal = PatternImage.create(1, 1)){
    super('image', defVal);
  }
  isValid(input){ return input instanceof PatternImage; }
  toJSON(data){ return data.toJSON(); }
  toData(data){ return data.toData(); }
  fromData(img){ return PatternImage.fromData(img); }
}

class MappingType extends BasicType {
  constructor(){
    super('mapping', new Map());
  }
  get defaultValue(){ return new Map(); /* fresh map! */ }
  isValid(input){ return input instanceof Map; }
  toJSON(data){ return Array.from(data.entries()); }
  fromData(data){
    if(data instanceof Map)
      return data;
    else {
      assert(Array.isArray(data), 'Invalid mapping type');
      return new Map(data);
    }
  }
}

class ReferenceType extends BasicType {
  constructor(refType = 'sketch'){
    super('reference', null);
    this.refType = refType;
  }
  isValid(input, layer, beforeRemapping = false){
    if(input === null)
      return true; // always valid as a reference
    // serialized validity
    if(beforeRemapping)
      return typeof input === 'number';
    // natural validity
    const inpRoot = input && input.root && input.root();
    if(!inpRoot || inpRoot === input)
      return false; // cannot use references to root!
    // the root of the reference must match that of the layer
    return input.type === this.refType
        && layer.root() === input.root();
  }
  toJSON(data){ return data ? data.id : null; }
  get needsRemapping(){ return true; }
  remap(data, map){ return data !== null ? map(data) : null; }
}

class YarnType extends NumberType {
  constructor(defVal = 0){
    super(defVal, 'yarn');
  }
  isValid(input){ return typeof input === 'number'; }
}

class YarnMaskType extends NumberType {
  constructor(defVal = 0){
    super(defVal, 'yarnmask');
  }
  isValid(input){ return typeof input === 'number'; }
}

class ParamDescriptor {
  constructor(name, type){
    this.name = name;
    this.type = type;
  }
}

module.exports = Object.assign(ParamDescriptor, {
  BasicType,
  UndefinedType,
  NullType,
  NumberType,
  StringType,
  BooleanType,
  EnumType,
  ImageType,
  MappingType,
  ReferenceType,
  YarnType,
  YarnMaskType
});