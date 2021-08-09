// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
// const BedShape = require('./shape.js');
const NeedleBlock = require('./block.js');
const { integerStats } = require('./cost.js');

// local variables
let __nodeID = -1;

/**
 * Return the pair of stress indices across two stitch arrays
 *
 * Two stitches have a stress relation iff
 * - they are the same
 * - they are wale-connected
 * 
 * @param {TracedStitch[]} sources the previous stitches
 * @param {TracedStitch[]} targets the next stitches
 * @return {number[][]} a list of index pairs [[src, trg]]
 */
function stressPairsBetween(sources, targets){
  const S = sources.length;
  const T = targets.length;
  const rotN = Math.max(S, T);
  const pairs = [];
  // check for shortcut if inside a node
  let prevRot = 0;
  srcLoop:
  for(let src = 0; src < S; ++src){
    const sts = sources[src];
    const stss = [ sts, ...sts.getNextWales()];
    let numPairs = Math.max(1, stss.length - 1);
    const rot = prevRot;
    for(let idx = 0; idx < T; ++idx){
      const trg = (src + idx + rot) % T;
      const tts = targets[trg];
      if(stss.some(ts => ts.matches(tts))){
        pairs.push([src, trg]);
        // update the expected rotation
        prevRot = (trg - src + rotN) % rotN;
        // decrease number of pairs available
        --numPairs;
        if(!numPairs)
          continue srcLoop;
      } // endif linked
    } // endfor trg
  } // endfor src
  return pairs;
}

/**
 * Yarn step used for compiler passes
 */
class YarnStep {
  /**
   * Create a yarn step associated with a node slice.
   * This allocates a default layout shape (to be optimized)
   * that contains the needle information.
   * 
   * @param {YarnNode} node the parent node
   * @param {number} index the associated trace slice index
   * @param {boolean} circular whether the step is within a circular node
   */
  constructor(node, index, circular){
    this.node     = node;
    this.index    = index;
    this.slice    = node.slices[index];
    this.circular = circular;
    this.shape    = null; // BedShape.from(this.slice.stitchCount, { circular });
  }

  get length(){ return this.slice.activeCount; }
  get stitchCount(){ return this.slice.stitches.length; }
  get lastIndex(){ return Math.max(0, this.length - 1); }
  get orientation(){ return this.slice.orientation; }
  get prevStep(){ return this.node.steps[this.index - 1]; }
  get nextStep(){ return this.node.steps[this.index + 1]; }
  get block(){ return this.node.getBlock(this.index); }
  get stitches(){ return this.slice.stitches; }
  
  isCCW(){ return this.slice.isCCW(); }
  isHead(){ return this.index === 0; }
  isTail(){ return this.index === this.node.steps.length - 1; }
  activeStitch(index){ return this.slice.activeStitch(index); }
  hasStitch(ts){ return this.slice.hasTracedStitch(ts); }
  hasActiveStitch(ts) { return this.slice.isActive(ts); }
  needsCastOn(){ return this.slice.needsCastOn(); }
  needsCastOff(){ return this.slice.needsCastOff(); }
  offsetRange(offset = 0){ return this.shape.getOffsetRange(offset); }
  startsYarn(){ return this.slice.startsYarn(); }
  endsYarn(){ return this.slice.endsYarn(); }

  /**
   * Returns the list of index pairs for yarn stress between
   * this step and a given step as argument.
   * 
   * @param {YarnStep} step the target yarn step
   * @return {number[][]} a list of index pairs [[src,trg]]
   */
  stressPairsTo(step){
    assert(step, 'No target step available');
    return stressPairsBetween(
      this.slice.stitches,
      step.slice.stitches
    );
  }

  /**
   * Returns the list of index pairs for yarn stress between
   * two different shapes using the post-needles.
   * 
   * The index list contains all index identities,
   * but the ones for needles casting-off.
   * 
   * @return {number[][]} a list of index identity pairs excluding cast-off needles
   */
  postStressPairs(){
    return this.slice.stitches.flatMap((ts, idx) => {
      if(ts.needsCastOff())
        return [];
      else
        return [ [idx,idx] ];
    });
  }
}

/**
 * A yarn block encapsulating stitches with associated needles
 * associated with a parent that is either
 * - a YarnStep => this block has active stitches
 * - a YarnNode => this block is suspended
 */
