// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');

// local instance
let prng;
seed('apple');

/**
 * 128-bits PRNG
 * 
 * @param {number} a seed 1
 * @param {number} b seed 2
 * @param {number} c seed 3
 * @param {number} d seed 4
 * @see http://pracrand.sourceforge.net/
 * @see https://github.com/bryc/code/blob/master/jshash/PRNGs.md
 * @see https://stackoverflow.com/questions/521295/seeding-the-random-number-generator-in-javascript/47593316#47593316
 */
function sfc32(a, b, c, d) {
  return () => {
    a |= 0; b |= 0; c |= 0; d |= 0; 
    let t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ b >>> 9;
    b = c + (c << 3) | 0;
    c = c << 21 | c >>> 11;
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for(let i = 0; i < str.length; i++){
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return () => {
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function seed(seed = 'apple', type = 'sfc32'){
  switch(type){

    case 'sfc32': {
      const seedFun = xmur3(seed);
      prng = sfc32(seedFun(), seedFun(), seedFun(), seedFun());
    } break;

    case 'math': {
      // note: seed cannot be used
      prng = Math.random;
    } break;

    default:
      assert.error('Unsupported type', type);
  }
  return prng;
}

function get(){
  return prng();
}

/**
 * Mostly uniform random bit (1 or 0)
 */
function getBit(){
  return prng() >= 0.5 ? 1 : 0;
}

/**
 * Mostly uniform random sign (+1 or -1)
 */
function getSign(){
  return getBit() ? 1 : -1;
}

  /**
 * Return a random integer within 0 ... n (inclusive)
 *
 * @param n the upper bound
 * @return an integer i s.t. 0 <= i <= n
 */
function getInt(n){
  return Math.floor(get() * (n + 1));
}

function *shuffled(list){
  // Fisher-Yates in-place shuffling as we yield samples
  // @see https://en.wikipedia.org/wiki/Fisher%E2%80%93Yates_shuffle
  for(let i = list.length - 1; i >= 0; --i){
    const j = getInt(i);
    assert(j >= 0 && j <= i, 'Invalid random integer');
    if(j !== i){
      // swap two entries
      [list[i], list[j]] = [list[j], list[i]];
    }
    yield list[i];
  }
}

module.exports = {
  // general interface
  get, getBit, getSign, getInt,
  seed,
  // prng
  sfc32,
  // seeding
  xmur3,
  // shuffling
  shuffled
};