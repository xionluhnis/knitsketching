// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { ActivePass, CASTOFF_PASS } = require('./fragment.js');
const { CASTOFF_STITCH } = require('../../knitout.js');
const xfer = require('../../knitout/transfer.js');

/**
 * A castoff knitting pass
 */
class CastOffPass extends ActivePass {
  constructor(castoffSettings, {
    usePickUpStitch = true
  }){
    super(castoffSettings, CASTOFF_PASS);
    this.usePickUpStitch = usePickUpStitch;
    assert(this.numEntries > 1,
      'Cannot cast off single or empty sequence');
  }

  get stitchNumber(){ return CASTOFF_STITCH; }

  cast(k, i, backward = false){
    const e = this.entry(i);
    e.knit(k, backward);
    k.setMetadata(-1, e.stitch.index);
  }

  generate(k, state){
    // XXX provide different options
    const N = this.numEntries;
    assert(N > 1,
      'Cannot cast off single or empty sequence of needles');
    const withTuck = this.usePickUpStitch;
    const tucks = []; // to be dropped at the end
    for(const curr of this.entries()){
      // cast tuck on previous action entry
      if(withTuck && curr.hasPrev()){
        const prev = curr.prev();
        prev.tuck(k);
        tucks.push(prev.needle);
      }
      // knit current entry
      curr.knit(k);
  
      // find next needle
      let nextNeedle;
      if(curr.hasNext())
        nextNeedle = curr.nextNeedle;
      else {
        // find next needle (outside of list)
        const lts = curr.stitch;
        const nts = lts.getNext();
        if(nts){
          nextNeedle = this.findNeedleOf(nts, state);
        } // endif nts
      } // endif else
  
      // do move to next needle if any
      if(nextNeedle){
        // the move goes in the same orientation as the knitting
        // => if on the same side, we always get a carrier conflict
        // => use an explicit kickback
        const currNeedle = curr.needle;
        if(nextNeedle.side === currNeedle.side){
          k.miss(
            -curr.dir, currNeedle,
            curr.carriers
          ).setComment(-1, 'castoff kickback');
        }
  
        // flush state so move knows where the carriers are
        k.flush();
  
        // actual move
        xfer.singleMove(k, currNeedle, nextNeedle, state);
      }
    }
  
    // ensure we clear all the tucks
    for(const n of tucks)
      k.drop(n);
  }
}

module.exports = CastOffPass;