// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const geom = require('../../geom.js');
const Timer = require('../../timer.js');
const TraceSlice  = require('./slice.js');
const BedShape    = require('./shape.js');
const YarnNode    = require('./node.js');
const Cost = require('./cost.js');
const OffsetOptimizer = require('./offsets.js');
const {
  topoSort,
  findIndependentSubGraphs
} = require('./opt.js');
const PlanarEmbedding = require('./planar.js');
const StitchProgram = require('../compiler/stitchprog.js');

// constants
const SCHEDULE_FORWARD  = 'forward';
const SCHEDULE_GREEDY   = 'greedy';
const SCHEDULE_OPTIMAL  = 'optimal';

/**
 * Create a new scheduling algorithm from a yarn trace and parameters.
 * 
 * @param trace a trace instance
 * @param params an object containing parameters for the scheduling algorithm
 */
function SchedulingAlgorithm(trace, params){
  // inputs
  this.trace = trace;
  this.verbose = !!params.verbose;
  this.scheduleType = params.scheduleType || SCHEDULE_GREEDY;
  this.useSubGraphs = !!params.useSubGraphs;
  this.filterInsert = !!params.filterInsert;
  this.flatLayouts = params.flatLayouts || 'all';
  this.useFlatFlipping = !!params.useFlatFlipping;
  this.useGreedyTension = !!params.useGreedyTension;
  this.useLegacySlicing = !!params.useLegacySlicing;
  this.stitchProgram = params.stitchProgram;
  this.params = params;
  // shaping step boundaries
  this.maxStepDecrease = params.maxStepDecrease || 2;
  this.maxStepIncrease = params.maxStepIncrease || 2;
  this.maxShift = params.maxShift || 2;
  this.mixedShaping = !!params.mixedShaping;

  // states
  // - between nodes = at interfaces
  this.subGraphs = [];
  this.graphIndex = 0;
  this.planar = null;
  // - within nodes
  this.withinIndex = 0;
  this.stepIndex = 0;
  // - node offsets
  this.blocks = [];
  this.offOpt = null;

  // constants over optimization
  this.fullyFlat = false;
  this.simpleFlat = BedShape.isSimpleFlat(this.flatLayouts);
  this.stepCount = 1;

  // outputs
  this.nodes = [];
  this.nodeIndex = [];

  // debug
  this.timer = Timer.create();
}

/**
 * Returns the scheduling progress within [0;1].
 * Note that the progress is not cumulative.
 * One progress within [0;1] is generated per step.
 * 
 * @return {number} a progress number within [0;1]
 */
SchedulingAlgorithm.prototype.progress = function(){
  // depends on stage
  if(this.graphIndex < this.subGraphs.length){
    // 1. Between-nodes optimization
    const delta = this.planar ? this.planar.progress() : 0;
    return (this.graphIndex + delta) / (this.subGraphs.length || 1);

  } else if(this.withinIndex < this.nodes.length){
    // 2. Within-nodes optimization
    return this.stepIndex / (this.stepCount || 1);

  } else {
    // 3. Block creation, and
    // 4. Block offsets optimization
    return this.offOpt ? this.offOpt.progress() : 0;
    // this.blockPass / maxBlockPasses;
  }
};

