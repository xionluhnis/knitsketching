// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');

// constants
const S = {
  // factors
  MM_TO_INCH: 1 / 25.4,
  INCH_TO_MM: 25.4,

  // units
  PX: 'px',
  MM: 'mm',
  MILLIMETER: 'mm',
  MILLIMETERS: 'mm',
  IN: 'in',
  INCH: 'in',

  // distance conversion
  distToMM(unit){
    switch(unit.toLowerCase()){
      case 'mm':
      case 'millimeter':
      case 'millimeters':
        return 1;
      case 'cm':
        return 10;
      case 'dm':
        return 100;
      case 'm':
      case 'meter':
      case 'meters':
        return 1000;
      case 'in':
      case '"':
      case 'inch':
      case 'inches':
        return S.INCH_TO_MM;
      default:
        return NaN;
    }
  },

  isLengthUnit(unit){
    if(unit instanceof Unit)
      unit = unit.unit;
    if(typeof unit !== 'string')
      return false;
    return !Number.isNaN(S.distToMM(unit));
  },

  unitName(unit){
    switch(unit.toLowerCase()){
      case 's':
      case 'st':
      case 'stitch':
      case 'stitches':
        return 'stitch';

      case 'w':
      case 'wale':
      case 'wales':
        return 'wale';

      case 'c':
      case 'crs':
      case 'course':
      case 'courses':
        return 'course';

      case 'mm':
      case 'millimeter':
      case 'millimeters':
        return 'mm';

      case 'm':
      case 'meter':
      case 'metre':
      case 'meters':
      case 'metres':
        return 'm';

      case 'in':
      case 'inch':
      case 'inches':
      case '"':
        return 'in';

      case '%':
      case 'percent':
        return '%';

      default:
        return unit;
    }
  },

  // unit aliases
  areAliases(u1, u2){
    return S.unitName(u1) == S.unitName(u2);
  }
};

class Unit {
  constructor(value, unit){
    this.value = value;
    this.unit = unit || '';
  }

  as(unit, strict){
    // non-unit or matching unit
    if(!unit
    || !unit.length
    || unit === this.unit
    || S.areAliases(unit, this.unit))
      return this;
    // check if current has no unit
    if(!strict && !this.hasUnit())
      return new Unit(this.value, unit); // add unit
    // check distance transform
    const uf = S.distToMM(unit);
    if(!isNaN(uf)){
      const cf = S.distToMM(this.unit);
      if(isNaN(cf))
        return null; // invalid conversion
      // else, we convert
      return new Unit(this.value * cf / uf, unit);
    }

    // invalid
    return null;
  }
  asRatio(...args){ return new UnitRatio(this).asRatio(...args); }
  asScalar(){ return this.value; }
  hasUnit(){ return this.unit && this.unit.length; }
  inverse(){ return new UnitRatio(new Unit(1), this); }
  scaledBy(alpha){ return new Unit(this.value * alpha, this.unit); }
  matches(...units){
    const isLen = this.isLengthUnit();
    const uname = S.unitName(this.unit);
    for(const u of units){
      if(isLen && S.isLengthUnit(u))
        return true;
      else if(S.unitName(u) === uname)
        return true;
    }
    return false;
  }
  isLengthUnit(){ return S.isLengthUnit(this.unit); }

