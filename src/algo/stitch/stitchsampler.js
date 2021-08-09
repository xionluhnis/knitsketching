// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const PackedArray = require('../../ds/packedarray.js');
const { F32, U16, U32 } = PackedArray;

// constants -----------------------------------------------------------------
// orientations
const CCW   = 1;
const CW    = -1;
const NONE  = 0;
// stitch fields
const STITCH_X  = 'sx';
const STITCH_Y  = 'sy';
const STITCH_A  = 'sa';
// index metadata
const LAYER_INDEX = 'li';
const GROUP_DATA  = 'gd';
const YARN_MASK   = 'ym';
const YARN_MASK_ALL = 0x000003FF; // 10 first bits
const GROUP_MASK    = 0xFFFFFFFE;
const GROUP_SHIFT   = 1;
const MAX_GROUP_ID  = Math.pow(2, 31)-1;
const SHORTROW_FLAG = 0x00000001;
// pointer fields
const PREV_COURSE = 'pc';
const NEXT_COURSE = 'nc';
const PREV_WALE_0 = 'pw0';
const PREV_WALE_1 = 'pw1';
const NEXT_WALE_0 = 'nw0';
const NEXT_WALE_1 = 'nw1';

// connection types
const COURSE = 1;
const WALE   = 2;

// lists
const ALL_COURSES     = [PREV_COURSE, NEXT_COURSE];
const ALL_PREV_WALES  = [PREV_WALE_0, PREV_WALE_1];
const ALL_NEXT_WALES  = [NEXT_WALE_0, NEXT_WALE_1];
const ALL_WALES       = ALL_PREV_WALES.concat(ALL_NEXT_WALES);
const ALL_NEIGHBORS   = ALL_COURSES.concat(ALL_WALES);

// maps
const NTYPE_MAP = {
  [PREV_COURSE]: COURSE,
  [NEXT_COURSE]: COURSE,
  [PREV_WALE_0]: WALE,
  [PREV_WALE_1]: WALE,
  [NEXT_WALE_0]: WALE,
  [NEXT_WALE_1]: WALE
};

// connection type pairings
const TYPE_PAIRS = Object.entries(NTYPE_MAP);

// pairs
const OTHER_TYPES = {
  [PREV_COURSE]: [NEXT_COURSE],
  [NEXT_COURSE]: [PREV_COURSE],
  [PREV_WALE_0]: [NEXT_WALE_0, NEXT_WALE_1],
  [PREV_WALE_1]: [NEXT_WALE_0, NEXT_WALE_1],
  [NEXT_WALE_0]: [PREV_WALE_0, PREV_WALE_1],
  [NEXT_WALE_1]: [PREV_WALE_0, PREV_WALE_1],
};

/**
 * Structure to sample stitches and their related information
 * on top of sketches.
 *
 * Sizing:
 * - wale = ratio #wales/mm
 * - course = ratio #courses/mm
 * - scale = ratio mm/px
 *
 * Per-stitch data:
 * - f32 sx, sy, sa (stitch x, y, alpha)
 * - u32 pc, nc, pw0, pw1, nw0, nw1 (previous/next course/wale pointer #0/1)
 * - u16 li (layer index) and ym (yarn mask)
 * - u32 gd (group id | shortrow flag)
 *
 * @param sketches list of sketches
 */
class StitchSampler {
  constructor(sketches, {
    numStitches, courseDist, waleDist, sketchScale
  } = {}){
    this.sketches = sketches || [];
    if(numStitches)
      this.allocate(numStitches);
    this.courseIndex  = [];
    this.srIndex      = [];
    this.warnings     = [];
    // global stitch information
    this.courseDist   = courseDist || NaN;
    this.waleDist     = waleDist || NaN;
    this.sketchScale  = sketchScale || NaN;
    // temporary
    this.timeIndex = [];
  }

  clear(){
    this.courseIndex  = [];
    this.srIndex      = [];
    this.warnings     = [];
    this.array.clear();
  }

  createSubdiv(scale){
    assert(scale > 1, 'Invalid subdivision scale');
    return new StitchSampler(this.sketches, {
      numStitches:  this.length * scale * scale,
      courseDist:   this.courseDist / scale,
      waleDist:     this.waleDist / scale,
      sketchScale:  this.sketchScale
    });
  }

