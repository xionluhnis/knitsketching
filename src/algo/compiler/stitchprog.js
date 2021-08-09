// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../../assert.js');
const DSL = require('../../dsl.js');
const geom = require('../../geom.js');
const Timer = require('../../timer.js');
const Trace = require('../trace/trace.js');
const noise = require('simplenoise');
const Action = require('./action.js');
const toBuffer = require('data-uri-to-buffer');
const UPNG = require('upng-js');
const Sizing = require('../../sizing.js');

/**
 * Interpret range value
 *
 * @param value the range component (either start or end)
 * @param valueEnd the local context's end value
 * @return the effective location number
 */
function interpretRange(value, valueOffset, valueEnd){
  if(value < 0)
    return value + valueEnd + 1;
  if(value > 0 && value < 1)
    return valueOffset + value * valueEnd;
  return valueOffset + value;
}

class StitchProgram {
  constructor(graph, nodeIndex, stitches, indices){
    // inputs
    // - references
    this.graph = graph;
    this.nodeIndex = nodeIndex;
    this.stitches = stitches || Array.from(graph.stitches());
    // - data
    this.indices = indices || this.stitches.map((_, i) => i);
  }
  isEmpty(){ return !this.indices.length; }
  fromTrace(){ return this.graph instanceof Trace; }
  needsTrace(){
    assert(this.fromTrace(), 'Action only available in Trace programs');
  }
  get trace(){
    if(this.graph instanceof Trace)
      return this.graph;
    console.warn('Trace not available in StitchSampler programs');
    return null;
  }
  get sampler(){ return this.graph.sampler || this.graph; }
  get sketches(){ return this.graph.sketches; }

  // -------------------------------------------------------------------------
  // --- static methods ------------------------------------------------------
  // -------------------------------------------------------------------------

  static eval(program, graph, nodeIndex, args = {}, verbose = false){
    // create program object
    const prog = new StitchProgram(graph, nodeIndex);
    // evaluate program DSL
    return DSL.eval(
      program, Object.assign({
        prog,
        geom,
        math: Math,
        noise,
        Action
      }, args), DSL.range, verbose
    );
  }
  static transform(graph, nodeIndex, program, verbose = false){
    const t = Timer.create();
    // apply user program
    StitchProgram.eval(
      program, graph, nodeIndex, {}, verbose
    );
    t.measure('transform');
    console.log('Stitch program', t.toString());
  }
  static check(program){
    try {
      StitchProgram.eval(program, Trace.empty(), []);
    } catch(e){
      return e;
    }
    return null; // no error at compilation time
  }
  static clear(stitchGraph){
    if(stitchGraph.sampler){
      const trace = stitchGraph;
      // reset programs, stitch types and yarn stacks
      for(let i = 0; i < trace.length; ++i){
        trace.setProgram(i, 0);
        trace.setStitchType(i, 0);
        // trace.setYarns(i, 1);
        trace.setDefaultYarn(i);
        trace.setLayerData(i, 0);
        // trace.setFrontYarns(i, 1);
        // trace.setBackYarns(i, 0);
      }
    } else {
      const sampler = stitchGraph;
      for(let i = 0; i < sampler.length; ++i){
        sampler.getStitch(i).setYarnMask(0x0001);
      }
    }
  }
  static resetPrograms(){
    Action.resetPrograms();
  }

  // -------------------------------------------------------------------------
  // --- Stitch operations ---------------------------------------------------
  // -------------------------------------------------------------------------
  each(fun){
    for(const [i, idx] of this.indices.entries())
      fun(this.stitches[idx], idx, i);
    return this;
  }
  eachDo(fun){
    for(const idx of this.indices)
      fun(this.withIndices([idx]), this.stitches[idx]);
    return this;
  }
  prog(arg, unsafe = false){
    this.needsTrace();
    if(typeof arg === 'number')
      this.each(s => s.setProgram(arg, unsafe));
    else
      this.each(s => s.setProgram(arg.progId, unsafe));
  }
  type(stype){ this.each(s => s.setStitchType(stype)); }
  yarns(fun){ this.each(s => fun(s.getYarnStack(), s)); }
  knit(){ this.prog(Action.KNIT); }
  tuck(){ this.prog(Action.TUCK); }
  miss(){ this.prog(Action.MISS); }
  kickback(){ this.prog(Action.KICKBACK); }

  // -------------------------------------------------------------------------
  // --- Stitch queries ------------------------------------------------------
  // -------------------------------------------------------------------------
  withIndices(indices){
    return new StitchProgram(
      this.graph, this.nodeIndex, this.stitches, indices
    );
  }
  all(){
    return new StitchProgram(
      this.graph, this.nodeIndex, this.stitches
    );
  }
  empty(){ return this.withIndices([]); }
  filter(pred){
    return this.withIndices(this.indices.filter((i, ii) => {
      return pred(this.stitches[i], ii);
    }));
  }
  filterAll(pred){
    return this.withIndices(this.stitches.flatMap((s,i) => {
      return pred(s, i) ? [i] : [];
    }));
  }
  flatMap(map){
    const set = new Set(this.indices.flatMap(i => map(this.stitches[i], i)));
    return this.withIndices(Array.from(set));
  }
  reduce(redFunc, startValue){
    let accu = startValue;
    for(const idx of this.indices){
      accu = redFunc(accu, this.stitches[idx], idx);
    }
    return accu;
  }

