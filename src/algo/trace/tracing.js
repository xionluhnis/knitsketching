// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const Trace = require('./trace.js');
const { CW, CCW, TUCK_NEXT, TUCK_PREV } = Trace;
const Action = require('../compiler/action.js');
const Queue = require('../../ds/queue.js');

// constants
// - tracing algorithm variant
const TRACE_ONCE  = 1;
const TRACE_TWICE = 2;
const TRACE_HALF  = 3;
// - stitch states
const NONE  = 0;
const ONCE  = 1;
const TWICE = 2;
// - boundary increase mode
const BORDER_INCREASE_OUT = 'out';
const BORDER_INCREASE_IN  = 'in';
// - all yarns
const ALL_YARNS = Array.from({ length: 10 }, (_, i) => i + 1);

class CCWStitchGroup {
  constructor(stitches, index, shortrow){
    this.stitches = stitches;
    this.index    = index;
    this.shortrow = shortrow;
    if(shortrow)
      this.circular = false;
    else {
      const pc = this.stitches[0].getPrevCourse();
      this.circular = !!pc;
      // ensure that this matches the connectivity
      const circConn = this.stitches[this.stitches.length - 1].matches(pc);
      assert(this.circular === circConn,
        'Invalid CCW circularity');
    }
    // topological connectivity
    this.prev = new Set();
    this.next = new Set();
    // traversal state
    this.prevPending = 0; // # of prev wales to finish before ready
    this.currPending = stitches.length; // # stitches before done
  }

  isReady(){ return this.prevPending === 0; }
  isDone(){ return this.currPending === 0; }
}

class SubTrace {
  constructor(trace, last = trace.length - 1){
    this.trace = trace;
    this.last  = last;
  }
  get yarn(){ return this.trace.getTraceYarn(this.last); }
  get orientation(){ return this.trace.getOrientation(this.last); }
  get lastStitch(){
    return this.trace.getTracedStitchAt(this.last).stitch;
  }
}

function TracingAlgorithm(sampler, {
  tracingMode = TRACE_TWICE,
  increaseType = Action.KICKBACK_INCREASE,
  maxPendingYarns = 9, intarsiaPasses = 2, intarsiaSwitch = true,
  borderType = BORDER_INCREASE_IN,
  verbose
}){
  // inputs
  this.sampler = sampler;
  this.tracingMode = tracingMode;
  this.verbose = !!verbose;

  // tracing parameters
  this.minTracesPerStitch = tracingMode === TRACE_TWICE ? 2 : 1;
  this.maxTracesPerStitch = tracingMode === TRACE_ONCE ? 1 : 2;
  this.mustTraceTwice   = this.minTracesPerStitch === 2;
  this.canTraceTwice    = this.maxTracesPerStitch === 2;
  this.maxPendingYarns  = maxPendingYarns;
  this.intarsiaPasses   = intarsiaPasses || Infinity;
  this.intarsiaSwitch   = intarsiaSwitch;

  // shaping parameters
  this.increaseType = increaseType || Action.KICKBACK_INCREASE;
  this.borderType   = borderType || BORDER_INCREASE_IN;

  // intermediary data
  this.stitches   = [];
  this.groups     = [];
  this.sources    = [];
  this.sinks      = [];
  this.readyList    = [];
  this.pendingYarns = new Queue(); // Queue<SubTrace>
  this.pendingMap   = new Map();   // Map<YarnNum, SubTrace>
  this.tracedGroups = 0;

  // state
  this.orientation  = CCW;
  this.last = -1;
  this.yarn = 1;
  this.passes = 0;

  // output
  this.trace = new Trace(sampler);
}

TracingAlgorithm.expectedActions = function(numStitches, tracingMode){
  switch(tracingMode){
    case TRACE_TWICE:
      return Math.ceil(2 * numStitches);
    case TRACE_ONCE:
      return Math.ceil(1 * numStitches);
    case TRACE_HALF:
      return Math.ceil(1.5 * numStitches);
    default:
      assert.error('Unsupported tracing mode', tracingMode, 'for stitches', numStitches);
  }
};

TracingAlgorithm.prototype.groupOf = function(stitch){
  const [idx, sr] = stitch.getGroupData();
  if(sr)
    return this.groups[idx + this.sampler.numCourses];
  else
    return this.groups[idx];
};
TracingAlgorithm.prototype.lastTracedStitchOf = function(stitch){
  for(let i = 1; i >= 0; --i){
    if(i < this.getTraceCount(stitch)){
      const ts = this.trace.getTracedStitch(stitch.index, i);
      if(ts.getTraceYarn() === this.yarn)
        return ts;
    }
  }
  return null;
};
TracingAlgorithm.prototype.prevTracedStitchOf = function(stitch){
  const ts = this.lastTracedStitchOf(stitch);
  return ts ? ts.getPrev() : null;
};

