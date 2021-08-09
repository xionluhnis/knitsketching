// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../../assert.js');
const env = require('../../../env.js');
const Action = require('../action.js');
const StitchPattern = require('./stitchpattern.js');
const {
  EMPTY, KNIT, TUCK, MISS, PURL, MOVE_L1, MOVE_R1,
  codeToChar
} = StitchPattern;
const {
  FYARN_BITS, BYARN_NONE, BYARN_MISS, BYARN_TUCK, BYARN_KNIT,
  FYARN_FULL_MASK, asFYarnList
} = require('../../../yarnstack.js');

// constants
const FRONT_KNITS = [KNIT, MOVE_L1, MOVE_R1];
const EXPLICIT = 'explicit';
const IMPLICIT = 'implicit';
const ONE_TO_TWOSIDED = 0x01;
const TWO_TO_ONESIDED = 0x02;

class MultiYarnPattern extends StitchPattern {
  constructor(parent = null){
    super(parent);
    // stitch domains
    this.progDomains = [];
  }
  getYarns(){
    const mapping = this.getParam('mapping');
    return [...new Set(Array.from(mapping.values()).flatMap(bits => {
      return FYARN_BITS.flatMap((yb,i) => {
        return (yb & bits) !== 0 ? [i+1] : [];
      });
    }))];
  }
  filterNode(/* nprog */){
    return true; // keep all by default
  }
  allocateYarns(prog, yarns = this.getYarns()){
    if(!yarns.length)
      return; // nothing to do
    // const defYarn = this.getDefaultYarn();
    // split program coverage into sub-programs
    // for each independent node that is covered
    const nodeProgs = prog.splitByNode().filter(nprog => {
      return this.filterNode(nprog); // allow filtering of those blocks
    });
    this.progDomains = [];

    // get yarn mask
    const yarnMask = this.getParam('yarnMask') || FYARN_FULL_MASK;

    // for each sub-program
    for(const nprog of nodeProgs){
      // get the range of actions
      // based on the courses it covers
      const domain = nprog.courseRange(false).filter(s => {
        const ty = s.getTraceYarn();
        const tyMsk = 1 << (ty - 1);
        // only keep stitches whose trace yarn matches the mask
        return (yarnMask & tyMsk) !== 0;
      });
      if(domain.isEmpty())
        continue; // skip empty domains
      this.progDomains.push(domain); // store for unification
      
      // ensure the yarn is properly represented
      domain.eachDo(sprog => {
        // update the stack of back yarns
        this.allocateStitchYarn(sprog, yarns);
      });
    }
  }
  allocateStitchYarn(sprog, yarns){
    // basic allocation of yarn
    sprog.yarns((ys, s) => {
      ys.allocateYarns([ ...yarns, s.getTraceYarn() ]);
    });
  }
  mark(...args){
    // get list of active yarns
    const yarns = this.getYarns();
    if(!yarns.length)
      return; // nothing to do
    // allocate yarn domains
    this.allocateYarns(this.prog, yarns);
    // do the normal front marking that depends on the parent
    super.mark(...args);
  }

  unify(/* layers */){
    // explicit miss type
    const explicitMiss = this.getParam('missType') === EXPLICIT;
    for(const nprog of this.progDomains){
      nprog.each(s => {
        if(s.getProgram() !== 0)
          return; // already user-programed
        // unification = program from stitch type only
        const yarnStack = s.getYarnStack();
        const yarnMask = yarnStack.yarnMask;
        // compute yarns to insert (only for first in step bundle)
        const insertYarns = MultiYarnPattern.getInsertYarns(s, yarnMask);
        // compute yarns to remove (only for last in step bundle)
        const removeYarns = MultiYarnPattern.getRemoveYarns(s, yarnMask);
        // topological transition
        const topoXform = MultiYarnPattern.getTopologicalTransform(s);

        // get associated program
        const progId = MultiYarnPattern.getProgramId(
          s.getStitchType(), s.getShapingAction(), s.getYarnStack(),
          insertYarns, removeYarns, topoXform, {
            explicitMiss
          }
        );
        s.setProgram(progId, true);
      });
    }
  }

