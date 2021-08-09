// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const K = require('./knitout.js');
const { Needle } = K;

/**
 * Block of knitout instructions
 */
class Block {
  constructor(index = 0){
    this.index      = index;
    this.racking    = 0;
    this.direction  = K.NONE;
    this.carriers   = [];
    this.actions    = [];
    this.pointers   = [];
    // conflict offset cache
    this.frontOffsets = new Set();
  }
  get firstPtr(){ return this.pointers[0]; }
  get lastPtr(){ return this.pointers[this.pointers.length - 1]; }
  get length(){ return this.actions.length; }

  next(){
    const b = new Block(
      this.index + 1,
      this.startPtr + this.actions.length
    );
    // state carry
    b.racking = this.racking;
    // b.dir = this.dir;
    // b.carriers = this.carriers;
    return b;
  }

  copy(){
    const b = new Block(this.index);
    b.racking   = this.racking;
    b.direction = this.direction;
    b.carriers  = this.carriers;
    b.actions   = this.actions;
    b.pointers  = this.pointers;
    return b;
  }

  pointer(index = 0){ return this.pointers[index]; }
  opcode(index = 0){ return this.actions[index][0]; }

  endRacking(){
    if(this.opcode() === K.RACK)
      return this.actions[0][1]; // return rack operation's argument
    else
      return this.racking; // return the initial racking (since it does not change)
  }
  add(entry, pointer){
    assert(typeof pointer === 'number' && pointer >= 0,
      'Invalid pointer argument');
    this.actions.push(entry);
    this.pointers.push(pointer);
  }

  matchesCarriers(cs){
    assert(Array.isArray(cs), 'Carrier argument must be an array', cs);
    // special cases
    if(cs === this.carriers) return true;
    if(!cs || !this.carriers) return false;
    if(cs.length !== this.carriers.length) return false;
    // else, check all members
    for(let i = 0; i < cs.length; ++i){
      if(cs[i] !== this.carriers[i])
        return false; // found a difference!
    }
    return true; // all the same
  }
  firstAction(){ return this.actions[0]; }
  lastAction(){ return this.actions[this.actions.length - 1]; }
  firstNeedle(){
    const act = this.firstAction();
    return act ? act.find(a => a instanceof Needle) : null;
  }
  needlesOf(index){
    const act = this.actions[index];
    if(!act)
      return [];
    // /!\ if the action exists
    // then it must have a needle argument
    // else, it's in a block without needles
    //
    // w/ needle(s):
    //  knit/tuck/split/miss
    //  drop/amiss/xfer
    //
    return act.filter(a => a instanceof Needle);
  }
  lastNeedles(){ return this.needlesOf(this.length - 1); }
  lastNeedle(){
    const act = this.lastAction();
    return act ? act.find(a => a instanceof Needle) : null;
  }

  lastFrontOffset(){
    const ns = this.lastNeedles();
    if(ns.length){
      // if multiple needles, they should all have the same
      // offset w.r.t. the front bed
      const n0 = ns[0];
      const frontOffset = n0.frontOffset(this.racking);
      for(let i = 1; i < ns.length; ++i)
        assert(ns[i].frontOffset(this.racking) === frontOffset, 'A needle does not match racking offset', ns, this.racking);
    } else {
      // no offset available
      return NaN;
    }
  }

  recordOffset(n){
    assert(n instanceof Needle, 'Invalid needle argument', n);
    const offset = n.frontOffset(this.racking);
    this.frontOffsets.add(offset);
  }

  hasNeedleConflict(n){
    assert(n instanceof Needle, 'Invalid needle argument', n);
    const offset = n.frontOffset(this.racking);
    return this.frontOffsets.has(offset);
  }

  hasDirectionConflict(n){
    assert(n instanceof Needle, 'Invalid needle argument', n);
    const pn = this.lastNeedle();
    if(!pn)
      return false;
    // if we have a previous needle
    // then the move to the new needle should match
    // the current block direction
    const d = Math.sign(
      n.frontOffset(this.racking) - pn.frontOffset(this.racking)
    );
    return this.direction !== d;
  }