class YarnBlock {
  constructor(node, index, stitches, blockOrNeedles, offset = 0){
    // parenthood
    this.node = node;
    this.index  = index;

    // parameter
    this.offset = offset;

    // data
    this.stitches = stitches;
    if(blockOrNeedles instanceof NeedleBlock)
      this.block  = blockOrNeedles;
    else
      this.block  = NeedleBlock.fromNeedles(blockOrNeedles, 0, true);
    // this.stitchMap = new Map(stitches.map((ts, idx) => [ts, idx]));
    this.pairMap = new Map();
    this.pairOcc = new Map();
  }

  get stitchCount(){ return this.stitches.length; }
  get row(){ return this.node.getBlocks(this.index); }
  get colIndex(){ 
    const idx = this.row.findIndex(blk => blk === this);
    assert(idx !== -1, 'Invalid column index');
    return idx;
  }
  get leftBlock(){ return this.row[this.colIndex - 1]; }
  get rightBlock(){ return this.row[this.colIndex + 1]; }
  get leftBlocks(){ return this.row.slice(0, this.colIndex); }
  get rightBlocks(){ return this.row.slice(this.colIndex + 1); }

  left(...args){ return this.offset + this.block.left(...args); }
  right(...args){ return this.offset + this.block.right(...args); }
  width(...args){ return this.block.width(...args); }
  hasShape(){ return false; }
  isEmpty(){ return this.stitchCount === 0; }
  filter(predicate, parent, index = this.index + 1){
    const keep = this.stitches.map((...args) => !!predicate(...args));
    return new SuspendedBlock(
      parent, index,
      this.stitches.filter((_, idx) => keep[idx]),
      this.needles.filter((_, idx) => keep[idx]),
      this.offset
    );
  }

  /**
   * Return a local raw needle (without any offset)
   * 
   * @param {number} index the needle index
   * @return the corresponding local needle
   */
  getLocalNeedle(index){
    assert(index >= 0 && index < this.stitchCount,
      'Needle index out-of-bounds', index);
    return this.block.needles[index];
  }
  /**
   * Return an indexed needle, with a possible offset
   * 
   * @param {number} index the needle index
   * @param {number} offset a base offset (default is block offset)
   * @return the corresponding needle
   */
  getNeedle(index, offset = this.offset){
    return this.getLocalNeedle(index).shiftedBy(offset);
  }
  /**
   * Returns the list of needles of this block
   * with any potential given offset
   * 
   * @param {number} [offset] base offset (default is block offset)
   * @return {array} a list of needles
   */
  getNeedles(offset = this.offset){
    return this.block.needles.map(n => n.shiftedBy(offset));
  }
  /**
   * Return the needle associated with a stitch in this block.
   * If the stitch is not in the block, then returns null.
   * 
   * @param {any} ts traced stitch of interest
   * @param {number} [offset] base offset (default is block offset)
   * @return the corresponding needle or null
   */
  needleOf(ts, offset = this.offset){
    const stitchIndex = this.stitches.findIndex(s => s.matches(ts));
    if(stitchIndex !== -1)
      return this.getNeedle(stitchIndex, offset);
    else
      return null;
  }
  /**
   * Return the index pairs of needle movements between
   * this block and a given block argument.
   * 
   * Pairs are cached, and thus this method can be called
   * frequently without too much fear.
   * 
   * @param {YarnBlock} blk a yarn block
   * @return {number[][]} a list of needle index pairs [[src, trg]]
   */
  stressPairsTo(blk){
    if(!this.pairMap.has(blk)){
      const pairs = stressPairsBetween(
        this.stitches, blk.stitches
      );
      this.pairMap.set(blk, pairs);
    }
    return this.pairMap.get(blk);
  }
  getShiftsTo(
    blk, thisOffset = this.offset, thatOffset = blk.offset,
    errFun = x => Math.abs(x)
  ){
    if(!this.pairOcc.has(blk)){
      const pairs = this.stressPairsTo(blk) || [];
      const shifts = pairs.map(([src, trg]) => {
        const sn = this.getLocalNeedle(src);
        const tn = blk.getLocalNeedle(trg);
        return sn.offset - tn.offset;
      });
      const { occ } = integerStats(shifts);
      this.pairOcc.set(blk, Array.from(occ.entries()));
    }
    let shifts = 0;
    for(const [shift, count] of this.pairOcc.get(blk)){
      shifts += errFun(shift + thisOffset - thatOffset) * count;
    }
    return shifts;
  }
}

class YarnStepBlock extends YarnBlock {
  constructor(step, offset = 0){
    super(
      step.node,
      step.index,
      step.slice.stitches,
      step.shape.getNeedles(),
      offset
    );
    this.step = step;

    // caches
    this.activeCache = new Map();
  }