  static getProgramId(
    stitchType, shapingType, yarnStack,
    insertYarns, removeYarns, topoXform, {
    explicitMiss = false
  } = {}){
    // get yarns => necessary number of passes
    const yarns = Array.from(yarnStack.yarns).sort((a,b) => a-b);
    // XXX would be great if the user had a choice of the pass orders
    // so that they can control which yarn is in front w.r.t. tucks

    // shaping aliases
    if(shapingType === Action.MISS)
      stitchType = MISS;

    // computate action with its passes, while coding the name
    // so we don't repeatedly create the same program, but reuse it
    // -------------------------------------------------------------
    // 1 = pre pass = yarn insertion, then pre-action --------------
    // -------------------------------------------------------------
    const pre = ({ k, d, n, rn, e }) => {
      // i) insert yarns
      if(insertYarns.length){
        // insert the yarns
        // XXX this probably does not work well for more than two yarns
        const id = env.global.insertDepth || 3;
        k.inhook(insertYarns);
        if(id === 3){
          k.tuck(d, n, insertYarns);
          k.tuck(d, e.stepNeedle(2), insertYarns);
          k.tuck(-d, e.stepNeedle(1), insertYarns);
        } else {
          k.tuck(-d, e.stepNeedle(id), insertYarns);
          for(let i = id - 1; i > 0; i -= 2){
            k.tuck(d, e.stepNeedle(i - 1), insertYarns);
            k.tuck(-d, e.stepNeedle(i), insertYarns);
          }
        }
        k.releasehook(insertYarns);
      }
      // ii) pre-transfer
      if(stitchType === PURL){
        k.xfer(n, rn);
      }
    };
    const preId = [
      insertYarns.length ? 'in:' + insertYarns.join(':') : '',
      stitchType === PURL ?  'xfer' : ''
    ].join(':');

    // -------------------------------------------------------------
    // 2 = main passes = one per yarn ------------------------------
    // -------------------------------------------------------------
    const extra = topoXform === TWO_TO_ONESIDED ? 1 : 0;
    const main = new Array(yarns.length + extra);
    const mainIds = new Array(yarns.length + extra);
    const quarterRacking = new Array(yarns.length + extra);
    let frontPass = 0;
    for(const [i, yarn] of yarns.entries()){
      const isFront = yarnStack.hasFrontYarn(yarn);
      const front = isFront ? (stitchType || KNIT) : 0;
      const back  = yarnStack.getBackYarnAction(yarn - 1);
      const context = {
        carriers: [ yarn.toString() ],
        meta: isFront
      };
      if(isFront)
        frontPass = i;

      // set default flag
      quarterRacking[i] = false; // by default

      // different cases:
      // - 1-to-2-sided = disregard action on first pass
      if(i === 0 && topoXform === ONE_TO_TWOSIDED){
        // double-sided knit (for jacquard knitting)
        quarterRacking[i] = true; // requires racking by 0.25
        main[i] = Action.FBKnitFunc(context);
        mainIds[i] = 'fb' + yarn;

      } else
      // - 2-to-1-sided = disregard action on last pass
      if(i === yarns.length - 1 && topoXform === TWO_TO_ONESIDED){
        // i) pass of transfers from back to front (like purl back)
        main[i] = Action.XferFunc({ backward: true });
        mainIds[i] = 'xf' + yarn;
        // ii) full knitting with last yarn
        main[i+1] = Action.KnitFunc(context);
        mainIds[i+1] = 'k' + yarn;

      } else
      // - kickback shaping
      if(isFront && shapingType === Action.KICKBACK){
        main[i] = Action.KickbackFunc(context);
        mainIds[i] = 'kb' + yarn;

      } else
      // - split shaping
      if(isFront && shapingType === Action.SPLIT){
        main[i] = Action.SplitFunc(context);
        mainIds[i] = 'p' + yarn;

      } else
      // - rsplit shaping
      if(isFront && shapingType === Action.RSPLIT){
        main[i] = Action.RSplitFunc(context);
        mainIds[i] = 'rs' + yarn;

      } else
      // - no-op
      if([EMPTY, MISS].includes(front)
      && [BYARN_NONE, BYARN_MISS].includes(back)){
        // no-op, just floating
        if(explicitMiss){
          main[i] = Action.MissFunc(context);
          mainIds[i] = 'M' + yarn;
        } else {
          main[i] = Action.noop;
          mainIds[i] = 'm' + yarn;
        }

      } else
      // - single front knit
      if(FRONT_KNITS.includes(front)
      && back !== BYARN_KNIT){
        // front knit, for specific yarn
        main[i] = Action.KnitFunc(context);
        mainIds[i] = 'k' + yarn;

      } else
      // - front/back knit
      if(FRONT_KNITS.includes(front)
      && back === BYARN_KNIT){
        // double-sided knit (for jacquard knitting)
        quarterRacking[i] = true; // requires racking by 0.25
        main[i] = Action.FBKnitFunc(context);
        mainIds[i] = 'fb' + yarn;

      } else
      // - purl
      if(front === PURL || back === BYARN_KNIT){
        // knit on reverse needle, for specific yarn
        main[i] = Action.BKnitFunc(context);
        mainIds[i] = 'p' + yarn;

      } else
      // - front tuck, for specific yarn
      if(front === TUCK || back === BYARN_TUCK){
        // tuck on front needle
        main[i] = Action.TuckFunc(context);
        mainIds[i] = 't' + yarn;

      } else {
        // what can lead to here?
        assert.error('Unification impossible', yarn, front, back);
        // provide fallback so we get some execution (although dangerous)
        const cs = [ yarn.toString() ];
        main[i] = ({ k, d, n }) => {
          k.knit(d, n, cs).setComment(-1, 'dangerous');
        };
        mainIds[i] = '?' + yarn;
      }
    }

    // -------------------------------------------------------------
    // 3 = post pass = post-action, then yarn removal --------------
    // -------------------------------------------------------------
    const post = ({ k, n, rn, move }) => {
      // i) post-transfers
      switch(stitchType){
        case PURL:    k.xfer(rn, n); break;
        case MOVE_L1: move(-1); break;
        case MOVE_R1: move(+1); break;
      }
      // ii) remove yarn
      if(removeYarns.length){
        // remove the yarns
        k.outhook(removeYarns);
      }
    };
    const postId = [
      [PURL, MOVE_L1, MOVE_R1].includes(stitchType) ? 'xfer:' + codeToChar(stitchType) : '',
      removeYarns.length ? 'out:' + removeYarns.join(':') : ''
    ].join(':');

    // register action, reusing program name
    const progName = [
      preId,
      mainIds.join(':'),
      postId
    ].join(':');
    return Action.register({
      pre, main, post,
      // require split-by-side if we have pre- or post-transfers
      splitBySide: [PURL, MOVE_L1, MOVE_R1].includes(stitchType),
      quarterRacking, frontPass
    }, progName).progId;
  }

