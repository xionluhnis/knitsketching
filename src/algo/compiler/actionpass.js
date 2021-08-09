// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const Action = require('./action.js');
const { ActivePass, ACTION_PASS } = require('./fragment.js');
const ShapingPass = require('./shaping.js');

/**
 * A knitting action pass
 */
class ActionPass extends ActivePass {
  constructor(passSettings, {
    useCSE = true,
    multiTransfer = false,
    reduceTransfers = false,
    useSRTucks = false,
    intarsiaTucks = 'both',
    intarsiaSide = 'after',
    safeTucks = true,
    useSVS = false
  } = {}){
    super(passSettings, ACTION_PASS);
    // parameters
    this.useSRTucks     = useSRTucks;
    this.intarsiaTucks  = intarsiaTucks;
    this.intarsiaSide   = intarsiaSide;
    this.safeTucks      = safeTucks;
    this.useSVS         = useSVS;
    // transfer parameters
    this.useCSE         = useCSE;
    this.multiTransfer  = multiTransfer;
    this.reduceTransfers = reduceTransfers;
  }

  getOption(optName, min = false, def = Action.getOptionDefault(optName)){
    let value;
    for(const { action } of this.entries()){
      // if(action.isStandard())
      //   continue; // note: FBKnit is standard, but uses quarterRacking
      const prog = action.getProgram();
      if(prog.hasOption(optName)){
        if(min){
          if(value === undefined)
            value = !!prog[optName];
          else
            value &= !!prog[optName];
        } else
          value |= !!prog[optName];
      }
    }
    return value !== undefined ? value : def;
  }

  getPassOption(optName, pass, min = false){
    let value = min;
    for(const { action } of this.entries()){
      const prog = action.getProgram();
      let val = prog[optName];
      if(Array.isArray(val))
        val = val[pass]; // use value at given pass index
      if(min)
        value &= !!val;
      else
        value |= !!val;
    }
    return value;
  }

  generate(k, state){
    // check if the action pass is over short-row stitches
    // in which case we should use the fabric presser
    const usePresser = this.stitches.some(s => s.onShortRow());
    // check if we must split the entries by source side
    const splitBySide = this.getOption('splitBySide');
    if(!splitBySide){
      this.generatePasses(
        k, state, Array.from(this.entries()),
        usePresser
      );
    } else {
      // split by side
      const passes = [];
      for(const e of this.entries()){
        const lastPass = passes[passes.length - 1];
        if(!lastPass
        || lastPass[0].needle.side !== e.needle.side) {
          passes.push([e]); // create new pass
        } else {
          lastPass.push(e); // append to last pass
        }
      } // endfor e
      for(const entries of passes)
        this.generatePasses(k, state, entries, usePresser);
    } // endif splitBySide
  }

  applyMoves(k, state, entries, nmap){
    if(!nmap.size)
      return; // no move
    // must use a CSE transfer to apply moves
    const sources = this.needles;
    const targets = this.needles.map(n => {
      const key = n.toString();
      return nmap.has(key) ? nmap.get(key) : n;
    });
    const useCSEMoves = this.getOption('useCSEMoves', true);
    const xfer = new ShapingPass({
      stitches: this.stitches,
      sources, targets,
      halfGauge: this.halfGauge
    }, {
      useCSE: useCSEMoves,
      multiTransfer: this.multiTransfer,
      reduceTransfers: this.reduceTransfers
    });
    // apply transfer pass
    xfer.build(k, state, this.verbose);
  }

  generatePasses(k, state, entries, usePresser){
    this.sidePasses(k, state, entries, Action.PRE);
    this.mainPasses(k, state, entries, usePresser);
    this.sidePasses(k, state, entries, Action.POST);
  }

  sidePasses(k, state, entries, side){
    assert([Action.PRE, Action.POST].includes(side),
      'Invalid side pass', side);
    const numPre = entries.reduce((max, { action }) => {
      return Math.max(max, action.getNumPasses(side));
    }, 0);
    for(let pass = 0; pass < numPre; ++pass){
      const nmap = new Map(); // Map<str,Needle>
      for(const e of entries)
        e.action.exec(side, pass, k, e, state, nmap);
      this.applyMoves(k, state, entries, nmap);
    }
  }

