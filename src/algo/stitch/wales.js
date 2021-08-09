// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const dtw = require('./dtw.js');
const geom = require('../../geom.js');
const BedShape = require('../schedule/shape.js');

// constants
const GREEDY  = 0;
const PARTIAL = 1;
const OPTIMAL = 2;

function bind(inpIndex, outIndex, {
  courses, paths, penalty,
  minimal = true,
  numBranches = 1,
  flatLayouts = 'all', flatFlipping = false
}){
  const N = inpIndex.length;
  const M = outIndex.length;
  assert(N && M, 'Not a valid interface');
  // different cases depending on N and M
  if(N === 1 && M === 1){
    bindOneToOne(inpIndex[0], outIndex[0], {
      courses, paths, penalty, minimal
    });

  } else if(N === 1){
    bindOneToMany(inpIndex[0], outIndex, {
      courses, paths, penalty, minimal, numBranches,
      flatLayouts, flatFlipping
    });

  } else if(M === 1){
    bindOneToMany(outIndex[0], inpIndex, {
      courses, paths, penalty, minimal, numBranches, backward: true,
      flatLayouts, flatFlipping
    });

  } else {
    // N to M
    // = reduce to simpler problems by introducing intermediate course(s)
    console.warn(
      'Complex ' + N + '-by-' + M
    + ' interface not supported yet'
    );
    // XXX eventually implement that
    // Option 1 = transform into Nx1 interface followed by 1xM interface
  }
}

function applyWalePairs(src, trg, pairs){
  // remove all current wales
  for(const s of src)
    s.clearNextWales();
  // assign new wales
  for(const [i0, i1] of pairs){
    src[i0].setNextWale(trg[i1]);
  }
}
function applyWaleShift(src, trg, shift, partial = false){
  assert(partial || src.length === trg.length,
    'Cannot apply shift on different cardinalities');
  applyWalePairs(src, trg, src.map((_, i) => {
    return [
      (i + shift) % src.length,
      i
    ];
  }));
}

function bindOneToOne(inpIdx, outIdx, {
  courses, paths, penalty, minimal = false
}){
  const crs0 = courses[inpIdx];
  const crs1 = courses[outIdx];
  const circular = paths[inpIdx].isCircular()
                || paths[outIdx].isCircular();
  const { path: links /*, minCost */ } = dtw.align(
    crs0, crs1, penalty,
  {
    // computed circularity: one course path is circular (or both)
    circular,
    // constraints on irregularity
    minimal
  });
  // apply wale links
  applyWalePairs(crs0, crs1, links);
  return links;
}

