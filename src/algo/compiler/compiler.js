// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const KnittingProgram = require('./program.js');
const ActionPass = require('./actionpass.js');
const CastOnPass = require('./caston.js');
const CastOffPass = require('./castoff.js');
const { YarnStartPass, YarnEndPass } = require('./yarn.js');
const AlignmentPass = require('./alignment.js');
const ShapingPass = require('./shaping.js');
const { HalfGaugeHook } = require('./halfgauge.js');
const { xfer } = require('../../knitout/transfer.js');
const SketchLayer = require('./sketchlayer.js');
const Timer = require('../../timer.js');
/** @typedef {import('../../knitout.js').sim.KnittingMachineState} KnittingMachineState */
/** @typedef {import('../schedule/node.js')} YarnNode */

// constants
// - shaping algorithm
const CSE_SHAPING = 'cse';
// const RS_SHAPING  = 'rs';

/**
 * Create a new code generation algorithm from a sequence of nodes.
 * 
 * @param {YarnNode[]} nodes a time-ordered sequence of nodes
 * @param {Object} params an object with parameters for code generation
 */
function CompilerAlgorithm(nodes, params){
  // inputs
  this.trace    = null; // will be populated upon init()
  this.nodes    = nodes;
  this.gauge    = params.gauge || 'full';
  this.verbose  = !!params.verbose;
  // algorithm parameters
  this.useISN       = !!params.useIncreaseStitchNumber;
  this.useSRTucks   = !!params.useSRTucks;
  this.useSVS       = !!params.useSVS;
  this.intarsiaTucks = params.intarsiaTucks || 'both';
  this.intarsiaSide = params.intarsiaSide || 'after';
  this.safeTucks    = !!params.safeTucks;
  this.shapingAlgo  = params.shapingAlgorithm || CSE_SHAPING;
  this.useCSE       = this.shapingAlgo === CSE_SHAPING;
  this.multiTransfer = params.multiTransfer || false;
  this.reduceTransfers = params.reduceTransfers || false;
  this.usePickUpStitch = !!params.usePickUpStitch;
  this.insertDepth  = params.insertDepth || 3;
  // casting types
  this.castOnType   = params.castOnType || CastOnPass.INTERLOCK;
  // program pre- and post-modifiers
  this.progHooks  = [];
  this.progMods   = [];

  // output
  this.program = null; // will be populated upon init

  // state
  this.nodeIndex = 0; // node assembly index
  this.stepIndex = 0; // step assembly index
  this.iterIndex = 0; // assembly index
  this.iterCount = 0;
  this.passIndex = 0; // pass index
  this.lastPass  = null;
  this.passCount = 0;
  this.modIndex  = 0; // modifier index
  this.totalStitchCount = 0;
  this.timer = Timer.create();
}

CompilerAlgorithm.prototype.getNodeIndex = function(){
  return this.nodes.map(n => {
    const start = n.firstSlice.traceStart;
    const end   = n.lastSlice.traceEnd;
    // trace index start + end
    return { start, end };
  });
};

CompilerAlgorithm.prototype.init = function(){

  // 0) Restart timer
  this.timer.restart();

  // 1) Get trace
  this.trace = this.nodes[0].trace;
  assert(this.trace, 'Missing trace?');

  // 2) Create knitting program and allocate output space
  this.totalStitchCount = this.nodes.reduce((sum, node) => {
    return sum + node.stitchCount;
  }, 0);
  this.program = new KnittingProgram(this.trace);
  const factor = 3; // XXX tune this factor
  this.program.allocate(this.totalStitchCount * factor);

  // 3) Measure constants for progress
  this.iterCount = this.nodes.reduce((sum, node) => {
    return sum + node.steps.length;
  }, 0);
  this.timer.measure('alloc');

  // 4) Instantiate hooks and pre-assemble layers
  // = half-gauge hook and layer hooks
  if(this.gauge === 'half'){
    this.progHooks.push(new HalfGaugeHook());
  }
  const layers = SketchLayer.applyTo(this.trace, this.getNodeIndex());
  for(const layer of layers){
    // potential hook
    const hook = layer.getHook();
    if(hook)
      this.progHooks.push(hook);
    // potential modifier
    const mod = layer.getModifier();
    if(mod)
      this.progMods.push(mod);
  }
  for(const hook of this.progHooks)
    this.program.addHook(hook);

  return true;
};