  static getInsertYarns(s, yarnMask = 0){
    const pts = s.getPrev();
    if(!pts)
      return []; // skip actual yarn start stitch
    if(pts.pass === s.pass)
      return []; // skip stitches that are not starting a new step
    if(s.isShortRow())
      return []; // skip short-rows stitches (do not start steps!)
    if(!yarnMask)
      yarnMask = s.getYarnStack().yarnMask;
    // compute yarn difference, but not with previous stitch
    // instead, use its underlying lower course stitch
    const lcs = pts.getLowerCourseStitch();
    const prevMask = lcs.getYarnStack().yarnMask;
    if(prevMask === yarnMask)
      return []; // no possible yarn to insert
    // compute yarn difference
    const diffMask = yarnMask & (~prevMask);
    return asFYarnList(diffMask);
  }

  static getRemoveYarns(s, yarnMask = 0){
    const nts = s.getNext();
    if(!nts)
      return []; // skip actual yarn end stitch
    if(nts.pass === s.pass)
      return []; // skip stitches that are not ending a step
    if(nts.isShortRow())
      return []; // skip transition to short-row stitches
    if(!yarnMask)
      yarnMask = s.getYarnStack().yarnMask;
    const nextMask = nts.getYarnStack().yarnMask;
    if(nextMask === yarnMask)
      return []; // no possible yarn to remove
    // compute yarn difference
    const diffMask = yarnMask & (~nextMask);
    return asFYarnList(diffMask);
  }

  static getTopologicalTransform(s){
    if(!s.isTwoSided())
      return false; // no transform to do
    // else it's two-sided => check before and after
    let flags = 0;
    prev: {
      const ps = s.getPrevWales()[0];
      if(ps && !ps.isTwoSided())
        flags |= ONE_TO_TWOSIDED;
    }
    next: {
      const ns = s.getNextWales()[0];
      if(ns && !ns.isTwoSided())
        flags |= TWO_TO_ONESIDED;
    }
    return flags;
  }

}

module.exports = Object.assign(MultiYarnPattern, {
  // miss mode
  IMPLICIT, EXPLICIT
});