  // -------------------------------------------------------------------------
  // --- Indexed queries -----------------------------------------------------
  // -------------------------------------------------------------------------
  pass(passId){
    this.needsTrace();
    return this.filter(s => s.pass === passId);
  }
  courses(range){
    const numCourses = this.sampler.numCourses;
    // normalize range
    if(!Array.isArray(range))
      range = [range, range, 1];
    // interval step
    const from = interpretRange(range[0], 0, numCourses);
    const to   = interpretRange(range[1], 0, numCourses);
    const step = range[2] || 1;
    return this.filter(s => {
      const [crsIdx, sr] = s.stitch.getGroupData();
      if(sr)
        return false;
      
      return crsIdx >= from && crsIdx <= to
          && (step === 1 || ((crsIdx - from) % step === 0));
    });
  }
  spannedGroups(anyPass = false){
    this.needsTrace();
    const sid = anyPass ? s => s.stitch.getGroupData()[0] : s => {
      return s.stitch.getGroupData()[0] + '/' + s.pass;
    };
    const groups = new Set();
    for(const idx of this.indices){
      const s = this.stitches[idx];
      groups.add(sid(s));
    }
    return this.filterAll(s => {
      return groups.has(sid(s));
    });
  }
  courseRange(fullSR = false){
    if(this.isEmpty())
      return this.empty();
    this.needsTrace();
    // non-singular case
    const srSet = new Set();
    // get initial stitch range on courses
    let [startStitch, endStitch] = this.reduce(([ss, es], stitch) => {
      const [gid, sr] = stitch.getGroupData();
      if(sr)
        srSet.add(gid);
      const ls = stitch.getLowerCourseStitch();
      const us = stitch.getUpperCourseStitch();
      return [
        ls.index < ss.index ? ls : ss,
        us.index > es.index ? us : es
      ];
    }, [this.graph.last(), this.graph.first()]);

    // get starting stitch within its course
    for(const s of this.sampler.course(startStitch.getCourseIndex())){
      const ts = this.graph.getTracedStitch(s.index, startStitch.pass);
      if(ts.index < startStitch.index)
        startStitch = ts;
    }
    // get ending stitch within its course
    for(const s of this.sampler.course(endStitch.getCourseIndex())){
      const ts = this.graph.getTracedStitch(s.index, endStitch.pass);
      if(ts.index > endStitch.index)
        endStitch = ts;
    }
    // get ending stitch in potential post short-rows
    while(!endStitch.isEnd()){
      const ns = endStitch.getNext();
      if(ns.isShortRow())
        endStitch = ns;
      else {
        // we've reached the next course
        break;
      }
    }
    assert(startStitch.index <= endStitch.index,
      'Invalid sequence of traced stitches');

    // create index set
    const indices = [];
    const trace = this.trace;
    for(let i = startStitch.index; i <= endStitch.index; ++i){
      const ts = trace.getTracedStitchAt(i);
      const [gid, sr] = ts.getGroupData();
      // include stitch iff
      // - not a short-row or
      // - a short row and either
      //    - fullSR=true (=> keep all short-row stitches in range)
      //    - the short-row is covered (srSet.has(gid))
      if(!sr || fullSR || srSet.has(gid)){
        indices.push(i);
      }
    }
    /*
    let ts = startStitch;
    do {
      const [gid, sr] = ts.getGroupData();
      // include stitch iff
      // - not a short-row or
      // - a short row and either
      //    - fullSR=true (=> keep all short-row stitches in range)
      //    - the short-row is covered (srSet.has(gid))
      if(!sr || fullSR || srSet.has(gid)){
        indices.push(ts.index);
      }
      // move to next stitch
      ts = ts.getNext();

    } while(ts && ts.index <= endStitch.index);
    */
    return this.withIndices(indices);
  }
  node(idx){
    this.needsTrace();
    const { start = -1, end = -1 } = this.nodeIndex[idx] || {};
    return this.filter(s => {
      return start <= s.index && s.index <= end;
    });
  }
  splitByNode(withNIdx = false){
    this.needsTrace();
    const nodeOf = idx => {
      for(let n = 0; n < this.nodeIndex.length; ++n){
        const { start = -1, end = -1 } = this.nodeIndex[n] || {};
        if(start <= idx && idx <= end)
          return n;
      }
      return -1;
    };
    const nodeIndices = this.nodeIndex.map(() => []);
    for(let idx of this.indices){
      const n = nodeOf(idx);
      assert(n >= 0, 'Stitch outside of the node index');
      nodeIndices[n].push(idx);
    }
    return nodeIndices.flatMap((indices, nidx) => {
      if(indices.length){
        const nprog = this.withIndices(indices);
        return withNIdx ? [[nidx, nprog]] : [nprog];
      } else
        return []; // node does not overlap
    });
  }
  first(){
    if(this.isEmpty())
      return this;
    return this.withIndices([this.indices.reduce((min, idx) => {
      return Math.min(min, idx);
    })]);
  }
  last(){
    if(this.isEmpty())
      return this;
    return this.withIndices([this.indices.reduce((max, idx) => {
      return Math.max(max, idx);
    })]);
  }
  range(range){
    if(this.isEmpty())
      return this;
    const [minIdx, maxIdx] = this.indices.reduce(([min,max], idx) => {
      return [
        Math.min(min, idx),
        Math.max(max, idx)
      ];
    }, [this.indices[0], this.indices[0]]);
    // normalize range
    if(!Array.isArray(range))
      range = [range, range, 1];
    // interval step
    const from = interpretRange(range[0], minIdx, maxIdx);
    const to   = interpretRange(range[1], minIdx, maxIdx);
    const step = range[2] || 1;
    return this.filter(s => {
      return from <= s.index && s.index <= to
          && (step === 1 || ((s.index - from) % step === 0));
    });
  }
  sketch(id){
    this.needsTrace();
    return this.filter(s => s.stitch.getSketch().id === id);
  }
  nearPosition(p, range = 0){
    if(range){
      // any within range
      return this.filter(s => {
        return geom.distBetweenBelow(p, s.getPosition(), range);
      });

    } else {
      // the closest one only
      if(!this.indices.length)
        return this; // to not fail with no data
      const ci = this.indices.reduce((bi, i) => {
        const pb = this.stitches[bi].getPosition();
        const pi = this.stitches[i].getPosition();
        const db = geom.distBetween(pb, p);
        const di = geom.distBetween(pi, p);
        return di < db ? i : bi;
      }, this.indices[0]);
      return this.withIndices([ci]);
    }
  }

