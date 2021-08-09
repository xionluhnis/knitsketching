// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const Knitout = require('./knitout.js');
const K = Knitout;
const { Needle, LEFT, RIGHT, NORMAL_STITCH, PRESSER_OFF } = K;

class Loop {
  constructor(data){
    // representative data
    this.data = data;

    // carrier sources
    this.cs = [];

    // past connectivity
    this.parents = [];
    this.previous = [];
  }
  static from(data){ return new Loop(data); }
}

function offsetOf(arg){
  if(arg instanceof K.Needle)
    return arg.offset;
  else {
    assert(typeof arg === 'number', 'Invalid argument type');
    return arg;
  }
}

/** @typedef {'f'|'b'|'fs'|'bs'} BedSide */

/**
 * Needle bed state representation
 *
 * @property {BedSide} side the bed side (f|fs|b|bs)
 * @property {Map<number, Loop[]>} offsets the mapping from offset to loops
 * @property {Map<Loop, number>} loops the mapping from loop to offset
 */
class NeedleBed {
  constructor(side){
    this.side = side;          // FRONT|BACK|FRONT_SLIDER|BACK_SLIDER
    this.offsets  = new Map(); // Map<number, Loop[]>
    this.loops    = new Map(); // Map<Loop, number>
  }

  matches(n){ return n.side === this.side; }
  isEmpty(idx = null){
    if(idx === null)
      return this.offsets.size === 0;
    else if(idx instanceof K.Needle)
      return !this.offsets.has(idx.offset);
    else {
      assert(typeof idx === 'number',
        'Argument must be either null, a needle or an offset');
      return !this.offsets.has(idx);
    }
  }
  hasLoop(loop){ return this.loops.has(loop); }

  // generic getter / setters
  getLoops(idx){ return this.offsets.get(offsetOf(idx)) || []; }
  setLoops(idx, loops){
    assert(Array.isArray(loops), 'Loops must be an array');
    const offset = offsetOf(idx);
    // remove past loop information
    for(const loop of this.offsets.get(offset) || [])
      this.loops.delete(loop);

    // set new loop information
    this.offsets.set(offset, loops);
    for(const loop of loops)
      this.loops.set(loop, offset);
  }
  getOffset(loop){
    assert(this.loops.has(loop), 'No offset to be found', loop, this);
    return this.loops.get(loop);
  }
  getNeedle(loop){ return new Needle(this.side, this.getOffset(loop)); }

  // semantic setters
  knit(idx, loop){
    // get previous loop to store as parents of the new loop
    const loops = this.getLoops(idx);
    loop.parents.push(...loops);
    // set new loops on needle
    this.setLoops(idx, [loop]);
    // return the past loops
    return loops;
  }
  tuck(idx, ...loops){
    assert(loops.length, 'Tuck requires at least one loop argument');
    const offset = offsetOf(idx);
    // add in offset mapping
    if(this.offsets.has(offset))
      this.offsets.get(offset).push(...loops);
    else
      this.offsets.set(offset, loops);
    // add in loop mapping
    for(const loop of loops)
      this.loops.set(loop, offset);
  }
  drop(idx){
    const offset = offsetOf(idx);
    const loops = this.offsets.get(offset) || [];
    this.offsets.delete(offset);
    for(const loop of loops)
      this.loops.delete(loop);
    return loops;
  }

  copy(){
    const nb = new NeedleBed(this.side);
    for(const [offset, loops] of this.offsets){
      assert(loops.length, 'Empty list of loops should not exist');
      nb.offsets.set(offset, loops.slice());
      for(const loop of loops)
        nb.loops.set(loop, offset);
    }
    return nb;
  }

  offsetEntries(){  return this.offsets.entries(); }
  offsetKeys(){     return this.offsets.keys(); }
  loopKeys(){       return this.loops.keys(); }
  *needleEntries(){
    for(const [off, loops] of this.offsetEntries())
      yield [new K.Needle(this.side, off), loops];
  }
  *needleKeys(){
    for(const off of this.offsetKeys())
      yield new K.Needle(this.side, off);
  }
  sortedNeedles(sortFunc){
    return Array.from(this.needleKeys()).sort(sortFunc);
  }

  findLoop(predicate){
    for(const loop of this.loops.keys()){
      if(predicate(loop, this))
        return loop;
    }
    return null;
  }

