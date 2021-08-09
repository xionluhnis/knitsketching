// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { CASTON_STITCH } = require('../../knitout.js');
const {
  ActivePass,
  YARNSTART_PASS,
  YARNEND_PASS
} = require('./fragment.js');

/**
 * A yarn insertion pass
 */
class YarnStartPass extends ActivePass {
  constructor(passSettings, insertDepth = 3){
    super(passSettings, YARNSTART_PASS);
    this.insertDepth = insertDepth || 3;
    assert(this.numEntries > 1,
      'Cannot start yarn before single or empty sequence');
    assert(this.insertDepth > 0,
      'Insertion depth must be positive');
  }

  get stitchNumber(){ return CASTON_STITCH; }

  generate(k /*, state */){
    // XXX provide different options
    const N = this.numEntries;
    assert(N > 1,
      'Cannot cast on single or empty sequence of needles');
    
    // extracted variables
    const dirs = this.dirs;
    const nbs = this.actIndex.map(i => this.needles[i]);
    const cs = this.yarns;
    
    // insert yarn from hook
    k.inhook(cs);
    
    // initial tucks
    switch(N){
  
      case 1:
        k.tuck(dirs[0], nbs[0], cs);
        k.tuck(-dirs[0], nbs[0].shiftedBy(-2), cs);
        k.tuck(dirs[0], nbs[0].shiftedBy(-1), cs);
        // XXX this requires clearing the bed later!
        break;
  
      case 2:
        k.tuck(dirs[0], nbs[0], cs);
        if(nbs[0].side !== nbs[1].side)
          k.tuck(dirs[1], nbs[1], cs); // any direction from second
        else
          k.tuck(-dirs[0], nbs[1], cs); // reverse direction from first
        k.tuck(dirs[0], nbs[0], cs);
        break;

      case 3:
        k.tuck(dirs[0], nbs[0], cs);
        if(nbs[0].side !== nbs[2].side)
          k.tuck(dirs[2], nbs[2], cs);
        else
          k.tuck(-dirs[0], nbs[2], cs);
        k.tuck(dirs[1], nbs[1], cs);
        break;
  
      default: {
        let i = Math.min(nbs.length - 1, this.insertDepth);
        k.tuck(dirs[i], nbs[i], cs);
        for(let d = i - 2; d > 0; d -= 2){
          i = Math.max(1, d);
          // new tuck
          const fromDiffSide = nbs[i].side !== nbs[i+2].side;
          if(fromDiffSide)
            k.tuck(dirs[i], nbs[i], cs); // direction does not matter
          else
            k.tuck(-dirs[i+2], nbs[i], cs); // need reverse from previous
          // intermediate tuck
          k.tuck(dirs[i+1], nbs[i+1], cs);
        }
      } break;
    }

    // yarn release
    k.releasehook(cs);
  }
}

/**
 * A yarn removal pass with optional tail
 */
class YarnEndPass extends ActivePass {
  constructor(passSettings, useTail = null){
    super(passSettings, YARNEND_PASS);
    // by default, use a tail if all stitches need cast-off
    if(useTail === null)
      this.useTail = this.stitches.every(s => s.needsCastOff());
    else
      this.useTail = useTail;
    assert(this.numEntries > 1,
      'Cannot start yarn before single or empty sequence');
  }

  generate(k /*, state */){
    // XXX what about partial yarn removal?

    // get last needle entry
    const last = this.lastEntry;

    // create small tail for more easily hand-knot
    if(this.useTail && last){
      for(let i = 0, bwd = true; i < 5; ++i, bwd = !bwd)
        last.knit(k, bwd);
    }

    // bring yarn back to hook and cut
    k.outhook(this.yarns);

    // drop pending needle of tail
    if(this.useTail && last)
      k.drop(last.needle);
  }
}

module.exports = {
  YarnStartPass,
  YarnEndPass
};