  // -------------------------------------------------------------------------
  // --- Neighborhoods -------------------------------------------------------
  // -------------------------------------------------------------------------

  /**
   * Apply a mapping to modify the program selection step by step
   * 
   * @param {Function} fun map from stitch to stitches (or a single stitch)
   * @param {number} [n=1] the number of steps
   * @return {StitchProgram} the corresponding selection program
   */
  fneighbors(fun, n = 1){
    if(n <= 0)
      return this;
    const fn = this.flatMap(s => {
      const nss = fun(s);
      if(Array.isArray(nss))
        return nss.map(ns => ns.index);
      else if(nss)
        return [nss.index];
      else
        return [];
    });
    return fn.fneighbors(fun, n-1);
  }
  up(n = 1){ return this.fneighbors(s => s.getNextWales(), n); }
  down(n = 1){ return this.fneighbors(s => s.getPrevWales(), n); }
  prev(n = 1){
    this.needsTrace();
    return this.fneighbors(s => s.getPrev(), n);
  }
  next(n = 1){
    this.needsTrace();
    return this.fneighbors(s => s.getNext(), n);
  }
  left(n = 1){
    if(n === 0)
      return this;
    this.needsTrace();
    return this.fneighbors(s => {
      const pcs = s.stitch.getPrevCourse();
      if(pcs)
        return s.trace.getTracedStitch(pcs.index, s.pass);
      else
        return null;
    }, n);
  }
  right(n = 1){
    if(n === 0)
      return this;
    this.needsTrace();
    return this.fneighbors(s => {
      const ncs = s.stitch.getNextCourse();
      if(ncs)
        return s.trace.getTracedStitch(ncs.index, s.pass);
      else
        return null;
    }, n);
  }

  /**
   * Apply a mapping to grow the selection step by step
   * 
   * @param {Function} fun map from stitch to stitches (or a single stitch)
   * @param {number} [n=1] the number of steps
   * @return {StitchProgram} the extended stitch program
   * @see fneighbors for the boundary version
   */
  withFNeighbors(fun, n = 1){
    if(n <= 0)
      return this;
    const set = new Set(this.indices);
    for(; n > 0; --n){
      // create stable copy for iteration (since we'll modify the set)
      const index = Array.from(set);
      for(const i of index){
        const s = this.stitches[i];
        const nss = fun(s);
        if(Array.isArray(nss)){
          for(const ns of nss)
            set.add(ns.index);
        } else if(nss){
          set.add(nss.index);
        }
      } // endfor i of index
    } // endfor n > 0
    return this.withIndices(Array.from(set));
  }
  withUp(n = 1){ return this.withFNeighbors(s => s.getNextWales(), n); }
  withDown(n = 1){ return this.withFNeighbors(s => s.getPrevWales(), n); }
  withNext(n = 1){
    this.needsTrace();
    return this.withFNeighbors(s => s.getNext(), n);
  }
  withPrev(n = 1){
    this.needsTrace();
    return this.withFNeighbors(s => s.getPrev(), n);
  }