  allocate(numStitches){
    assert(numStitches > 0, 'Should allocate a positive number of stitches');
    this.array = new PackedArray([
      // stitch position (except layer)
      [STITCH_X,    F32], // stitch x
      [STITCH_Y,    F32], // stitch y
      [STITCH_A,    F32], // stitch alpha
      // index metadata
      [LAYER_INDEX, U16], // layer index
      [YARN_MASK,   U16], // base yarn mask
      [GROUP_DATA,  U32], // group id | sr flag
      // pointer data
      [PREV_COURSE, U32], // prev course neighbor
      [NEXT_COURSE, U32], // next course neighbor
      [PREV_WALE_0, U32], // prev wale neighbor 0
      [PREV_WALE_1, U32], // prev wale neighbor 1
      [NEXT_WALE_0, U32], // next wale neighbor 0
      [NEXT_WALE_1, U32]  // next wale neighbor 1
    ], numStitches);
  }

  get length(){ return this.array ? this.array.length : 0; }
  get capacity(){ return this.array ? this.array.capacity : 0; }
  get lastCourseIndex(){ return this.courseIndex.length - 1; }
  get lastShortRowIndex(){ return this.srIndex.length - 1; }
  get numCourses(){ return this.courseIndex.length; }
  get numShortrows(){ return this.srIndex.length; }
  get numGroups(){ return this.numCourses + this.numShortrows; }
  get lastStitchIndex(){ return this.length - 1; }

  getBuffers(){ return this.array.getBuffers(); }

  toData(minimal = false){
    const obj = {};
    for(const key in this){
      const value = this[key];
      switch(key){

        case 'sketches':
          obj[key] = value.map(sketch => sketch.id); // only transfer id
          break;

        case 'array':
          obj[key] = value.toData(minimal);
          break;

        // temporary data, constructed when needed
        case 'timeIndex':
          break;

        // default transferable data
        default:
          obj[key] = value;
          break;
      }
    }
    return obj;
  }

  loadData(data){
    for(let key in data){
      const value = data[key];
      if(key == 'sketches')
        this.sketches = value.map(sketch => typeof sketch == 'number' ? sketch : sketch.id);
      else if(key == 'array')
        this.array = PackedArray.fromData(value);
      else
        this[key] = value;
    }
    return this;
  }

  remapData(map){
    this.sketches = this.sketches.map(map);
    return this;
  }

  static fromData(data){
    return new StitchSampler().loadData(data);
  }

  /**
   * Start the sampling of a new course
   *
   * @return the new course index
   */
  startStitchGroup(time, region, index){
    assert(typeof time === 'number',
      'Missing or invalid time argument');
    // the last entry should be non-empty!
    if(index.length){
      // check whether the last group is non-empty
      const { start, end } = index[index.length - 1];
      assert(start <= end, 'Empty stitch group!');
    }
    index.push({
      start: this.array.length, end: this.array.length - 1, time, region
    });
    return index.length - 1;
  }
  startCourse(time, region){
    return this.startStitchGroup(time, region, this.courseIndex);
  }
  startShortRow(time, region){
    return this.startStitchGroup(time, region, this.srIndex);
  }
  getCourseEntry(ci = this.lastCourseIndex){
    return this.courseIndex[ci];
  }
  getShortRowEntry(ri = this.lastShortRowIndex){
    return this.srIndex[ri];
  }
  updateLastCourse(){
    assert(this.courseIndex.length, 'No course started');
    this.courseIndex[this.lastCourseIndex].end = this.lastStitchIndex;
  }
  updateLastShortRow(){
    assert(this.srIndex.length, 'No course started');
    this.srIndex[this.lastShortRowIndex].end = this.lastStitchIndex;
  }

  /**
   * Create a new stitch
   *
   * @param {number} li layer index
   * @param {{x,y}} p stitch location { x, y }
   * @typedef {{ alpha: number, shortRow: boolean}} StitchOptions
   * @return {Stitch} the created stitch
   */
  createStitch(li, p, { alpha = NaN, shortRow = false } = {}){
    // check arguments stitch
    assert('x' in p && 'y' in p, 'Invalid stitch location');
    assert(typeof li === 'number'
        && typeof p.x === 'number'
        && typeof p.y === 'number'
        && typeof alpha === 'number', 'Invalid argument types');
    assert(0 <= li && li < this.sketches.length,
      'Layer index out-of-bounds');
    // create
    const gi = shortRow ? this.lastShortRowIndex : this.lastCourseIndex;
    assert(0 <= gi, 'No stitch group created yet');
    assert(gi <= MAX_GROUP_ID, 'Group index out-of-bounds');
    const srFlag = shortRow ? SHORTROW_FLAG : 0;
    this.array.push({
      [STITCH_Y]:     p.y,
      [STITCH_X]:     p.x,
      [STITCH_A]:     alpha,
      [LAYER_INDEX]:  li,
      [YARN_MASK]:    0x0001, // use yarn 1 only by default
      [GROUP_DATA]:   srFlag | (gi << GROUP_SHIFT) 
    });

    // update short-row / course index
    if(shortRow)
      this.updateLastShortRow();
    else
      this.updateLastCourse();

    // return new stitch
    return new Stitch(this, this.array.length - 1);
  }