  static from(...args){
    assert(args.length, 'Need at least one argument');
    let valid = true;
    let nums = [];
    let divNumIndex = -1;
    let divUnitIndex = -1;
    let units = [];
    for(let arg of args){
      if(typeof arg == 'number'){
        nums.push(arg);
      } else if(arg == '/' || arg.toLowerCase() == 'per'){
        if(divUnitIndex == -1){
          divNumIndex = nums.length;
          divUnitIndex = units.length;
        } else {
          assert.error('Unsupported double division', args);
          valid = false;
        }
      } else {
        assert(typeof arg == 'string', 'Invalid argument', arg);
        units.push(arg);
      }
    }
    if(valid){
      // we only support single units or ratios
      if(divUnitIndex != -1){
        // ratio
        const pnums = nums.slice(0, divNumIndex);
        const nnums = nums.slice(divNumIndex);
        const punits = units.slice(0, divUnitIndex);
        const nunits = units.slice(divUnitIndex);
        if(pnums.length > 1 || punits.length > 1){
          assert.error('Numerator has multiple numbers or units');
          return null;
        } else if(nnums.length > 1 || nunits.length > 1){
          assert.error('Dividor has multiple numbers or units');
          return null;
        }
        const top = Unit.from(...pnums, ...punits);
        const bot = Unit.from(...nnums, ...nunits);
        return new UnitRatio(top, bot);
      } else {
        // distance or bare unit
        if(nums.length > 1 || units.length > 1){
          assert.error('Multiple numbers or units');
          return null;
        }
        return new Unit(nums.length ? nums[0] : 1, units[0]);
      }
      // not reachable
    }
    // not valid
    return null;
  }
}

class UnitRatio {
  constructor(top, bottom){
    this.top = top;
    this.bottom = bottom || new Unit(1);
  }

  compact(asRatio){
    // try to simplify the units of this ratio
    if(this.top.hasUnit() && this.bottom.hasUnit()){
      // direct match
      if(this.top.unit == this.bottom.unit)
        return asRatio ? new UnitRatio(new Unit(this.top.value), new Unit(this.bottom.value)) : new Unit(this.top.value / this.bottom.value);
      // both distance units
      const tdf = S.distToMM(this.top.unit);
      const bdf = S.distToMM(this.bottom.unit);
      if(!isNaN(tdf) && !isNaN(bdf)){
        return asRatio ? new UnitRatio(new Unit(this.top.value * tdf), new Unit(this.bottom.value * bdf)) : new Unit(this.top.value * tdf / (this.bottom.value * bdf));
      }
    } else if(!this.bottom.hasUnit() && !asRatio){
      return new Unit(this.top.value / this.bottom.value, this.top.unit);
    }
    return this;
  }
  as(unit, strict){
    const cu = this.compact();
    if(cu instanceof Unit)
      return cu.as(unit, strict);
    assert(cu instanceof UnitRatio, 'Invalid compact unit');
    if(strict){
      // conversion is not possible
      return null;
    } else {
      // might be possible by taking the inverse
      return cu.inverse().as(unit, true);
    }
  }
  asRatio(topUnit, botUnit, strict, compact){
    const cu = compact ? this.compact(true) : this;
    const tu = cu.top.as(topUnit);
    const bu = cu.bottom.as(botUnit);
    if(tu && bu)
      return new UnitRatio(tu, bu); // simple conversion
    else if(strict)
      return null; // invalid ratio
    else {
      // try inverting (=> check possible inversion of top/bot units)
      // /!\ the final units should match topUnit/botUnit, since that's the expected output
      return cu.inverse().asRatio(topUnit, botUnit, true);
    }
  }
  asScalar(){ return this.top.asScalar() / this.bottom.asScalar(); }
  inverse(){ return new UnitRatio(this.bottom, this.top); }
  scaledBy(alpha){
    return new UnitRatio(this.top.scaledBy(alpha), this.bottom);
  }
}

function parse(str){
  // split string
  const tokens = (str.match(/([0-9.]+|[a-zA-Z%]+|\/)/g) || []).map(tkn => {
    if('0123456789.'.includes(tkn[0]))
      return parseFloat(tkn);
    else
      return tkn;
  });
  return Unit.from(...tokens);
}

function parseAs(str, unit, strict){
  const u = parse(str);
  return u ? u.as(unit, strict) : null;
}

function parseAsRatio(str, tunit, bunit, strict){
  const u = parse(str);
  return u ? u.asRatio(tunit, bunit, strict) : null;
}

module.exports = Object.assign(S, {
  parse, parseAs, parseAsRatio
});
