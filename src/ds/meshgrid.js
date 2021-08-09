// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global ImageData */

// modules
const assert = require('../assert.js');

// constants
const M = {
  // types of grids
  U8:   'u8',
  U32:  'u32',
  // U64:  'u64',
  I8:   'i8',
  I32:  'i32',
  // I64:  'i64',
  F32:  'f32',
  F64:  'f64',
};

function checkIntArgs(...args){
  let allInts = true;
  for(let i = 0; i < args.length && allInts; ++i)
    allInts = Number.isInteger(args[i]);
  assert(allInts, 'Arguments must be integers', args);
}

/**
 * Packed regular mesh grid with multiple channels
 *
 * @param width the grid width
 * @param height the grid height
 * @param channels the number of channels
 * @param type the type of data (u8, u32, i8, i32, f32 or f64)
 */
class MeshGrid {
  constructor(width, height, channels, type, bare){
    assert(channels, 'No properties');
    this.length = width * height;
    this.width = width;
    this.height = height;
    this.type = type;
    this.channels = channels;
    if(!bare){
      this.data = MeshGrid.allocate(this.length * this.channels, type);
    }
  }

  dim(idx){
    if(idx === 0)
      return this.height;
    else if(idx === 1)
      return this.width;
    assert.error('Invalid dimension index', idx);
    return NaN;
  }

  static fromData(data){
    const grid = new MeshGrid(data.width, data.height, data.channels, data.type, true);
    grid.data = data.data; // XXX as-is or wrapped buffer within typed array?
    return grid;
  }

  copy(){
    const grid = MeshGrid.fromData(this);
    if(this.data){
      grid.data = MeshGrid.allocate(this.length * this.channels, this.type);
      grid.data.set(this.data);
    }
    return grid;
  }

  /**
   * Allocate a typed array
   *
   * @param N the length
   * @param type the type of array
   * @return a corresponding typed array
   */
  static allocate(N, type){
    switch(type){
      case M.U8:  return new Uint8Array(N);
      case M.U32: return new Uint32Array(N);
      // case M.U64: this.data = new BigUint64Array(N); break;
      case M.I8:  return new Int8Array(N);
      case M.I32: return new Int32Array(N);
      // case M.I64: this.data = new Int64Array(N); break;
      case M.F32: return new Float32Array(N);
      case M.F64: return new Float64Array(N);
      default: assert.error('Unsupported type', type);
    }
  }

  /**
   * Reset the values of this grid to an initial value
   *
   * @param value the initial value (defaults to 0)
   * @return this mesh grid
   */
  reset(value){
    if(value === undefined)
      value = 0;
    this.data.fill(value, 0, this.data.length);
    return this;
  }

  /**
   * Fill one channel with a value
   *
   * @param c the channel index
   * @param value the value (or 0 by default)
   */
  fill(c, value){
    if(value === undefined)
      value = 0;
    const k = this.channels;
    const N = this.data.length;
    for(let i = c; i < N; i += k)
      this.data[i] = value;
  }

  /**
   * Checks whether an index is valid
   */
  isValid(y, x, c = 0){
    checkIntArgs(y, x, c);
    // check channel if provided
    if(c && (c < 0 || c >= this.channels))
      return false;
    // else, just check (x,y) are within the grid
    return y >= 0 && x >= 0 && y < this.height && x < this.width;
  }

  /**
   * Get the linear grid index for a given location (y, x, c).
   * All arguments must be integers
   * 
   * @param {number} y the first index (or row index)
   * @param {number} x the second index (or column index)
   * @param {number} c the last index (or channel index)
   * @return {number} the corresponding linear index
   */
  index(y, x, c){
    assert(this.isValid(y, x, c), 'Out-of-bounds indexing');
    return (y * this.width + x) * this.channels + (c || 0);
  }

  /**
   * Compute the vector index for a given linear index.
   * The linear index must be an integer within data bounds.
   * 
   * @param {number} index a linear index into the data
   * @return {number[]} the vector index [y, x, c]
   */
  pos(index){
    assert(index >= 0 && index < this.data.length,
      'Out-of-bounds indexing');
    // compute position backward incrementally (using remainders)
    // index = (y * width + x) * channels + c
    const c = index % this.channels;
    index -= c; // index = (y * w + x) * ch
    index /= this.channels; // index = y * w + x
    const x = index % this.width;
    index -= x; // index = y * w
    const y = index / this.width;
    return [y, x, c];
  }

  /**
   * Get the value at a given grid index (y, x, c).
   * All arguments must be integers, else the access is invalid.
   */
  get(y, x, c){
    const idx = this.index(y, x, c);
    const v = this.data[idx];
    assert(v !== undefined, 'Invalid data access');
    return v;
  }

  getVec(y, x){
    const idx = this.index(y, x, 0);
    return Array.from({ length: this.channels }, (_, i) => this.data[idx + i]);
  }

