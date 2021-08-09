// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const BedShape = require('./shape.js');

/**
 * Computes integer statistics:
 * - min = minimum value
 * - max = maximum value
 * - range = max - min (/!\ width=range+1)
 * - occ = map of occurrences for each existing shift
 * 
 * @param {number[]} list a list of integers
 * @return {{min, max, range, occ}} the integer statistics
 */
function integerStats(list){
  let min = Infinity;
  let max = -Infinity;
  let occ = new Map();
  for(const n of list){
    if(n < min) min = n;
    if(n > max) max = n;
    occ.set(n, (occ.get(n) || 0) + 1);
  }
  return {
    min, max,
    range: max - min,
    occ
  };
}

/**
 * Compute the best shift from a list.
 * The best shift is defined as the one that minimizes lexicographically:
 * 1) the maximum shifts incurred, as well as
 * 2) its number of occurrences.
 * 
 * @param {number[]|any} shiftsOrStats a list of integer shifts, or its stats
 * @return {number} the best shift found
 */
function minimizeMaximumShiftAndItsOccurrence(shiftsOrStats){
  let stats;
  if(Array.isArray(shiftsOrStats))
    stats = integerStats(shiftsOrStats);
  else
    stats = shiftsOrStats;
  
  // extract the necessary integer statistics
  const { min, max, range, occ } = stats;

  // check that we have expected statistics
  assert(Number.isInteger(min) && Number.isInteger(max)
      && Number.isInteger(range) && occ instanceof Map,
    'Invalid integer statistics');

  // best offset is offset that minimizes the largest shifts and its occurence count
  // = use one of the integer mean(s)
  // /!\ there are (1 + range % 2) integer means
  if(range % 2 === 0){
    // use single integer mean
    const mean = (min + max) / 2;
    assert(Number.isInteger(mean), 'Invalid median shift');
    return mean;

  } else {
    // use the integer mean that minimizes the maximum shift's occurences
    const minOcc = occ.get(min);
    const maxOcc = occ.get(max);
    if(minOcc < maxOcc){
      // right mean => keeps min as maximum shift
      return Math.floor((min + max) / 2) + 1;

    } else {
      // left mean => keeps max as maximum shift
      return Math.floor((min + max) / 2);
    }
  }
}

/**
 * Compute the best shift from a list.
 * The best shift is defined as the one that minimizes the number
 * of non-zero shift occurrences after applying the selected shift correction.
 * 
 * @param {number[]|any} shiftsOrStats a list of integer shifts, or its stats
 * @param {boolean} [withOcc] whether to return both the best shift and its occurrence, or just the best shift (default)
 * @return {number|number[]} the best shift found, or both that and its occurrence
 */
function minimizeNonZeroShift(shiftsOrStats, withOcc = false){
  let stats;
  if(Array.isArray(shiftsOrStats))
    stats = integerStats(shiftsOrStats);
  else
    stats = shiftsOrStats;
  
  // measure largest occurrence
  let maxOcc = -1;
  let maxShift = 0;
  for(const [shift, occ] of stats.occ){
    if(occ > maxOcc){
      maxOcc = occ;
      maxShift = shift;
    }
  }
  return withOcc ? [maxShift, maxOcc] : maxShift;
}

/**
 * Returns the best offset for a given bed layout mapping,
 * where best means to minimize (1) the maximum needle shift, together
 * with (2) its number of occurrences, lexicographically.
 * 
 * @param {BedShape} shapeSrc the source layout shape
 * @param {BedShape} shapeTrg the target layout shape
 * @param {number[][]} idxPairs the list of index pairs
 * @return {number} the best offset
 */
function getBestOffset(shapeSrc, shapeTrg, idxPairs){
  if(!idxPairs.length)
    return 0;
  const shifts = BedShape.getShifts(shapeSrc, shapeTrg, idxPairs);
  return minimizeMaximumShiftAndItsOccurrence(shifts);
}

/**
 * Returns the rolls and shifts costs of a pair of shapes
 * while allowing the relative offset to vary optimally.
 * 
 * @param {BedShape} srcShape the source layout shape
 * @param {BedShape} trgShape the target layout shape
 * @param {number[][]} pairIdx the list of index pairs
 * @return {{offset, rolls, shifts}} the cost and best offset
 */