  get next(){ return this.node.getBlock(this.index + 1); }
  get colIndex(){ return this.node.ltrActive; }
  get slice(){ return this.step.slice; }

  hasShape(){ return true; }
  isCircular(){ return this.step.circular; }
  shapeChanges(){
    // && its shape changes into a different shape on the next step
    const thisShape = this.step.shape;
    const nextStep  = this.step.nextStep; 
    const nextShape = nextStep ? nextStep.shape : this.node.postShape;
    return !thisShape.matches(nextShape);
  }
  hasTracedStitch(ts){ return this.slice.hasTracedStitch(ts); }
  isActive(ts){ return this.slice.isActive(ts); }
  getActiveNeedles(){
    const offset = this.offset;
    if(!this.activeCache.has(offset)){
      this.activeCache.set(offset, this.slice.getActiveMap((_, nidx) => {
        return this.getNeedle(nidx, offset);
      }));
    }
    return this.activeCache.get(offset);
  }
  getActiveIndex(){ return this.slice.getActiveMap((ts, i) => i); }
  getDirections(){
    const ori = this.step.orientation;
    return this.getActiveNeedles().map(n => n.orientationToDir(ori));
  }
  /**
   * Compute the CCW sequence of stitches after cast-off, before shaping.
   * This excludes the needles of active stitches without next targets.
   * 
   * @return {array} a sequence of stitches
   */
  shapingStitches(){
    const slice = this.slice;
    return this.stitches.filter(ts => {
      return !slice.isActive(ts)
          || !ts.needsCastOff();
    });
  }
  /**
   * Compute the CCW sequence of needles after cast-off, before shaping.
   * It thus excludes the needles of stitches without next target.
   * 
   * @return {array} a sequence of needles
   */
  preNeedles(){
    const offset = this.offset;
    const slice = this.slice;
    return this.stitches.flatMap((ts, idx) => {
      const active = slice.isActive(ts);
      // remove needle if actively casting off
      // /!\ needs to be active!
      if(active && ts.needsCastOff())
        return []; // no needle after action
      else
        return [ this.getNeedle(idx, offset) ];
    });
  }
  /**
   * Compute the CCW sequence of needles after shaping.
   * It excludes the needles of stitches without next target.
   * For those with multiple target, the first one is used.
   * 
   * /!\ the preNeedles of the next blocks can have a different
   * cardinality, whereas these have the same as the preNeedle
   * of this block = they are their targets after shaping!
   * 
   * This also means that the cast-offs are only taken into account
   * if the underlying step is actively casting off.
   * 
   * @return {array} a sequence of needles
   */
  postNeedles(){
    const slice = this.slice;
    const nextBlock = this.next;
    const offset = nextBlock.offset;
    return this.stitches.flatMap(ts => {
      // suspended stitch case
      const sn = nextBlock.needleOf(ts, offset);
      if(sn)
        return [ sn ]; // suspended stitch
      else {
        assert(!slice.isExpected(ts),
          'Not in next block, but expected in current slice');
      }

      // get next wale target
      const nts = ts.getTargetWale();
      if(!nts)
        return []; // cast-off stitch
      const nn = nextBlock.needleOf(nts, offset);
      assert(nn, 'No needle found for next wale target');
      return [ nn ];
    });
  }
}

class SuspendedBlock extends YarnBlock {
  constructor(node, index, stitches, needles, offset = 0, original = null){
    super(node, index, stitches, needles, offset);

    // suspended copy tracking
    this.original = original || this;
    if(this.original === this){
      this.identity = stitches.map((_, idx) => [idx, idx]);
    } else {
      this.identity = original.identity;
    }
  }
  hasTracedStitch(ts){ return this.stitches.some(s => s.matches(ts)); }
  copy(index = this.index + 1, node = this.node){
    return new SuspendedBlock(
      node, index,
      this.stitches, this.block,
      this.offset, this.original
    );
  }
  stressPairsTo(blk){
    if(blk.original === this.original)
      return this.identity; // special case
    else if(blk.node === this.node)
      return null; // within same node, suspended blocks only link to themselves
    else
      return super.stressPairsTo(blk);
  }
  getShiftsTo(
    blk, thisOffset = this.offset, thatOffset = blk.offset,
    errFun = x => Math.abs(x)
  ){
    if(blk.original === this.original)
      return errFun(thisOffset - thatOffset) * this.stitchCount;
    else
      return super.getShiftsTo(blk, thisOffset, thatOffset, errFun);
  }
}