SchedulingAlgorithm.prototype.init = function(){
  this.timer.restart();

  // 1) Compute trace slices from trace
  const slices = TraceSlice.from(
    this.trace,
    this.maxStepIncrease,
    this.maxStepDecrease,
    this.useLegacySlicing
  );
  if(this.verbose){
    // check that the slices are consistent
    for(const slice of slices){
      const ass0 = Array.from(slice.activeStitches());
      const ass1 = slice.getActiveMap(ts => ts);
      assert(ass0.length === ass1.length, 'Not consistent!');
      for(let i = 0; i < ass0.length; ++i)
        assert(ass0[i].matches(ass1[i]), 'Inconsistent stitches');
    }
  }

  // 2) Create nodes from slices, with their dependencies
  // /!\ we must not overwrite the array as the compiler refers to it!
  for(const node of YarnNode.from(slices, this.useLegacySlicing))
    this.nodes.push(node);

  // 3) Topological order on nodes given their dependencies
  topoSort(this.nodes, this.nodes.filter(n => n.prev.size === 0));
  // store preceding/following node
  for(let i = 0; i < this.nodes.length; ++i){
    this.nodes[i].index = i;
    this.nodes[i].preceding = this.nodes[i - 1];
    this.nodes[i].following = this.nodes[i + 1];
  }

  // 4) Compute node index (for UI)
  this.nodeIndex = this.nodes.map(n => {
    const start = n.firstSlice.traceStart;
    const end   = n.lastSlice.traceEnd;
    // trace index start + end
    return { start, end };
  });

  // 5) Compute invariants
  this.fullyFlat = this.nodes.every(n => !n.circular);
  this.stepCount = this.nodes.reduce((sum, n) => sum + n.steps.length, 0);

  // 6) Pre-compute sub-graphs
  // = find layout-independent subsets of the node graph
  let bridgeSet;
  if(this.useSubGraphs)
    [this.subGraphs, bridgeSet] = findIndependentSubGraphs(this.nodes, true);
  else
    [this.subGraphs, bridgeSet] = [[this.nodes.slice()], new Set()];

  // measure timing
  this.timer.measure('init');

  // 7) Apply stitch program if any
  if(this.stitchProgram && this.stitchProgram.length){
    try {
      StitchProgram.transform(
        this.trace, this.nodeIndex,
        this.stitchProgram,
        this.verbose
      );
    } catch(e){
      assert.error(e);
    }
  }

  // debug
  if(this.verbose){
    console.log(
      'Scheduling ' + this.nodes.length + ' nodes, within '
    + this.subGraphs.length + ' subgraph(s) - ['
    + (bridgeSet.size / 2) + ' bridge node(s)]'
    );
  }

  return true;
};

/**
 * Optimize the planar embedding for an independent subgraph.
 * This only optimizes the nodes at the node interfaces within the dependency graph.
 * 
 * The optimization uses branch and bound to explore the space
 * of potential node settings. The selection parameters are:
 * - Node input shapes
 * - Node input offsets
 * - Left-to-right insertion index
 * - Node output shapes
 * - Node output offsets
 * 
 * @see PlanarEmbedding
 */
SchedulingAlgorithm.prototype.optimizeBetweenNodes = function(){
  // interface optimization between nodes of a subgraph
  if(this.graphIndex >= this.subGraphs.length)
    return true;
  
  // get the subgraph nodes
  const nodes = this.subGraphs[this.graphIndex];
  assert(nodes.length > 0, 'Empty subgraph');

  // only optimize if not a singleton
  if(nodes.length > 1){
    // find a valid planar embedding that minimizes
    // our typical [align, rolls, shifts] cost lexicographically
    if(!this.planar)
      this.planar = new PlanarEmbedding(nodes, this); // create new
    if(!this.planar.optimize())
      return false; // need more optimization
    else
      this.planar = null; // we're done with it
  }

  const done = ++this.graphIndex >= this.subGraphs.length;
  if(done)
    this.timer.measure('itfs');
  return done;
};

/**
 * One step (node) of the optimization for the bed shapes within nodes.
 */
