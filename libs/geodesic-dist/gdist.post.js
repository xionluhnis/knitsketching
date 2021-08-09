"use strict";
/* global Module */

/**
 * Wrapper code for the geodesic distance using the Heat method
 */
class InvalidArgumentError extends Error {
  constructor(message){
    super();
    this.message = message;
  }
}

function assert(cond, errorMsg){
  if(!cond)
    throw new InvalidArgumentError(errorMsg);
}

function gridSet(arr, num_rows, row, col, value){
  arr[row + col * num_rows] = value;
}
let numVertices = 0;
const g = Module;
g.precompute = function precompute(faces, edges, params){

  // 1 = check face data + edge data
  const vertices  = new Set();
  const hedges    = new Set();
  numVertices = 0;
  for(const face of faces){
    assert(face.length === 3, 'Not a triangular face');
    for(let i = 0, j = 2; i < 3; j = i++){
      const vc = face[i];
      numVertices = Math.max(numVertices, vc + 1);
      const vp = face[j];
      vertices.add(vc);
      // check that half-edge is unique
      const he = [vp, vc].join('/');
      assert(!hedges.has(he), 'Half-edge appear twice');
      hedges.add(he);
    }
  }
  assert(numVertices === vertices.size,
    'Vertex count does not match, vertices are not continuous');

  // 2 = set potential parameters
  for(const pair of [
    ['robust',    'robust'],
    ['timeStep',  'time_step'],
    ['verbose',   'verbose']
  ]){
    const [name, key] = pair;
    if(name in params){
      const value = params[name];
      const setter = g['_set_' + key];
      setter(value);
    }
  }

  // 3 = allocate and set mesh data
  const F = faces.length;
  const fptr = g._allocate_faces(F);
  const findex = new Uint32Array(
    g.HEAPU32.buffer, fptr, F*3);
  const eptr = g._get_edge_ptr();
  const eindex = new Float64Array(
    g.HEAPF64.buffer, eptr, F*3);
  for(let i = 0; i < F; ++i){
    assert(Array.isArray(faces[i]) && faces[i].length === 3,
      'Faces must be triangular');
    assert(Array.isArray(edges[i]) && edges[i].length === 3,
      'Edge data must be a triangular array');
    for(let j = 0; j < 3; ++j){
      // set vertex index
      gridSet(findex, F, i, j, faces[i][j]);
      
      // set edge length
      gridSet(eindex, F, i, j, edges[i][j]);
    }
  }

  // 4 = precompute
  g._create_surface_mesh();
  g._precompute();

  // 5 = mark that we have vertices stored
  numVertices = vertices.size;
};
g.distancesTo = function distancesTo(idx){
  assert(numVertices > 0,
    'No valid precomputation yet');

    // compute from source
    const dptr = g._compute_from_source(idx);
  
    // wrap data into typed array
    return new Float64Array(
      g.HEAPF64.buffer, dptr, numVertices);
};