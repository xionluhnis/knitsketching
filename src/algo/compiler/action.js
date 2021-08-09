// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { INCREASE_STITCH } = require('../../knitout.js');
const xfer = require('../../knitout/transfer.js');

// constants
// - shaping actions
const KNIT      = 0;
const TUCK      = 1;
const MISS      = 2;
const KICKBACK  = 3;
const SPLIT     = 4;
const RSPLIT    = 5;
// - common actions
const BKNIT     = 6;
const FBKNIT    = 7;
const USR_START = 8;

// program passes
const PRE   = 'pre';
const MAIN  = 'main';
const POST  = 'post';

// storages
const programs = [];
const namedProgMap = new Map();
function noop(){}
function knit(k, d, ns, cs){ k.knit(d, ns[0], cs); }
let splitBySide = false;
let useCSEMoves = false;

class Action {
  constructor(stitch){
    this.stitch = stitch;
    this.progId = stitch.getProgram();
    if(!this.progId && stitch.isShaping()){
      this.progId = stitch.getShapingAction();
    }
    assert(0 <= this.progId && this.progId < programs.length,
      'Invalid program id', this.progId, programs.length);
  }
  isStandard(){ return 0 <= this.id && this.id < USR_START; }
  getProgram(){ return programs[this.progId] || Knit; }
  getNumPasses(which){
    const prog = this.getProgram();
    assert(which in prog, 'Invalid program pass', which);
    return (prog[which] || []).length;
  }
  getFrontPassIndex(){
    const prog = this.getProgram();
    return prog.frontPass;
  }
  exec(...args){
    const prog = this.getProgram();
    prog.exec(...args);
    return this;
  }

  static from(stitch){ return new Action(stitch); }
  static resetPrograms(){
    programs.splice(USR_START);
    namedProgMap.clear();
    splitBySide = false;
    useCSEMoves = false;
  }
  static splitBySide(flag){
    if(typeof flag === 'boolean')
      splitBySide = flag;
    else
      return splitBySide;
  }
  static useCSEMoves(flag){
    if(typeof flag === 'boolean')
      useCSEMoves = flag;
    else
      return useCSEMoves;
  }
  static register({
    // action passes
    pre = [],
    main,
    post = [],
    // per-action options
    splitBySide,
    useCSEMoves,
    quarterRacking,
    frontPass = 0
  }, name = null){
    if(name && namedProgMap.has(name)){
      const progId = namedProgMap.get(name);
      return programs[progId];
    }
    const progId = programs.length;
    const prog = new ActionProgram(progId, pre, main, post, {
      splitBySide, useCSEMoves, quarterRacking, frontPass
    });
    programs.push(prog);
    if(name){
      namedProgMap.set(name, progId);
    }
    return prog;
  }
  static numPrograms(){ return programs.length; }
  static getOptionDefault(name){
    switch(name){
      case 'splitBySide': return splitBySide;
      case 'useCSEMoves': return useCSEMoves;
      case 'quarterRacking': return false;
      default: return null;
    }
  }
}

// ------------------------------------------------------------------
// action program wrappers ------------------------------------------
// ------------------------------------------------------------------
// new argument wrapper (for destructuring by name)
class ProgramArguments {
  constructor(k, e, s, m, {
    svs = false
  } = {}){
    this.k = k; // knitout
    this.e = e; // action entry
    this.s = s; // knitting state
    this.m = m; // move map
    // options
    this.svs = svs; // split via sliders
  }
  get d(){ return this.e.dir; }
  get dir(){ return this.e.dir; }
  get n(){ return this.e.needle; }
  get needle(){ return this.e.needle; }
  get ns(){ return this.e.needles; }
  get needles(){ return this.e.needles; }
  get rn(){ return this.e.needle.otherHook(); }
  get cs(){ return this.e.carriers; }
  get carriers(){ return this.e.carriers; }
  get state(){ return this.s; }
  get stitch(){ return this.e.stitch; }
  get move(){
    if(!this.m){
      assert.error('Cannot use move in main pass');
      return;
    }
    return (steps) => {
      if(!steps)
        return; // not a real move
      const key = this.n.toString();
      assert(!this.m.has(key), 'Can only call move once');
      this.m.set(key, this.e.stepNeedle(steps));
    };
  }
}

