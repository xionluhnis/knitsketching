// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const BedShape = require('./shape.js');
const Cost = require('./cost.js');
const NeedleBlock = require('./block.js');
const YarnNode = require('./node.js');

// constants
// - stages
const INP_SHAPE   = 0;
const INP_OFFSET  = 1;
const INSERT_IDX  = 2;
const OUT_SHAPE   = 3;
const OUT_OFFSET  = 4;
const STAGE_COUNT = 5;
// sides
const ANY     = 0;
const OUTPUT  = 1;
const INPUT   = 2;

/**
 * Create a planar embedding algorithm
 * 
 * @param {YarnNode[]} nodes a sequence of time-ordered nodes
 * @param {any} params an object containing embedding parameters
 */
function PlanarEmbedding(nodes, params){
  // input graph
  this.nodes = nodes;

  // parameters
  this.verbose    = !!params.verbose;
  this.filterIns  = !!params.filterInsert;
  this.fullyFlat  = !!params.fullyFlat;
  this.simpleFlat = !!params.simpleFlat;
  this.graphIndex = params.graphIndex;
  this.maxShift   = params.maxShift || 0;
  this.flatLayouts = params.flatLayouts || 'all';
  this.useFlatFlipping = !!params.useFlatFlipping;

  // nodes should be ordered by time
  for(let i = 1; i < nodes.length; ++i){
    assert(nodes[i-1].index < nodes[i].index,
      'Nodes are not in time order');
  }

  // compute useful sets (for front/back testing)
  this.nodeSet = new Set(nodes);
  this.nodeIndex = new Map(nodes.map((n, idx) => [n, idx]));
  this.outActiveSet = new Set(nodes.filter(n => {
    return Array.from(n.nextNodes).some(nn => this.nodeSet.has(nn));
  }).map(n => n.lastStep));
  this.inpActiveSet = new Set(nodes.filter(n => {
    return Array.from(n.prevNodes).some(pn => this.nodeSet.has(pn));
  }).map(n => n.firstStep));
  assert(this.outActiveSet.size && this.inpActiveSet.size,'Empty front or back');

  // get input and output step lists
  this.outSteps = nodes.map(n => n.lastStep);
  this.inpSteps = nodes.map(n => n.firstStep);
  this.activeSet = new Set(nodes.flatMap(node => {
    return [node.lastStep, node.firstStep].filter(step => {
      return this.outActiveSet.has(step) || this.inpActiveSet.has(step);
    });
  }));

  // get list of bridges that lead to branches failing
  // because neighboring stitches are too far away
  // /!\ within a same shape, stitches can never be too far away
  //  => the cases that create rejection are between nodes
  //
  // *Bridge* stitches are stitches from two different output shapes
  // whose wales are neighbors in a same input shape.
  // - the neighboring property in the input shape means that
  //   the output shape stitches should end up close to avoid yarn stress
  // => the shapes are constrained by those bridge pairs
  this.bridges = []; // [[ts1, ts2]] = all bridge constraints
  // [ts1, ts2] such that node(ts1).index < node(ts2).index 
  this.bridgeGrid = this.nodes.map(() => this.nodes.map(() => []));
  // bridgeGrid[ni][nj] = [[tsi, tsj]] = per-node per-node list of bridges
  this.inputBridges = this.nodes.map(() => []);
  // inputBridges[nk] = [[tsi, tski, tsj, tskj]]
  //        
  for(let i = 0; i < this.nodes.length; ++i){
    const ni = this.nodes[i]; // first output node
    for(let j = i + 1; j < this.nodes.length; ++j){
      const nj = this.nodes[j]; // second output node
      // go over possible input node
      for(let k = 0; k < this.nodes.length; ++k){
        const nk = this.nodes[k];
        if(k === i || k === j)
          continue; // skip since no possible bridge
        // get pairs
        const niPairs = ni.next.get(nk);
        const njPairs = nj.next.get(nk);
        if(!niPairs || !njPairs || !niPairs.length || !njPairs.length)
          continue; // no possible bridge
        
        // get continuity slice
        const slice = nk.firstStep.slice;
        // check if pair mappings form any bridge
        for(const [niIdx, nikIdx] of niPairs){
          for(const [njIdx, njkIdx] of njPairs){
            assert(nikIdx !== njkIdx,
              'Cannot map to same stitch, since interfaces are 1-1');
            // if nikIdx and njkIdx are neighbor in the input slice
            // then this is a bridge!
            if(slice.areAdjacent(nikIdx, njkIdx)){
              // found a bridge!
              this.bridges.push([
                i, niIdx, nikIdx,
                j, njIdx, njkIdx
              ]);
              // forward bridge in grid
              this.bridgeGrid[i][j].push([
                niIdx, njIdx
              ]);
              // backward bridge in grid
              this.bridgeGrid[j][i].push([
                njIdx, niIdx
              ]);
              // bridge constraint for input
              this.inputBridges[k].push([
                nikIdx, njkIdx
              ]);
            } // endif found a bridge
          } // endfor [njStitch, njkStitch]
        } // endfor [niStitch, nikStitch]
      } // endfor nk of nodes
    } // endfor i < j < #nodes
  } // endfor i < #nodes
  if(this.verbose)
    console.log('#bridges=' + this.bridges.length);

  // get both input and output shape lists
  this.outShapes = this.outSteps.map(s => this.shapesOf(s));
  this.inpShapes = this.inpSteps.map(s => this.shapesOf(s));

  // iteration state
  this.stack = [];
  this.iter = 0;
  this.bestSelection = null;
  this.bestCost = [Infinity, Infinity, Infinity];
  this.numInsertReject = 0;
  this.numOutputReject = 0;

  // cost cache
  this.costCache = new Map();
}

