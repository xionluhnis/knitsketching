// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');

// constants
const MIN_DOUBLING = 100;

class Queue {
  constructor(array){
    this.first = 0;
    this.data = array || [];
  }

  get length(){
    return this.data.length - this.first;
  }

  asArray(){
    return this.data.slice(this.first);
  }

  pack(){
    if(!this.first)
      return;
    assert(this.first <= this.data.length - 1, 'Invalid first location');
    this.data = this.data.slice(this.first);
    this.first = 0;
  }

  maypack(){
    // repack if above minimum threshold
    if(this.first >= MIN_DOUBLING && this.first > this.length / 2){
      // rebuild data array
      this.pack();
    }
  }

  sort(f){
    this.pack();
    this.data.sort(f);
    return this;
  }

  /**
   * Returns the element at the front of the queue
   *
   * @return the first element of the queue (or undefined / null)
   */
  head(){
    return this.data[this.first];
  }

  /**
   * Returns the element at the back of the queue
   *
   * @return the last element of the queue (or undefined / null)
   */
  tail(){
    return this.data[this.data.length - 1];
  }

  /**
   * Add a sequence of element at the back of the queue
   *
   * @param ...elements the elements to add at the back
   */
  enqueue(...elements){
    this.data.push(...elements);
    this.maypack();
  }

  /**
   * Remove the element at the front of the queue and return it, unless the queue was empty.
   *
   * Note that the queue explicitly removes the element from its data storage (so it can be freed).
   *
   * @return the element that was at the front (and is not anymore)
   */
  dequeue(){
    if(!this.length)
      return null;
    const prevLen = this.length;
    const elem = this.data[this.first];
    this.data[this.first] = null; // explicit freeing
    // empty case
    if(this.first === this.data.length - 1){
      // rebuild queue
      this.first = 0;
      this.data = [];
      return elem;
    }
    this.first += 1;
    this.maypack();
    assert(this.length === prevLen - 1,
      'Operation did not change the length correctly');
    return elem;
  }

  *[Symbol.iterator](){
    for(let i = this.first; i < this.data.length; ++i)
      yield this.data[i];
  }

  filter(pred){
    return new Queue(this.asArray().filter(pred));
  }
}

module.exports = Queue;