  findLoopNeedle(predicate){
    for(const loop of this.loops.keys()){
      if(predicate(loop, this))
        return new K.Needle(this.side, this.getOffset(loop));
    }
    return null;
  }
  *filterLoopNeedles(predicate){
    for(const loop of this.loops.keys()){
      if(predicate(loop, this))
        yield new K.Needle(this.side, this.getOffset(loop));
    }
  }

  findOffset(predicate){
    for(const offset of this.offsets.keys()){
      if(predicate(offset, this))
        return offset;
    }
    return null;
  }

  toString(min = Infinity, max = -Infinity){
    if(!Number.isFinite(min) || !Number.isFinite(max)){
      for(const offset of this.offsets.keys()){
        min = Math.min(min, offset);
        max = Math.max(max, offset);
      }
    }
    const cells = [];
    for(let off = min; off <= max; ++off){
      const loops = this.offsets.get(off) || [];
      cells.push(loops.length ? 'o' : '-');
    }
    return cells.join('');
  }
}

class YarnCarrier {
  constructor(
    name, machine, inBed = false, active = false, released = false,
    needle = new Needle(K.FRONT, Infinity), side = RIGHT,
    lastLoop = null
  ){
    this.name     = name;
    this.machine  = machine;
    this.inBed    = !!inBed;
    this.active   = !!active;
    this.released = !!released;
    this.needle   = needle;
    this.side     = side;
    this.lastLoop = lastLoop;
    assert(name, 'Missing name of carrier');
    assert(machine instanceof KnittingMachineState, 'Invalid machine');
    assert(needle instanceof Needle, 'Invalid needle location');
    assert([LEFT, RIGHT].includes(side), 'Invalid side', side);
    assert(!lastLoop || lastLoop instanceof Loop, 'Invalid loop');
  }
  getLoopNeedle(){
    if(!this.lastLoop)
      return null;
    return this.machine.getLoopNeedle(this.lastLoop);
  }

  conflictsDirectlyWith(
    n, racking = this.machine.racking, threshold = 10
  ){
    const delta = n.frontOffset(racking) - this.needle.frontOffset(racking);
    if(this.side === RIGHT)
      return 0 < delta && delta < threshold; // within possible range
    else {
      return -threshold < delta && delta < 0; // within possible range
    }
  }
  conflictsIndirectlyWith(
    n, racking = this.machine.racking, threshold = 10
  ){
    const ln = this.getLoopNeedle();
    if(!ln)
      return false;
    // if n is between this carrier and the needle of the last loop
    // then we have an indirect conflict (yarn is in between)
    const loopOffset = ln.frontOffset(racking);
    const carrierOffset = this.needle.frontOffset(racking) + this.side * threshold;
    const nOffset = n.frontOffset(racking);
    // note: if at loop needle, we do not consider as conflict
    return (nOffset - carrierOffset) * (nOffset - loopOffset) < 0;
  }
  conflictsWith(n, racking = this.machine.racking, threshold = 10){
    return this.conflictsDirectlyWith(n, racking, threshold)
        || this.conflictsIndirectlyWith(n, racking);
  }

  copy(machine){
    return new YarnCarrier(
      this.name, machine, this.inBed, this.active, this.released,
      this.needle, this.side, this.lastLoop
    );
  }

  insert(){
    this.inBed = true;
    return this;
  }

  activate(){
    this.active = true;
    return this;
  }

  release(){
    this.released = true;
    return this;
  }
  
  atNeedleSide(needle, side = this.side, loop = null){
    this.active = true;
    this.needle = needle;
    this.side = side;
    if(loop){
      assert(loop instanceof Loop,
        'Invalid loop type');
      if(this.lastLoop)
        loop.previous.push(this.lastLoop);
      loop.cs.push(this.name);
      this.lastLoop = loop;
    }
    assert(needle instanceof Needle, 'Invalid needle location');
    assert([LEFT, RIGHT].includes(side), 'Invalid side', side);
    return this;
  }
}

