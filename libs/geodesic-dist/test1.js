"use strict";

const tmod = require('./gdist.js');
tmod().then(gdist => {
  // try thing with test module
  // console.log(gdist);
  gdist._set_verbose(true);

  // create quad with two triangles in CCW order
  //
  //   0--3
  //   | /|
  //   |/ |
  //   1--2
  //
  const numFaces = 2;
  const numVerticesPerFace = 3;
  const numVertices = 4;
  
  console.log('Allocating faces');

  const fptr = gdist._allocate_faces(numFaces);
  const faces = new Uint32Array(
    gdist.HEAPU32.buffer, fptr, numFaces * numVerticesPerFace);
  const eptr = gdist._get_edge_ptr();
  const edges = new Float64Array(
    gdist.HEAPF64.buffer, eptr, numFaces * numVerticesPerFace);
  
  console.log('Creating faces');

  // write face vertex index
  console.log('- Wrong way vvv');
  // /!\ invalid row-based
  faces[0*3 + 0] = 0;
  faces[0*3 + 1] = 1;
  faces[0*3 + 2] = 3;
  faces[1*3 + 0] = 1;
  faces[1*3 + 1] = 2;
  faces[1*3 + 2] = 3;
  gdist._print_faces();

  console.log('- Correct way vvv');
  // /!\ correct column-based
  faces[0 + 0*2] = 0;
  faces[0 + 1*2] = 1;
  faces[0 + 2*2] = 3;
  faces[1 + 0*2] = 1;
  faces[1 + 1*2] = 2;
  faces[1 + 2*2] = 3;
  gdist._print_faces();

  console.log('Creating edge lengths');

  // write edge lengths
  set_mat_entry(edges, 2, 0, 0, 1);
  set_mat_entry(edges, 2, 0, 1, Math.SQRT2);
  set_mat_entry(edges, 2, 0, 2, 1);
  set_mat_entry(edges, 2, 1, 0, 1);
  set_mat_entry(edges, 2, 1, 1, 1);
  set_mat_entry(edges, 2, 1, 2, Math.SQRT2);
  gdist._print_edges();

  // create surface mesh
  gdist._set_robust(true);
  gdist._set_time_step(1.0);
  gdist._create_surface_mesh();

  console.log('Precomputation');

  // precompute data
  gdist._precompute();

  console.log('Computing geodesic distance');

  // query for all distances
  const dptr = gdist._compute_from_source(0);

  console.log('Displaying results');

  // display results
  const dist = new Float64Array(
    gdist.HEAPF64.buffer, dptr, numVertices);
  for(let i = 0; i < dist.length; ++i){
    console.log('d[v#' + i + '] = ' + dist[i]);
  }
});

function set_mat_entry(arr, num_rows, row, col, value){
  arr[row + col * num_rows] = value;
}