TracingAlgorithm.prototype.init = function(){
  assert(this.sampler && this.sampler.length, 'Empty sampler?');

  // allocate trace
  const expNumActions = TracingAlgorithm.expectedActions(this.sampler.length, this.tracingMode);
  this.trace.allocate(expNumActions);

  // get all stitches
  this.stitches = this.sampler.allStitches();

  // create list of stitch groups
  this.groups = new Array(this.sampler.numGroups);
  let gi = 0;
  let numStitches = 0;
  for(const crs of this.sampler.courses()){
    this.groups[gi] = new CCWStitchGroup(crs, gi, false);
    numStitches += this.groups[gi].stitches.length;
    ++gi;
  }
  for(const sr of this.sampler.shortrows()){
    this.groups[gi] = new CCWStitchGroup(sr, gi, true);
    numStitches += this.groups[gi].stitches.length;
    ++gi;
  }
  assert(numStitches === this.stitches.length,
    'The stitch groups are missing stitches');

  // build topological graph on stitch groups
  for(const grp of this.groups){
    // this does assume multiple possible next stitch groups
    for(const s of grp.stitches){
      assert(this.groupOf(s) === grp,
        'Invalid stitch group assignment');
      // next groups
      for(const nws of s.getNextWales())
        grp.next.add(this.groupOf(nws));
      // prev groups
      for(const pws of s.getPrevWales())
        grp.prev.add(this.groupOf(pws));
    } // endfor s of crs.stitches
  } // endfor crs of this.groups

  // spread pending counts through next wales
  for(const stitch of this.stitches){
    for(const nws of stitch.getNextWales()){
      const nextGrp = this.groupOf(nws);
      nextGrp.prevPending += 1;
      assert(nextGrp.prev.size,
        'Next group has no prev stitch');
    }
  }

  // locate sources
  this.sources = this.groups.filter(crs => crs.prev.size === 0);

  // locate sinks
  this.sinks = this.groups.filter(crs => crs.next.size === 0);

  // initialize tracing by marking sources as ready
  this.readyList = this.sources.slice();
  assert(this.readyList.length, 'No source?');
};

TracingAlgorithm.prototype.progress = function(){
  return Math.max(0, Math.min(1, this.tracedGroups / (this.groups.length || 1)));
};

TracingAlgorithm.prototype.getTraceCount = function(stitch){
  return this.trace.getTraceCount(stitch);
};
TracingAlgorithm.prototype.isReady = function(stitch){
  return this.groupOf(stitch).isReady();
};
TracingAlgorithm.prototype.canStartFrom = function(stitch){
  return this.isReady(stitch)
      && this.getTraceCount(stitch) < this.minTracesPerStitch
      && this.matchesYarn(stitch);
};
TracingAlgorithm.prototype.canTrace = function(stitch){
  return this.isReady(stitch)
      && this.getTraceCount(stitch) < this.maxTracesPerStitch
      && this.matchesYarn(stitch);
};
TracingAlgorithm.prototype.matchesYarn = function(stitch){
  return (stitch.getYarnMask() & (1 << (this.yarn-1))) !== 0;
};
TracingAlgorithm.prototype.matchesLocalPass = function(stitch){
  if(this.pendingYarns.length === 0
  || this.passes + 1 < this.intarsiaPasses)
    return true; // always valid from the pass viewpoint
  assert(this.passes < this.intarsiaPasses,
    'Current pass count is invalid',
    this.passes, this.intarsiaPasses);
  // check whether knitting that stitch increases the pass count
  const newPass = this.getTraceCount(stitch);
  const prePass = this.trace.getPass(this.last);
  // if the same pass, then we don't switch pass
  // => this.passes won't increase => we can still knit it
  return newPass === prePass;
};
TracingAlgorithm.prototype.isSufficient = function(stitch){
  return this.getTraceCount(stitch) >= this.minTracesPerStitch;
};

TracingAlgorithm.prototype.getTraceIndex = function(stitch, pass = -1){
  if(pass < 0)
    pass = this.getTraceCount(stitch) - 1; // defaults is to use the last pass
  if(pass === 0 || pass === 1)
    return this.trace.getTracedStitchIndex(stitch.index, pass); // return index of last trace
  else
    return -1; // not traced yet
};