PlanarEmbedding.prototype.shapesOf = function(step){
  if(!this.isActive(step))
    return []; // shape is not needed for this step
  const stitchCount = step.slice.stitches.length;
  if(this.fullyFlat && this.simpleFlat){
    // fully flat => simplest flat layout
    return [
      BedShape.from(stitchCount, { circular: false })
    ];

  } else {
    // free step
    return Array.from(BedShape.shapes(stitchCount, {
      circular: step.circular,
      flatLayouts: this.flatLayouts,
      flipping: this.useFlatFlipping
    }));
  }
};

PlanarEmbedding.prototype.linksOf = function(srcStep, trgStep){
  assert(srcStep instanceof YarnNode.Step
      && trgStep instanceof YarnNode.Step, 'Invalid argument types');
  if(this.isActive(srcStep, OUTPUT)){
    return srcStep.node.next.get(trgStep.node);
  } else {
    return srcStep.node.prev.get(trgStep.node);
  }
};

PlanarEmbedding.prototype.getInputShape = function(nidx, shapeIdx){
  assert(typeof nidx === 'number' && typeof shapeIdx === 'number',
    'Invalid argument types: should be numbers', nidx, shapeIdx);
  return this.inpShapes[nidx][shapeIdx];
};

PlanarEmbedding.prototype.getOutputShape = function(nidx, shapeIdx){
  assert(typeof nidx === 'number' && typeof shapeIdx === 'number',
    'Invalid argument types: should be numbers', nidx, shapeIdx);
  return this.outShapes[nidx][shapeIdx];
};

PlanarEmbedding.prototype.nodeIndexOf = function(node){
  assert(node instanceof YarnNode, 'Argument should be a node');
  return this.nodeIndex.get(node);
};

PlanarEmbedding.prototype.isActive = function(step, side = ANY){
  assert(step instanceof YarnNode.Step, 'Step has invalid type', step);
  switch(side){
    case ANY:     return this.activeSet.has(step);
    case OUTPUT:  return this.outActiveSet.has(step);
    case INPUT:   return this.inpActiveSet.has(step);
    default:
      assert.error('Invalid side', side);
      return false;
  }
};

/**
 * Extract parameters from a numerical selection
 * 
 * @param {number[]} selection the selected embedding
 * @return {array} the parameters [inShapes, inOffsets, insertIdx, outShapes, outOffsets, alignCost]
 */