  get(...args){
    return this.array.get(...args);
  }

  set(...args){
    this.array.set(...args);
  }

  /**
   * Returns a stitch data structure
   * to manipulate the stitch data stored in this sampler
   *
   * @param index the stitch index
   * @return the corresponding Stitch element
   */
  getStitch(index){ return new Stitch(this, index); }

  addWarning(warning){ this.warnings.push(warning); }

  // iterators and collections
  *stitches(){
    for(let i = 0, n = this.length; i < n; ++i)
      yield this.getStitch(i);
  }
  allStitches(){
    return Array.from(this.stitches());
  }
  *course(ci){
    assert(typeof ci === 'number' && 0 <= ci && ci <= this.lastCourseIndex,
      'Invalid course index argument', ci);
    const { start, end } = this.getCourseEntry(ci);
    for(let i = start; i <= end; ++i)
      yield this.getStitch(i);
  }
  *courses(){
    for(let ci = 0, n = this.lastCourseIndex; ci <= n; ++ci)
      yield Array.from(this.course(ci));
  }
  *shortrow(ri){
    assert(typeof ri === 'number' && 0 <= ri
        && ri <= this.lastShortRowIndex,
      'Invalid short-row index argument', ri);
    const { start, end } = this.getShortRowEntry(ri);
    for(let i = start; i <= end; ++i)
      yield this.getStitch(i);
  }
  *shortrows(){
    for(let ri = 0, n = this.lastShortRowIndex; ri <= n; ++ri)
      yield Array.from(this.shortrow(ri));
  }
  *group([gi, sr]){
    if(sr)
      yield *this.shortrow(gi - this.numCourses);
    else
      yield *this.course(gi);
  }
  checkTimeIndex(){
    const numGroups = this.courseIndex.length + this.srIndex.length;
    if(this.timeIndex.length === numGroups)
      return; // already up to date
    // not up to date => create (from scratch)
    this.timeIndex = this.courseIndex.concat(this.srIndex).sort((e1, e2) => {
      return e1.time - e2.time;
    });
  }
  *stitchesWithinTimeRange(timeStart, timeEnd){
    assert(!isNaN(timeStart) && !isNaN(timeEnd) && timeStart <= timeEnd,
      'Invalid time range');
    this.checkTimeIndex();
    for(const { start, end, time } of this.timeIndex){
      if(time < timeStart)
        continue; // too early => skip
      else if(time > timeEnd)
        break; // too late => stop
      // else, we're in range!
      for(let i = start; i <= end; ++i)
        yield this.getStitch(i);
    }
  }

  clearShortRows(){
    if(this.numShortrows === 0)
      return;
    const { start } = this.srIndex[0];
    assert(!isNaN(start) && start > 0, 'Invalid short-row entry');
    assert(this.array.length >= start, 'Invalid short-row start');
    this.array.fill(0, start);
    this.array.length = start; // the rest becomes noise
    this.srIndex = []; // clear short-row index
  }

  clearCourses(fromIdx = 0){
    if(this.numCourses <= fromIdx)
      return;
    const { start } = this.courseIndex[fromIdx];
    assert(!isNaN(start) && start > 0, 'Invalid course entry');
    assert(this.array.length >= start, 'Invalid course start');
    this.array.fill(0, start);
    this.array.length = start; // the rest becomes noise
    this.courseIndex.splice(fromIdx, this.courseIndex.length - fromIdx);
    assert(this.courseIndex.length === fromIdx,
      'Course clearing invalid');
  }
}

class Stitch {
  constructor(sampler, index){
    this.sampler = sampler;
    this.index = index;
  }

  matches(stitch){ return !!stitch && stitch.index === this.index; }
  get pointer(){ return this.index + 1; }
  get sketches(){ return this.sampler.sketches; }
  get pass(){ return 0; }

  // --- base accessors ------------------------------------------------------

  get(which){ return this.sampler.get(this.index, which); }
  has(which){ return !!this.get(which); }
  set(...args){
    this.sampler.set(this.index, ...args); // which, value);
    return this;
  }

