// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');
const { asFYarnBits } = require('./yarnstack.js');

// constants
// - carrier identifiers ("1" to "10")
const CARRIER_1 = '1';
const CARRIERS  = Array.from({ length: 10 }, (_, i) => (i+1).toString());
// - carrier types
const KNIT    = 'knit';
const INLAY   = 'inlay';
const ELASTIC = 'elastic';
const PLATING = 'plating';
const TYPES   = [KNIT, INLAY, ELASTIC, PLATING];
// - color circle
const COLORS  = [
  '#0075dc', '#ffff80', '#2bce48',
  '#990000', '#808080', '#f0a3ff',
  '#993f00', '#4c005c', '#005c31',
  '#ffcc99', '#94ffb5', '#8f7c00',
  '#9dcc00', '#c20088', '#003380',
  '#ffa405', '#ffa8bb', '#426600',
  '#ff0010', '#5ef1f2', '#00998f',
  '#e0ff66', '#740aff', '#ffff00',
  '#ff5005', '#191919'
];

class CarrierDevice {
  constructor(parent, name, {
    type = KNIT,
    DSCS = false,
    carriers = [ CARRIER_1 ],
    color
  }, strict = false){
    this.parent = parent;
    // properties
    this.name = name;
    this.type = type;
    this.DSCS = DSCS;
    this.carriers = new Set(carriers);
    this.color = color;
    // computed
    this.bitmask = asFYarnBits(carriers);

    // raise errors when strict
    if(strict){
      assert.throwing(() => {
        assert(typeof name === 'string', 'Name must be a string');
        assert(TYPES.includes(type), 'Invalid carrier type', type);
        assert(typeof DSCS === 'boolean', 'DSCS must be a boolean');
        assert(typeof color === 'string', 'Invalid color type');
        assert(color.startsWith('#'), 'Color must start with #');
        assert(carriers.every(c => CARRIERS.includes(c)),
          'Some referenced carrier does not exist');
      });
    }
  }

  matches(carriers){
    return carriers.length === this.carriers.size
        && carriers.every(cname => this.carriers.has(cname.toString()));
  }
}

let envConfig = null;
class CarrierConfig {
  constructor(config, strict = false){
    this.config = config;
    const defKey = config['default'];
    assert(defKey in config, 'Invalid default key', defKey, config);
    this.carriers = new Map();
    const defData = config[defKey];
    for(const [cname, cdata] of Object.entries(config)){
      if(cname === 'default')
        continue;
      this.carriers.set(cname, new CarrierDevice(this, cname,
        Object.assign({}, defData, cdata, {
          color: cdata.color ? cdata.color : COLORS[this.carriers.size % COLORS.length]
        }), strict
      ));
    }
    // set default device
    this.defaultDevice = this.carriers.get(defKey) || this.firstDevice();
    this.defaultYarnMask = this.defaultDevice.bitmask;
  }
  findDevice(pred = () => false){
    for(const dev of this.carriers.values()){
      if(pred(dev))
        return dev;
    }
    return null;
  }
  firstDevice(){
    return this.findDevice(() => true);
  }
  getDeviceByCarriers(carriers){
    return this.findDevice(dev => dev.matches(carriers));
  }
  *devices(){
    yield *this.carriers.values();
  }
  getDevice(key){
    switch(typeof key){
      case 'string':
        return this.carriers.get(key);

      case 'number':
        return this.findDevice(dev => {
          return dev.bitmask === key;
        });

      default:
        if(Array.isArray(key))
          return this.getDeviceByCarriers(key);
        assert.error('Invalid argument', key);
        return null;
    }
  }
  getDeviceInfo(key, prop, defVal = null){
    const dev = this.getDevice(key);
    return dev ? dev[prop] : defVal;
  }
  static fromEnv(){
    const env = require('./env.js');
    if(!envConfig
    || envConfig.config !== env.global.carriers){
      envConfig = CarrierConfig.from(env.global.carriers);
    }
    return envConfig;
  }
  static from(...args){ return new CarrierConfig(...args); }
  static check(config){ return new CarrierConfig(config, true); }
  // direct accessors
  static getDeviceInfo(...args){
    return CarrierConfig.fromEnv().getDeviceInfo(...args);
  }
  static *devices(){
    yield *CarrierConfig.fromEnv().devices();
  }
}

module.exports = CarrierConfig;