PlanarEmbedding.prototype.extractFrom = function(selection){
  // extract alignment cost
  // + insertIdx/srcShape/srcOffset/trgShape/trgOffset
  let alignCost = 0;
  const inpShapes  = [];
  const inpOffsets = [];
  const insertIndex   = [];
  const outShapes  = [];
  const outOffsets = [];
  for(let i = 0, nidx = 0; i < selection.length; i += STAGE_COUNT, ++nidx){
    // src shape selection
    const inShapeIdx = selection[i + INP_SHAPE];
    if(inShapeIdx >= 0){
      const shape = this.getInputShape(nidx, inShapeIdx);
      if(!shape.isAligned())
        ++alignCost;
    }
    inpShapes.push(inShapeIdx);

    // src offset selection
    if(i + INP_OFFSET >= selection.length)
      break;
    inpOffsets.push(selection[i + INP_OFFSET]);

    // insertIdx
    if(i + INSERT_IDX >= selection.length)
      break;
    insertIndex.push(selection[i + INSERT_IDX]);

    // trg shape selection
    if(i + OUT_SHAPE >= selection.length)
      break;
    const outShapeIdx = selection[i + OUT_SHAPE];
    if(outShapeIdx >= 0){
      const shape = this.getOutputShape(nidx, outShapeIdx);
      if(!shape.isAligned())
        ++alignCost;
    }
    outShapes.push(outShapeIdx);

    // trg offset selection
    if(i + OUT_OFFSET >= selection.length)
      break;
    outOffsets.push(selection[i + OUT_OFFSET]);
  }

  return [
    inpShapes, inpOffsets,
    insertIndex,
    outShapes, outOffsets,
    alignCost
  ];
};

/**
 * Get a pair cost using the cache
 * 
 * @param {number} srcNodeIdx the output node index
 * @param {number} srcShapeIdx the output shape index
 * @param {number} srcOffset the output shape offset
 * @param {number} trgNodeIdx the input node index
 * @param {number} trgShapeIdx the input shape index
 * @param {number} trgOffset the input shape offset
 * @return {{rolls, shifts}} the associated rolls and shifts
 */
PlanarEmbedding.prototype.getCostOfPair = function(
  srcNodeIdx, srcShapeIdx, srcOffset,
  trgNodeIdx, trgShapeIdx, trgOffset
){
  const cacheKey = [
    srcNodeIdx, srcShapeIdx, srcOffset,
    trgNodeIdx, trgShapeIdx, trgOffset
  ].join('/');
  // check if in cache
  if(!this.costCache.has(cacheKey)){
    // compute cost and store in cache
    const srcShape = this.getOutputShape(srcNodeIdx, srcShapeIdx);
    const trgShape = this.getInputShape(trgNodeIdx, trgShapeIdx);
    const srcNode = this.nodes[srcNodeIdx];
    const trgNode = this.nodes[trgNodeIdx];
    const pairIdx = this.linksOf(srcNode.lastStep, trgNode.firstStep);
    this.costCache.set(cacheKey, Cost.getShapeOffsetPairCost(
      srcShape, srcOffset,
      trgShape, trgOffset,
      pairIdx
    ));
  }
  // get cost from cache
  return this.costCache.get(cacheKey);
};

/**
 * Returns the cost of a possibly incomplete selection
 * 
 * @param {number[]} selection the selected embedding
 * @return {number[]} its cost [shape, rolls, shifts]
 */
PlanarEmbedding.prototype.costOf = function(selection){
  // extract steps, shapes and partial alignment cost
  const [
    selInpShapes, selInpOffsets,
    /* insertIndex */,
    selOutShapes, selOutOffsets,
    alignCost
  ] = this.extractFrom(selection);
  let rollCost  = 0;
  let shiftCost = 0;

  // compute roll/shift cost between all available steps
  const numOuts = selOutOffsets.length;
  const numInps = selInpOffsets.length;
  for(let i = 0; i < numOuts; ++i){
    if(selOutShapes[i] < 0 || Number.isNaN(selOutOffsets[i]))
      continue; // not in graph
    const outStep = this.outSteps[i];

    for(let j = i + 1; j < numInps; ++j){
      if(selInpShapes[j] < 0 || Number.isNaN(selInpOffsets[j]))
        continue; // not in graph
      const inpStep = this.inpSteps[j];
      // check whether both steps are connected
      // and get their stress pair index if they are
      const pairIdx = this.linksOf(outStep, inpStep);
      if(!pairIdx)
        continue; // not connected!

      // get cost from cache
      const { rolls, shifts } = this.getCostOfPair(
        i, selOutShapes[i], selOutOffsets[i],
        j, selInpShapes[j], selInpOffsets[j]
      );
      rollCost += rolls;
      shiftCost += shifts;
    }
  }

  return [alignCost, rollCost, shiftCost];
};