/**
 * A yarn node that cover multiple trace slices
 * for which the layout is optimized as a whole.
 */
class YarnNode {
  /**
   * Create a node with a given sequence of slices
   * 
   * @param {array} slices a sequence of trace slices
   */
  constructor(slices){
    this.id       = ++__nodeID;

    // input
    this.slices   = slices;
    assert(slices.length, 'Empty slices');
    this.circular = this.firstSlice.circular;
    assert(this.circular === this.lastSlice.circular,
      'First and last slices must have same circularity');

    // data
    this.steps = slices.map((_, sliceIndex) => {
      return new YarnStep(this, sliceIndex, this.circular);
    });
    this.blocks = []; // YarnBlock[][]
    this.postShape = null; // this.lastStep.shape.copy();

    // left-right ordering
    this.ltrNodes = [ this ]; // YarnNode[]
    this.ltrActive = 0; // default to single block

    // node dependencies
    this.prev = new Map();  // Map<YarnNode, [[src, trg]]> stress pairs
    this.next = new Map();  // Map<YarnNode, [[src, trg]]> stress pairs
    this.following  = null; // YarnNode?
    this.preceding  = null; // YarnNode?
    this.index = 0;

    // stitch map
    this.map = new Map();       // Map<ts.index, [stepIdx, activeIndex]>
    this.activeFront = [];      // TracedStitch[]
    this.buildMap();
  }

  get firstSlice(){   return this.slices[0]; }
  get lastSlice(){    return this.slices[this.slices.length - 1]; }
  get firstStep(){    return this.steps[0]; }
  get lastStep(){     return this.steps[this.steps.length - 1]; }
  get stitchCount(){  return this.map.size; }
  get length(){   return this.slices.length; }
  get trace(){    return this.firstSlice.trace; }
  get sampler(){  return this.trace.sampler; }
  get prevNodes(){    return this.prev.keys(); }
  get nextNodes(){    return this.next.keys(); }

  hasTracedStitch(tstitch){ return this.map.has(tstitch.index); }
  indexOf(ts){ return this.map.get(ts.index) || [-1, 0]; }
  stepOf(ts){ return this.steps[this.indexOf(ts)[0]]; }
  stepIndexOf(ts){
    const [s, i] = this.indexOf(ts);
    return [this.steps[s], i];
  }
  setLTRNodes(nodePairs, thisIndex){
    assert(Array.isArray(nodePairs) && nodePairs.length > 0,
      'Invalid node pairs');
    assert(typeof thisIndex === 'number'
          && 0 <= thisIndex && thisIndex < nodePairs.length,
      'Invalid index of this node', thisIndex);
    this.ltrNodes = nodePairs;
    this.ltrActive = thisIndex;
  }
  getBlocks(row){
    assert(0 <= row && row < this.blocks.length,
      'Invalid row number', row);
    return this.blocks[row];
  }
  get firstBlockRow(){ return this.getBlocks(0); }
  get lastBlockRow(){ return this.getBlocks(this.steps.length); }
  getBlock(row, col = this.ltrActive){
    assert(0 <= row && row < this.blocks.length,
      'Invalid row number', row);
    const blkRow = this.blocks[row];
    assert(0 <= col && col < blkRow.length,
      'Invalid column nomber', col);
    return blkRow[col];
  }

  /**
   * Build the basic data structures from the steps and slices:
   * - map = mapping from stitch index to [stepIdx, index]
   * - heads = front stitches for matching nodes dependencies
   * - tails = back stitches for matching node dependencies
   */
  buildMap(){
    for(let s = 0; s < this.steps.length; ++s){
      const step = this.steps[s];
      for(let i = 0, n = step.length; i < n; ++i){
        const ts = step.activeStitch(i);
        this.map.set(
          ts.index, [s, i]
        );
      } // endfor start <= i <= end
    } // endfor s < #steps

    // interfaces are front and back slices
    // - front slice is used to match past nodes
    //   but only considering active stitches
    // - back slice is used to receive those matches
    for(const stitch of this.firstSlice.stitches){
      const isFirstActive = this.firstSlice.isActive(stitch);
      const isActive = this.hasTracedStitch(stitch);
      const isNotLastExpected = !this.lastSlice.isExpected(stitch);
      if(isFirstActive
      || isActive
      || isNotLastExpected){
        // add to active front
        this.activeFront.push(stitch);
        // check that both hasTracedStitch and !isExpected match
        if(!isFirstActive){
          assert(isActive === isNotLastExpected,
            'Expected front stitch disappeared with being active');
        }
      }
    } // endfor stitch of this.firstSlice.stitches
  }

