// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');

class ListNode {
  constructor(elem, prev, next){
    this.elem = elem;
    this.prev = prev;
    this.next = next;
  }

  insertBefore(elem){
    const node = new ListNode(elem, this.prev, this);
    this.prev = node;
    return node;
  }

  insertAfter(elem){
    const node = new ListNode(elem, this, this.next);
    this.next = node;
    return node;
  }
}

class LinkedList {
  constructor(list){
    this.head = null;
    this.tail = null;
    this.length = 0;

    if(list && list.length){
      for(const elem of list)
        this.pushBack(elem);
    }
  }

  pushFront(elem){
    if(this.length){
      this.head = this.head.insertBefore(elem);
    } else {
      this.head = this.tail = new ListNode(elem, null, null);
    }
    this.length += 1;
  }

  pushBack(elem){
    if(this.length){
      this.tail = this.tail.insertAfter(elem);
    } else {
      this.head = this.tail = new ListNode(elem, null, null);
    }
    this.length += 1;
  }

  front(){
    return this.head ? this.head.elem : null;
  }

  back(){
    return this.tail ? this.tail.elem : null;
  }

  popFront(){
    const elem = this.front();
    if(this.length > 1){
      this.head = this.head.next;
      this.head.prev = null;
      this.length -= 1;

    } else if(this.length === 1){
      this.head = this.tail = null;
      this.length = 0;

    } else {
      // this.length <= 0
      assert.error('Cannot pop empty list');
    }
    return elem;
  }

  popBack(){
    const elem = this.back();
    if(this.length > 1){
      this.tail = this.tail.prev;
      this.tail.next = null;
      this.length -= 1;

    } else if(this.length === 1){
      this.head = this.tail = null;
      this.length = 0;

    } else {
      // this.length <= 0
      assert.error('Cannot pop empty list');
    }
    return elem;
  }
}

module.exports = LinkedList;
