// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// constants
const M = {

  // traversal type
  FORWARD:  'forward',
  BACKWARD: 'backward',
  RANDOM:   'random',

  // domains
  SKETCH: 1,
  LAYER:  2,

  // orientation
  CW: -1, // clockwise
  CCW: 1, // counter-clockwise
  NONE: 0,

  // data channels
  K: 0,   // curvature k
  U: 1,   // u orientation of flow
  V: 2,   // v orientation of flow
  T: 3,   // global time t_k

  // neighborhood
  // 4-nh
  LEFT:   { dx: -1, dy: 0,  mask: 0b1000 },
  TOP:    { dx: 0,  dy: -1, mask: 0b0100 },
  RIGHT:  { dx: 1,  dy: 0,  mask: 0b0010 },
  BOTTOM: { dx: 0,  dy: 1,  mask: 0b0001 },
  N4_MASK: 0xF,
  // 8-nh
  TOP_LEFT:     { dx: -1, dy: -1, mask: 0b10000000 },
  TOP_RIGHT:    { dx: 1,  dy: -1, mask: 0b01000000 },
  BOTTOM_LEFT:  { dx: -1, dy: 1,  mask: 0b00100000 },
  BOTTOM_RIGHT: { dx: 1,  dy: 1,  mask: 0b00010000 },
  N8_MASK: 0xFF,
};
// neighborhoods
M.N4 = [ M.LEFT, M.TOP, M.RIGHT, M.BOTTOM ];
M.N8M4 = [ M.TOP_LEFT, M.TOP_RIGHT, M.BOTTOM_LEFT, M.BOTTOM_RIGHT ];
M.N8 = M.N4.concat(M.N8M4);

module.exports = M;