  /**
   * Map a grid into a new grid
   *
   * @param mapFunc the function ([pixelVec]) => vec (or number) if single output channel
   * @param channels the expected output cardinality per pixel (defaults to 1)
   * @param type the expected type of the output
   * @return a new MeshGrid with matching channels, type and data from the mapping
   */
  map(mapFunc, channels, type){
    const grid = new MeshGrid(this.width, this.height, channels || 1, type || this.type);
    for(let y = 0; y < this.height; ++y){
      for(let x = 0; x < this.width; ++x){
        const curVec = this.getVec(y, x);
        const newVec = mapFunc(curVec, y, x);
        const idx = grid.index(y, x);
        if(Array.isArray(newVec)){
          for(let c = 0; c < grid.channels; ++c)
            grid.data[idx + c] = newVec[c];
        } else {
          assert(grid.channels == 1, 'Return value is a number, expected channels count is', grid.channels);
          grid.data[idx] = newVec;
        }
      } // endfor x
    } // endfor y
    return grid;
  }

  reduce(reduceFunc, initSum){
    for(let y = 0; y < this.height; ++y){
      for(let x = 0; x < this.width; ++x){
        initSum = reduceFunc(initSum, this.getVec(y, x), y, x);
      }
    }
    return initSum;
  }

  /**
   * Set the value v at a given grid index (y, x, c).
   * All arguments must be integers
   */
  set(y, x, c, v){
    const idx = this.index(y, x, c);
    this.data[idx] = v;
  }

  setRow(y, c, v){
    for(let x = 0; x < this.width; ++x)
      this.set(y, x, c, v);
  }
  setCol(x, c, v){
    for(let y = 0; y < this.height; ++y)
      this.set(y, x, c, v);
  }

  /**
   * Extract a 2d array for a given channel
   *
   * @param c the channel
   * @param transpose whether to transpose the output grid (switch y/x dimensions)
   * @return Array[height][width] for channel c (or Array[width][height] if transposing)
   */
  getGrid(c, transpose){
    checkIntArgs(c);
    if(transpose){
      return Array.from({ length: this.width }, (_, col) => {
        return Array.from({ length: this.height }, (_, row) => {
          return this.get(row, col, c);
        });
      });
    } else {
      return Array.from({ length: this.height }, (_, row) => {
        return Array.from({ length: this.width }, (_, col) => {
          return this.get(row, col, c);
        });
      });
    }
  }

  /**
   * Extract a sub grid as typed array
   *
   * @param c the channel
   */
  getSubArray(c){
    checkIntArgs(c);
    const data = MeshGrid.allocate(this.length, this.type);
    for(let i = 0; i < this.length; ++i)
      data[i] = this.data[i * this.channels + c];
    return data;
  }

  /**
   * Extract a grid channel as single-channel grid
   *
   * @param c the channel
   * @return MeshGrid { channels = 1 }
   */
  getSubGrid(c){
    checkIntArgs(c);
    const grid = new MeshGrid(this.width, this.height, 1, this.type);
    for(let i = 0; i < this.length; ++i)
      grid.data[i] = this.data[i * this.channels + c];
    return grid;
  }

  /**
   * Create canvas visualization for debugging
   *
   * @param vecToRGBA mapping for color value
   * @return a data URL
   */
  visualize(vecToRGBA, blobCallback = null){
    if(!vecToRGBA){
      assert(this.channels == 1, 'Default visualization only available for single-channel grids');
      const { min, max } = this.data.reduce(({ min, max }, val) => {
        if(isNaN(val))
          return { min, max }; // skip NaN values
        return { min: Math.min(min, val), max: Math.max(max, val) };
      }, { min: this.data[0] || 0, max: this.data[0] || 0 });
      vecToRGBA = ([v]) => {
        const gray = Math.max(0, Math.min(0xFF,
          Math.round(((v || 0) - min) / (max - min) * 255)
        ));
        return [gray, gray, gray, 0xFF];
      };
    }
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const img = new ImageData(this.width, this.height);
    for(let i = 0, ti = 0, ii = 0; i < this.length; ++i, ti += this.channels, ii += 4){
      const vec = Array.from({ length: this.channels }, (_, c) => this.data[ti + c]);
      const rgba = vecToRGBA(vec, ti);
      // if only rgb, add constant alpha
      if(rgba.length === 3)
        rgba.push(0xFF); // full alpha
      for(let c = 0; c < 4; ++c){
        img.data[ii + c] = rgba[c];
      }
    }
    const ctx = canvas.getContext('2d');
    ctx.putImageData(img, 0, 0);
    if(blobCallback)
      canvas.toBlob(blobCallback);
    else
      return canvas.toDataURL();
  }
}

module.exports = Object.assign(MeshGrid, M);