CompilerAlgorithm.prototype.startNode = function(node, nodeIndex){
  // comment marker to split visualization at node start
  this.program.addEvent('nodeStart', node, 'Node ' + nodeIndex);
};
CompilerAlgorithm.prototype.consumeStep = function(step){
  // step start event
  this.program.addEvent('stepStart', step);

  // 1 = yarn insertion pass
  if(step.startsYarn()){
    this.program.addFragment(YarnStartPass.fromBlock(step.block, this.insertDepth));
  }

  // 2 = caston pass
  if(step.needsCastOn()){
    this.program.addFragment(CastOnPass.fromBlock(step.block, this.castOnType));
  }

  // 3 = action | castoff
  if(step.needsCastOff()){
    // 3b = castoff pass
    this.program.addFragment(CastOffPass.fromBlock(step.block, this));

  } else {
    // 3a = action pass
    this.program.addFragment(ActionPass.fromBlock(step.block, this));

    // 4a = shaping pass
    this.program.addFragment(ShapingPass.fromBlock(step.block, this));
  }

  // 5 = alignment pass
  this.program.addFragment(AlignmentPass.fromBlock(step.block, this));

  // 6 = yarn removal pass
  if(step.endsYarn())
    this.program.addFragment(YarnEndPass.fromBlock(step.block));

  // step end event
  this.program.addEvent('stepEnd', step);
};
CompilerAlgorithm.prototype.endNode = function(node){
  // event
  this.program.addEvent('nodeEnd', node);

  // between-node alignment
  if(node.following){
    const curr = node.lastBlockRow;
    const next = node.following.firstBlockRow;
    this.program.addFragment(AlignmentPass.fromRows(curr, next));
  }
};

CompilerAlgorithm.prototype.assemble = function(){
  if(this.nodeIndex >= this.nodes.length)
    return true; // done!
  
  // current node
  const node = this.nodes[this.nodeIndex];
  if(this.stepIndex === 0)
    this.startNode(node, this.nodeIndex);

  // current step
  const step = node.steps[this.stepIndex];
  this.consumeStep(step);

  // Update indices
  ++this.stepIndex;
  ++this.iterIndex;
  if(this.stepIndex >= node.steps.length){
    ++this.nodeIndex;
    this.stepIndex = 0;
    this.endNode(node);
  }

  // we're done when we've gone over all nodes
  const done = this.nodeIndex >= this.nodes.length;
  if(done){
    this.timer.measure('assemble');
    this.passCount = this.program.size();
  }
  return done;
};

CompilerAlgorithm.prototype.generate = function(){
  // are we done?
  if(this.passIndex >= this.passCount)
    return true;

  // generate Knitout code of the current pass
  // 1) get current pass
  const pass = this.lastPass ? this.lastPass.next : this.program.first;

  // 2) generate Knitout code
  assert(pass, 'Missing pass');
  this.program.build(pass, this.verbose);

  // 3) switch to next pass (if any)
  ++this.passIndex;
  this.lastPass = pass;

  // done state
  const passDone = this.passIndex >= this.passCount;
  const hasNext  = this.lastPass.hasNext();
  assert(passDone !== hasNext,
    'Done with passes pending, or not done, but no pass pending');
  if(passDone){
    this.timer.measure('generate');
  }
  return passDone;
};

/**
 * Pass modifications over the entire program
 */
CompilerAlgorithm.prototype.modify = function(){
  if(this.modIndex >= this.progMods.length)
    return true;

  // get program modifier
  const progMod = this.progMods[this.modIndex];
  // XXX apply over the whole program, generating a new program
  // update index
  ++this.modIndex;

  // we're done when we've gone over all nodes
  const done = this.modIndex >= this.progMods.length;
  if(done)
    this.timer.measure('modify');
  return done;
};

CompilerAlgorithm.prototype.finish = function(){
  // output debug information (and timing)
  if(this.verbose){
    (console.debug || console.log)(
      '#stitches=' + this.totalStitchCount
    + ', #instr=' + this.program.output.length
    );
    this.timer.debug('Code gen');
  }
  return true;
};

/**
 * Returns the code generaton progress
 * 
 * @return { number } a progress number within [0;1]
 */
CompilerAlgorithm.prototype.progress = function(){
  // assembly stage
  if(this.iterIndex < this.iterCount)
    return this.iterIndex / this.iterCount;
  // generate stage
  if(this.passIndex < this.passCount)
    return this.passIndex / this.passCount;
  // modifier stage
  if(this.modIndex < this.progMods.length)
    return this.modIndex / this.progMods.length;
  // any other state
  return 1.0;
};

module.exports = Object.assign(CompilerAlgorithm, {
  // load
  resolve: function(){
    if(xfer instanceof Promise)
      return xfer;
    else
      return Promise.resolve(xfer);
  }
});