function getShapePairCost(srcShape, trgShape, pairIdx){
  const npairs = BedShape.getNeedlePairs(srcShape, trgShape, pairIdx);
  // allow for a relative offset between shapes
  const deltas = npairs.map(([n1, n2]) => n2.offset - n1.offset);
  const offset = minimizeMaximumShiftAndItsOccurrence(deltas);
  let rolls = 0;
  let shifts = 0;
  for(const [n1, n2] of npairs){
    if(n1.side !== n2.side){
      ++rolls;
    }
    if(n1.offset !== n2.offset - offset){
      ++shifts;
    }
  } // endfor [n1, n2]
  return {
    offset, rolls, shifts
  };
}

/**
 * Returns the rolls and shifts costs of a pair of shapes
 * whose relative offsets are given and fixed.
 * 
 * @param {BedShape} srcShape the source layout shape
 * @param {number} srcOffset the source layout offset
 * @param {BedShape} trgShape the target layout shape
 * @param {number} trgOffset the target layout offset
 * @param {number[][]} pairIdx the list of index pairs
 * @return {{rolls, shifts}} the roll and shift costs
 */
function getShapeOffsetPairCost(
  srcShape, srcOffset, trgShape, trgOffset, pairIdx
){
  const npairs = BedShape.getNeedlePairs(srcShape, trgShape, pairIdx);
  let rolls = 0;
  let shifts = 0;
  for(const [n1, n2] of npairs){
    if(n1.side !== n2.side){
      ++rolls;
    }
    if(n1.offset + srcOffset !== n2.offset + trgOffset){
      ++shifts;
    }
  } // endfor [n1, n2]
  return {
    rolls, shifts
  };
}

/**
 * Return the best source and target shapes given a range of possible
 * source and target shapes, and a free offset.
 * 
 * @param {BedShape[]} srcShapes a list of possible source shapes
 * @param {BedShape[]} trgShapes a list of possible target shapes
 * @param {number[][]} pairIdx an index of pairs from src to trg
 * @return {{srcIdx, trgIdx, offset, rolls, shifts}} the cost and best indices
 */
function getBestShapePair(srcShapes, trgShapes, pairIdx){
  let bestRolls = Infinity;
  let bestShifts = Infinity;
  let srcIdx = -1;
  let trgIdx = -1;
  let bestOffset = Infinity;
  for(let src = 0; src < srcShapes.length; ++src){
    trgLoop:
    for(let trg = 0; trg < trgShapes.length; ++trg){
      const npairs = BedShape.getNeedlePairs(
        srcShapes[src], trgShapes[trg], pairIdx
      );
      const deltas = npairs.map(([n1, n2]) => n2.offset - n1.offset);
      const offset = minimizeMaximumShiftAndItsOccurrence(deltas);
      let rolls = 0;
      let shifts = 0;
      for(const [n1, n2] of npairs){
        if(n1.side !== n2.side){
          if(rolls >= bestRolls)
            continue trgLoop; // cannot be best anymore
          else
            ++rolls;
        }
        if(n1.offset !== n2.offset - offset){
          if(rolls === bestRolls && shifts >= bestShifts)
            continue trgLoop; // cannot be best anymore
          else
            ++shifts;
        }
      } // endfor [n1, n2]

      // is it better?
      if((rolls < bestRolls)
      || (rolls === bestRolls && shifts < bestShifts)){
        bestRolls = rolls;
        bestShifts = shifts;
        srcIdx = src;
        trgIdx = trg;
        bestOffset = offset;
      }
    } // endfor trg < #trgShapes
  } // endfor src < #srcShapes
  return {
    srcIdx, trgIdx,
    offset: bestOffset,
    rolls: bestRolls,
    shifts: bestShifts
  };
}

/**
 * Checks whether one cost is better than another
 * 
 * @param {number[]} cost1 the first cost
 * @param {number[]} cost2 the second cost
 * @param {boolean} orEqual whether to accept cost equality (by default, not!)
 * @return {boolean} whether the first cost is better (or equal) to the second
 */
function isCostBetter(cost1, cost2, orEqual = false){
  for(let i = 0; i < 3; ++i){
    if(cost1[i] < cost2[i])
      return true;
    else if(cost1[i] > cost2[i])
      return false;
  }
  return orEqual;
}

module.exports = {
  integerStats,
  minimizeMaximumShiftAndItsOccurrence,
  minimizeNonZeroShift,
  getBestOffset,
  getShapePairCost,
  getShapeOffsetPairCost,
  getBestShapePair,
  isCostBetter
};