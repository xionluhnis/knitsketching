// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const Sketch = require('../sketch/sketch.js');
const Mesh = require('./mesh/mesh.js');
const IterativeWorker = require('./iterativeworker.js');
const TimeSolverAlgorithm = require('./mesh/solver.js');

module.exports = IterativeWorker.create(function onMessage(data){
  assert(Array.isArray(data.sketches)
      && Array.isArray(data.meshes), 'Data must be array of root sketches');
  
  // instantiate sketches and remap
  const map = {};
  const sketches = data.sketches.map(sketchData => {
    const sketch = new Sketch();
    sketch.deserialize(sketchData, map, true); // use same ID => not valid for growth
    return sketch;
  });
  const remap = id => {
    console.assert(typeof id == 'number', 'Invalid remapping');
    console.assert(id in map, 'Missing identifier', id, map);
    return map[id];
  };
  for(const sketch of sketches){
    sketch.remap(remap);
  }

  // instantiate new meshes
  const meshes = data.meshes.map(meshData => {
    return Mesh.fromData(meshData).remapData(remap);
  });
  const solvers = meshes.map(mesh => new TimeSolverAlgorithm(mesh, data.params));
  return [
    // flow+time solver
    {
      algorithms: solvers,
      steps: [
        [s => s.iterate(),  s => s.message()]
      ],
      data: (solvers, retData) => {
        retData.meshes = meshes.map(mesh => mesh.toData(true));
      },
      outputs: [true]
    }
  ];
});