TracingAlgorithm.prototype.isYarnAvailable = function(yarn, allowCurr = true){
  if(yarn === this.yarn){
    if(!allowCurr)
      return false;
    // check if trace ended that yarn
    return this.last === -1
        || yarn === this.trace.hasFlags(this.last, Trace.END);
    
  } else {
    return !this.pendingMap.has(yarn) // yarn is not pending
        && this.pendingYarns.length < this.maxPendingYarns; // not using too many
  }
};
TracingAlgorithm.prototype.getAvailableYarns = function(allowCurr = true){
  return ALL_YARNS.filter(y => this.isYarnAvailable(y, allowCurr));
};
TracingAlgorithm.prototype.switchYarn = function(){
  if(!this.pendingYarns.length)
    return null; // no yarn change happened

  // we're considering a new yarn
  // => we can reset the pass count
  this.passes = 0;

  // temporarily save the current subtrace information
  let last;
  if(this.trace.lastTraceYarn() === this.yarn)
    last = new SubTrace(this.trace, this.trace.length - 1);
  else
    last = new SubTrace(this.trace, this.last);
  assert(last.yarn === this.yarn,
    'Last subtrace yarn does not match trace yarn at index');

  // pick new yarn subtrace
  let curr;
  while(this.pendingYarns.length && !curr){
    curr = this.pendingYarns.dequeue();
    assert(this.pendingMap.has(curr.yarn), 'Invalid pending map state');
    this.pendingMap.delete(curr.yarn);

    // check if yarn has any chance of being used
    const { lastStitch } = curr;
    if(this.isSufficient(lastStitch)){
      const sg = this.groupOf(lastStitch);
      if(sg.isDone()
      && Array.from(sg.next).every(nsg => nsg.isDone())){
        // stitch group is done
        // next groups are all done
        // => this stitch cannot do anything
        // => we should end its yarn
        this.trace.appendFlags(Trace.END, curr.last);

        // not a valid subtrace anymore
        curr = false;
      }
    } // endif stitch is sufficient
  } // enwhile !curr

  // did we find a valid subtrace?
  if(curr){
    // store past subtrace as pending
    // unless that trace is empty
    if(last.last >= 0){
      this.pendingYarns.enqueue(last);
      assert(!this.pendingMap.has(last.yarn),
        'New pending yarn is already pending');
      this.pendingMap.set(last.yarn, last);
    }

    // update state to new subtrace
    this.orientation = curr.orientation;
    this.last = curr.last;
    this.yarn = curr.yarn;

    return curr; // we found a reasonable new subtrace

  } else {
    // no valid subtrace found
    curr = last;
    assert(this.pendingYarns.length === 0 && this.pendingMap.size === 0,
      'Invalid state of pending queue or pending map');

    return null; // we found no new subtrace
  }
};

TracingAlgorithm.prototype.knit = function(stitch, flags = 0){
  assert(this.canTrace(stitch),
    'Knitting unavailable stitch', stitch, flags);

  // get current trace count
  const prevTraces = this.getTraceCount(stitch);
  if(prevTraces === 1)
    flags |= Trace.TWICE;
  else
    assert(prevTraces === 0, 'Tracing more than twice?', prevTraces);

  // was the previous pass count different?
  if(this.trace.length
  && this.last >= 0){
    const lastPass = this.trace.getPass(this.last);
    const currPass = prevTraces;
    if(lastPass !== currPass){
      // check if we just downgraded to the previous pass
      // while staying on the same course, in which case
      // we should reset the pass count
      const lastStitch = this.trace.lastStitch();
      if(stitch.matchesGroupOf(lastStitch)
      && currPass < lastPass){
        // reset because of downgrade
        this.passes = 0;

      } else {
        // update our cumulated number of passes
        ++this.passes;
      }
    } // endif pass changed
  } // endif #trace and this.last >= 0
  
  // special case for half-tracing
  if(this.tracingMode === TRACE_HALF && prevTraces > 0){
    // XXX update action (and previous traces) given previous traces
  }
  const orientFlag = this.orientation === CW ? Trace.INVERSE : 0;
  this.last = this.trace.length; // advance last pointer
  this.trace.addEntry(stitch, this.yarn, flags | orientFlag);

  // update stitch state
  const currTraces = prevTraces + 1;
  assert(currTraces === this.getTraceCount(stitch),
    'Trace count was not updated correctly', prevTraces, currTraces);

  // update pending information of node(s)
  // in case it just became "sufficient"
  if(currTraces === this.minTracesPerStitch){
    // update current node
    curr: {
      const grp = this.groupOf(stitch);
      grp.currPending -= 1;
      assert(grp.currPending >= 0,
        'Invalid current pending count', grp.currPending);
      // if done, then remove from readyList
      if(grp.isDone()){
        const idx = this.readyList.indexOf(grp);
        assert(idx !== -1, 'Marking node of non-ready course');
        this.readyList.splice(idx, 1);
        
        // update progress
        this.tracedGroups += 1;
      }
    }

    // update next nodes
    for(const nws of stitch.getNextWales()){
      const grp = this.groupOf(nws);
      grp.prevPending -= 1;
      assert(grp.prevPending >= 0,
        'Invalid prev pending count', grp.prevPending);
      // if newly ready, add to readyList
      if(grp.isReady()){
        assert(!this.readyList.includes(grp), 'Already ready?');
        this.readyList.push(grp);
      }
    } // endif updating next nodes
  } // endif just made sufficient
};

TracingAlgorithm.prototype.tuck = function(){
  assert(this.trace.length,
    'Cannot tuck on current, because none available!');
  this.trace.appendFlags(TUCK_NEXT, this.last);
};

/**
 * Iteration of tracing, effectively creating a sequence from yarn START to END
 * that may span multiple groups (or even the entire stitch graph)
 */