class FrontBlock {
  constructor({
    step, nodeIdx, nodes,
    target = null, shape = null, shapeIdx = -1, offset = NaN
  }){
    this.step     = step;     // @type {YarnStep}
    this.nodeIdx  = nodeIdx;  // @type {number}
    this.nodes    = nodes;    // @type {YarnNode[]}
    // computed or for later:
    this.target   = target;   // @type {YarnStep}
    this.shape    = shape;    // @type {BedShape}
    this.shapeIdx = shapeIdx; // @type {number}
    this.offset   = offset;   // @type {number}
    // compute first available target if none provided
    if(!target){
      const thisNode = step.node;
      // note: can start after this node's index to speed up!
      for(let i = nodeIdx + 1; i < this.nodes.length; ++i){
        const n = nodes[i];
        if(thisNode.next.has(n)){
          this.target = n.firstStep;
        }
      }
    }
  }

  get node(){ return this.step.node; }

  toObject(){
    return {
      step: this.step, nodeIdx: this.nodeIdx, nodes: this.nodes,
      target: this.target, shape: this.shape, shapeIdx: this.shapeIdx,
      offset: this.offset
    };
  }
  copy(newParams){
    return new FrontBlock(Object.assign(this.toObject(), newParams));
  }

  transform(currNode){
    const thisNode = this.node;

    // only keep blocks that are linked
    // to posterior nodes in this subgraph
    let isActive = false;
    for(const n of thisNode.nextNodes){
      if(n.index > currNode.index){
        assert(this.nodes.includes(n),
          'Next node is part of a different subgraph');
        isActive = true;
        break;
      }
    }
    // if this bock is not active later on
    // then we remove it = return an empty sequence
    if(!isActive)
      return []; // this block disappears

    // else the block stays be it may change target
    // and possibly split?
    if(this.target
    && this.target.node === currNode){
      // the target changes
      //
      // XXX may need to be split into multiple blocks!
      //
      let target;
      for(let i = this.nodeIdx; i < this.nodes.length; ++i){
        const n = this.nodes[i];
        if(n.index <= currNode.index)
          continue; // in the past of this transformation
        if(thisNode.next.has(n)){
          if(target){
            assert.error('Front node should be split, but not supported');
          } else {
            target = n.firstStep; // found first target
          }
        }
      }
      assert(target, 'Missing new target');
      return [ this.copy({ target }) ];

    } else {
      return [ this ]; // no change
    }
  }
}

/**
 * Compute the front of a selected graph embedding
 * at a selected node index (defaults to the last).
 * 
 * The front is a sequence of entries of the form:
 *    { step, nodeIdx, shapeIdx, shape }
 * 
 * @param {number[]} selection a selected embedding
 * @param {number} upToNodeIdx the node to get the front up to
 * @return {{front, preFront, input, insertIdx}} the selected front
 */
PlanarEmbedding.prototype.frontOf = function(
  selection,
  upToNodeIdx = this.nodes.length - 1
){
  let front     = [];
  let preFront  = front;
  let input     = null;
  let insertIdx = -1;
  const [
    selInpShapes, selInpOffsets,
    insertIndex,
    selOutShapes, selOutOffsets
  ] = this.extractFrom(selection);

  for(let i = 0; i < this.nodes.length && i <= upToNodeIdx; ++i){
    // get node
    const node = this.nodes[i];

    // set input step
    input = { step: this.inpSteps[i], shape: null, offset: NaN };

    // set input shape
    if(i >= selInpShapes.length)
      break;
    const inpShapeIdx = selInpShapes[i];
    input.shape = this.getInputShape(i, inpShapeIdx);

    // set input offset
    if(i >= selInpOffsets.length)
      break;
    const inpOffset = selInpOffsets[i];
    if(input.shape && !Number.isNaN(inpOffset)){
      input.offset = inpOffset;
    }

    // update front
    preFront = front;
    front = front.flatMap(blk => blk.transform(node));

    // insert new front step
    if(i >= insertIndex.length)
      break;
    const outStep = this.outSteps[i];
    const out = new FrontBlock({
      step: outStep, nodeIdx: i, nodes: this.nodes
    });
    insertIdx = insertIndex[i];

    // we need the step inserted iff it has pending links within this subgraph
    const hasActiveTarget = !!out.target;
    const isOutActive = this.outActiveSet.has(out.step);
    assert(isOutActive === hasActiveTarget, 'Inconsistent active state');
    if(insertIdx >= 0){
      assert(isOutActive, 'Inserting a step that is not active');
      front.splice(insertIdx, 0, out);

    } else {
      assert(!isOutActive, 'Not inserting an active step');
    }

    // set new front shape
    if(i >= selOutShapes.length)
      break;
    const outShapeIdx = selOutShapes[i];
    out.shape = this.getOutputShape(i, outShapeIdx);
    out.shapeIdx = outShapeIdx;

    // set new front offset
    if(i >= selOutOffsets.length)
      break;
    const outOffset = selOutOffsets[i];
    if(out.shape && !Number.isNaN(outOffset)){
      out.offset = outOffset;
    }
  }

  return { front, preFront, input, insertIdx };
};

