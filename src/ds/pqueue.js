// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const { FibonacciHeap } = require('@tyriar/fibonacci-heap');
const pq = require('pairing-heap');

class MapStorage {
  constructor(){
    this.map = new Map();
  }
  get(data){
    return this.map.get(data);
  }
  set(data, node){
    this.map.set(data, node);
  }
}
class ArrayStorage {
  constructor(N){
    this.arr = new Array(N);
    assert(typeof N === 'number', 'Storage capacity must be a number');
  }
  get(idx){
    return this.arr[idx];
  }
  set(idx, node){
    this.arr[idx] = node;
  }
}

class FibQueue {
  constructor(N = 0){
    this.nodes = N ? new ArrayStorage(N) : new MapStorage();
    this.heap = new FibonacciHeap((n1, n2) => n1.key - n2.key);
  }
  isEmpty(){ return this.heap.isEmpty(); }
  insert(i, priority){
    const node = this.heap.insert(priority, i);
    this.nodes.set(i, node);
    return this;
  }
  decrease(i, newPriority){
    const node = this.nodes.get(i);
    this.heap.decreaseKey(node, newPriority);
    return this;
  }
  pop(withPriority = false){
    const node = this.heap.extractMinimum();
    return withPriority ? [node.value, node.key] : node.value;
  }
  top(withPriority = false){
    const node = this.heap.findMinimum();
    return withPriority ? [node.value, node.key] : node.value;
  }
}

class PairingQueue {
  constructor(N = 0){
    this.nodes = N ? new ArrayStorage(N) : new MapStorage();
    this.heap = pq.NIL;
  }
  isEmpty(){ return this.heap === pq.NIL; }
  insert(i, priority){
    const node = pq.create(priority);
    // register data into node and node itself
    node.data = i;
    this.nodes.set(i, node);
    // update heap by merging the two nodes
    this.heap = pq.merge(node, this.heap);
    return this;
  }
  decrease(i, newPriority){
    const node = this.nodes.get(i);
    node.weight = newPriority;
    this.heap = pq.decreaseKey(this.heap, node);
    return this;
  }
  pop(withPriority = false){
    const data = this.heap.data;
    const priority = this.heap.weight;
    this.heap = pq.pop(this.heap);
    return withPriority ? [data, priority] : data;
  }
  top(withPriority = false){
    return withPriority ? [this.heap.data, this.heap.weight] : this.heap.data;
  }
}

module.exports = {
  // priority queues
  FibQueue,
  PairingQueue,
  // node storages
  MapStorage,
  ArrayStorage
};