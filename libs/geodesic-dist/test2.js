"use strict";

const tmod = require('./gdist.js');
tmod().then(gdist => {
  // try thing with test module
  // console.log(gdist);
  gdist._set_verbose(true);

  // create quad with four triangles in CCW order
  //
  //   0---3
  //   |\ /|
  //   | 4 |
  //   |/ \|
  //   1---2
  //
  const numFaces = 4;
  const numVertices = 5;
  
  console.log('Allocating faces');

  gdist._allocate_faces(numFaces);
  
  console.log('Creating faces');
  const setFace = (f, is, es) => {
    gdist._set_face(f, ...is);
    gdist._set_face_edges(f, ...es);
  };
  const ONE = 1;
  const DIA = Math.SQRT1_2;
  setFace(0, [0,1,4], [ONE, DIA, DIA]);
  setFace(1, [1,2,4], [ONE, DIA, DIA]);
  setFace(2, [2,3,4], [ONE, DIA, DIA]);
  setFace(3, [3,0,4], [ONE, DIA, DIA]);
  // debug
  gdist._print_faces();
  gdist._print_edges();

  // create surface mesh
  gdist._set_time_step(1.0);
  gdist._set_robust(true);
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