TracingAlgorithm.prototype.traceYarn = function(){
  if(!this.readyList.length)
    return true;
  
  // trace yarn
  switch(this.tracingMode){
    case TRACE_TWICE:
      this.traceTwice();
      break;

    case TRACE_ONCE:
      this.traceOnce();
      break;

    case TRACE_HALF:
      this.traceHalf();
      break;

    default:
      assert.error('Unsupported tracing mode:', this.tracingMode, this);
  }

  // we're done when the ready list is empty
  // but we may be done tracing because there's no valid trace
  // => we must also check that we've visited all stitches
  // XXX check we visited all stitches in case the ready queue is empty
  const done = this.readyList.length === 0;
  if(done){
    assert(this.tracedGroups === this.groups.length,
      'Not all groups have been traced!');
    const minTraceLen = this.minTracesPerStitch * this.stitches.length;
    const maxTraceLen = this.maxTracesPerStitch * this.stitches.length;
    assert(minTraceLen <= this.trace.length
        && this.trace.length <= maxTraceLen,
      'The trace length violates tracing min/max requirements');
  }
  return done;
};

/**
 * Get a stitch group for starting with the current yarn.
 * 
 * The course cluster is taken to be that of the last traced one
 * if possible, else it's taken as the first of readyList
 * for which we have a yarn match.
 * 
 * @return {CCWStitchGroup} the found stitch group (can be null)
 */
TracingAlgorithm.prototype.getYarnStartGroup = function(){
  const isValid = grp => grp.stitches.some(s => this.canStartFrom(s));
  let newGroup;
  // if the trace just ended
  if(this.trace.length
  && this.trace.isEnd(this.trace.length - 1)){
    const lastStitch = this.trace.lastStitch();
    assert(lastStitch, 'Yarn end without any stitch');
    const grp = this.groupOf(lastStitch);
    if(isValid(grp)){
      newGroup = grp;
    } else {
      newGroup = this.readyList.find(sg => isValid(sg));
    }
  } else {
    newGroup = this.readyList.find(sg => isValid(sg));
  }
  return newGroup;
};

/**
 * Select a starting stitch from a list of stitches.
 * Priority is given to:
 * 1) Endpoint stitches
 * 2) Stitches course-connected to already-connected stitches
 *    a.k.a. "broken" course stitches (tracing-like endpoints)
 * 3) Source / sink stitches (without prev / next wales)
 * 4) Stitches on seams
 * 
 * @param {Stitch[]} stitches 
 * @returns 
 */
TracingAlgorithm.prototype.getStartingStitch = function(stitches){
  // select starting stitch, while favoring, in order:
  // 1) Endpoint stitches
  // 2) Stitches course-connected to already-done stitches
  // 3) Source / sink stitches (no prev wales, or no next wales)
  // 4) Stitches on seams
  let bestStitch;
  let isEndpoint = false;
  let isBreakage = false;
  let isSinkSource = false;
  let isSeam = false;
  for(const stitch of stitches){
    if(!this.canStartFrom(stitch))
      continue; // skip unavailable stitches
    // priority
    let better = false;
    const endpoint = stitch.isCourseEndpoint();
    if(isEndpoint !== endpoint){
      if(!endpoint)
        continue; // current is better
      else
        better = true;
    }
    const breakage = !!stitch.getCourses().find(cs => {
      return !this.canStartFrom(cs);
    });
    if(!better && isBreakage !== breakage){
      if(!breakage)
        continue; // current is better
      else
        better = true;
    }
    const sinksource = stitch.countPrevWales() === 0
                    || stitch.countNextWales() === 0;
    if(!better && isSinkSource !== sinksource){
      if(!sinksource)
        continue; // current is better
      else
        better = true;
    }
    // XXX use real seam information
    const seam = stitch.getCourses().some(cs => {
      return cs.getLayerIndex() !== stitch.getLayerIndex();
    });
    if(!better && isSeam !== seam){
      if(!seam)
        continue; // current is better
      else
        better = true;
    }
    if(!bestStitch || better){
      bestStitch = stitch;
      isEndpoint = endpoint;
      isBreakage = breakage;
      isSinkSource = sinksource;
      isSeam = seam;
    }
  }
  return bestStitch;
};

/**
 * Find a ready stitch to start the yarn with and effectively knit-start it.
 * This assumes that there is a group available in the ready-list
 * and that it contains available stitches for the current yarn.
 *
 * @return {Stitch} the best found starting stitch
 */