  // --- data ----------------------------------------------------------------

  getLayerIndex(){ return this.get(LAYER_INDEX); }
  static isShortRow(gd){
    return (gd & SHORTROW_FLAG) === SHORTROW_FLAG;
  }
  getGroupData(){
    const gd = this.get(GROUP_DATA);
    const sr = Stitch.isShortRow(gd);
    // /!\ unsigned rightshift (because the left is "signed")
    return [(gd & GROUP_MASK) >>> GROUP_SHIFT, sr];
  }
  getGroupIndex(){
    return (this.get(GROUP_DATA) & GROUP_MASK) >>> GROUP_SHIFT;
  }
  isShortRow(){ return Stitch.isShortRow(this.get(GROUP_DATA)); }
  getYarnMask(){ return this.get(YARN_MASK) || YARN_MASK_ALL; }
  setYarnMask(ym = 0){
    assert(0 <= ym && ym <= YARN_MASK_ALL,
      'Yarn mask out of bounds', ym);
    this.set(YARN_MASK, ym);
  }
  getCourseIndex(){
    const [ci, sr] = this.getGroupData();
    assert(!sr, 'Course index of a short-row stitch');
    return ci;
  }
  getLowerCourseStitch(){
    let s = this;
    while(s.isShortRow()){
      s = s.getNeighbor(PREV_WALE_0);
    }
    return s; 
  }
  getLowerCourseIndex(){
    return this.getLowerCourseStitch().getCourseIndex();
  }
  getUpperCourseStitch(){
    let s = this;
    while(s.isShortRow()){
      s = s.getNeighbor(NEXT_WALE_0);
    }
    return s;
  }
  getUpperCourseIndex(){
    return this.getUpperCourseStitch().getCourseIndex(); 
  }
  getShortRowIndex(){
    const [ci, sr] = this.getGroupData();
    assert(sr, 'Short-row index of a course stitch');
    return ci;
  }
  getCourseEntry(){
    return this.sampler.getCourseEntry(this.getCourseIndex());
  }
  getShortRowEntry(){
    return this.sampler.getShortRowEntry(this.getShortRowIndex());
  }
  getGroupEntry(){
    if(this.isShortRow())
      return this.getShortRowEntry();
    else
      return this.getCourseEntry();
  }
  getRegionID(){
    return this.getGroupEntry().region;
  }
  stitchGroup(){
    const [gi, sr] = this.getGroupData();
    if(sr)
      return this.sampler.shortrow(gi);
    else
      return this.sampler.course(gi);
  }
  getStitchGroup(){ return Array.from(this.stitchGroup()); }
  getStitchGroupSize(){
    const { start, end } = this.getGroupEntry();
    return end - start + 1;
  }
  matchesGroupOf(stitch){
    return stitch && this.get(GROUP_DATA) === stitch.get(GROUP_DATA);
  }
  getPosition(){
    return {
      x: this.get(STITCH_X),
      y: this.get(STITCH_Y)
    };
  }
  setPosition(p){
    assert('x' in p && 'y' in p, 'Invalid position');
    assert(!isNaN(p.x) && !isNaN(p.y), 'Invalid position values');
    this.set(STITCH_X, p.x);
    this.set(STITCH_Y, p.y);
    return this;
  }
  getAlpha(){ return this.get(STITCH_A); }
  hasAlpha(){ return !Number.isNaN(this.getAlpha()); }
  setAlpha(alpha){
    return this.set(STITCH_A, alpha);
  }
  getTime(){ return this.getGroupEntry().time; }
  getSketch(){
    const layerIndex = this.getLayerIndex();
    return this.sampler.sketches[layerIndex];
  }
  getMeshLayer(mesh){
    const layerIndex = this.getLayerIndex();
    return mesh.layers[layerIndex];
  }

  // --- generic neighbor accessors ------------------------------------------

