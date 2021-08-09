// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const BedShape = require('./shapes/base.js');
const CircularBedShape = require('./shapes/circular.js');
const CShapeBedShape = require('./shapes/cshape.js');
const SimpleFoldBedShape = require('./shapes/simplefold.js');
const {
  NONE, FLIPPED, REDUCED, NIBBLE_CODE
} = BedShape;

function from(stitchCount, {
  circular = true,
  nibbles  = NONE,
  roll     = 0,
  cshape   = false,
  flipped  = false,
  reduced  = false,
  main     = stitchCount
} = {}){
  if(typeof nibbles === 'string'){
    assert(nibbles in NIBBLE_CODE, 'Invalid nibble string', nibbles);
    nibbles = NIBBLE_CODE[nibbles];
  }
  // compute flags
  let flags = NONE;
  if(nibbles)
    flags |= nibbles;
  if(flipped)
    flags |= FLIPPED;
  if(reduced)
    flags |= REDUCED;
  // create bed shape
  if(circular){
    return new CircularBedShape(stitchCount, flags, roll);
  } else if(cshape) {
    return new CShapeBedShape(stitchCount, flags, main);
  } else {
    return new SimpleFoldBedShape(stitchCount, flags, roll);
  }
}

/**
 * Generator enumerating all flat layouts for a given number of stitches.
 * 
 * @param {number} stitchCount number of stitches in the layout
 * @param {Object} params set of options for valid shapes
 * @param {boolean} [params.flipping=false] whether to allow flipping (simple-fold)
 * @param {boolean} [params.reduced=false] whether to reduce flat offsets (simple-fold)
 * @param {boolean} [params.cshape=false] whether to include c-shaped layouts
 * @param {boolean} [params.simpleFold=false] whether to include simple-fold layouts
 * @yield {CShapeBedShape|SimpleFoldBedShape} all possible selected flat layouts
 */
function *flatShapes(stitchCount, params = {}){
  const [cshape, simpleFold] = flatLayouts(params);
  assert(cshape || simpleFold, 'Invalid flat layout options');
  // generate corresponding layouts
  if(cshape)
    yield *CShapeBedShape.shapes(stitchCount);
  if(simpleFold)
    yield *SimpleFoldBedShape.shapes(stitchCount, params);
}

/**
 * Generator enumerating all layouts for a given number of stitches.
 * 
 * @param {number} stitchCount number of stitches in the layout
 * @param {Object} params set of options for valid shapes
 * @yield {CShapeBedShape|SimpleFoldBedShape} all possible selected flat layouts
 */
function *allShapes(stitchCount, params = {}){
  // circular shapes
  yield *CircularBedShape.shapes(stitchCount, !!params.simple);
  // flat shapes
  yield *flatShapes(stitchCount, params);
}

/**
 * Generator enumerating all layouts for a given number of stitches.
 * 
 * @param {number} stitchCount number of stitches in the layout
 * @param {Object} params set of options for valid shapes
 * @param {boolean} [params.circular=false] whether to consider circular (true) or flat (false) layout
 * @param {boolean} [params.simple=false] whether to use simple circular layouts
 * @param {boolean} [params.cshape=false] whether to include c-shaped layouts
 * @param {boolean} [params.simpleFold=false] whether to include simple-fold layouts
 * @param {boolean} [params.flipping=false] whether to allow flipping (simple-fold)
 * @param {boolean} [params.reduced=false] whether to reduce flat offsets (simple-fold)
 * @yield {BedShape} all possible selected layouts
 */
function *shapes(stitchCount, params = {}){
  // circular shapes
  const circular = !!params.circular;
  if(circular)
    yield *CircularBedShape.shapes(stitchCount, !!params.simple);
  else
    yield *flatShapes(stitchCount, params);
}

/**
 * Returns the list of selected flat layouts (at least one)
 * 
 * @param {string|Object} str the flat layout options as a string or object
 * @return {boolean[]} [cshape, simpleFold]
 */