TracingAlgorithm.prototype.startYarn = function(){
  this.orientation = CCW; // default orientation

  // simple case = we find a group with the current yarn
  let newGroup = this.getYarnStartGroup();

  // harder case = we find a group for another available yarn
  if(!newGroup){
    // current yarn doesn't work
    // => try available yarns if we can
    for(const yarn of this.getAvailableYarns()){
      this.yarn = yarn;
      this.last = -1; // new potential trace
      newGroup = this.getYarnStartGroup();
      if(newGroup){
        break;
      }
    }
  }

  // hardest case = we find a group for a pending yarn to be ended
  if(!newGroup){
    // if still no available group
    // then we must stop a pending one that would work
    for(const { yarn } of this.pendingYarns.asArray().reverse()){
      this.yarn = yarn;
      this.last = -1; // new potential trace
      newGroup = this.getYarnStartGroup();
      if(newGroup){
        break;
      }
    }
    if(!newGroup){
      // this should not happen
      assert.error('Tracing is not possible, impossible to start yarn');
      return null;
    }
    // we close that pending group and restart from it
    const subTrace = this.pendingMap.get(this.yarn);
    this.pendingMap.delete(this.yarn);
    this.pendingYarns = this.pendingYarns.filter(st => st !== subTrace);
    this.trace.appendFlags(Trace.END, subTrace.last);
  }
  assert(newGroup, 'No available stitch group for start');

  const bestStitch = this.getStartingStitch(newGroup.stitches);
  assert(bestStitch, 'No best starting stitch?', bestStitch);

  // mark start of trace
  this.knit(bestStitch, Trace.START);

  // reset number of passes
  this.passes = 0;

  // return stitch
  return bestStitch;
};

TracingAlgorithm.prototype.tryLocalYarnStart = function(nextStitch){
  // if we reached the max number of pending yarns
  // then we cannot start a new local one!
  if(this.pendingYarns.length >= this.maxPendingYarns)
    return false;
  
  let newGroup;
  const prevYarn = this.yarn; // memorize current yarn
  const prevLast = this.last; // memorize last index
  // search for available yarn to start from (except current)
  for(const yarn of this.getAvailableYarns(false)){
    this.yarn = yarn;
    newGroup = this.getYarnStartGroup();
    if(newGroup){
      break;
    }
  }
  // if we failed at starting locally
  if(!newGroup){
    this.yarn = prevYarn; // reset yarn
    return false; // return attempt failure
  }

  // else we found a group to start from
  // set previous yarn as pending
  let last;
  if(this.trace.lastTraceYarn() === prevYarn)
    last = new SubTrace(this.trace, this.trace.length - 1);
  else
    last = new SubTrace(this.trace, prevLast);
  assert(last.yarn === prevYarn,
    'Last subtrace yarn does not match trace yarn at index');
  this.pendingYarns.enqueue(last);
  assert(!this.pendingMap.has(prevYarn),
    'Previous yarn was pending');
  this.pendingMap.set(prevYarn, last);

  // start knitting with that yarn
  this.last = -1;
  const bestStitch = this.getStartingStitch(newGroup.stitches);
  assert(bestStitch, 'No best starting stitch', bestStitch);

  // mark local start of trace
  this.knit(bestStitch, Trace.START);
  nextStitch(bestStitch);

  // reset number of passes
  this.passes = 0;

  return true; // return attempt success
};

/**
 * Attempts to trace the next row
 *
 * Requirements:
 * - the current stitch is suffiently traced
 * - the current stitch has a next wale to some ready stitch
 * - yarn matches
 *
 * @param stitch the current stitch
 * @param nextStitch (stitch)=>() callback to assign the next stitch
 * @return whether the attempt was successful
 */
TracingAlgorithm.prototype.tryNextRow = function(stitch, nextStitch){
  // i) check that current stitch is sufficiently traced
  if(!this.isSufficient(stitch))
    return false;

  // ii) check that one next wale contains a ready stitch
  const nwss = stitch.getNextWales().filter(nws => {
    return this.isReady(nws) // ready for tracing
        && this.matchesYarn(nws) // matching yarn
        && this.matchesLocalPass(nws); // matching pass threshold
  });
  if(nwss.length === 0)
    return false; // no next row to go to

  // we can go to next row!
  // => select the next wale based on the direction if multiple options
  let nws;
  if(nwss.length === 1)
    nws = nwss[0];
  else
    nws = nwss[this.orientation === CCW ? 1 : 0];

  // Different cases:
  //
  // 1) the next wale has two groups
  //    => spiral-like move (go to course neighbor)
  //    => no need to tuck (because not endpoint to tie)
  //    => select course neighbor that matches direction
  //
  // 2) the next wale is an endpoint in the current direction
  //    => tuck (because entering a short row)
  //    => go to endpoint in reverse direction
  //

  // try to do a spiral move
  // = case (1)
  // = use the course neighbor of the next wale (in same direction)
  const isCCW = this.orientation === CCW;
  let next = isCCW ? nws.getNextCourse() : nws.getPrevCourse();
  // if not available (or invalid yarn), then it's the other case
  if(!next
  || !this.matchesYarn(next)
  || !this.matchesLocalPass(next)){
    // case (2)
    
    // tuck for entering short-row
    // /!\ such tuck may not be valid in some cases (flat boundaries)
    this.tuck();
    
    // reverse orientation
    this.orientation = -this.orientation;

    // go to endpoint
    next = nws;
  }

  assert(next && this.matchesYarn(next),
    'No valid next stitch selected');
  this.knit(next);
  nextStitch(next);
  return true;
};