// program wrapper
class ActionProgram {
  constructor(progId, pre, main, post, {
    splitBySide, useCSEMoves, quarterRacking,
    frontPass = 0
  } = {}){
    this.progId = progId;
    // functions
    this.pre  = Array.isArray(pre) ? pre : [pre];
    this.main = Array.isArray(main) ? main : [main];
    this.post = Array.isArray(post) ? post : [post];
    // options
    this.splitBySide = splitBySide;
    this.useCSEMoves = useCSEMoves;
    this.quarterRacking = quarterRacking;
    // information
    this.frontPass = frontPass;
  }

  hasOption(name){ return typeof this[name] !== 'undefined'; }

  getUserFunction(passType, pass){
    switch(passType){
      case PRE: return this.pre[pass];
      case MAIN: return this.main[pass];
      case POST: return this.post[pass];
      default: assert.error('Invalid pass type');
    }
  }

  exec(passType, pass, k, entry, state, nmap, opts){
    const fun = this.getUserFunction(passType, pass);
    if(!fun)
      return; // nothing to do

    // two different APIs
    if(fun.length > 1){
      fun(k, entry.dir, entry.needles, entry.carriers, state, nmap);
    } else
      fun(new ProgramArguments(k, entry, state, nmap, opts));
  }

  extend({
    pre = null,
    main = null,
    post = null,
    splitBySide,
    useCSEMoves
  }){
    return Action.register({
      pre: pre ? pre : this.pre,
      main: main ? main : this.main,
      post: post ? post : this.post,
      splitBySide,
      useCSEMoves
    });
  }
}

// ------------------------------------------------------------------
// base functions ---------------------------------------------------
// ------------------------------------------------------------------
function KnitFunc({ carriers = null, meta = true } = {}){
  return ({ k, n, d, cs, stitch }) => {
    k.knit(d, n, carriers || cs);
    if(meta)
      k.setMetadata(-1, stitch.index);
  };
}
function TuckFunc({ carriers = null, meta = true } = {}){
  return ({ k, n, d, cs, stitch }) => {
    k.tuck(d, n, carriers || cs);
    if(meta)
      k.setMetadata(-1, stitch.index);
  };
}
function MissFunc({ carriers = null, meta = true } = {}){
  return ({ k, n, d, cs, stitch }) => {
    k.miss(d, n, carriers || cs);
    if(meta)
      k.setMetadata(-1, stitch.index);
  };
}
function KickbackFunc({ carriers = null, meta = true } = {}){
  return ({ k, n, d, cs, state, stitch }) => {
    // use special increase stitch number
    const currSN = state.stitchNumber;
    if(currSN !== INCREASE_STITCH)
      k.xStitchNumber(INCREASE_STITCH);
    // actual kickback
    k.knit(-d, n, carriers || cs);
    if(meta)
      k.setMetadata(-1, stitch.index);
    // reset stitch number
    if(currSN !== INCREASE_STITCH)
      k.xStitchNumber(currSN);
  };
}
function SplitFunc({ carriers = null, meta = true, dir = 1 } = {}){
  return ({ k, ns, d, cs, state, stitch, svs }) => {
    assert(ns.length === 2, 'Invalid needle pair', ns);

    // presser cannot be on here because of transfer(s)
    const presserMode = state.presserMode;
    if(presserMode)
      k.xPresserMode('off');

    // racking is not compatible (notably quarter racking)
    const racking = state.racking;
    if(racking)
      k.rack(0);

    // use special increase stitch number
    const currSN = state.stitchNumber;
      if(currSN !== INCREASE_STITCH)
        k.xStitchNumber(INCREASE_STITCH);

    // store index for metadata
    const metaIdx = k.length;
    // action split
    xfer.splitTo(
      k,
      dir * d,
      ns[0], ns[1], carriers || cs,
      state,
      svs
    );
    if(meta)
      k.setMetadata(metaIdx, stitch.index);

    // reset stitch number
    if(currSN !== INCREASE_STITCH)
      k.xStitchNumber(currSN);

    // re-introduce quarter racking
    if(racking)
      k.rack(racking);

    // re-introduce presser
    if(presserMode)
      k.xPresserMode(presserMode);
  };
}
function RSplitFunc({ carriers = null, meta = true } = {}){
  return SplitFunc({ carriers, meta, dir: -1 });
}
function BKnitFunc({ carriers = null, meta = true } = {}){
  return ({ k, rn, d, cs, stitch }) => {
    k.knit(d, rn, carriers || cs);
    if(meta)
      k.setMetadata(-1, stitch.index);
  };
}
function FBKnitFunc({ carriers = null, meta = true } = {}){
  return ({ k, n, rn, d, cs, stitch }) => {
    const [fn, bn] = n.inFront() ? [n, rn] : [rn, n];
    if(carriers)
      cs = carriers;
    if(d > 0){
      k.knit(d, fn, cs);
      if(meta)
        k.setMetadata(-1, stitch.index);
      k.knit(d, bn, cs);
    } else {
      k.knit(d, bn, cs);
      k.knit(d, fn, cs);
      if(meta)
        k.setMetadata(-1, stitch.index);
    }
  };
}