  mainPasses(k, state, entries, usePresser){
    if(usePresser){
      k.xPresserMode('on');
    }
    const numMain = entries.reduce((max, { action }) => {
      return Math.max(max, action.getNumPasses(Action.MAIN));
    }, 0);
    let quarterRacking = this.getPassOption('quarterRacking', 0);
    for(let pass = 0; pass < numMain; ++pass){
      if(quarterRacking && state.racking !== 0.25){
        k.rack(0.25);
      }
      for(const e of entries){
        const { stitch, action, needle: n } = e;
        if(action.isStandard() && pass > 0)
          continue; // standard program only for first pass
        assert(n.inHook(), 'Actions cannot be on sliders');

        // split cases
        const isSplit = [Action.SPLIT, Action.RSPLIT].includes(action.progId);
        // base tuck check
        // - not when splitting
        // - only for the front yarn pass
        const mayTuck = !isSplit && action.getFrontPassIndex() === pass;

        // take care of prev-tuck (unless on split)
        if(mayTuck && stitch.hasPrevTuck())
          this.prevTuck(k, e, state, stitch);

        // execute action
        const userIdx = k.length;
        action.exec(Action.MAIN, pass, k, e, state, null, {
          svs: this.useSVS
        });
        // greedy automatic metadata (on first action)
        if(!action.isStandard()){
          // potential automatic metadata
          if(k.length > userIdx)
            k.setMetadata(userIdx, stitch.index);
        }

        // take care of next-tuck (unless on split)
        if(mayTuck && stitch.hasNextTuck())
          this.nextTuck(k, e, state, stitch);
      } // endfor e of entries()

      // release quarter racking if not continued
      const quarterRacked = quarterRacking;
      quarterRacking = this.getPassOption('quarterRacking', pass + 1);
      if(quarterRacked && !quarterRacking){
        k.rack(0); // reset racking
      }
    }
    // release presser if we used it
    if(usePresser)
      k.xPresserMode('off');
  }

  matchesSafeTuck(nn, state){
    // do not add tuck if the needle is empty
    const nextLoops = state.getNeedleLoops(nn);
    if(nextLoops.length === 0)
      return false; // no loop => never a good idea to tuck

    // safe tucking mode requires that we have exactly one loop
    return !this.safeTucks
        || nextLoops.length === 1;
  }
  matchesIntarsiaOrientation(stitch){
    // - none = do not tuck
    // - cw/ccw = only tuck in corresponding orientation
    // - both = tuck
    return this.intarsiaTucks === 'both'
        || (this.intarsiaTucks === 'cw' && stitch.isCW())
        || (this.intarsiaTucks === 'ccw' && stitch.isCCW());
  }

  nextTuck(k, e, state, stitch){

    // only tuck with the front yarn carrier
    /*
    const FYs = stitch.getFrontYarns();
    if(FYs.every(y => !state.lastCarriers.includes(y.toString())))
      return; // does not match front yarn carrier
    */

    // get next needle location in slice
    const nn = e.nextNeedle;
    if(!nn)
      return; // no next needle <=> beyond endpoint and not circular

    // safe tucking check
    if(!this.matchesSafeTuck(nn, state))
      return; // skip unsafe tuck
    
    // intarsia check
    const nstitch = e.nextStitch;
    assert(nstitch, 'Next needle but no next stitch?');
    if(stitch.getTraceYarn() !== nstitch.getTraceYarn()){
      // check sidedness
      if(this.intarsiaSide !== 'after')
        return; // tuck before first stitch instead
      // check the intarsia orientation mode
      if(!this.matchesIntarsiaOrientation(stitch))
        return;

    } else if(!this.useSRTucks){
      return; // skip short-row tucks
    }
    
    k.tuck(
      nn.orientationToDir(e.orientation),
      nn, e.carriers
    );
  }

  prevTuck(k, e, state, stitch){
    const pn = e.prevNeedle;

    // safe tucking check
    if(!this.matchesSafeTuck(pn, state))
      return; // skip unsafe tuck

    // intarsia checks
    // note: before-tucks only for intarsia
    const pstitch = e.prevStitch;
    if(this.intarsiaSide === 'before'
    && stitch.getTraceYarn() !== pstitch.getTraceYarn()
    && this.matchesIntarsiaOrientation(stitch)){
      // before tuck for intarsia, matching orientation
      // => do the tuck
      k.tuck(
        pn.orientationToDir(e.orientation),
        pn, e.carriers
      );
    }
    // else, no tuck
  }
}

module.exports = ActionPass;