class KnittingMachineState {
  constructor(data = {}, live = false, emptyBeds = false){
    this.live = live; // XXX should be private
    const {
      beds,
      racking = 0, carriers = new Map(),
      stitchNumber = NORMAL_STITCH,
      presserMode = PRESSER_OFF,
      speed = 0, lastCarriers = []
    } = data;
    if(beds && !emptyBeds){
      // copy data from argument
      const entries = Array.from(beds.entries(), ([side, nb]) => [side, nb.copy()]);
      this.beds = new Map(entries);
    } else {
      // create new beds
      const entries = Knitout.ALL_SIDES.map(side => {
        return [side, new NeedleBed(side)];
      });
      this.beds = new Map(entries);
    }
    this.racking = racking;
    this.stitchNumber = stitchNumber;
    this.speed = speed;
    this.presserMode = presserMode;
    this.carriers = new Map(Array.from(carriers.values(), c => {
      return [c.name, c.copy(this)];
    }));
    this.lastCarriers = lastCarriers.slice();
    // loop information
    this.loopProvider = () => ({}); // no information in loops
  }

  isLive(){
    return this.live;
  }
  copy(){
    return new KnittingMachineState(this);
  }
  asCopy(){
    if(this.isLive())
      return this.copy();
    else
      return this;
  }
  clearCopy(){
    return new KnittingMachineState(this, false, true);
  }

  setLoopProvider(fun){
    this.loopProvider = fun;
  }

  getBed(side){ return this.beds.get(side); }
  getHookBed(side){
    return this.getBed(side.endsWith('s') ? side.charAt(0) : side);
  }
  getSliderBed(side){
    return this.getBed(side.endsWith('s') ? side : side + 's');
  }
  hookBeds(){ return Knitout.HOOK_SIDES.map(s => this.getBed(s)); }
  sliderBeds(){ return Knitout.SLIDER_SIDES.map(s => this.getBed(s)); }
  getNeedleLoops(n){ return this.beds.get(n.side).getLoops(n.offset); }
  isEmpty(n){ return this.beds.get(n.side).isEmpty(n.offset); }
  hasPendingSliders(){
    for(const nb of this.sliderBeds()){
      if(!nb.isEmpty())
        return true;
    }
    return false;
  }

  findLoop(predicate){
    for(const nb of this.beds.values()){
      const loop = nb.findLoop(predicate);
      if(loop !== null)
        return [nb, loop];
    }
    return null;
  }

  findLoopNeedle(predicate){
    for(const nb of this.beds.values()){
      const n = nb.findLoopNeedle(predicate);
      if(n)
        return n;
    }
    return null;
  }
  *filterLoopNeedles(predicate){
    for(const nb of this.beds.values())
      yield *nb.filterLoopNeedles(predicate);
  }

  hasLoop(loop){
    for(const nb of this.beds.values()){
      if(nb.hasLoop(loop))
        return true;
    }
    return false;
  }

  getLoopNeedle(loop){
    for(const nb of this.beds.values()){
      if(nb.hasLoop(loop))
        return new Needle(nb.side, nb.getOffset(loop));
    }
    return null;
  }

  findNeedle(predicate){
    for(const nb of this.beds.values()){
      const offset = nb.find(offset => {
        return predicate(new K.Needle(nb.side, offset), nb.getLoops(offset));
      });
      if(offset !== null){
        return new K.Needle(nb.side, offset);
      }
    }
    return null;
  }

  *allCarriers(){ yield *this.carriers.values(); }
  *activeCarriers(){ yield *this.filterCarriers(c => c.active); }
  *filterCarriers(pred){
    for(const carrier of this.carriers.values()){
      if(pred(carrier))
        yield carrier;
    }
  }
  getAllCarriers(){ return Array.from(this.allCarriers()); }
  getActiveCarriers(){ return Array.from(this.activeCarriers()); }

  *needles(){
    for(const nb of this.beds.values())
      yield *nb.needleKeys();
  }
  *needleEntries(){
    for(const nb of this.beds.values())
      yield *nb.needleEntries();
  }