  hasNeighbor(which){ return !!this.has(which); }
  getNeighbor(which){
    const ptr = this.get(which);
    return ptr ? new Stitch(this.sampler, ptr - 1) : null;
  }
  pickNeighbor(which, outList){
    const ptr = this.get(which);
    if(ptr)
      outList.push(new Stitch(this.sampler, ptr - 1));
    return this;
  }
  getNeighbors(whichList){
    if(!whichList)
      whichList = ALL_NEIGHBORS;
    const list = [];
    for(const which of whichList)
      this.pickNeighbor(which, list);
    return list;
  }
  findNeighbor(predicate, ...whichList){
    if(!whichList.length)
      whichList = ALL_NEIGHBORS;
    for(const which of whichList){
      const nstitch = this.getNeighbor(which);
      if(nstitch && predicate(nstitch, NTYPE_MAP[which], which)){
        return { 
          stitch: nstitch,
          type: NTYPE_MAP[which],
          which
        };
      }
    }
    return null;
  }
  getConnectionType(stitch){
    for(const [which, type] of TYPE_PAIRS){
      const nstitch = this.getNeighbor(which);
      if(nstitch && nstitch.index == stitch.index)
        return type;
    }
    return NONE;
  }

  // --- neighbor counters ---------------------------------------------------

  countNeighbors(which){
    if(!which)
      which = ALL_NEIGHBORS;
    let n = 0;
    for(let i = 0; i < which.length; ++i){
      if(this.has(which[i]))
        ++n;
    }
    return n;
  }
  countCourses(){ return this.countNeighbors(ALL_COURSES); }
  countPrevWales(){ return this.countNeighbors(ALL_PREV_WALES); }
  countNextWales(){ return this.countNeighbors(ALL_NEXT_WALES); }
  countWales(){ return this.countNeighbors(ALL_WALES); }

  // --- generic neighbor setters --------------------------------------------

  setNeighbor(which, stitch){
    assert(stitch && stitch.index !== this.index, 'Invalid stitch or self stitch neighbor');
    assert(!this.isConnectedTo(stitch), 'Double connection to stitch');
    this.set(which, stitch.pointer);
  }
  setNeighborRelation(thisTypes, thatStitch, thatTypes){
    assert(thatStitch && 'index' in thatStitch,
      'Invalid setting of neighbor relation to non-stitch value');
    assert(Array.isArray(thisTypes) && thisTypes.length
        && Array.isArray(thatTypes) && thatTypes.length === thisTypes.length, 'Invalid types arguments');
    // set relation on this side
    let thisPtr = null;
    let thatPtr = null;
    for(let i = 0; i < thisTypes.length; ++i){
      // this pointer
      const thisType = thisTypes[i];
      if(!thisPtr && !this.hasNeighbor(thisType)){
        thisPtr = thisType;
      }
      // that pointer
      const thatType = thatTypes[i];
      if(!thatPtr && !thatStitch.hasNeighbor(thatType)){
        thatPtr = thatType;
      }
    }
    assert(thisPtr && thatPtr, 'Relation is not valid because no slot is available', thisPtr, thisTypes, thatPtr, thatTypes);
    // actually commit now
    if(thisPtr && thatPtr){
      this.setNeighbor(thisPtr, thatStitch);
      thatStitch.setNeighbor(thatPtr, this);
    }
    return this;
  }
  removeNeighbor(...args){
    let index;
    let types;
    for(let arg of args){
      if(typeof arg === 'string'){
        assert(types === undefined, 'Multiple types? Pass an array of them!');
        assert(ALL_NEIGHBORS.includes(arg), 'Invalid neighbor type', arg);
        types = [ arg ];
      } else if(typeof arg === 'number'){
        assert(index === undefined, 'Multiple stitch indices?');
        index = arg;
      } else if(Array.isArray(arg)){
        assert(types === undefined, 'Multiple types sets? Pass a single array of them!');
        assert(arg.every(type => ALL_NEIGHBORS.includes(type)),
          'One of the neighbor types is not valid', arg);
        types = arg;
      } else {
        assert(arg instanceof Stitch, 'Invalid argument, neither a type, index nor stitch');
        index = arg.index;
      }
    }
    if(types === undefined)
      types = ALL_NEIGHBORS;
    const ptr = index + 1;
    for(const which of types){
      if(this.get(which) === ptr){
        this.set(which, 0); // remove pointer
        return true;
      }
    }
    return false;
  }
  removeNeighborRelation(thisTypes, thatStitch, thatTypes){
    assert(thatStitch && 'index' in thatStitch,
      'Invalid removal of neighbor relation to non-stitch value');
    assert(Array.isArray(thisTypes) && thisTypes.length
        && Array.isArray(thatTypes) && thatTypes.length, 'Invalid types arguments');
    // check that both sides are removed
    const thisPtr = this.removeNeighbor(thisTypes, thatStitch);
    const thatPtr = thatStitch.removeNeighbor(thatTypes, this);
    assert(thisPtr && thatPtr, 'Relation was not valid, one side was not removed', thisPtr, thisTypes, thatPtr, thatTypes);
    return this;
  }
  clearNeighbors(types = ALL_NEIGHBORS){
    for(const which of types){
      const ptr = this.get(which);
      if(!ptr)
        continue;
      this.set(which, 0); // remove pointer

      // propagate to other side
      const stitch = new Stitch(this.sampler, ptr - 1);
      stitch.removeNeighbor(OTHER_TYPES[which], this);
    }
  }