  /**
   * Select the neighbors of the current selection within some range
   *
   * @param range the range of rings to select
   * @return the new neighborhood
   */
  neighbors(range, inGraph = true){
    if(!range)
      range = [1, 1, 1]; // 1-ring neighborhood
    else if(!Array.isArray(range))
      range = [range, range, 1]; // N-ring neighborhood
    assert(range[2] == 1, 'Neighbors can only use step=1');
    const N = this.stitches.length; // workspace size
    const order = new Uint8Array(N); // initialized to 0
    let current = this.indices;
    
    // first pass: mark current selection to 1
    for(const idx of current){
      order[idx] = 1;
    }
    
    // next passes: mark neighbors iteratively
    for(let r = 1; r <= range[1] && current.length; ++r){
      current = current.reduce((accu, idx) => {
        const ts = this.stitches[idx];
        for(const ns of ts.neighbors(inGraph)){
          if(order[ns.index] === 0){
            order[ns.index] = r + 1;
            accu.push(ns.index); // no duplicates because of order information
          }
        }
        return accu;
      }, []);
    }
    // create new selection that matches the range information
    current = [];
    for(let i = 0; i < N; ++i){
      let r = order[i] - 1;
      if(r >= range[0] && r <= range[1])
        current.push(i);
    }
    return this.withIndices(current);
  }

  /**
   * Filter current stitches to those that
   * have neighbors outside the selection.
   *
   * When used on a shape, this also includes
   * nodes that have no neighbors outside the selection
   * but which have minimal or extremal courseId.
   */
  boundaries(inGraph = true){
    const stitchMap = {};
    for(const idx of this.indices){
      stitchMap[idx] = true;
    }
    return this.filter(s => {
      for(const ns of s.neighbors(inGraph)){
        if(!(ns.index in stitchMap))
          return true;
      }
      return false;
    });
  }

  // -------------------------------------------------------------------------
  // --- Set operations ------------------------------------------------------
  // -------------------------------------------------------------------------

  and(sel){ return this.inter(sel); }
  inter(sel){
    const flags = new Uint8Array(this.stitches.length);
    for(const idx of this.indices)
      flags[idx] = 1;
    return this.withIndices(sel.indices.filter(idx => {
      return flags[idx] === 1;
    }));
  }

  or(sel){ return this.union(sel); }
  union(sel){
    const flags = new Uint8Array(this.stitches.length);
    for(const idx of this.indices)
      flags[idx] = 1;
    return this.withIndices(sel.indices.reduce((accu, idx) => {
      if(!flags[idx])
        accu.push(idx); // not in this indices => add it
      return accu;
    }, this.indices.slice()));
  }

  minus(sel){
    const flags = new Uint8Array(this.stitches.length);
    for(const idx of sel.indices)
      flags[idx] = 1;
    return this.withIndices(this.indices.filter(idx => {
      return !flags[idx];
    }));
  }

  inverse(){
    const flags = new Uint8Array(this.stitches.length);
    for(const idx of this.indices)
      flags[idx] = 1;
    const newIndices = [];
    for(let i = 0, n = this.stitches.length; i < n; ++i){
      if(!flags[i])
        newIndices.push(i);
    }
    return this.withIndices(newIndices);
  }

  // -------------------------------------------------------------------------
  // --- Grid operations -----------------------------------------------------
  // -------------------------------------------------------------------------
  waleGrid(waleRange, waleSteps = 1, revWales = false){
    if(!Array.isArray(waleRange))
      waleRange = [waleRange, waleRange, 1]; // N-ring neighborhood
    // select course
    const numWales = this.indices.length;
    const indices = [];

    // range interpretation
    const from = interpretRange(waleRange[0], 0, numWales);
    const to   = interpretRange(waleRange[1], 0, numWales);
    const step = waleRange[2] || 1;
    const wales = [];
    const ws = revWales ? numWales - 1 : 0;
    const we = revWales ? -1 : numWales;
    const dw = revWales ? -1 : 1;
    for(let w = ws; w !== we; w += dw){
      if(from <= w && w <= to
      && (step === 1 || (w - from) % step === 0)){
        indices.push(this.indices[w]);
        wales.push([this.indices[w]]);
      }
    } // endfor w from ws to we by dw
    
    // expand wales
    for(const wale of wales){
      for(let h = 1, nh = Math.abs(waleSteps); h < nh; ++h){
        const s = this.stitches[wale[wale.length - 1]];
        const nss = waleSteps > 0 ? s.getNextWales() : s.getPrevWales();
        if(!nss.length)
          break;
        wale.push(nss[0].index); // XXX this is ad-hock
        indices.push(nss[0].index);
      }
    }
    return new WaleGridProgram(
      this, indices, wales,
      waleSteps > 0 ? -1 : 1
    );
  }