  /**
   * Checks whether the given node has front active stitches
   * that are linked to the tail of this node.
   * 
   * Active stitches are linked to this node
   * <=>
   *    One of their parent is active in this node
   * 
   * @param {YarnNode} node a node to check for active linking
   * @return {boolean} whether there is an active link
   */
  isLinkedTo(node){
    for(const activeStitch of node.activeFront){
      for(const pts of activeStitch.getPrevWales()){
        // note: just having the stitch expected
        // is not sufficient, as we care about direct adjacency
        if(this.hasTracedStitch(pts))
          return true;
      }
    }
    return false; // no reason found for an active link
  }

  /**
   * Compute stitch stress pairs for interface optimization.
   * 
   * The pairs go from this node's last slice to
   * the argument's head slice.
   * 
   * Pairs are [srcIndex, trgIndex], where the indices
   * are actual stitch indices within the corresponding slice
   * so that needle locations can be computed directly.
   * 
   * @param {YarnNode} node a node to compute stress pairs to
   * @return {number[][]} array of pairs [src, trg] that create stress
   */
  getStressPairsTo(node){
    // from tail to head
    return this.lastStep.stressPairsTo(node.firstStep);
  }

  /**
   * Verifies whether a node is a potential next node,
   * in which case we compute its associated stress pairs
   * and store them for both this node and the argument node.
   * 
   * @param {YarnNode} node a potential node neighbor (as next node)
   * @return {boolean} whether the argument is a next neighbor
   */
  tryLinkTo(node){
    if(!this.isLinkedTo(node))
      return false;

    // compute stress pairs and store them
    const stressPairs = this.getStressPairsTo(node);
    assert(stressPairs.length, 'Linked without stress pair');

    // store stress pairs
    this.next.set(node, stressPairs);
    node.prev.set(this, stressPairs.map(([src, trg]) => [trg, src]));
    return true;
  }

  generateBlocks(){
    // create block grid
    const numCols = this.ltrNodes.length;
    this.blocks = Array.from({
      length: this.steps.length + 1
    }, () => new Array(numCols));

    // create yarn step blocks
    for(const [row, step] of this.steps.entries())
      this.blocks[row][this.ltrActive] = new YarnStepBlock(step);

    // create last post-shape block
    post: {
      // should replace with the first target of each action
      const stitches = this.lastStep.stitches.filter(ts => {
        return !ts.needsCastOff();
      });
      const needles = stitches.map((_, i) => this.postShape.getNeedle(i)); 
      this.lastBlockRow[this.ltrActive] = new SuspendedBlock(
        this, this.steps.length,
        stitches, needles, this.postShape.offset
      );
    }

    // create initial suspended blocks
    // and then propagate them to the end
    for(let col = 0; col < this.ltrNodes.length; ++col){
      if(col === this.ltrActive)
        continue; // skip active yarn step block
      const [srcNode, trgNode] = this.ltrNodes[col];
      assert(srcNode !== trgNode, 'Source and target are the same');
      assert(trgNode !== this, 'Active suspended node');
      assert(srcNode && trgNode, 'Missing source or target node');

      // create initial suspended block
      assert(this.preceding, 'Suspended group without previous node');
      if(this.preceding === srcNode){
        // create a new block with the stitches that are linked
        // to the target node
        const pairIndex = srcNode.next.get(trgNode);
        assert(pairIndex && pairIndex.length,
          'Suspended block without connectivity pair index');
        const stitches = [];
        const needles  = [];
        const step = srcNode.lastStep;
        for(const [srcIdx] of pairIndex){
          stitches.push(step.slice.stitches[srcIdx]);
          needles.push(srcNode.postShape.getNeedle(srcIdx));
        }
        this.firstBlockRow[col] = new SuspendedBlock(
          this, 0, stitches, needles
        );

      } else {
        // find already existing suspended block in preceding node
        let prevBlock;
        for(let pcol = 0; pcol < this.preceding.ltrNodes.length; ++pcol){
          const [psrcNode, ptrgNode] = this.preceding.ltrNodes[pcol];
          if(psrcNode === srcNode && ptrgNode === trgNode){
            prevBlock = this.preceding.lastBlockRow[pcol];
            break;
          }
        }
        assert(prevBlock, 'No previous block matching LTR pair');
        this.firstBlockRow[col] = prevBlock.copy(0, this);
      }
      
      // create copies afterwards
      for(let row = 1; row < this.blocks.length; ++row){
        this.blocks[row][col] = this.blocks[row-1][col].copy(row);
      }
    }

    return this.blocks;
  }

