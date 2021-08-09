// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const SketchLayer = require('./base.js');
const { ImageType, MappingType } = require('./param.js');
const FloatPattern = require('./floatpattern.js');
const MultiYarnPattern = require('./multiyarnpattern.js');
const { TILED, SCALED, EXPLICIT, IMPLICIT } = MultiYarnPattern;
const Queue = require('../../../ds/queue.js');
const {
  BYARN_MISS, BYARN_TUCK, BYARN_KNIT
} = require('../../../yarnstack.js');

// constants
const TUB_2C = '2-colors tubular';
const FLO_2C = '2-colors floating';
const VER_2C = '2-colors vertical';
const HOR_2C = '2-colors horizontal';
const PIQ_2C = '2-colors pique';
const BACKINGS_2C = [
  TUB_2C, FLO_2C, VER_2C, HOR_2C, PIQ_2C
];
const TUB_3C = '3-colors tubular';
const FLO_3C = '3-colors floating';
const ALT_3C = '3-colors alternating';
const BACKINGS_3C = [
  TUB_3C, FLO_3C, ALT_3C
];
const TUB_XC = 'any-colors tubular';
const FLO_XC = 'any-colors floating';
const ALT_XC = 'any-colors alternating';
const BACKINGS_XC = [
  TUB_XC, FLO_XC, ALT_XC
];
const BACKINGS = BACKINGS_XC.concat(BACKINGS_2C).concat(BACKINGS_3C);

class JacquardPattern extends FloatPattern {

  static yarnCount(backing){
    if(BACKINGS_2C.includes(backing))
      return 2;
    else if(BACKINGS_3C.includes(backing))
      return 3;
    return -1;
  }

  jacquardStack(ys, dx, dy, backing){
    // check that stack size matches backing
    const yarns = Array.from(ys.yarns).sort((a,b) => a-b);
    let expCount = JacquardPattern.yarnCount(backing);
    if(expCount === -1){
      expCount = yarns.length; // adaptive
      if(expCount > 3){
        // ideally, we would have actual implementations
        // that take of the general N yarns case for each backing,
        // but our machine doesn't handle more than 3
        expCount = 3; // XXX handle backings for 4+ yarns
      }
      if(expCount === 2 || expCount === 3){
        // simplify to fixed backing
        switch(backing){
          case TUB_XC: backing = expCount === 2 ? TUB_2C : TUB_3C; break;
          case FLO_XC: backing = expCount === 2 ? FLO_2C : FLO_3C; break;
          case ALT_XC: backing = expCount === 2 ? PIQ_2C : ALT_3C; break;
          default:
            assert.error('Invalid backing', backing);
        }
      }

    } else {
      assert(expCount === yarns.length,
        'Backing does not match yarn count', expCount, yarns.length);
    }
    
    // get yarn data
    const FY = ys.getFrontYarns()[0]; // XXX support yarn groups
    const C = Math.min(Math.max(0, yarns.indexOf(FY)), expCount - 1);
    let CB0 = -1, CB1 = -1;
    if(expCount === 2)
      CB0 = 1 - C;
    else if(expCount === 3){
      CB0 = (C + 1) % 3;
      CB1 = (C + 2) % 3;
    }
    const BY0 = yarns[CB0];
    const BY1 = yarns[CB1];

    // recreate stack
    // front stays front, for all backings
    ys.resetFrontYarns([FY], true);

    // back yarn stack depends on the backing
    let bys, mks;
    switch(backing){

      // 2-colors backings
      // - tubular
      case TUB_2C:
        bys = [ BY0 ];
        mks = [ BYARN_KNIT ];
        break;
      // - vertical stripes
      case VER_2C:
        bys = [ FY, BY0 ];
        mks = [
          [BYARN_KNIT, BYARN_MISS][(dx + C) % 2],
          [BYARN_MISS, BYARN_KNIT][(dx + C) % 2]
        ];
        break;
      // - floating
      case FLO_2C:
        bys = [ BY0 ];
        mks = [ 
          [BYARN_MISS, BYARN_TUCK][(dx % 6) === [2,5][dy % 2] ? 1 : 0]
        ];
        break;
      // - horizontal
      case HOR_2C:
        bys = [ FY, BY0 ];
        /*
        // this is a mimicking of the vertical version:
        mks = [
          [BYARN_KNIT, BYARN_MISS][(dy + C) % 2],
          [BYARN_MISS, BYARN_KNIT][(dy + C) % 2]
        ];
        // which looks like the wanted backing, but would not knit!
        // because we need frequent connectivity across columns!
        */
        
        // /!\ this below is the proper horizontal backing
        // but it leads to twice as much yarn on the back side,
        // which could induce some warping, or lead to pile-up
        // unless the yarn is sufficiently thin!
        mks = [ BYARN_KNIT, BYARN_KNIT ];
        break;
      // - pique
      case PIQ_2C:
        bys = [ FY, BY0 ];
        mks = [
          [BYARN_KNIT, BYARN_MISS][(dx + dy) % 2],
          [BYARN_KNIT, BYARN_MISS][(dx + dy + 1) % 2] // or +1?
        ];
        break;

      // 3-colors backings
      // - floating
      case FLO_3C:
        bys = [ BY0, BY1 ];
        mks = [ 
          [BYARN_MISS, BYARN_TUCK][(dx % 6) === [2,5][(dy + 0) % 2] ? 1 : 0],
          [BYARN_MISS, BYARN_TUCK][(dx % 6) === [2,5][(dy + 1) % 2] ? 1 : 0]
        ];
        break;
      // - tubular
      case TUB_3C:
        bys = [ BY0, BY1 ];
        mks = [
          [BYARN_KNIT, BYARN_MISS][(dx + dy) % 2],
          [BYARN_KNIT, BYARN_MISS][(dx + dy + 1) % 2]
        ];
        break;
      // - alternating
      case ALT_3C:
        bys = [ FY, BY0, BY1 ];
        mks = [
          [BYARN_KNIT, BYARN_MISS][(dx + dy) % 2],
          [BYARN_KNIT, BYARN_MISS][(dx + dy + 1) % 2],
          [BYARN_KNIT, BYARN_MISS][(dx + dy) % 2]
        ];
        break;
    }
    if(bys && mks){
      ys.resetBackYarns(bys, mks);
    } else {
      console.warn('Incomplete backing implementation', backing);
    }
  }