function bindOneToMany(inpIdx, outIndex, {
  courses, paths, penalty,
  backward = false, numBranches = 1,
  flatLayouts = 'all', flatFlipping = false
}){
  const inpCrs  = courses[inpIdx];
  const inpPath = paths[inpIdx];
  const outCourses = outIndex.map(idx => courses[idx]);
  const outPaths   = outIndex.map(idx => paths[idx]);
  const numStitches = outCourses.reduce((sum, crs) => sum + crs.length, 0);
  assert(inpCrs.length === numStitches,
    'Input and output cardinalities are not the same, cannot bind!');
  const inpCircular = inpPath.isCircular();
  const trivialFlat = flatLayouts === 'trivial' && !inpCircular && outPaths.every(p => {
    return p.isFlat();
  });

  // Exhaustive search with branch and bound
  //
  // 1) Select ordering of courses
  // = k! for k courses in the flat case, (k-1)! in the circular case
  // /!\ in the circular case, we can fix the initial selection to outCourses[0]
  // @see https://en.wikipedia.org/wiki/Cyclic_order
  //
  // 2) For each circular course, select the split / roll number
  // = n for n stitches in an even internal course
  // = 2n for n stitches in an odd internal course
  // = n for n stitches in an boundary course (left or right)
  //
  // 3) Find best alignment of sequences
  // = n for n stitches
  const getShiftedError = (seq, shift = 0, errBnd = Infinity, partial = true) => {
    if(partial)
      assert(seq.length <= numStitches, 'Invalid partial cardinality');
    else
      assert(seq.length === numStitches, 'Invalid sequence cardinality');
    let error = 0;
    for(let i = 0, n = seq.length; i < n && error < errBnd; ++i){
      error += penalty(
        inpCrs[(i + shift) % numStitches],
        seq[i],
        false, false
      );
    }
    return error;
  };
  const getBestShift = (seq, bestError = Infinity, partial = true) => {
    let bestShift = -1;
    for(let i = 0; i < numStitches; ++i){
      const error = getShiftedError(seq, i, bestError, partial);
      if(error < bestError){
        bestError = error;
        bestShift = i;
      }
    }
    return [bestShift, bestError];
  };
  const getBestError = (seq, errBnd = Infinity, partial = true) => {
    if(trivialFlat){
      return [0, getShiftedError(seq, 0, errBnd, partial)];
    } else {
      return getBestShift(seq, errBnd, partial);
    }
  };

  // branch and bound
  const K = outCourses.length;
  let bestSeq = null, bestShift = -1, bestPerm = null;
  let bestError = Infinity;
  const states = Array.from(geom.permutations(K), perm => {
    return {
      perm, seq: [], index: 0
    };
  });
  // state = [ idxPerm[], roll[0], roll[1] ... roll[K-1] ]
  while(states.length){
    const { perm, seq, index } = states.pop();
    assert(index <= K, 'Complete state in queue');

    // if we have a solution, make sure this branch
    // is still meaningful to pursue at all
    let shift = -1, error;
    if(seq.length && Number.isFinite(bestError)){
      [shift, error] = getBestError(seq, bestError, index < K);
      if(error >= bestError)
        continue; // do not continue further that branch
    }
    // if a complete state, we store it as best option
    if(index === K){
      if(shift === -1)
        [shift, error] = getBestError(seq, bestError, false);
      bestError = error;
      bestSeq   = seq;
      bestShift = shift;
      bestPerm  = perm;
      continue;
    }
    // else, we must build the sequence further

    const crsIdx = perm[index];
    const crs = outCourses[crsIdx];
    const outCircular = outPaths[crsIdx].isCircular();

    // basic flat case
    if(!outCircular){
      // flat case
      // = no roll to select, just append directly
      const nseq = seq.concat(crs);

      states.push({
        perm, seq: nseq, index: index + 1
      });

      // don't consider splits if trivial
      if(trivialFlat)
        continue;
    }

    // find best split of new course
    // based on circularity of path, and available flat layouts
    const splits = [];
    for(const [front, back] of BedShape.splits(crs, {
      circular: outCircular, flatLayouts, flipping: flatFlipping,
    })){
      // measure error
      const nseq = back.concat(seq, front);
      const [, splitError] = getBestShift(nseq, bestError);
      if(splitError >= bestError)
        continue; // don't consider
      splits.push([nseq, splitError]);
    }
    if(!splits.length)
      continue; // no valid split below best error

    // depending on algorithm, either
    // - pick best
    // - pick k best
    // - pick all
    // => sort from worst to best error
    splits.sort(([,e1], [,e2]) => e2 - e1);
    const k = Math.min(splits.length, numBranches);
    // pick k best, from kth best to best
    for(let i = splits.length - k; i < splits.length; ++i){
      const [nseq] = splits[i];
      states.push({
        perm, seq: nseq, index: index + 1
      });
    } // endfor #splits-k <= i < #splits
  } // endwhile #states
  assert(bestSeq && 0 <= bestShift && bestPerm,
    'Did not find a valid alignment');
  assert(bestShift < numStitches,
    'Invalid best shift', bestShift);
  
  // apply binding
  if(!backward)
    applyWaleShift(inpCrs, bestSeq, bestShift);
  else
    applyWaleShift(bestSeq, inpCrs, numStitches - bestShift);
}

module.exports = {
  bind,
  bindOneToOne,
  bindOneToMany,
  // constants
  GREEDY,
  PARTIAL,
  OPTIMAL
};