  grid(courseIdx, pass, ...args){
    return this.courses([
      courseIdx, courseIdx, 1
    ]).pass(pass).waleGrid(...args);
  }

  stitchGrid(w, h, {
    baseAxis = 'wale', xAlign = -1, yAlign = -1, revY = false,
    traceUnits = true
  } = {}){
    // only works with single stitch selection
    if(this.indices.length !== 1)
      return new GridProgram(this, []);

    // get single stitch
    const stitch = this.stitches[this.indices[0]];

    // parse units if strings
    const size = [w, h];
    const crsLen = stitch.getStitchGroupSize();
    let fullCrs = false;
    for(const [i, s] of size.entries()){
      if(typeof s === 'number')
        continue; // already a stitch number
      else if(typeof s !== 'string') {
        size[i] = 0; // make it break nicely
        console.warn('Invalid size type', s);
        continue;
      }
      // else we need to parse from string
      const u = Sizing.parse(s);
      const isCrs = i === 0;
      if(u.isLengthUnit()){
        size[i] = this.lengthToStitches(s, isCrs); // using length

      } else if(u.matches('stitch', '')){
        size[i] = u.value; // directly in stitch number

      } else if(u.matches('course')){
        size[i] = Math.max(0, Math.round(u.value * crsLen));
        if(u.value >= 1.0 && i === 0)
          fullCrs = true;

      } else if(u.matches('%')){
        size[i] = Math.max(0,
          Math.round(u.value / 100 * crsLen)
        );
        if(u.value >= 100 && i === 0)
          fullCrs = true;

      } else {
        size[i] = 0; // make it break nicely
        console.warn('Invalid grid units');
      }
    } // endfor [i, s] of [width, height].entries()

    // reduce height if looking for trace units, not from a trace
    if(traceUnits && !this.fromTrace()){
      // input was in trace stitches
      // => we only need half the height
      size[1] = Math.ceil(size[1] / 2);
    }

    // shortcut if any size is invalid (or below 1)
    [w, h] = size;
    if(!Number.isFinite(w) && w > 0){
      w = crsLen;
      fullCrs = true;
    } else 
      w = Math.min(w, crsLen);
    if(!Number.isFinite(h) && h > 0)
      h = crsLen; // to allow h=Infinity
    if(w <= 0 || h <= 0
    || !Number.isInteger(w)
    || !Number.isInteger(h)) {
      return new GridProgram(this, []);
    }

    // dedicated mode base on axis
    const opts = {
      stitch, crsLen, fullCrs,
      xAlign, yAlign, revY
    };
    assert(['wale', 'course'].includes(baseAxis),
      'Invalid base axis', baseAxis);
    if(baseAxis === 'wale')
      return this.stitchWaleGrid(w, h, opts);
    else
      return this.stitchCourseGrid(w, h, opts);
  }

  buildWale(h, startIdx, indices, yAlign, revY = false){
    const above = [ startIdx ];
    const below = above.slice();
    const dh = yAlign ? h - 1 : Math.ceil((h-1)/2);
    for(let dy = 1; dy <= dh; ++dy){
      if(yAlign !== +1 && above.length + below.length - 1 < h){
        // grow above
        const s = this.stitches[above[above.length - 1]];
        const nss = s ? s.getNextWales() : []; // XXX use getTargetWale?
        if(nss.length){
          above.push(nss[0].index);
          indices.push(nss[0].index);
        } else {
          above.push(-1); // pad with invalid indices
        }
      }
      if(yAlign !== -1 && above.length + below.length - 1 < h){
        // grow below
        const s = this.stitches[below[below.length - 1]];
        const pss = s ? s.getPrevWales() : [];
        if(pss.length){
          below.push(pss[0].index);
          indices.push(pss[0].index);
        } else {
          below.push(-1); // pad with invalid indices
        }
      }
    }
    // combine below parts
    let wale;
    if(below.length)
      wale = below.slice(1).reverse().concat(above);
    else
      wale = above;
    // return wale, possibly inverted
    return revY ? wale.reverse() : wale;
  }