SchedulingAlgorithm.prototype.optimizeWithinNodes = function(){
  // layout optimization within nodes
  if(this.withinIndex >= this.nodes.length)
    return true;
  const node = this.nodes[this.withinIndex];
  const hasPrev = node.prev.size > 0;
  const hasNext = node.next.size > 0;

  // build list of potential shapes
  const stepCount = node.steps.length;
  const stepShapes = node.steps.map(step => {
    const stitchCount = step.slice.stitches.length;
    // step options depend on location and slice type
    if(step.shape){
      // fixed start
      return [ step.shape ];

    } else if(this.fullyFlat){
      // fully flat
      return [
        BedShape.from(stitchCount, { circular: false })
      ];

    } else {
      // free step
      return Array.from(BedShape.shapes(stitchCount, {
        circular: step.circular, simple: true, // note: no packing constraints
        flatLayouts: this.flatLayouts,
        flipping: this.useFlatFlipping
      }));
    }
  });
  // post shape(s)
  if(hasNext)
    stepShapes.push([ node.postShape ]); // fixed from next interface
  else {
    // not fixed = copy options of last step
    stepShapes.push(
      stepShapes[stepShapes.length - 1] // the shapes of the last step
    );
  }

  // build list of pair indexes between shapes at each step
  const pairsIndices = node.steps.map(step => {
    return step.nextStep ? step.stressPairsTo(step.nextStep) : step.postStressPairs();
  });

  // optimize for intermediary steps (and their offsets)
  let backward = hasNext && !hasPrev;
  let selection;
  switch(this.scheduleType){
    case SCHEDULE_FORWARD:
      backward = false; // enforce we do it forward
      /* fall through */
    case SCHEDULE_GREEDY:
      if(hasPrev && hasNext && this.useGreedyTension && stepShapes[0][0].circular)
        selection = this.greedyTensionSteps(stepShapes, pairsIndices);
      else
        selection = this.greedySteps(stepShapes, pairsIndices, backward);
      break;

    default:
      assert(this.scheduleType === SCHEDULE_OPTIMAL,
        'Unsupported schedule type', this.scheduleType);
      selection = this.optimalSteps(stepShapes, pairsIndices);
  }

  // check results
  assert(Array.isArray(selection) && selection.length === stepCount + 1,
    'Invalid selection');

  // apply selection to internal steps
  for(let i = 0; i < stepCount; ++i){
    const step = node.steps[i];
    step.shape = stepShapes[i][selection[i]];
  }
  node.postShape = stepShapes[stepCount][selection[stepCount]];

  // update indices for progress
  this.stepIndex += stepCount;

  // done when we've gone over all steps
  const done = ++this.withinIndex >= this.nodes.length;
  if(done)
    this.timer.measure('nodes');
  return done;
};

SchedulingAlgorithm.prototype.greedyTensionSteps = function(
  stepsShapes, idxPairs
){
  const stepCount = stepsShapes.length - 1;
  assert(stepCount > 0, 'Front + post => minimum 2 shapes');
  assert(stepsShapes[0].length === 1
      && stepsShapes[stepCount].length === 1,
    'Greedy tension requires fixed start and end steps');
  // get rotations at start and end
  const { roll: rs, stitchCount: ns } = stepsShapes[0][0];
  const { roll: re, stitchCount: ne } = stepsShapes[stepCount][0];
  const ts = rs / ns;
  const te = re / ne;

  // try rotations in both directions
  // and use the one that leads to the least amount of [roll,shift]
  const sshapes = new Array(2);
  const sels = new Array(2);
  const rcosts = new Array(2);
  const scosts = new Array(2);
  let bestIdx = -1;
  let bestCost = [Infinity, Infinity];
  for(let i = 0; i < 2; ++i){
    const lerpInside = !i;
    const shapes = stepsShapes.map((stepShapes, stepIdx) => {
      if(stepShapes.length === 1)
        return stepShapes;
      // else we filter to the proper amount of roll
      const stitchCount = stepShapes[0].stitchCount;
      const alpha = stepIdx / stepCount;
      let ti;
      if(lerpInside){
        ti = geom.lerp(ts, te, alpha); // interpolation inside [0;1]
      } else if(ts < te){
        ti = geom.lerp(1 + ts, te, alpha); // interpolation across [0;1], by 0-1
      } else {
        ti = geom.lerp(ts, 1 + te, alpha); // interpolation across [0;1], by 1-0
      }
      const ri = Math.round(ti * stitchCount) % stitchCount;
      const rollShapes = stepShapes.filter(s => {
        return s.roll === ri;
      });
      assert(rollShapes.length,
        'No matching shape with proper tension');
      return rollShapes;
    });
    sshapes[i] = shapes;
    const { selection, rollCost, shiftCost } = this.greedySteps(
      shapes, idxPairs, false, false, true
    );
    sels[i] = selection;
    rcosts[i] = rollCost;
    scosts[i] = shiftCost;
    if(rollCost < bestCost[0]
    || (rollCost === bestCost[0] && shiftCost < bestCost[1])){
      bestIdx = i;
      bestCost = [rollCost, shiftCost];
    }
  }
  assert(bestIdx !== -1, 'No best selection?');
  const bestSel = sels[bestIdx];
  return stepsShapes.map((stepShapes, stepIdx) => {
    const bestShape = sshapes[bestIdx][stepIdx][bestSel[stepIdx]];
    const shapeIdx = stepShapes.indexOf(bestShape);
    assert(shapeIdx !== -1, 'Selection does not exist');
    return shapeIdx;
  });
};

