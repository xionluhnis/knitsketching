// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const env = require('../env.js');
const Action = require('./compiler/action.js');
const Sketch = require('../sketch/sketch.js');
const Mesh = require('./mesh/mesh.js');
const SamplingAlgorithm = require('./stitch/sampling.js');
const TracingAlgorithm = require('./trace/tracing.js');
const SchedulingAlgorithm = require('./schedule/scheduling.js');
const CompilerAlgorithm = require('./compiler/compiler.js');
const IterativeWorker = require('./iterativeworker.js');

module.exports = IterativeWorker.create(function onMessage(data, prev){
  assert(data, 'No data?', data);
  // extract universal data
  let sketches = data.sketches;
  assert(Array.isArray(sketches), 'Sketch data is missing');
  // parameters
  const params = data.params;

  // set environment variables
  assert('carriers' in params, 'Missing carriers data');
  env.global = params; // reset => carrier config will be updated

  // clear pre-existing user programs
  Action.resetPrograms();

  // remap sketches
  const map = {};
  sketches = sketches.map(sketchData => {
    const sketch = new Sketch();
    sketch.deserialize(sketchData, map, true); // use same ID => not valid for growth
    return sketch;
  });
  const remap = id => {
    assert(typeof id == 'number', 'Invalid remapping');
    assert(id in map, 'Missing identifier', id, map);
    return map[id];
  };
  for(const sketch of sketches){
    sketch.remap(remap);
  }

  // instantiate algorithms
  let samplers;
  if('seams' in data){
    // using prevous samplers
    samplers = prev[0].algorithms;
    // updating their data
    for(let samplerIdx = 0; samplerIdx < samplers.length; ++samplerIdx){
      const sampler = samplers[samplerIdx];
      sampler.updateSeamData(
        sketches, remap,
        data.seams[samplerIdx],
        params
      );
    }

  } else {
    // creating samplers from scratch
    samplers = data.meshes.map(meshData => {
      const mesh = Mesh.fromData(meshData).remapData(remap);
      return new SamplingAlgorithm(mesh, params);
    });
  }
  const tracers = samplers.map(sampler => new TracingAlgorithm(sampler.sampler, params));
  const schedulers = tracers.map(tracer => new SchedulingAlgorithm(tracer.trace, params));
  const compilers = schedulers.map(sched => new CompilerAlgorithm(sched.nodes, params));
  
  // return list of stages
  let stages = [
    // sampling algorithms
    {
      algorithms: samplers,
      steps: [
        [ s => s.init(),          'Sampling init' ],
        [ s => s.globalSample(),  'Global sampling' ],
        [ s => s.localSample(),   'Local sampling' ],
        [ s => s.instantiate(),   'Instantiating stitches' ],
        [ s => s.distribute(),    'Distribute wales' ],
        [ s => s.subdivide(),     'Subdivide graph' ],
        [ s => s.split(),         'Split wales' ],
        [ s => s.finish(),        'Finishing sampling' ]
      ],
      data: (samplers, retData /*, stageIdx */) => {
        retData.samplers = samplers.map(p => {
          const sampler = p.sampler.length ? p.sampler : p.coarseSampler;
          return sampler.toData(true);
        });
        retData.buffers = retData.samplers.flatMap(samp => samp.array.getBuffers());
      },
      outputs: [false, false, false, true, true, true, true, false]
    },
    // tracing algorithms
    {
      algorithms: tracers,
      steps: [
        [ t => t.init(),       'Tracing init'], 
        [ t => t.traceYarn(),  'Tracing yarn'],
        [ t => t.finish(),     'Finishing traces']
      ],
      data: (tracers, retData) => {
        retData.traces = tracers.map(p => p.trace.toData(true));
        retData.buffers = retData.traces.flatMap(trace => trace.array.getBuffers());
      },
      outputs: [false, true, false]
    },
    // scheduling algorithms
    {
      algorithms: schedulers,
      steps: [
        [ s => s.init(),                  'Creating node index' ],
        [ s => s.optimizeBetweenNodes(),  'Optimizing interfaces' ],
        [ s => s.optimizeWithinNodes(),   'Optimizing internals' ],
        [ s => s.generateBlocks(),        'Generating needle blocks' ],
        [ s => s.optimizeBlocksOffsets(), 'Optimizing blocks offsets' ],
        [ s => s.finish(),                'Finishing layout' ]
      ],
      data: (schedulers, retData /*, sidx */) => {
        retData.nodeIndices = schedulers.map(s => s.nodeIndex);
        retData.traces = schedulers.map(s => s.trace.toData(true));
        retData.buffers = retData.traces.flatMap(trace => trace.array.getBuffers());
      },
      outputs: [true, false, false, false, false, false]
    },
    // compiling algorithms
    {
      algorithms: compilers,
      steps: [
        [ c => c.init(),      'Resolving actions' ],
        [ c => c.assemble(),  'Assembling program' ],
        [ c => c.generate(),  'Generating code' ],
        [ c => c.modify(),    'Applying modifiers' ],
        [ c => c.finish(),    'Finishing program' ]
      ],
      data: (compilers, retData, sidx) => {
        if(sidx){
          retData.knitouts = compilers.map(c => c.program.output.toData(true));
          retData.buffers = retData.knitouts.flatMap(k => k.array.getBuffers());
        } else {
          retData.traces = compilers.map(c => c.trace.toData(true));
        }
      },
      outputs: [true, false, false, false, true]
    }
  ];
  // restrict pipeline range
  if(data.seamEdit && params.seamStop !== 'none'){
    switch(params.seamStop){
      case 'sampling':
        stages = stages.slice(0, 1);
        break;
      case 'tracing':
        stages = stages.slice(0, 2);
        break;
      case 'nodes':
        stages = stages.slice(0, 3);
        stages[2].steps = stages[2].steps.slice(0, 1);
        stages[2].outputs = stages[2].outputs.slice(0, 1);
        break;
    }
  }
  return stages;
}, [
  SamplingAlgorithm.resolve, // promises to load before starting
  CompilerAlgorithm.resolve
]);