  buildCourse(w, startIdx, indices, xAlign, fullCrs = false){
    // get course-level stitch group
    const stitch = this.stitches[startIdx];
    const stitches = stitch.getStitchGroup();
    const crsLen = stitches.length;
    const circ = stitches[0].isCourseConnectedTo(
      stitches[stitches.length - 1]
    );

    // find stitch index for X positioning
    const idx = stitches.findIndex(cs => cs.matches(stitch));
    if(idx === -1){
      assert.error('Course computation failed');
      return [];
    }

    // ensure we don't get stuck
    if(!Number.isFinite(w)){
      w = crsLen; // to prevent infinite loop
      assert.error('Width must be finite', w);
    }

    // only keep w > crsLen for fullCrs
    if(!fullCrs)
      w = Math.min(w, crsLen);

    // get aligned base course
    let course = [];
    const addIndices = () => {
      for(const idx of course){
        if(idx !== startIdx && idx !== -1)
          indices.push(idx);
      }
    };
    switch(xAlign){
      // stitch is on the left
      case -1:
        if(circ){
          course = Array.from({
            length: Math.min(w, crsLen)
          }, (_, i) => {
            return stitches[(idx + i) % crsLen].index;
          });

        } else {
          course = Array.from({
            length: Math.min(w, crsLen - idx)
          }, (_, i) => {
            return stitches[idx + i].index;
          });
        }
        addIndices();

        // pad the right
        while(course.length < w)
          course.push(-1);
        break;

      // stitch is on the right
      case +1:
        if(circ){
          course = Array.from({
            length: Math.min(w, crsLen)
          }, (_, i) => {
            return stitches[(idx + crsLen - i) % crsLen].index;
          }).reverse();

        } else {
          course = Array.from({
            length: Math.min(w, idx + 1)
          }, (_, i) => {
            return stitches[idx - i].index;
          }).reverse();
        }
        addIndices();
        
        // pad the left
        while(course.length < w)
          course.unshift(-1);
        break;

      // stitch is in the center
      case 0: {
        const hw = Math.floor(Math.min(w, crsLen) / 2);
        if(circ){
          course = Array.from({
            length: Math.min(w, crsLen)
          }, (_, i) => {
            return stitches[(idx + crsLen - hw + i) % crsLen].index;
          });

        } else {
          const lw = Math.min(hw, idx);
          const rw = Math.min(hw, crsLen - lw);
          course = Array.from({
            length: Math.min(lw + rw, crsLen)
          }, (_, i) => {
            const si = idx + i - lw;
            if(0 <= si && si < stitches.length){
              // within bounds
              return stitches[si].index;

            } else {
              // out-of-bounds
              return -1;
            }
          });
        }
        addIndices();

        // pad both sides
        while(course.length < w){
          course.push(-1);
          if(course.length < w)
            course.unshift(-1);
        }
      } break;

      default:
        console.warn('Invalid x alignment', xAlign);
        break;
    }
    return course;
  }

  stitchWaleGrid(w, h, {
    stitch, xAlign = -1, yAlign = -1, revY = false
  } = {}){
    
    // get base course
    const indices = [ stitch.index ];
    const course = this.buildCourse(w, stitch.index, indices, xAlign);

    // create wale stack
    const wales = [];
    for(const idx of course){
      const wale = this.buildWale(h, idx, indices, yAlign, revY);
      wales.push(wale);
    }
    return new WaleGridProgram(this, indices, wales, yAlign);
  }

  stitchCourseGrid(w, h, {
    stitch, fullCrs, xAlign = -1, yAlign = -1, revY = false
  }){
    // get base wale
    const indices = [stitch.index];
    const wale = this.buildWale(h, stitch.index, indices, yAlign, revY);

    // if fullCrs, then compute proper value for w
    if(fullCrs){
      w = wale.reduce((w, idx) => {
        const s = this.stitches[idx];
        return Math.max(w, s.getStitchGroupSize());
      }, w);
    }

    // create course stack
    const courses = [];
    for(const idx of wale){
      const crs = this.buildCourse(w, idx, indices, xAlign, fullCrs);
      courses.push(crs);
    }

    return new CourseGridProgram(this, indices, courses, xAlign);
  }

  // -------------------------------------------------------------------------
  // --- Grid utilities ------------------------------------------------------
  // -------------------------------------------------------------------------
  
  static parseImage(dataUri){
    const buffer = toBuffer(dataUri);
    const { data } = UPNG.decode(buffer);
    return data;
  }
  parseImage(dataUri){
    return StitchProgram.parseImage(dataUri);
  }

  static strToGrid(str, map = x => x){
    if(typeof map === 'object')
      map = x => map[x]; // implicit map function
    return str.split('\n').flatMap(line => {
      if(!line.length)
        return [];
      else
        return [ Array.from(line, c => map(c)) ];
    });
  }
  strToGrid(str, map = x => x){
    return StitchProgram.strToGrid(str, map);
  }

  // -------------------------------------------------------------------------
  // --- Size utilities ------------------------------------------------------
  // -------------------------------------------------------------------------
  
  lengthToStitches(lenStr, crsDir, round = true){
    if(crsDir)
      return this.lengthToCourseStitches(lenStr, round);
    else
      return this.lengthToWaleStitches(lenStr, round);
  }
  lengthToCourseStitches(lenStr, round = true){
    const length = Sizing.parseAs(lenStr, 'mm').asScalar(); // in mm
    const numPx = length / this.graph.sketchScale; // in px
    const numSt = numPx / this.graph.courseDist; // in traced stitches
    return round ? Math.round(numSt) : numSt;
  }
  lengthToWaleStitches(lenStr, round = true){
    const length = Sizing.parseAs(lenStr, 'mm').asScalar(); // in mm
    const numPx = length / this.graph.sketchScale; // in px
    const numSt = numPx / this.graph.waleDist; // in traced stitches
    // /!\ different from using this.sampler.waleDist
    return round ? Math.round(numSt) : numSt;
  }
}