/**
 * Attempts to continue the trace through a course neighbor
 *
 * Requirement:
 * - stitch has a course neighbor that needs tracing
 * - yarn matches
 *
 * @param stitch the last traced stitch
 * @param nextStitch (stitch)=>() callback for selecting the next stitch
 * @return whether the attempt was a success (true) or not (false)
 */
TracingAlgorithm.prototype.tryContinue = function(stitch, nextStitch){
  const courses = stitch.getCourses();
  if(courses.length === 0)
    return false; // not possible to "continue" on the course

  // check if the "previous" stitch was a course of this one
  // in which case, we try to trace the other one (directional tracing)
  const { stitch: prevStitch } = this.prevTracedStitchOf(stitch) || {};
  if(prevStitch
  && !prevStitch.matches(stitch)
  && courses.find(cs => cs.matches(prevStitch))){
    // we should trace the "other" course
    const next = courses.find(cs => cs.index !== prevStitch.index);
    if(next
    && !this.isSufficient(next)
    && this.matchesYarn(next)
    && this.matchesLocalPass(next)){
      this.knit(next);
      nextStitch(next);
      return true;
    }
    // else, we should not "continue"
    // though we could return, but that's for the other rules
    return false;
  }

  // otherwise, it's not a same-course continuity
  // => we do not have any clear direction to enforce
  // so we choose depending on what is available
  const cstitches = courses.filter(cs => {
    return !this.isSufficient(cs) // insufficient tracing (more to do)
        && this.matchesYarn(cs)  // matching yarn mask
        && this.matchesLocalPass(cs); // matching pass threshold
  });
  let next;
  if(cstitches.length === 1){

    // simple case, since we don't have any choice
    // thus we should (and can) trace it
    next = cstitches[0];
    assert(this.canTrace(next), 'Cannot trace, but should trace?');

  } else if(cstitches.length === 2){

    // if one course has higher trace count, then use the other one
    const tc0 = this.getTraceCount(cstitches[0]);
    const tc1 = this.getTraceCount(cstitches[1]);
    // XXX does trace count balancing actually help reduce yarn cuts?
    if(tc0 < tc1){
      next = cstitches[0];

    } else if(tc1 < tc0){
      next = cstitches[1];

    } else {
      // both with same trace count!
      // => keep the same orientation = use oriented course
      if(this.orientation === CCW)
        next = stitch.getNextCourse();
      else
        next = stitch.getPrevCourse();
    }
  } else {
    // no course available (though with one or two existing courses)
    // => we cannot use tryContinue (this is an odd special case)
    return false;
  }

  // non-standard tryContinue case
  assert(next && !this.isSufficient(next)
      && this.matchesYarn(next) && this.matchesLocalPass(next),
    'No best course, from two available ones?', stitch, next, cstitches);

  // note: the orientation may be changing, so we update accordingly
  if(stitch.isNextCourse(next))
    this.orientation = CCW;
  else {
    assert(stitch.isPrevCourse(next), 'Neither prev nor next course');
    this.orientation = CW;
  }

  // knit new stitch
  this.knit(next);
  nextStitch(next);
  return true;
};

/**
 * Attempts to turn back at the end of a short-row
 *
 * Requirements:
 * - stitch is endpoint (of short-row, flat course, or intarsia region)
 * - stitch still needs tracing
 *
 * @param stitch the last traced stitch
 * @param nextStitch (stitch)=>() callback for next stitch
 * @return whether the attempt was successful
 */
TracingAlgorithm.prototype.tryTuckAndTurn = function(stitch, nextStitch){
  // check requirements
  const css = stitch.getCourses().filter(cs => {
    return this.matchesYarn(cs) && this.matchesLocalPass(cs);
  });
  if(css.length === 2 // not an endpoint, even from intarsia pov
  || this.isSufficient(stitch) // already sufficient
  || !this.matchesLocalPass(stitch)) // would go beyond pass threshold
    return false;

  // yarn always matches
  assert(this.matchesYarn(stitch),
    'Current stitch does not match yarn');

  // 1) Tuck past current
  this.tuck();

  // 2) Turn
  this.orientation = -this.orientation;

  // 3) Knit
  this.knit(stitch);
  nextStitch(stitch);
  return true;
};

/**
 * Attempts to end a short-row and continue
 * knitting on an available base before the short-row.
 *
 * Requirements:
 * - stitch is an endpoint
 * - stitch is sufficient, and so is any potential course
 * - tracing can continue from the course of a past stitch
 * - yarn matches
 *
 * @param stitch the last traced stitch
 * @param nextStitch nstitch => () callback for next stitch
 * @return whether the attempt worked
 */