/**
 * Optimize the selection of a sequence of step shapes to minimize [roll, shift].
 * This is done in a greedy way by finding the best pair, step by step
 * while using the best target as the next source shape.
 * 
 * For results where the last step is constrained, the result may be sub-optimal
 * for that last step.
 * However, assuming we allow a free transfer after the last step,
 * then this is a viable solution (and optimal but for that last rotation/translation).
 * In practice, we need that last freedom, so it's a reasonable strategy.
 * 
 * @param {BedShape[][]} stepsShapes a sequence of valid shape lists for each step
 * @param {number[][]} idxPairs a sequence of lists of needle pairs
 * @param {boolean} [backward=false] whether to optimize backward
 * @return {number[]} the index sequence of the best shapes
 */
SchedulingAlgorithm.prototype.greedySteps = function(
  stepsShapes, idxPairs,
  backward = false,
  greedyTension = false,
  returnCost = false
){
  const forward = !backward;
  // greedy front-to-back strategy
  const stepCount = stepsShapes.length - 1;
  assert(stepCount > 0, 'Front + post => minimum 2 shapes');
  if(forward && stepCount === 1){
    return returnCost ? {
      rollCost: 0, shiftCost: 0, selection: [0, 0]
    } : [0, 0]; // trivial case without optimization
  }
    
  
  // else we must at least optimize one pair
  const selection = Array.from({ length: stepCount+1 }, () => 0);
  let rollCost  = 0;
  let shiftCost = 0;
  let start, end, dir;
  if(backward){
    [start, end, dir] = [stepCount - 1, -1, -1];
  } else {
    [start, end, dir] = [0, stepCount, +1];
  }
  for(let i = start; i !== end; i += dir){
    let srcShapes;
    if(i === start || backward) {
      // backward => no constraint on source
      // forward, start => no constraint either (or preset)
      srcShapes = stepsShapes[i];

    } else {
      // use previous selection
      srcShapes = [ stepsShapes[i][selection[i]] ];
    }
    let trgShapes;
    if(backward){
      // backward => target is constrained
      trgShapes = [ stepsShapes[i+1][selection[i+1]] ];

    } else {
      // unconstrained (yet to optimize)
      trgShapes = stepsShapes[i + 1];
    }
    const pairIdx   = idxPairs[i]; // from source to target
    if(pairIdx.length === 0){
      assert(i === stepCount - 1 && forward,
        'Empty pair index before the last step of a forward node');
      // we reuse the previous selection
      selection[i + 1] = selection[i];
      continue;
    }

    // special shortcut for 1-1 shapes
    if((srcShapes.length === 1 || trgShapes.length === 1)
    && srcShapes[0].stitchCount === trgShapes[0].stitchCount){
      let useShortCut = true;
      if(this.mixedShaping){
        // for mixed shaping, we could still check whether it's 1-1
        // and then actually apply the shortcut, which may speed up things
        const srcSet = new Set();
        const trgSet = new Set();
        checkLoop:
        for(const [is, it] of pairIdx){
          for(const [idx, set] of [[is, srcSet], [it, trgSet]]){
            if(set.has(idx)){
              // index appears twice
              // => irregular stitch!
              // => may require some shaping
              useShortCut = false;
              break checkLoop;

            } else {
              set.add(idx);
            }
          } // endfor [idx, set]
        } // endfor [is, it] of pairIdx
      } // endif this.mixedShaping
      // only use shortcut if acceptable to do so
      if(useShortCut){
        // we can reuse the previous selection directly if we can match it
        let sel = -1;
        // get first needle pair
        const [src0, trg0] = pairIdx[0];
        // find matching shape
        if(forward && srcShapes.length === 1){
          // forward transfer = from source to target
          const srcShape = srcShapes[0];
          const sn = srcShape.getNeedle(src0);
          sel = selection[i+1] = trgShapes.findIndex(s => {
            // return s.matches(srcShape);
            return s.getNeedle(trg0).matches(sn);
          });
        
        } else if(!forward && trgShapes.length === 1) {
          // backward transfer = from target to source
          const trgShape = trgShapes[0];
          const tn = trgShape.getNeedle(trg0);
          sel = selection[i] = srcShapes.findIndex(s => {
            // return s.matches(trgShape);
            return s.getNeedle(src0).matches(tn);
          });
        }
        // did we find a matching selection
        if(sel !== -1){
          // matching selection
          // no roll or shift error
          // => to next step directly
          continue;
        }
        // else, no matching shape found
      } // endif useShortCut
    }

    // find optimal shape pair from source to target
    const {
      srcIdx, trgIdx, rolls, shifts
    } = Cost.getBestShapePair(srcShapes, trgShapes, pairIdx);
    
    // first forward step produces a selection for the source too
    // in the forward mode
    if(forward){
      if(i === 0)
        selection[i] = srcIdx;
      // selection of target
      selection[i+1] = trgIdx;

    } else {
      // selection of source
      selection[i] = srcIdx;
    }

    // update cost (for debug)
    rollCost += rolls;
    shiftCost += shifts;
  }

  // debug
  if(this.verbose){
    console.log(
      'Greedy node cost: '
      + rollCost + ' rolls and '
      + shiftCost + ' shifts'
    );
    // console.log(stepsShapes.map((s,i) => {
    //   return s[selection[i]].toString();
    // }));
  }

  return returnCost ? { selection, rollCost, shiftCost } : selection;
};