  mapCarrier(name, cFunc, defResult = false){
    const carrier = this.carriers.get(name);
    if(carrier)
      return cFunc(carrier, name);
    else
      return defResult;
  }
  setCarrier(name, sFunc, createCopy = false){
    if(!this.carriers.has(name)){
      this.createCarrier(name);
    }
    const carrier = this.carriers.get(name);
    assert(carrier, 'Carrier does not exist yet', name);
    // create copy if asked for
    const newCarrier = createCopy ? carrier.copy(this) : carrier;
    sFunc(newCarrier);
    if(createCopy)
      this.carriers.set(name, newCarrier);
    return newCarrier;
  }
  getCarrier(name){ return this.carriers.get(name); }
  getCarriers(names){
    return names.map(name => this.carriers.get(name));
  }
  createCarrier(name, ...args){
    assert(!this.carriers.has(name), 'Carrier exists already', name);
    const carrier = new YarnCarrier(name, this, ...args);
    this.carriers.set(name, carrier);
    return carrier;
  }
  isCarrierActive(name){   return this.mapCarrier(name, c => c.active); }
  isCarrierReleased(name){ return this.mapCarrier(name, c => c.released); }
  isCarrierInBed(name){    return this.mapCarrier(name, c => c.inBed); }
  removeCarrier(cname){
    this.carriers.delete(cname);
  }
  getCarrierConflicts(n){
    const cs = [];
    for(const [cname, carrier] of this.carriers){
      if(carrier.conflictsWith(n, this.racking))
        cs.push(cname);
    }
    return cs;
  }
  hasCarrierConflict(n){
    for(const carrier of this.carriers.values()){
      if(carrier.conflictsWith(n, this.racking))
        return true;
    }
    return false;
  }

  toStrings(min = Infinity, max = -Infinity){
    if(!Number.isFinite(min) || !Number.isFinite(max)){
      for(const nb of this.beds.values()){
        for(const offset of nb.offsetKeys()){
          min = Math.min(min, offset);
          max = Math.max(max, offset);
        }
      }
    }
    return ['b', 'bs', 'fs', 'f'].map(s => this.beds.get(s).toString(min, max));
  }

  toString(min = Infinity, max = -Infinity){
    return this.toStrings(min, max).join('\n');
  }

  consume(op, args, loopData){
    const desc = K.OPERATIONS[op] || [];
    assert(desc.length, 'Unsupported operation', op, desc);
    assert(args.length === desc.length - 1, 'Arguments do not match');

    // generic carriers (always as last argument if any)
    const cs = desc[desc.length - 1] === K.CARRIERS ? args[args.length - 1] : [];
    if(cs.length)
      this.lastCarriers = cs.slice(); // store as last carriers
    switch(op){

      // in cs
      case K.IN:
      case K.INHOOK:
        for(const cname of cs)
          this.setCarrier(cname, c => c.insert());
        break;

      // releasehook cs
      case K.RELEASEHOOK:
        // check that the carriers we are releasing are all non-released yet
        for(const cname of cs)
          this.setCarrier(cname, c => c.release());

        // check that no carrier is pending release
        assert(Array.from(this.carriers.values()).every(c => c.released),
          'Some carriers have not been released after releasehook',
          cs, this.carriers);
        break;

      // out cs
      // outhook cs
      case K.OUT:
      case K.OUTHOOK:
        for(const cname of cs)
          this.removeCarrier(cname);
        break;

      // rack r
      case K.RACK:
        this.racking = args[0];
        break;

      // knit d n cs
      case K.KNIT: {
        const [dir, n] = args;
        const nb = this.beds.get(n.side);
        const loop = Loop.from(loopData);
        nb.knit(n, loop);
        // carrier set
        for(const cname of cs)
          this.setCarrier(cname, c => c.atNeedleSide(n, dir, loop));
      } break;

      // tuck d n cs
      case K.TUCK: {
        const [dir, n] = args;
        const nb = this.beds.get(n.side);
        const loop = Loop.from(loopData);
        nb.tuck(n, loop);
        // carrier set
        for(const cname of cs)
          this.setCarrier(cname, c => c.atNeedleSide(n, dir, loop));
      } break;

      // drop n
      case K.DROP: {
        const n = args[0];
        const nb = this.beds.get(n.side);
        nb.drop(n);
      } break;

      // xfer n n2
      case K.XFER: {
        const [n, n2] = args;
        assert(n.frontOffset(this.racking) === n2.frontOffset(this.racking),
          'Transfer needle offsets do not match', n, n2, this.racking);
        assert(n.side !== n2.side, 'Cannot transfer between same side beds');
        const nb = this.beds.get(n.side);
        const n2b = this.beds.get(n2.side);
        const loops = nb.drop(n); // drop on that side
        if(loops.length)
          n2b.tuck(n2, ...loops); // tuck on the other (unless no loops)

        // find carriers to be changed
        const cupdates = [];
        for(const [name, c] of this.carriers.entries()){
          if(c.needle.matches(n))
            cupdates.push([name, n2]);
        }
        // carrier set
        for(const [name, n2] of cupdates)
          this.setCarrier(name, c => c.atNeedleSide(n2));
      } break;

      // split d n n2 cs
      case K.SPLIT: {
        const [dir, n, n2] = args;
        assert(n.frontOffset(this.racking) === n2.frontOffset(this.racking),
          'Split needle offsets do not match', n, n2, this.racking);
        assert(n.side !== n2.side, 'Cannot split between same side beds');
        const nb = this.beds.get(n.side);
        const n2b = this.beds.get(n2.side);
        const loop = Loop.from(loopData);
        const prevLoops = nb.knit(n, loop);
        n2b.tuck(n2, ...prevLoops);
        
        // find carriers to be changed
        const cupdates = [];
        for(const [name, c] of this.carriers.entries()){
          if(cs.includes(name)){
            cupdates.push([name, n, dir]); // in cs => always update
          } else if(c.needle.matches(n))
            cupdates.push([name, n2, c.side]); // no in cs, matching n
        }
        // carrier set
        for(const [name, n, side] of cupdates)
          this.setCarrier(name, c => c.atNeedleSide(n, side, loop));
      } break;

      // miss d n cs
      case K.MISS: {
        const [dir, n] = args;
        // carrier set
        for(const cname of cs)
          this.setCarrier(cname, c => c.atNeedleSide(n, dir));
      } break;

      // stitch sn tn
      case K.STITCH:
        console.warn('Does not support stitch, use x-stitch-number');
        /* fall through */

      // x-stitch-number n
      case K.X_STITCH_NUMBER:
        this.stitchNumber = args[0];
        break;

      // x-speed-number n
      case K.X_SPEED_NUMBER:
        this.speed = args[0];
        break;

      // x-presser-mode mode
      case K.X_PRESSER_MODE:
        this.presserMode = args[0];
        break;

      default:
        // do nothing by default
        break;
    }
  }