/**
 * Creates a grid from the bits of a number
 *
 * @param num the number, whose bits are used from most significant to least significant
 * @param width the expect grid width (for padding purposes on the left)
 * @return the grid
 */
function bitGrid(num, width){
  const grid = num.toString(2).split('').map(c => parseInt(c));
  if(!width)
    return grid;
  // pad on the left with 0 until width matches
  while(grid.length % width)
    grid.unshift(0);
  return grid;
}

/**
 * Rounding for stretch sampling
 *
 * @param value the ratio to round
 * @param length the sampling length
 * @return round(value) but below length-1
 */
function roundsamp(value, length){
  const v = Math.floor(value);
  if(v >= length)
    return length - 1;
  else
    return v;
}

// abstract grid program
// note: should not be instantiated directly, use subclass instead
class GridProgram extends StitchProgram {
  constructor(parent, indices){
    super(parent.graph, parent.nodeIndex, parent.stitches, indices);
    // default grid is empty
    this.maxWidth   = 0;
    this.maxHeight  = 0;
  }

  // method to be implemented by the grid instantiation
  indexAt(/* x, y */){
    assert.error('GridProgram::indexAt(x,y) is not implemented');
  }

  select(pred){
    const indices = [];
    for(let x = 0; x < this.maxWidth; ++x){
      for(let y = 0; y < this.maxHeight; ++y){
        const idx = this.indexAt(x, y);
        if(idx !== -1
        && pred(x, y, this.maxWidth, this.maxHeight, this.stitches[idx])){
          indices.push(idx);
        }
      }
    }
    return this.withIndices(indices);
  }
  gridDo(fun){
    for(let x = 0; x < this.maxWidth; ++x){
      for(let y = 0; y < this.maxHeight; ++y){
        const idx = this.indexAt(x, y);
        if(idx !== -1){
          const prog = this.withIndices([idx]);
          fun({
            prog,
            s: this.stitches[idx],
            x, y,
            w: this.maxWidth,
            h: this.maxHeight
          });
        }
      }
    }
  }

  /**
   * Uses a grid-like pattern to mask the current selection,
   * which includes manual grids or images.
   * The pattern is stretched to fit the current grid.
   *
   * @param grid the data to use for masking
   * @param gridWidth the width of the grid (if using a linear data array)
   * @param pixelSize the amount of cells per pixels
   * @param pixelOffset the offset of the pixel to use for thresholding
   * @param threshFunc (val)=>(true|false)
   */
  stretch(grid, gridWidth, pixelSize, pixelOffset, threshFunc){
    if(typeof grid == 'number')
      grid = bitGrid(grid, gridWidth);
    if(gridWidth){
      if(!pixelSize)
        pixelSize = 1;
      if(!pixelOffset)
        pixelOffset = 0;
      if(!threshFunc)
        threshFunc = x => x;
      const w = gridWidth;
      assert(grid.length % (w * pixelSize) == 0, 'Invalid grid width w.r.t. the grid argument');
      const h = grid.length / (w * pixelSize);
      // array containing 2d grid
      return this.select((i, j, N, M, s) => {
        const x = i / N;
        const y = j / M;
        const gX = roundsamp(x * w, w);
        const gY = roundsamp(y * h, h);
        return threshFunc(grid[(gY * w + gX) * pixelSize + pixelOffset], s, i, j, gX, gY);
      });
    } else if (threshFunc){
      // array of arrays
      return this.select((i, j, N, M, s) => {
        const x = i / N;
        const y = j / M;
        const gY = roundsamp(y * grid.length, grid.length);
        const row = grid[gY]; // not y * (grid.length-1)
        const gX = roundsamp(x * row.length, row.length);
        return threshFunc(row[gX], s, i, j, gX, gY);
      });
    } else {
      // array of arrays
      return this.select((i, j, N, M) => {
        const x = i / N;
        const y = j / M;
        const row = grid[roundsamp(y * grid.length, grid.length)];
        return row[roundsamp(x * row.length, row.length)];
      });
    }
  }
  stretchDo(grid, fun, gridWidth = 0, pixelSize = 1, pixelOffset = 0){
    return this.stretch(grid, gridWidth, pixelSize, pixelOffset, (v, s, px, py, gx, gy) => {
      return fun(v, this.withIndices([s.index]), s, px, py, gx, gy);
    });
  }
  stretchMap(grid, map, gridWidth = 0, pixelSize = 0, pixelOffset = 0, remap = x => x){
    this.stretchDo(grid, (v, s) => {
      const key = remap(v); // remap pixel
      if(key in map)
        s.prog(map[key]);
      // else, do nothing
    }, gridWidth, pixelSize, pixelOffset);
    return this;
  }