/**
 * Select a best interface shape and the related offsets
 * 
 * @param {number[]} ltrNodeNums the left-to-right node indices
 * @param {number[]} ltrShapeNums the left-to-right shape indices
 * @param {number} newNodeIdx the new node index (input side)
 * @param {BedShape[]} newShapes the list of possible new shapes (input)
 * @param {boolean} needsAlignment whether we cannot afford non-aligned shapes
 * @return {{offsets, newShape, newOffset}} the best configuration found
 */
PlanarEmbedding.prototype.selectBestInterface = function(
  ltrNodeNums, ltrShapeNums, newNodeIdx, newShapes, needsAlignment = false
){
  // XXX steps should include information about which needles are still available
  //     so that we can use that for packing!
  // for now, let's use the pair index between nodes
  const newNode = this.nodes[newNodeIdx];
  const pairIndexBlocks = ltrNodeNums.map(nodeIdx => {
    const node = this.nodes[nodeIdx];
    const pairIndex = node.next.get(newNode);
    assert(pairIndex, 'Missing pair index for node pair');
    return pairIndex.map(([idx, ]) => idx);
  });
  const ltrShapes = ltrShapeNums.map((shapeIdx, idx) => {
    return this.getOutputShape(ltrNodeNums[idx], shapeIdx);
  });
  const offsets = NeedleBlock.packShapesToLeft(
    ltrShapes, pairIndexBlocks
  );
  let newShape  = -1;
  let newOffset = NaN;
  let bestCost  = [ Infinity, Infinity, Infinity ];
  newShapeLoop:
  for(let i = 0; i < newShapes.length; ++i){
    const trgShape = newShapes[i];
    const aligned  = trgShape.isAligned();
    if(needsAlignment && !aligned)
      continue; // skip non-aligned shapes if we require alignment

    // compute cost while using the cache
    const alignCost = aligned ? 0 : 1;
    let rollCost  = 0;
    let shifts = [];
    let minShift = Infinity;
    let maxShift = -Infinity;
    for(let j = 0; j < ltrShapes.length; ++j){
      const srcShape = ltrShapes[j];
      const srcOffset = offsets[j];
      const nodeIdx = ltrNodeNums[j];
      const pairIndex = this.nodes[nodeIdx].next.get(newNode);
      assert(pairIndex, 'Missing pair index for node pair');
      const npairs = BedShape.getNeedlePairs(srcShape, trgShape, pairIndex);
      for(const [n1, n2] of npairs){

        // measure roll
        if(n1.side !== n2.side)
          ++rollCost;
        
        // measure shift
        const shift = n2.offset - n1.offset - srcOffset;
        shifts.push(shift);

        // measure shift range
        minShift = Math.min(minShift, shift);
        maxShift = Math.max(maxShift, shift);
        // if the range is beyond our maximum shift, invalid!
        const shiftRange = maxShift - minShift;
        if(shiftRange > this.maxShift){
          continue newShapeLoop;
        }
      } // endfor [n1, n2] of npairs
    } // endfor j < #ltrShapes

    // compute best offset to reduce number of non-zero shifts
    const [offset, occ] = Cost.minimizeNonZeroShift(shifts, true);
    // by using -offset as offset of the target, we get its shifted cancelled
    // => all others are remaining shifts
    const shiftCost = shifts.length - occ;
    const newCost = [alignCost, rollCost, shiftCost];
    // update information if the cost is better
    if(Cost.isCostBetter(newCost, bestCost)){
      bestCost = newCost;
      newOffset = -offset;
      newShape = i;
      // change alignment requirement if the solution is aligned
      // because then any better solution also needs to be aligned
      if(alignCost === 0)
        needsAlignment = true;
    }
  } // endfor i < #newShapes

  return { offsets, newShape, newOffset, cost: bestCost };
};

