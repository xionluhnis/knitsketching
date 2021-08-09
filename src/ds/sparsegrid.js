// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');

class SparseGrid {
  constructor(width, height){
    this.width = width;
    this.height = height;
    this.data = {};
  }

  reset(){
    this.data = {};
  }

  keys(){
    return Object.keys(this.data).map(index => {
      return {
        x: index % this.width,
        y: Math.floor(index / this.width)
      };
    });
  }

  entries(){
    return Object.keys(this.data).map(index => {
      return [
        {
          x: index % this.width,
          y: Math.floor(index / this.width)
        }, 
        this.data[index]
      ];
    });
  }

  values(){
    return [...new Set(Object.values(this.data))];
  }

  index(y, x){
    return y * this.width + x;
  }

  has(y, x){
    return this.index(y, x) in this.data;
  }

  set(y, x, v){
    this.data[this.index(y, x)] = v;
  }

  get(y, x){
    return this.data[this.index(y, x)];
  }

  remove(y, x){
    delete this.data[this.index(y, x)];
  }

  loadData(data){
    Object.assign(this.data, data);
    return this;
  }

  toData(minimal){
    return minimal ? this.data : this;
  }

  static fromData(gridData){
    assert('width' in gridData && 'height' in gridData && 'data' in gridData, 'Missing grid size information');
    return new SparseGrid(gridData.width, gridData.height).loadData(gridData.data);
  }
}

module.exports = SparseGrid;