TracingAlgorithm.prototype.tryEndShortRow = function(stitch, nextStitch){
  // check first two requirements:
  // - stitch must be an endpoint in current direction
  //   = no next course (in the current orientation)
  // - stitch and course connection need to be sufficient
  //   = sufficient stitch and prev course (in the current orientation)
  const isCCW = this.orientation === CCW;
  let ncs = stitch.getNextCourse();
  let pcs = stitch.getPrevCourse();
  if(!isCCW)
    [ncs, pcs] = [pcs, ncs]; // reverse
  
  if(!this.isSufficient(stitch) || ncs
  || (pcs && !this.isSufficient(pcs))){
    return false;
  }

  // seek a base to trace from while following the current direction
  let base = stitch;
  let next;
  do {
    // move to previous wale in same orientation
    const pwss = base.getPrevWales();
    if(pwss.length === 0)
      break; // couldn't find next target
    if(pwss.length === 1)
      base = pwss[0];
    else
      base = pwss[isCCW ? 1 : 0];
    
    // if available, look for next course
    next = isCCW ? base.getNextCourse() : base.getPrevCourse();

    // continue until we find such next target that exists
  } while(!next);

  // may not have a next stitch
  // or that next stitch may be already sufficient
  // or it may not match the yarn
  // or it may lead to a large increase
  if(!next
  || this.isSufficient(next)
  || !this.matchesYarn(next)
  || !this.matchesLocalPass(next))
    return false;

  // note: the orientation stays the same
  // => no need to "unfix"

  // else we use it
  this.knit(next);
  nextStitch(next);
  return true;
};

/**
 * Attempt a short-row turn within the middle of a course.
 * This is to catch odd cases where the "next" side is already sufficient
 * and the "previous" is not yet.
 *
 * Requirements:
 * - current stitch has two courses
 * - previous stitch is from course neighbors
 * - previous stitch is not sufficient
 * - next stitch is sufficient already
 * - yarn matches
 *
 * @param stitch the current stitch
 * @param nextStitch (stitch)=>() callback to set next stitch
 * @return whether the attempt was successful
 */
TracingAlgorithm.prototype.tryMiddleTurn = function(stitch, nextStitch){
  const courses = stitch.getCourses().filter(cs => {
    return this.matchesYarn(cs) && this.matchesLocalPass(cs);
  });
  if(courses.length !== 2)
    return false; // not possible to "turn" within the course

  // check if the "previous" stitch was a course of this one
  // in which case, we try to trace the other one (directional tracing)
  const { stitch: prevStitch } = this.prevTracedStitchOf(stitch) || {};
  if(!prevStitch
  || this.isSufficient(prevStitch)
  || prevStitch.matches(stitch))
    return false; // requirements not met

  // test that prev stitch was a course neighbor (using its course index)
  if(courses.find(cs => cs.matches(prevStitch))){
    // get the "next" course and check that it's already sufficient
    const expNextStitch = courses.find(cs => !cs.matches(prevStitch));
    assert(expNextStitch, 'Two courses, but no next stitch');
    if(expNextStitch
    && this.isSufficient(expNextStitch)){
      // check for local pass matching
      if((this.isSufficient(stitch) && !this.matchesLocalPass(prevStitch))
      || (!this.isSufficient(stitch) && this.matchesLocalPass(stitch)))
        return false;

      // directly to prevStitch or again on same stitch
      const next = this.isSufficient(stitch) ? prevStitch : stitch;

      // flip orientation
      this.orientation = -this.orientation;

      // next is sufficient, and prev is not
      // => middle turn!
      console.warn('Middle turn', stitch, prevStitch, expNextStitch, next);
      this.knit(next);
      nextStitch(next);
      return true;
    }
    // else tryContinue should have worked!
    assert.error('tryContinue should have worked by now!');
  }

  // not a valid middle turn
  return false;
};

/**
 * Mark the end of this yarn trace.
 */
TracingAlgorithm.prototype.endYarn = function(){
  // we end the yarn at the last traced stitch
  // note: we could end another pending yarn instead
  // but there is no clear choice here...
  const stitch = this.trace.lastStitch();
  if(!this.isSufficient(stitch)){
    console.warn('Ending yarn on insufficient stitch');
  }
  this.trace.appendFlags(Trace.END);
};

/**
 * Double-trace algorithm
 *
 * Rule 1: start yarn (should always work)
 * Rule 2: move to next row
 * Rule 3: continue
 * Rule 4: tuck and turn
 * Rule 5: middle turn
 * Rule 6: end short row
 * Rule 7: start local yarn
 * Rule 8: end yarn (should always work)
 */