PlanarEmbedding.prototype.isInsertionIndexPossible = function(sel){
  // can only easily pre-reject for circular pairs
  const lastNodeIdx = Math.floor((sel.length-1) / STAGE_COUNT);
  assert(lastNodeIdx > 0, 'First insertion is always possible');
  const lastCircular = this.nodes[lastNodeIdx].firstStep.circular;
  if(!lastCircular)
    return true; // we cannot reject flat courses easily

  // get front information
  const { front } = this.frontOf(sel);
  // go over each circular node of the front
  const noNode = { nodeIdx: -1 };
  for(let i = 0; i < front.length; ++i){
    const nodeIdx = front[i].nodeIdx;
    if(!this.nodes[nodeIdx].firstStep.circular)
      continue; // cannot constrain flat nodes easily
    // get neighboring node indices
    const prevIdx = (front[i-1] || noNode).nodeIdx;
    const nextIdx = (front[i+1] || noNode).nodeIdx;
    // go over past bridges
    for(let j = 0; j < nodeIdx; ++j){
      if(!this.nodes[j].firstStep.circular)
        continue; // cannot constrain flat nodes easily
      const bridges = this.bridgeGrid[nodeIdx][j];
      if(!bridges.length)
        continue; // no constraint between the two nodes
      // there are constraints between (nodeIdx) and (j)
      // = we need them to be next to each other in the front
      // /!\ because j < nodeIdx, it MUST be in the front
      if(prevIdx === j || nextIdx === j)
        continue; // constraint satisfied!
      else
        return false; // constraint not satisfied!
    }
  }
  // no constraint not satisfied
  return true;
};

PlanarEmbedding.prototype.isOutputPossible = function(sel){
  const { front } = this.frontOf(sel);
  const ltrShapes = front.map(({ shape }) => shape);
  const offsets = NeedleBlock.packShapesToLeft(ltrShapes);
  const lastNodeIdx = Math.floor((sel.length-1) / STAGE_COUNT);
  const lastLtrIdx = front.findIndex(({ nodeIdx }) => {
    return nodeIdx === lastNodeIdx;
  });
  assert(lastLtrIdx !== -1, 'Missing node in front');
  const lastShape = ltrShapes[lastLtrIdx];
  const lastOffset = offsets[lastLtrIdx];
  // go over front
  for(let i = 0; i < front.length; ++i){
    if(i === lastLtrIdx)
      continue;
    const { nodeIdx } = front[i];
    assert(nodeIdx < lastNodeIdx, 'Future node?');
    const shape = ltrShapes[i];
    const offset = offsets[i];

    // go over existing bridge conflicts
    const bridges = this.bridgeGrid[lastNodeIdx][nodeIdx];
    for(const [niIdx, njIdx] of bridges){
      const ni = lastShape.getNeedle(niIdx, lastOffset);
      const nj = shape.getNeedle(njIdx, offset);
      const dist = Math.abs(ni.offset - nj.offset);
      if(dist > this.maxShift){
        return false;
      }
    }
  }
  // no unsatisfied bridge => output is likely possible
  return true;
};

PlanarEmbedding.prototype.progress = function(){
  if(this.stack.length){
    const currSel = this.stack[this.stack.length - 1];
    const currIdx = currSel[OUT_SHAPE];
    return currIdx / this.outShapes[0].length;

  } else {
    return this.iter ? 1.0 : 0.0;
  }
};

/**
 * Branch and bound optimization by exploring valid selections
 * while only exploring branches that are better (incrementally)
 * than a current best solution.
 */