  execute(op, args){
    if(this.isLive()){
      assert.error('Cannot execute operations on a live machine state');
      return;
    }
    // consume this operation with a new loop
    const loopData = this.loopProvider();
    this.consume(op, args, loopData);
  }
}

// individual simulated operations
operations: {
  for(let opcode = 1; opcode < Knitout.OPERATIONS.length; ++opcode){
    const [name,] = Knitout.OPERATIONS[opcode];
    assert(!(name in KnittingMachineState.prototype),
      'A knitout operation overwrites a machine operation', name);
    // implement explicit code execution (for simulated state changes)
    KnittingMachineState.prototype[name] = function(...args){
      this.execute(opcode, args);
      return this;
    };
    if(name.startsWith('x-'))
      KnittingMachineState.prototype[Knitout.extensionName(name)] = KnittingMachineState.prototype[name];
  }
}

function simulate(k, loopFun = i => i){
  assert(k instanceof Knitout, 'Argument must be a Knitout object');
  const machine = new KnittingMachineState();
  const states = [];
  for(let i = 0; i < k.length; ++i){
    const op = k.getOperation(i);
    const args = k.getArgs(i);
    machine.consume(op, args, loopFun(i));
    // store new state
    states.push(machine.copy());
  }
  return states;
}

function simulateBlocks(blocks, loopFun = i => i){
  assert(Array.isArray(blocks), 'Argument must be an array of Block objects');
  const machine = new KnittingMachineState();
  const states = [];
  // directly go over all blocks
  for(let b = 0; b < blocks.length; ++b){
    const block = blocks[b];
    // go over full block before yielding a new state
    for(let e = 0; e < block.actions.length; ++e){
      const entry = block.actions[e];
      const ptr = block.pointers[e];
      machine.consume(entry[0], entry.slice(1), loopFun(ptr, b, e));
    }
    // store new state
    states.push(machine.copy());
  }
  return states;
}

function streamSimulation(kstream, loopFun = i => i, copy = false){
  assert(kstream instanceof Knitout.Stream,
    'Argument must be a knitout stream', kstream);
  const machine = new KnittingMachineState({}, true);

  // upon operation commit, update machine
  let i = 0;
  kstream.listen(k => {
    const op = k.getOperation(-1);
    const args = k.getArgs(-1);
    machine.consume(op, args, loopFun(i++));
  });

  // return function to get machine snapshots
  return !copy ? machine : () => machine.copy();
}

module.exports = {
  // objects
  NeedleBed,
  YarnCarrier,
  KnittingMachineState,

  // functions
  simulate,
  simulateBlocks,
  streamSimulation
};