/**
 * Optimize the selection of a sequence of step shapes to minimize [roll, shift].
 * This is done using branch and bound with the bound being the best cost
 * currently achieved.
 * 
 * Note that the data structure for sequence expansion must imply DFS traversal.
 * /!\ BFS is not appropriate because we can only updated the bound after having
 * traversed the entire sequence. Thus BFS would lead to expanding the entire
 * valid space for the initial bound!
 * Fortunately, DFS is done with a stack = default Javascript array.
 * 
 * @param {BedShape[][]} stepsShapes a sequence of valid shape lists for each step
 * @param {number[][]} idxPairs a sequence of lists of needle pairs
 * @return {number[]} the index sequence of the best shapes
 */
SchedulingAlgorithm.prototype.optimalSteps = function(stepsShapes, idxPairs){
  // optimal incremental search
  // /!\ this could be an exponential search in the worst case scenario
  //  => use branch and bound to do better in practice
  const stepCount = stepsShapes.length - 1;
  assert(stepCount > 0, 'Front + post shapes => minimum 2');
  assert(stepCount === idxPairs.length,
    'There should be one steps shape option more than pair indexes');

  // cost cache and incremental cost function
  const costCaches = stepsShapes.map(() => new Map());
  const costOf = sequence => {
    let rollCost = 0;
    let shiftCost = 0;
    for(let i = 0; i < sequence.length - 1; ++i){
      const pairIndex = idxPairs[i];
      if(pairIndex.length === 0){
        assert(i === sequence.length - 2,
          'Empty pair index before the last step of a node');
        continue;
      }
      const src = sequence[i + 0];
      const trg = sequence[i + 1];
      // if not cached yet, create cache value
      const cacheKey = [src, trg].join('/');
      const costCache = costCaches[i];
      if(!costCache.has(cacheKey)){
        const srcShape = stepsShapes[i + 0][src];
        const trgShape = stepsShapes[i + 1][trg];
        assert(srcShape && trgShape, 'Invalid sequence');
        costCache.set(
          cacheKey,
          Cost.getShapePairCost(srcShape, trgShape, pairIndex)
        );
      }
      
      // retrieve from cache (except for offset that is not yet needed)
      const { rolls, shifts } = costCache.get(cacheKey);
      rollCost += rolls;
      shiftCost += shifts;
    }
    return [rollCost, shiftCost];
  };
  
  // branch and bound exploration
  // => need initial bound = from default order
  let bestSelection = stepsShapes.map(() => 0);
  let [bestRoll, bestShift] = costOf(bestSelection); // = full cost!

  // DFS vs BFS?
  // DFS => we go to the end faster
  //     => we can reduce the bound faster! (better)
  // BFS => we can remove branches faster if the initial cost is good
  //     ... but if the initial cost is bad, we may explode in space!
  // = no reason for BFS => DFS only viable (and cheaper data structure)
  // = stack-based (vs queue-based)
  const stack = [ [] ]; // start with empty selection
  let iter = 0;
  while(stack.length){
    ++iter; // for debug
    const selection = stack.pop();
    const [rolls, shifts] = costOf(selection);
    if(rolls > bestRoll
    || (rolls === bestRoll && shifts >= bestShift)){
      // skip branch or result
      continue;
    }
    
    // useful branch
    if(selection.length === stepCount + 1){
      // found a better selection! => record info
      bestRoll = rolls;
      bestShift = shifts;
      bestSelection = selection;

    } else {
      // expand sequence at its level
      const selIdx = selection.length;
      const shapeCount = stepsShapes[selIdx].length;
      for(let i = 0; i < shapeCount; ++i){
        stack.push(selection.concat( [i] ));
      }
    }
  } // endwhile #stack

  // extract offsets
  assert(bestSelection.length === stepCount, 'Invalid selection');
  for(let i = 0; i < bestSelection.length - 1; ++i){
    const src = bestSelection[i + 0];
    const trg = bestSelection[i + 1];
    const cacheKey = [src, trg].join('/');
    const costCache = costCaches[i];
    assert(costCache.has(cacheKey), 'Sequence not tested yet?');
  }

  // debug
  if(this.verbose){
    console.log(
      'Optimal node cost: '
      + bestRoll + ' rolls and '
      + bestShift + ' shifts'
      + ', in ' + iter + ' iteration(s)'
    );
  }

  // we've found the best selection (exhaustively)
  // => return list of shapes with their offsets
  return bestSelection;
};