  getNeedleOffsetRange(){
    // /!\ this does not take racking into account!
    let min = Infinity;
    let max = -Infinity;
    for(const entry of this.actions){
      for(const arg of entry){
        if(arg instanceof Needle){
          min = Math.min(min, arg.offset);
          max = Math.max(max, arg.offset);
        }
      }
    }
    return { min, max };
  }

  static getBlocksFrom(k){
    const blocks = [];
    // compute blocks on the way
    let currBlock = new Block();
    const yieldBlock = () => {
      blocks.push(currBlock);
      currBlock = currBlock.next();
    };
    for(let i = 0; i < k.length; ++i){
      const entry = k.getEntry(i);
      const comment = k.getComment(i);
      const meta  = k.getMetadata(i);
      // decompose entry
      const [op, ...args] = entry;
      const signature = K.OPERATIONS[op];
      switch(op){
        // single-block operations
        case K.NOOP:
          if(!comment && !meta)
            continue; // skip empty lines
          /* falls through */
        case K.IN:
        case K.INHOOK:
        case K.RELEASEHOOK:
        case K.OUT:
        case K.OUTHOOK:
        case K.SPLIT:
        case K.PAUSE:
          if(currBlock.length)
            yieldBlock(); // yield previous block
          currBlock.add(entry, i);
          // states
          for(let j = 1, a = 0; j < signature.length; ++j, ++a){
            const atype = signature[j];
            switch(atype){
               case K.DIRECTION:
                currBlock.direction = args[a];
                break;
              case K.CARRIERS:
                currBlock.carriers = args[a];
                break;
              case K.NEEDLE:
                currBlock.recordOffset(args[a]);
                break;
              default:
                break;
            }
          }
          yieldBlock(); // yield this singleton block
          break;

        // state-carrying operation that is visualized
        case K.RACK:
          if(currBlock.length)
            yieldBlock();
          currBlock.add(entry, i);
          yieldBlock();
          // impact next block
          currBlock.racking = args[0];
          break;

        // block operations (with carrier)
        // op d n cs
        case K.KNIT:
        case K.TUCK:
        case K.MISS: {
          const [d, n, cs] = args;
          // create a new block if
          // - current is non-empty AND
          // - one of either
          //   - different carriers
          //   - different direction
          //   - needle has already an associated action (either on this bed, or another other side)
          // for non-empty blocks
          // note: actions as [op, d, n, cs] => n is a[2]
          if(currBlock.length){
            if(currBlock.direction !== d
            || !currBlock.matchesCarriers(cs)
            || currBlock.hasDirectionConflict(n)
            ){
              yieldBlock(); // because different
            }
          }
          // if on a new block, set carriers + direction
          if(!currBlock.length){
            // set block properties
            currBlock.carriers = cs;
            currBlock.direction = d;
          }
          // add entry to block
          currBlock.add(entry, i);
          // record new front offset
          currBlock.recordOffset(n);

        } break;

        // block operations (without carrier)
        // op n [n2]
        case K.DROP:
        case K.AMISS:
        case K.XFER: {
          const ns = args;
          if(currBlock.length){
            if(currBlock.direction !== K.NONE
            || currBlock.carriers.length
            || ns.some(n => currBlock.hasNeedleConflict(n))){
              yieldBlock();
            }
          }
          // if on a new block, set carriers + direction
          if(!currBlock.length){
            currBlock.carriers  = [];
            currBlock.direction = K.NONE;
          }
          // add entry to block
          currBlock.add(entry, i);
          // record new front offsets
          for(const n of ns)
            currBlock.recordOffset(n);
        } break;

        default:
          // unsupported
          break;
      }
    } // endfor i < #k

    // yield last block
    if(currBlock.length)
      yieldBlock();

    // return list of blocks
    return blocks;
  }
}

module.exports = Block;