// ------------------------------------------------------------------
// base programs ----------------------------------------------------
// ------------------------------------------------------------------
function program(which, main, opts = {}){
  const progId = programs.length;
  assert(progId === which, 'Invalid default program id', progId, which);
  const prog = new ActionProgram(progId, [], main, [], opts);
  programs.push(prog);
  return prog;
}
const Knit = program(KNIT, KnitFunc());
const Tuck = program(TUCK, TuckFunc());
const Miss = program(MISS, MissFunc());
const Kickback = program(KICKBACK, KickbackFunc());
const Split = program(SPLIT, SplitFunc());
const RSplit = program(RSPLIT, RSplitFunc());
const BKnit = program(BKNIT, BKnitFunc());
const FBKnit = program(FBKNIT, FBKnitFunc(), { quarterRacking: true });

// check that we have the correct number
assert(programs.length === USR_START,
  'The base programs are incorrect', programs, USR_START);

// ------------------------------------------------------------------
// transfer functions -----------------------------------------------
// ------------------------------------------------------------------
function XferFunc({ backward = false }){
  return ({ k, n, rn, state }) => {

    // racking
    const prevRacking = state.racking;
    const partialRacking = !Number.isInteger(prevRacking);
    if(partialRacking)
      k.rack(Math.round(prevRacking)); // make integer for transfer
    
    // actual transfer
    if(backward)
      k.xfer(rn, n);
    else
      k.xfer(n, rn);

    // racking back
    if(partialRacking)
      k.rack(prevRacking);
  };
}

// ------------------------------------------------------------------
// increase types ---------------------------------------------------
// ------------------------------------------------------------------
const MISS_INCREASE     = 'miss';
const KICKBACK_INCREASE = 'kickback';
const SPLIT_INCREASE    = 'split';
const RSPLIT_INCREASE   = 'rsplit';

// increase pairs
const KNITMISS_PAIR = [KNIT, MISS];
const KICKBACK_PAIR = [KNIT, KICKBACK];
const SPLIT_PAIR    = [SPLIT, MISS];
const RSPLIT_PAIR   = [RSPLIT, MISS];
function increasePair(increaseType){
  switch(increaseType){
    case MISS_INCREASE:     return KNITMISS_PAIR;
    case KICKBACK_INCREASE: return KICKBACK_PAIR;
    case SPLIT_INCREASE:    return SPLIT_PAIR;
    case RSPLIT_INCREASE:   return RSPLIT_PAIR;
    default:
      assert.error('Invalid increase type', increaseType);
      return KICKBACK_PAIR;
  }
}

module.exports = Object.assign(Action, {
  // classes
  ActionProgram,
  // base functions and actions
  KNIT, TUCK, MISS, KICKBACK, SPLIT, RSPLIT, BKNIT, FBKNIT,
  Knit, Tuck, Miss, Kickback, Split, RSplit, BKnit, FBKnit,
  KnitFunc, TuckFunc, MissFunc, KickbackFunc,
  SplitFunc, RSplitFunc, BKnitFunc, FBKnitFunc,
  XferFunc,
  // passes
  PRE, MAIN, POST,
  // increase types
  MISS_INCREASE,
  KICKBACK_INCREASE,
  SPLIT_INCREASE,
  RSPLIT_INCREASE,
  // action pairs
  increasePair,
  KNITMISS_PAIR,
  KICKBACK_PAIR,
  SPLIT_PAIR,
  RSPLIT_PAIR,
  // base functions
  noop, knit
});