/**
 * Generate the needle blocks for global offset optimization
 */
SchedulingAlgorithm.prototype.generateBlocks = function(){
  // create the needle blocks
  // => shapes are fixed, only the block offsets can change from now on
  this.blocks = this.nodes.flatMap(node => {
    return node.generateBlocks().filter(row => row.some(blk => {
      return !blk.isEmpty();
    }));
  });
  assert(this.blocks[0].length === 1,
    'First row has multiple blocks');
  this.offOpt = new OffsetOptimizer(this.blocks, this.params);
  this.timer.measure('blocks');

  // apply basic LTR packing to all rows
  this.offOpt.pack();
  this.timer.measure('pack');

  // initial alignment
  this.offOpt.align();
  this.timer.measure('align');

  return true;
};

SchedulingAlgorithm.prototype.optimizeBlocksOffsets = function(){
  const done = this.offOpt.optimize();
  if(done)
    this.timer.measure('offsets');
  return done;
};

SchedulingAlgorithm.prototype.finish = function(){
  // debug layout
  if(this.verbose){
    for(let i = 0; i < this.nodes.length; ++i){
      const node = this.nodes[i];
      const start = node.firstStep.shape.getOffsetRange();
      const end   = node.postShape.getOffsetRange();
      console.log(
        'Node#' + node.id + ': from ('
        + start.min + ', ' + start.max + ') to ('
        + end.min + ', ' + end.max + ') in '
        + node.steps.length + ' steps'
      );
    }
    const offsets = this.blocks.map(row => row.map(blk => blk.offset));
    console.log('Block offsets: ', offsets);
    this.timer.debug('Scheduling');
  }
  return true;
};

module.exports = Object.assign(SchedulingAlgorithm, {
  GREEDY:   SCHEDULE_GREEDY,
  OPTIMAL:  SCHEDULE_OPTIMAL
});