  /**
   * Non-stretching variant of grid-like patterning.
   * Work like Pattern::pattern(), but does not stretch the underlying
   * pattern and instead tiles it over the selection.
   */
  tile(grid, gridWidth, pixelSize, pixelOffset, threshFunc){
    if(typeof grid == 'number')
      grid = bitGrid(grid, gridWidth);
    if(gridWidth){
      if(!pixelSize)
        pixelSize = 1;
      if(!pixelOffset)
        pixelOffset = 0;
      if(!threshFunc)
        threshFunc = x => x;
      const imgW = gridWidth;
      assert(grid.length % (imgW * pixelSize) == 0, 'Invalid grid width w.r.t. the grid argument');
      const imgH = grid.length / (imgW * pixelSize);
      // array containing 2d grid
      return this.select((x, y, _1, _2, s) => {
        const gX = x % imgW;
        const gY = y % imgH;
        const val = grid[(gY * imgW + gX) * pixelSize + pixelOffset];
        return threshFunc(val, s, x, y, gX, gY);
      });
    } else if(threshFunc) {
      // array of arrays
      return this.select((x, y, _1, _2, s) => {
        const gY = y % grid.length;
        const row = grid[gY];
        const gX = x % row.length;
        const val = row[gX];
        return threshFunc(val, s, x, y, gX, gY);
      });
    } else {
      // array of arrays
      return this.select((x, y) => {
        const row = grid[y % grid.length];
        const val = row[x % row.length];
        return val;
      });
    }
  }
  tileDo(grid, fun, gridWidth = 0, pixelSize = 1, pixelOffset = 0){
    return this.tile(grid, gridWidth, pixelSize, pixelOffset, (v, s, px, py, gx, gy) => {
      return fun(v, this.withIndices([s.index]), s, px, py, gx, gy);
    });
  }
  tileMap(grid, map, gridWidth = 0, pixelSize = 1, pixelOffset = 0, remap = x => x){
    this.tileDo(grid, (v, s) => {
      const key = remap(v);
      if(key in map)
        s.prog(map[key]);
      // else, do nothing
    }, gridWidth, pixelSize, pixelOffset);
    return this;
  }
}

class WaleGridProgram extends GridProgram {
  constructor(parent, indices, wales, alignY = -1){
    super(parent, indices);
    // grid information
    this.wales  = wales;
    this.alignY = alignY;
    // extents
    this.maxWidth  = wales.length;
    this.maxHeight = wales.reduce((max, w) => Math.max(max, w.length), 1);
  }

  align(alignY){
    return new WaleGridProgram(this, this.indices, this.wales, alignY);
  }
  topAlign(){ return this.align(-1); }
  bottomAlign(){ return this.align(1); }
  middleAlign(){ return this.align(0); }

  indexAt(x, y){
    // x/y might be in (0;1)x(0;1)
    if(0 < x < 1)
      x = Math.floor(x * (this.maxWidth-1));
    if(0 < y < 1)
      y = Math.floor(y * (this.maxHeight-1));
    // now x/y are integer coordinates
    // in [0;maxWidth-1]x[0;maxHeight-1]
    const dh = this.maxHeight - this.wales[x].length;
    let dy;
    switch(this.alignY){
      // bottom-aligned
      case -1: 
        dy = y;
        break;

      // top-aligned
      case 1: 
        dy = y - dh;
        break;

      // middle-aligned
      case 0:
        dy = y - Math.floor(dh/2);
        break;

      default:
        assert.error('Invalid y alignment', this.alignY);
        return;
    }
    if(dy in this.wales[x])
      return this.wales[x][dy];
    else
      return -1;
  }
}

class CourseGridProgram extends GridProgram {
  constructor(parent, indices, courses, alignX = -1){
    super(parent, indices);
    // grid information
    this.courses  = courses;
    this.alignX = alignX;
    // extents
    this.maxWidth  = courses.reduce((max, c) => Math.max(max, c.length), 1);
    this.maxHeight = courses.length;
  }

  align(alignX){
    return new CourseGridProgram(this, this.indices, this.wales, alignX);
  }
  leftAlign(){ return this.align(-1); }
  rightAlign(){ return this.align(1); }
  centerAlign(){ return this.align(0); }

  indexAt(x, y){
    // x/y might be in (0;1)x(0;1)
    if(0 < x < 1)
      x = Math.floor(x * (this.maxWidth-1));
    if(0 < y < 1)
      y = Math.floor(y * (this.maxHeight-1));
    // now x/y are integer coordinates
    // in [0;maxWidth-1]x[0;maxHeight-1]
    const dw = this.maxWidth - this.courses[y].length;
    let dx;
    switch(this.alignX){
      // left-aligned
      case -1: 
        dx = x;
        break;

      // right-aligned
      case 1: 
        dx = x - dw;
        break;

      // center-aligned
      case 0:
        dx = x - Math.floor(dw/2);
        break;

      default:
        assert.error('Invalid x alignment', this.alignX);
        return;
    }
    if(dx in this.courses[y])
      return this.courses[y][dx];
    else
      return -1;
  }
}

module.exports = StitchProgram;