  /**
   * Splits a sequence of slices and
   * create a sequence of associated nodes.
   * 
   * The split is done so that nodes are either
   * - starting and ending with circular slices
   * - having no circular slice
   * 
   * Two versions of the algorithm:
   * - legacy = uses slice information only
   * - simple = uses region information
   * 
   * @param {TraceSlice[]} slices a sequence of slices
   * @param {boolean} [legacy=false] whether to use the legacy algorithm
   * @return {YarnNode[]} a sequence of nodes
   */
  static from(slices, legacy = false){
    // 1 = compute the nodes
    let nodes;
    if(legacy)
      nodes = YarnNode.fromLegacy(slices);
    else
      nodes = YarnNode.fromRegions(slices);

    // 2 = store node dependencies
    // = define prev/next nodes of each node
    for(let i = 0; i < nodes.length; ++i){
      const n0 = nodes[i];
      for(let j = i + 1; j < nodes.length; ++j){
        const n1 = nodes[j];
        // check whether n0 <- n1 or n0 -> n1
        const fwd = n0.tryLinkTo(n1);
        const bwd = n1.tryLinkTo(n0);
        assert(!fwd || !bwd, 'Both forward and backward links between two nodes!');
      }
    }
    return nodes;
  }

  static fromRegions(slices){
    const nodes = [];
    let nodeSlices = [];
    const regionOf = slice => {
      const s0 = slice.stitches[0].stitch;
      return s0.getRegionID();
    };
    for(const slice of slices){
      if(!nodeSlices.length
      || regionOf(nodeSlices[0]) === regionOf(slice))
        nodeSlices.push(slice);
      else {
        nodes.push(new YarnNode(nodeSlices));
        nodeSlices = [ slice ];
      }
    }
    if(nodeSlices.length)
      nodes.push(new YarnNode(nodeSlices));
    return nodes;
  }

  static fromLegacy(slices){
    const nodes = [];
    let preSlices = [];
    let midSlices = [];
    let posSlices = [];
    if(slices[0].circular)
      midSlices.push(slices[0]);
    else
      preSlices.push(slices[0]);
    // node creation function
    const commitNodes = (createPost = false) => {
      // potential pre-circular section
      if(preSlices.length){
        nodes.push(new YarnNode(preSlices));
        preSlices = [];
      }
      // potential circular section
      if(midSlices.length){
        nodes.push(new YarnNode(midSlices));
        midSlices = [];
      }
      // potential post-circular section
      // = becomes pre-circular, or a post-node (at the end)
      if(posSlices.length){
        if(createPost)
          nodes.push(new YarnNode(posSlices));
        else
          preSlices = posSlices;
        posSlices = [];
      }
    };
    if(slices[0].needsCastOff())
      commitNodes(); // race case
    for(let i = 1; i < slices.length; ++i){
      const prevSlice = slices[i - 1];
      const slice = slices[i];
      // check whether we need to split
      // but only if we have some slices to worry about
      if(preSlices.length || midSlices.length){
        let split = false;
        for(const ts of slice.activeStitches()){
          // split iff
          // - unexpected stitch (i.e. new), and either
          //   - it is casting on, or
          //   - prev slice is missing one of its previous wales
          const noStitch    = !prevSlice.hasTracedStitch(ts);
          const castingOn   = ts.needsCastOn();
          const missParent  = ts.getPrevWales().some(pts => {
            return !prevSlice.hasTracedStitch(pts);
          });
          if(noStitch && (castingOn || missParent)){
            split = true;
            break;
          }
        }
        // split if needed
        if(split){
          commitNodes();
        } // endif split
      }

      // add new slice
      if(slice.circular){
        if(posSlices.length){
          midSlices = midSlices.concat(posSlices);
          posSlices = [];
        }
        midSlices.push(slice);
      } else if(midSlices.length){
        posSlices.push(slice);
      } else {
        preSlices.push(slice);
      }

      // commit if slice was ending yarn
      if(slice.needsCastOff()){
        commitNodes();
      }
    }
    // closing nodes
    commitNodes(true); // last post-section becomes a node
    return nodes;
  }
}

module.exports = Object.assign(YarnNode, {
  Step: YarnStep,
  Block: YarnBlock
});