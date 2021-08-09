// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { CASTON_STITCH } = require('../../knitout/knitout.js');
const { ActivePass, CASTON_PASS } = require('./fragment.js');

// constants
const INTERLOCK = 'interlock';
const KICKBACK  = 'kickback';

/**
 * A cast-on knitting pass
 */
class CastOnPass extends ActivePass {
  constructor(castonSettings, castOnType = INTERLOCK){
    super(castonSettings, CASTON_PASS);
    assert(this.numEntries > 1,
      'Cannot cast on single or empty sequence');
    this.castOnType = castOnType;
  }

  get stitchNumber(){ return CASTON_STITCH; }

  cast(k, i, backward = false){
    this.entry(i).knit(k, backward);
  }

  generate(k, state){
    const N = this.numEntries;
    assert(N > 1,
      'Cannot cast on single or empty sequence of needles');
    switch(this.castOnType){
      case KICKBACK: return this.kickbackCastOn(k, state);
      default: return this.interlockCastOn(k, state);
    }
  }

  interlockCastOn(k /*, state */){
    const N = this.numEntries;
    // casting depends on structure type
    if(this.step.circular){
      // circular caston by half-knitting twice over the circle
      const startIdx = 0;
      for(let i = startIdx; i < N; i += 2)
        this.cast(k, i); // first pass
      for(let i = 1 - startIdx; i < N; i += 2)
        this.cast(k, i); // second pass
      
    } else {
      // flat caston by half-knitting back and forth
      for(let i = 0; i < N; i += 2)
        this.cast(k, i); // forward pass
      const lastIdx = N - 1;
      const backStartIdx = lastIdx % 2 === 0 ? lastIdx - 1 : lastIdx;
      for(let i = backStartIdx; i >= 0; i -= 2)
        this.cast(k, i, true); // backward pass
    }
  }

  kickbackCastOn(k /*, state */){
    const N = this.numEntries;
    if(this.step.circular
    && N > 4){
      for(let i = 1; i < N; ++i){
        this.cast(k, (i + N - 3) % N);
        this.cast(k, (i + N - 2) % N);
        this.cast(k, i);
        this.cast(k, (i + N - 1) % N, true);
      }
      
    } else {
      // default
      this.interlockCastOn(k);
    }
  }
}

module.exports = Object.assign(CastOnPass, {
  INTERLOCK,
  KICKBACK
});