TracingAlgorithm.prototype.traceTwice = function(){
  // R1
  let stitch = this.startYarn();
  let sync = true;

  // update callback
  let more = true;
  const nextStitch = nstitch => {
    stitch = nstitch;
    more = true;
    sync = true; // newly synchronized
  };

  // R2/3/4/5/6 or 7
  do {
    more = false; // by default, we're done
    // expected next index
    const firstNext = this.trace.length;
    // consider all subtraces, starting with current
    // and then the ones in the queue, in order
    // /!\ we consider each subtrace twice so that
    //     the starting subtrace does not matter
    //     w.r.t. the threshold on passes, because
    //     switching 
    const numSubTraces = this.pendingYarns.length + 1;
    let numAttempts = 1; // only consider single yarn once
    if(numSubTraces > 1)
      numAttempts = numSubTraces * 2; // consider each subtrace twice
    for(let i = 0; i < numAttempts && !more; ++i){
      // the last stitch should be synchronized
      assert(sync, 'Stitch is not synchronized');

      // if we do it 1 pass at a time, then we must allow
      // for a way to break the pass barriers in case we've already
      // trie dall yarns once
      if(this.intarsiaPasses === 1 && i >= numSubTraces){
        this.passes = -1; // to allow us to break the local pass barrier
      }

      // try rules for current subtrace
      const lastPrev = this.last;
      if(this.tryNextRow(stitch, nextStitch)     // R2
      || this.tryContinue(stitch, nextStitch)    // R3
      || this.tryTuckAndTurn(stitch, nextStitch) // R4
      || this.tryMiddleTurn(stitch, nextStitch)  // R5 = for flat courses
      || this.tryEndShortRow(stitch, nextStitch) // R6
      ){
        assert(more, 'nextStitch was not called properly');
        if(i > 0 // we switched yarn at least once
        || Math.abs(firstNext - lastPrev) > 1 // trace jump
        ){
          // store the jump information
          this.trace.setTraceNextIndex(lastPrev, firstNext);
          this.trace.setTracePrevIndex(firstNext, lastPrev);
          // reset pass number
          this.passes = 0;
        }

        // note: the step was successful!

        // unless using intarsia switch
        // we don't want to switch yarn at this stage yet
        if(!this.intarsiaSwitch)
          break;

        // if the previous traced stitch was at an intarsia tuck
        // then we should switch yarn if possible here
        // => for other cases, we should no try other subtraces yet
        const pts = this.prevTracedStitchOf(stitch);
        const wasIntarsiaWall = pts && pts.hasNextTuck() && !pts.stitch.isCourseEndpoint();
        if(wasIntarsiaWall){
          this.trace.appendFlags(TUCK_PREV);
          // and yarn switch

        } else {
          break; // no yarn switch
        }
      }
      // done #pendingYarns + 1 times
      // => if none works, then we're back
      //    at the original sub-trace state
      const curr = this.switchYarn();
      if(curr)
        stitch = curr.lastStitch; // update current stitch
      else {
        sync = stitch.matches(this.trace.lastStitch())
            && this.yarn === this.trace.lastTraceYarn();
      }
    }

    // if no option was found, we may want to insert a local yarn
    if(!more){
      const res = this.tryLocalYarnStart(nextStitch); // R7
      assert(res === more, 'nextStitch not called properly');
    }

    // continue if the last action was successful
} while(more);

  // R8
  this.endYarn();
};

/**
 * Post-processing of the trace
 * = set shaping action for increase stitches
 * => basic stitch programs
 * 
 * Note:
 * we can only have one past stitch increasing
 * else we have an increase with decrease,
 * which is neither 1-2 nor 2-1
 * 
 * bad:  +-o-+ where o is the current stitch
 *       |/ \|
 *       +---+
 * 
 * ok:   +-o-+  or  +-o-+
 *       |  \|      |/  |
 *       +---+      +---+
 */
TracingAlgorithm.prototype.finish = function(){
  // resolve stitch increases
  const increasePair = Action.increasePair(this.increaseType);
  const borderIncreaseOut = this.borderType === BORDER_INCREASE_OUT;
  const isUnsafeBoundary = ts => {
    const nts = ts.getNext();
    return !nts || nts.stitch.matches(ts.stitch);
  };
  for(const ts1 of this.trace.stitches()){
    const ts2 = ts1.getPairedStitch();
    if(!ts2 || ts2.index < ts1.index)
      continue; // not an increase stitch, or already resolved
    // compute pair information
    let secNum  = borderIncreaseOut ? 0 : 1; // default selection
    let incPair = increasePair;

    // get safety of each side
    const b1 = isUnsafeBoundary(ts1);
    const b2 = isUnsafeBoundary(ts2);
    if(b1 && b2){
      // both stitches are unsafe
      // XXX can this really happen?
      if(increasePair === Action.KICKBACK_PAIR)
        incPair = Action.KNITMISS_PAIR; // make it safe

    } else if(b1 || b2){
      // one is unsafe => use other as secondary stitch
      secNum = b1 ? 1 : 0;
    }

    // assign actions from increase pair
    ts1.setShapingAction(incPair[1 - secNum]);
    ts2.setShapingAction(incPair[secNum]);

    // set target link to first wale
    const pts = ts1.getPrevWales()[0];
    pts.setTargetWale(secNum === 1 ? ts1 : ts2);
  }

  // note: the user stitch program cannot be applied yet
  // because we want to allow the user to get higher-level information,
  // including notably the node index segmenting the trace
  return true;
};

module.exports = Object.assign(TracingAlgorithm, {
  // tracing algorithm variant
  TRACE_ONCE, TRACE_TWICE, TRACE_HALF,
  // stitch state
  NONE, ONCE, TWICE,
  // boundary increase
  BORDER_INCREASE_IN, BORDER_INCREASE_OUT
});