  createDeltaMap(){
    // get stitch indices to cover
    const indices = new Set();
    for(const nprog of this.progDomains){
      for(const idx of nprog.indices)
        indices.add(idx);
    }
    const dmap = new Map();

    // nothing to do if empty
    if(indices.size === 0)
      return dmap;

    // find initial seed
    // if using an anchor, then set dx=dy=0 for it
    let i0 = -1;
    if(this.parent.type === 'anchorgrid'){
      // try anchor stitch as seed
      const anchor = this.parent.anchor;
      const stitch = anchor.getClosestStitch(this.prog.trace);
      if(indices.has(stitch.index))
        i0 = stitch.index;
      else {
        // search around stitch
        for(const ns of stitch.neighbors()){
          if(indices.has(ns.index)){
            i0 = ns.index;
            break;
          }
        }
      }
    }
    const pickStitch = () => {
      // find full course stitch, if any
      let srIdx = -1;
      for(const idx of indices){
        const s = this.prog.stitches[idx];
        if(s.isShortRow()){
          srIdx = idx;
          continue;
        }
        return idx;
      }
      return srIdx;
    };
    if(i0 === -1){
      i0 = pickStitch();
    }
    assert(0 <= i0 && i0 < this.prog.stitches.length,
      'Invalid seed index', i0, this.prog.stitches.length);

    // compute delta mapping
    const queue = new Queue();
    const push = (i, dx, dy) => {
      assert(typeof i === 'number',
        'First argument must be a stitch index');
      if(!indices.has(i) || dmap.has(i))
        return; // do not enqueue
      queue.enqueue(i);
      dmap.set(i, [dx, dy]);
    };
    push(i0, 0, 0);
    while(queue.length || indices.size){
      if(!queue.length){
        i0 = pickStitch();
        push(i0, 0, 0);
      }
      const idx = queue.dequeue();
      if(!indices.has(idx))
        continue; // already processed

      // spread dx/dy from stitch
      const [dx0, dy0] = dmap.get(idx);
      const s0 = this.prog.stitches[idx];
      // - set same dy across stitch group
      // - set appropriate dx across course, and push enqueue neighbors
      const ss = s0.getStitchGroup(); // in CCW order by construction
      const sidx = ss.findIndex(s => s.matches(s0));
      assert(sidx !== -1, 'Stitch does not exist?');

      // traverse group stitches
      for(const [i, s] of ss.entries()){
        const dx = dx0 + i - sidx;
        const si = s.index;
        // set dx/dy of stitch
        assert(indices.has(si),
            'Group stitch is already processed, or not in any domain');
        indices.delete(si); // mark as processed by removing
        // set dx/dy if not the source
        if(i !== sidx){
          dmap.set(si, [dx, dy0]); // overwrite what may exist!
        }
        // consider prev/next wales and enqueue 
        for(const [wss, dw] of [
          [s.getPrevWales(), -1],
          [s.getNextWales(), +1]
        ]){
          const dy = dy0 + dw;
          for(const ws of wss)
            push(ws.index, dx, dy);
        }
      }
    } // endwhile #queue || #indices

    // rescale so that min dx = 0 and min dy = 0
    let minDX = 0, minDY = 0;
    for(const [dx, dy] of dmap.values()){
      minDX = Math.min(minDX, dx);
      minDY = Math.min(minDY, dy);
    }
    if(minDX !== 0 || minDY !== 0){
      const index = Array.from(dmap.entries());
      for(const [idx, [dx, dy]] of index){
        dmap.set(idx, [dx - minDX, dy - minDY]);
      }
    }
    return dmap;
  }

  mark(...args){
    super.mark(...args);
    // mark two-sidedness unless purely floating
    const backing = this.getParam('backing');
    const twosided = ![FLO_2C, FLO_3C, FLO_XC].includes(backing);
    if(!twosided)
      return;

    // we mark the stitches as two-sided (for unification)
    for(const nprog of this.progDomains){
      nprog.each(s => s.setTwoSided());
    }
  }

  unify(...args){
    // get dx/dy information
    const dmap = this.createDeltaMap();
    const backing = this.getParam('backing');

    // update front/back given backing in each node domain
    for(const nprog of this.progDomains){
      // compute a dx/dy mapping for the domain

      nprog.each(s => {
        if(s.getProgram() !== 0)
          return; // already user-programmed

        // modify fyarn and byarns given backing
        // we need to compute C, dx and dy
        const ys = s.getYarnStack();
        assert(dmap.has(s.index), 'Delta map missing stitch');
        const [dx, dy] = dmap.get(s.index) || [0, 0];

        // set the jacquard stack
        this.jacquardStack(ys, dx, dy, backing);
      });
    }

    // apply unification
    super.unify(...args);
  }

}

module.exports = SketchLayer.register(
  'jacquard-pattern', JacquardPattern,
[
  ['spreadMode',  [SCALED, TILED]],
  ['pattern',     ImageType],
  ['mapping',     MappingType],
  ['missType',    [IMPLICIT, EXPLICIT]],
  ['backing',     BACKINGS]
], [
  'anchorgrid', 'rectangle'
]);