PlanarEmbedding.prototype.optimize = function(
  batchIters = 500
){

  // initialization
  if(!this.iter && !this.stack.length){
    // initialize exploration stack
    // /!\ stack for DFS exploration
    // start exploration with first full step, across all its possible shapes
    // but in reverse order (so the first to pop out is the most likely)
    this.stack = this.outShapes[0].map((_, idx) => {
      // insert at 0
      // no input shape (-1)
      // no input offset (NaN)
      // given output shape (idx)
      // trivial output offset (0)
      return [-1, NaN, 0, idx, 0];
    }).reverse();
  }

  // extract locally
  let { stack, iter, bestSelection, bestCost } = this;

  // until fully explored, keep selection new options
  while(stack.length && (++iter % batchIters) !== 0){

    // selection sequence by stages:
    // 1) Input step shape (uint)
    // 2) Input step offset (int)
    // 3) Insertion index (uint)
    // 4) Output step shape (uint)
    // 5) Output step offset (int)
    const sel = stack.pop();
    assert(Array.isArray(sel) && sel.every(i => typeof i === 'number'),
      'Invalid selection');

    // check cost
    const cost = this.costOf(sel);

    // if done, then we should compute the cost
    if(sel.length === this.nodes.length * STAGE_COUNT){
      // check if better
      if(Cost.isCostBetter(cost, bestCost)){
        // save better option
        bestSelection = sel;
        bestCost = cost;
      }

      // anyway, do not go farther, since no more stage available
      continue;

    } else if(!Cost.isCostBetter(cost, bestCost, true)){
      // it's worse => no need to go farther
      continue;
    }

    // selection action depends on stage and node index
    const stage = sel.length % STAGE_COUNT;
    const nid = Math.floor(sel.length / STAGE_COUNT);
    const node = this.nodes[nid];
    switch(stage){

      // input step selection ------------------------------------------------
      case INP_SHAPE:
        if(this.isActive(node.firstStep)){
          // need to optimize input shape+offset
          const { front } = this.frontOf(sel);
          const ltr = front.filter(blk => blk.target === node.firstStep);
          const ltrNodeNums   = ltr.map(blk => blk.nodeIdx);
          const ltrShapeNums  = ltr.map(blk => blk.shapeIdx);
          const newShapes = this.inpShapes[nid];
          const {
            offsets, newShape = -1, newOffset
          } = this.selectBestInterface(
            ltrNodeNums, ltrShapeNums,
            nid, newShapes,
            cost[0] === bestCost[0]
          );
          if(newShape >= 0){
            // there is a good configuration
            // => select it (with associated offset)
            const newSel = sel.concat([newShape, newOffset]);

            // and update past selection offsets
            for(let i = 0; i < offsets.length; ++i){
              const prevIdx  = ltrNodeNums[i];
              const selIdx = prevIdx * STAGE_COUNT + OUT_OFFSET;
              if(Number.isNaN(sel[selIdx]))
                newSel[selIdx] = offsets[i];
              // else it's already set (from a previous interface)
            }
            stack.push(newSel);
          }

        } else {
          // out of graph => no need to select anything
          assert(stage === INP_SHAPE, 'Invalid input stage');
          stack.push(sel.concat([-1, NaN]));
        }
        break;

      // left-to-right index selection ---------------------------------------
      case INSERT_IDX: {
        const { front, preFront } = this.frontOf(sel);
        if(front.length > 0){
          // need to select valid insertion location
          // => get index range of difference between fronts before this shape appears
          //    and after this shape appears => what it modifies
          //    (and their mapping in the new front)
          // then use that range as constraint on the insertion index
          let actFromIdx = front.length - 1;
          let actToIdx   = 0;
          for(let i = 0; i < preFront.length; ++i){
            const { target } = preFront[i];
            assert(target, 'Active, without target');
            if(target.node === node){
              actFromIdx = Math.min(actFromIdx, i);
              actToIdx = Math.max(actToIdx, i);
            }
          }
          // check validity of insertion index
          // before actually selecting them
          const selectInsertIdx = idx => {
            const newSel = sel.concat([idx]);
            if(this.isInsertionIndexPossible(newSel))
              stack.push(newSel);
            else {
              // else such index breaks some lower-level constraints
              // => do not consider it
              this.numInsertReject++;
            }
          };

          // if activity range exists, then we have a restricted
          // range of insertion, else we do not
          if(this.filterIns && actFromIdx <= actToIdx){
            // get range in new front, while keeping in mind
            // that blocks may have been removed or updated
            const preSet = new Set(preFront);
            const newStartIdx = front.findIndex(blk => !preSet.has(blk));
            if(newStartIdx >= 0){
              // there is a new range
              const newEndIdx = front.reduce((maxIdx, blk, idx) => {
                return preSet.has(blk) ? maxIdx : Math.max(maxIdx, idx);
              }, newStartIdx);
              for(let i = newStartIdx; i <= newEndIdx; ++i){
                selectInsertIdx(i);
              }

            } else {
              // all removed => only one insertion point available
              const newInsertIdx = actFromIdx;
              selectInsertIdx(newInsertIdx);
            }

          } else {
            // can insert anywhere
            // /!\ insertion is using splice => index within [0; len], not [0; len-1]
            for(let i = 0; i <= front.length; ++i){
              selectInsertIdx(i);
            }
          }
          
        } else {
          // single option
          stack.push(sel.concat([0]));
        }
      } break;

      // output step selection -----------------------------------------------
      case OUT_SHAPE:
        if(this.isActive(node.lastStep)){
          // add all available shapes
          // /!\ done in reverse order since first is more common,
          //     and thus we want it at the end of the stack (to be processed first)
          // note: the offset is computed during output/input optimization
          const needsAlignment = cost[0] === bestCost[0];
          for(let i = this.outShapes[nid].length - 1; i >= 0; --i){
            if(needsAlignment && !this.getOutputShape(nid, i).isAligned())
              continue; // skip unaligned shapes because of cost

            // check that output shape does not break a bridge constraint
            const newSel = sel.concat([i, NaN]);
            if(this.isOutputPossible(newSel))
              stack.push(newSel);
            else
              this.numOutputReject++;
          }

        } else {
          // skip shape + offset, since not active
          stack.push(sel.concat([-1, NaN]));
        }
        break;

      default:
        assert.error('Invalid selection stage', stage);
        break;
    }
  } // endwhile #stack
  // information
  if(this.verbose){
    console.log(
      'Optimizing subgraph #'
      + this.graphIndex + ', iter=' + iter
      + ' #stack=' + stack.length
    );
  }

  // store into object
  this.stack = stack;
  this.iter = iter;
  this.bestSelection = bestSelection;
  this.bestCost = bestCost;

  // check if done or not
  if(this.stack.length)
    return false;
  // else we're done!

  //
  // Apply selection onto nodes ----------------------------------------------
  //
  if(bestSelection){
    const [
      inpShapes, inpOffsets,
      insertIndex,
      outShapes, outOffsets
    ] = this.extractFrom(bestSelection);
    assert(outOffsets.length === this.nodes.length,
      'Selection did not cover some node');
    // apply shapes and offsets
    for(let i = 0; i < this.nodes.length; ++i){
      const node = this.nodes[i];
      // input shape
      const inpShapeIdx = inpShapes[i];
      if(inpShapeIdx >= 0){
        const shape = this.getInputShape(i, inpShapeIdx);
        assert(shape, 'Shape index is invalid', inpShapeIdx);
        node.firstStep.shape = shape;

        // check offset but discard (optimized later globally)
        const inpOffset = inpOffsets[i];
        assert(!Number.isNaN(inpOffset), 'Invalid offset', inpOffset);
        // node.offset = inpOffset;
      }

      // output shape (and left-to-right order information)
      const insertIdx = insertIndex[i];
      const outShapeIdx = outShapes[i];
      if(outShapeIdx >= 0){
        assert(insertIdx > -1, 'Invalid insertion index for output shape');
        // get front with this step
        const { front } = this.frontOf(bestSelection, i);
        const frontIdx = front.findIndex(blk => blk.step.node === node);
        assert(frontIdx > -1, 'Output shape, but no output step');
        assert(frontIdx === insertIdx, 'Invalid insertion', frontIdx, insertIdx);
        
        // set left-right information
        node.setLTRNodes(front.map(({ step, target }, fi) => {
          if(fi === insertIdx)
            return [ node, node ];
          else {
            assert(step && target, 'Front with invalid step');
            return [ step.node, target.node ];
          }
        }), insertIdx);

        // get output shape
        const shape = this.getOutputShape(i, outShapeIdx);
        assert(shape, 'Shape index is invalid', outShapeIdx);
        node.postShape = shape;

        // check offset and discard (optimized later globally)
        const outOffset = outOffsets[i];
        assert(!Number.isNaN(outOffset), 'Invalid offset', outOffset);
        
      } else {
        // XXX with splits, we can have a non-singleton front here
        node.setLTRNodes([
          [node, node]
        ], 0);
      }
    }

    // debug information
    if(this.verbose){
      const [alignCost, rollCost, shiftCost] = bestCost;
      console.log(
        'Subgraph#' + this.graphIndex + ' cost: '
        + alignCost + ' unaligned, '
        + rollCost + ' rolls and '
        + shiftCost + ' shifts, in '
        + iter + ' iterations, with '
        + this.costCache.size + ' cost entries'
      );
      console.log(
        'Early rejections: #insert=' + this.numInsertReject
        + ', #output=' + this.numOutputReject
      );
      // console.log('Offsets: ' + offsets.join(', '));
    }

  } else {
    console.warn(
      'Did not find a valid configuration for subgraph #'
      + this.graphIndex + ' ('
      + this.inpActiveSet.size + ' inputs, '
      + this.outActiveSet.size + ' outputs) after '
      + iter + ' iterations, with '
      + this.costCache.size + ' cost entries'
    );
  }
  return true;
};

module.exports = PlanarEmbedding;