  // --- course get/set ------------------------------------------------------

  getCourses(){
    const list = [];
    this.pickNeighbor(PREV_COURSE, list);
    this.pickNeighbor(NEXT_COURSE, list);
    return list;
  }
  getAnyCourse(){
    for(let which of ALL_COURSES){
      const stitch = this.getNeighbor(which);
      if(stitch)
        return stitch;
    }
    return null;
  }
  getCourse(fromStitch){
    assert(fromStitch.index !== this.index, 'Argument cannot be this stitch');
    const prevStitch = this.getNeighbor(PREV_COURSE);
    if(prevStitch && prevStitch.index === fromStitch.index){
      const nextStitch = this.getNeighbor(NEXT_COURSE);
      assert(!nextStitch || nextStitch.index !== fromStitch.index,
        'Stitch has same stitch as both course neighbors');
      return nextStitch;
    } else
      return prevStitch;
  }
  
  getNextCourse(){ return this.getNeighbor(NEXT_COURSE); }
  getPrevCourse(){ return this.getNeighbor(PREV_COURSE); }
  hasNextCourse(){ return this.hasNeighbor(NEXT_COURSE); }
  hasPrevCourse(){ return this.hasNeighbor(PREV_COURSE); }
  setPrevCourse(stitch){
    return this.setNeighborRelation([PREV_COURSE], stitch, [NEXT_COURSE]);
  }
  setNextCourse(stitch){
    return this.setNeighborRelation([NEXT_COURSE], stitch, [PREV_COURSE]);
  }

  // --- wale accessors ------------------------------------------------------

  getPrevWales(){
    const list = [];
    this.pickNeighbor(PREV_WALE_0, list);
    this.pickNeighbor(PREV_WALE_1, list);
    return list;
  }
  getNextWales(){
    const list = [];
    this.pickNeighbor(NEXT_WALE_0, list);
    this.pickNeighbor(NEXT_WALE_1, list);
    return list;
  }
  setNextWale(stitch){
    return this.setNeighborRelation(ALL_NEXT_WALES, stitch, ALL_PREV_WALES);
  }
  setPrevWale(stitch){ stitch.setNextWale(this); return this; }
  removeNextWale(stitch){
    return this.removeNeighborRelation(ALL_NEXT_WALES, stitch, ALL_PREV_WALES);
  }
  removePrevWale(stitch){
    return this.removeNeighborRelation(ALL_PREV_WALES, stitch, ALL_NEXT_WALES);
  }
  clearNextWales(){ this.clearNeighbors(ALL_NEXT_WALES); return this; }
  clearPrevWales(){ this.clearNeighbors(ALL_PREV_WALES); return this;}

  // --- is queries ----------------------------------------------------------

  isCourseEndpoint(ori = 0){
    switch(ori){
      case NONE:  return this.countCourses() < 2;
      case CCW:   return !this.hasNextCourse();
      case CW:    return !this.hasPrevCourse();
      default:
        assert.error('Invalid orientation argument', ori);
    }
  }
  isConnectedTo(stitch){
    return this.getConnectionType(stitch) !== NONE;
  }
  isCourseConnectedTo(stitch){
    for(const w of ALL_COURSES){
      const ptr = this.get(w);
      if(ptr === stitch.pointer)
        return true;
    }
    return false;
  }
  isWaleConnectedTo(stitch){
    for(const w of ALL_WALES){
      const ptr = this.get(w);
      if(ptr === stitch.pointer)
        return true;
    }
    return false;
  }
  isNextCourse(stitch){ return this.get(NEXT_COURSE) === stitch.pointer; }
  isPrevCourse(stitch){ return this.get(PREV_COURSE) === stitch.pointer; }
}

module.exports = Object.assign(StitchSampler, {
  // classes
  Stitch,
  // constants
  // - orientation
  CCW, CW, NONE,
  // - neighbors
  ALL_COURSES, ALL_PREV_WALES, ALL_NEXT_WALES, ALL_WALES, ALL_NEIGHBORS,
  // - connectivity
  COURSE, WALE,
  // - yarn mask
  YARN_MASK_ALL
});