function flatLayouts(str){
  if(!str)
    return [true, true];
  let cshape;
  let simpleFold;
  if(typeof str === 'string'){
    cshape = str.includes('cshape');
    simpleFold = str.includes('simpleFold');
  } else {
    assert(typeof str === 'object', 'Invalid argument type');
    cshape = !!str.cshape;
    simpleFold = !!str.simpleFold;
    // ensure we have some form of flat layout
    if(!cshape && !simpleFold){
      if(str.flatLayouts)
        [cshape, simpleFold] = flatLayouts(str.flatLayouts);
      else
        cshape = simpleFold = true;
    }
  }
  if(!cshape && !simpleFold)
    return [true, true];
  else
    return [cshape, simpleFold];
}

/**
 * Returns whether a flat layout is considered "simple"
 * 
 * @param {string} str a flat layout type
 * @return {boolean} whether it's "trivial" or does not include "cshape"
 */
function isSimpleFlat(str){
  const [cshape] = flatLayouts(str);
  return !cshape || str === 'trivial';
}

/**
 * 
 * @param {array} crs sequence of stitches in CCW order
 * @param {Object} params set of options for layout splits
 * @param {boolean} [params.circular=false] whether to consider circular (true) or flat (false) layout
 * @param {string}  [params.flatLayouts='all'] the set of allowed flat layouts
 * @param {boolean} [params.cshape=false] whether to include c-shaped layouts
 * @param {boolean} [params.simpleFold=false] whether to include simple-fold layouts
 * @param {boolean} [params.flipping=false] whether to allow flipping (simple-fold)
 * @yields {array[]} [front, back] a split of the course between front and back, left-to-right
 */
function *splits(crs, params){
  const circular = !!params.circular;
  if(circular)
    yield *CircularBedShape.splits(crs);
  else {
    const [cshape, simpleFold] = flatLayouts(params);
    assert(cshape || simpleFold, 'Invalid flat layout options');
    if(cshape)
      yield *CShapeBedShape.splits(crs);
    if(simpleFold)
      yield *SimpleFoldBedShape.splits(crs, !!params.flipping);
  }
}

/**
 * Compute a set of needle pairs given source and target shapes
 * and a mapping of stress pairs indices in between both.
 * 
 * By default, a list of [src, trg] needle pairs is returned.
 * Optionally, a pair mapping can be applied of the form:
 *    (srcNeedle, trgNeedle) => any
 * 
 * @param {BedShape} shapeSrc the source layout shape
 * @param {BedShape} shapeTrg the target layout shape
 * @param {number[][]} idxPairs a list of index pairs between source and target shapes
 * @param {function} pairMap the pair mapping function
 * @return {array} the list of needle pairs (or results of the pair mapping function)
 */
function getNeedlePairs(shapeSrc, shapeTrg, idxPairs,
    pairMap = (s, t) => [s, t]){
  assert(Array.isArray(idxPairs), 'Index pairs must be an array');
  return idxPairs.map(([srcIdx, trgIdx]) => {
    return pairMap(
      shapeSrc.getNeedle(srcIdx),
      shapeTrg.getNeedle(trgIdx)
    );
  });
}

/**
 * Returns the list of needle shifts (from needle source to needle target)
 * 
 * @param {BedShape} shapeSrc the source layout shape
 * @param {BedShape} shapeTrg the target layout shape
 * @param {number[][]} idxPairs the list of index pairs
 * @return {number[]} the needle shifts from source to target
 */
function getShifts(shapeSrc, shapeTrg, idxPairs){
  return BedShape.getNeedlePairs(shapeSrc, shapeTrg, idxPairs, (sn, tn) => {
    return tn.offset - sn.offset;
  });
}

module.exports = Object.assign(BedShape, {
  // classes
  Circular: CircularBedShape,
  CShape: CShapeBedShape,
  SimpleFold: SimpleFoldBedShape,
  // generic splitting
  splits,
  // generic shape factory
  from,
  flatLayouts,
  isSimpleFlat,
  // shape generators
  circularShapes: CircularBedShape.shapes,
  flatShapes,
  shapes, allShapes,
  // helpers
  getNeedlePairs,
  getShifts
});