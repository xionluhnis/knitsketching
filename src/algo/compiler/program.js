// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { Knitout, streamSimulation } = require('../../knitout.js');
const ProgramFragment = require('./fragment.js');

/**
 * Conceptual fragment that delimits a specific knitting event
 * 
 * @property {boolean} isRoot whether this is the start of the program
 * @property {string} event the event type
 * @property {any} data the event-related data
 * @property {string?} label an event label for code annotation
 */
class EventPass extends ProgramFragment {
  constructor({
    parent,
    event, data = null, label = null
  }, isRoot = false){
    super(parent, ProgramFragment.EVENT_PASS);
    // context
    this.isRoot = isRoot;
    this.event  = event;
    this.data   = data;
    this.label  = label;
  }

  get stitchNumber(){ return -1; /* no stitch consideration */ }

  generate(k /*, state */){
    if(this.label)
      k.addComment(this.label);
    // else it does not generate any knitout code
  }

  insertPrev(fragment, fireEvent = true){
    if(this.isRoot)
      assert.error('Cannot insert fragment before the root fragment');
    else
      super.insertPrev(fragment, fireEvent);
  }
}

class KnittingProgram {
  constructor(trace){
    // output
    this.rootFragment = new EventPass({
      event: 'start', parent: this
    }, true);
    this.tailFragment = this.rootFragment;
    this.output = new Knitout.Stream();

    // internal
    this.trace = trace; // for the simulation loop data
    /** @type { KnittingMachineState } */
    this.state      = streamSimulation(this.output, idx => {
      // return traced stitch if any associated
      const meta = this.output.getMetadata(idx);
      if(meta >= 0)
        return this.trace.getTracedStitchAt(meta);
      return null;
    });
    this.hooks = new Set();
  }
  get first(){ return this.rootFragment; }
  get last(){
    assert(this.tailFragment, 'Missing tail fragment');
    while(this.tailFragment.next)
      this.tailFragment = this.tailFragment.next;
    return this.tailFragment;
  }
  size(){
    let count = 1;
    let last = this.rootFragment;
    while(last.next){
      ++count;
      last = last.next;
    }
    return count;
  }
  allocate(instrCount){
    assert(instrCount > 0, 'Invalid allocation argument');
    this.output.allocate(instrCount);
  }
  build(fragment, verbose = true){
    assert(fragment.program() === this,
      'Fragment does not belong to this program');
    fragment.build(this.output, this.state, verbose);
  }

  /**
   * Add a fragment callback
   * 
   * @param {Function} f the callback upon new program fragment
   */
  addHook(hook){
    assert(hook instanceof KnittingProgramHook,
      'Invalid hook argument');
    this.hooks.add(hook);
  }

  fireFragmentEvent(fragment){
    for(const hook of this.hooks)
      hook.handle(fragment);
  }

  addFragment(fragment){
    this.last.insertNext(fragment);
  }

  addEvent(event, data = null, label = null){
    this.addFragment(new EventPass({
      parent: this, event, data, label
    }));
  }
}

class KnittingProgramHook {
  handle(/* fragment */){
    // implements the hook effect
  }
}

class KnittingProgramModifier {
  constructor(){}

  matches(/* fragment */){
    // needs to be updated to select fragments of interest
    return false;
  }
}

module.exports = Object.assign(KnittingProgram, {
  Hook: KnittingProgramHook,
  Modifier: KnittingProgramModifier
});