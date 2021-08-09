// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const env = require('../env.js');
const workify = require('webworkify');
// const Mesh = require('./mesh/mesh.js');
const Sizing = require('../sizing.js');
const StitchSampler = require('./stitch/stitchsampler.js');
const Trace = require('./trace/trace.js');
const Knitout = require('../knitout.js');

// constants
const S = {};

// worker-related
let listeners = [];
let worker = null;

// data related
let stage = 0;
let sketchMap = {};
let samplers = null;
let traces = null;
let knitouts = null;
let nodeIndices = null;
let samplingDist = 1;
let progress = 0;
let message = '';
let done = false;

function init(){
  if(!worker){
    worker = workify(require('./schedule-compute.js'));
    worker.addEventListener('message', event => {
      if(!event.data){
        // clear message
        clear(false);
        return;
      }
      // update meshes
      if(event.data.samplers){
        samplers = event.data.samplers.map(samplerData => {
          const sampler = StitchSampler.fromData(samplerData);
          sampler.remapData(sketchID => {
            assert(sketchID in sketchMap, 'Sketch does not exist', sketchID);
            return sketchMap[sketchID];
          });
          return sampler;
        });
      }
      if(event.data.traces){
        traces = event.data.traces.map((traceData, idx) => {
          const sampler = samplers[idx];
          assert(sampler, 'No matching sampler');
          const trace = new Trace(sampler);
          trace.loadData(traceData);
          return trace;
        });
      }
      if(event.data.nodeIndices){
        nodeIndices = event.data.nodeIndices;
      }
      if(event.data.knitouts){
        knitouts = event.data.knitouts.map(knitoutData => {
          return Knitout.fromData(knitoutData);
        });
        // update output
        env.setOutputs(knitouts);
      }
      if(event.data.message)
        message = event.data.message;
      progress = event.data.progress || 0;
      // if(event.data.empty || progress === 0.75)
      //  return; // nothing to update
      for(const callback of listeners){
        callback({ stage, event, message, progress, samplers, traces, nodeIndices, knitouts, samplingDist, done });
      }
    });
  }
}

function updateMeshes(meshes){
  reset();
  // save sketches locally
  sketchMap = {};
  const sketches = [];
  for(const mesh of meshes || []){
    for(const layer of mesh.layers){
      sketchMap[layer.sketch.id] = layer.sketch;
      sketches.push(layer.sketch);
    }
    mesh.computeSeamLayers(env.global);
  }

  // size information
  const sizeInfo = env.global.sizing;
  // samples per px
  const mmPerPx = Sizing.parseAsRatio(sizeInfo.sketch.scale, 'mm', 'px');
  const walePerMM = Sizing.parseAsRatio(sizeInfo['default'].wale, 'stitches', 'mm');
  const wppx = walePerMM.asScalar() * mmPerPx.asScalar();
  const coursePerMM = Sizing.parseAsRatio(sizeInfo['default'].course, 'stitches', 'mm');
  const cppx = coursePerMM.asScalar() * mmPerPx.asScalar();
  const sppx = Math.max(wppx, cppx);
  samplingDist = 1 / (sppx + 1e-6);

  // const buffers = meshes.map(mesh => mesh.getBuffers()).flat();
  // send to web worker, transferring the buffers
  const data = {
    sketches: sketches.map(sketch => sketch.toData()),
    meshes: meshes.map(mesh => mesh.toData()),
    params: Object.assign({
      courseDist: 1 / cppx,
      waleDist: 1 / wppx,
      sketchScale: mmPerPx.asScalar(),
      verbose: env.verbose
    }, env.global),
    seamEdit: !!document.getElementById('seam-update').checked
  };
  worker.postMessage(data);
}

function updateSeams(meshes){
  let validSketches = true;
  const sketches = [];
  const seams = [];
  meshLoop:
  for(const mesh of meshes || []){
    for(const layer of mesh.layers){
      if(sketchMap[layer.sketch.id] !== layer.sketch){
        validSketches = false;
        break meshLoop;
      }
      sketches.push(layer.sketch);
    }
    const slayers = mesh.computeSeamLayers(env.global);
    seams.push(slayers);
  }
  if(!validSketches){
    console.warn('The sketch map is invalid, we need to resample');
    updateMeshes(meshes);
    return;
  }

  const data = {
    sketches: sketches.map(sketch => sketch.toJSON()),
    seams: seams.map(layers => layers.map(sl => sl.toData())),
    params: env.global,
    seamEdit: !!document.getElementById('seam-update').checked
  };
  worker.postMessage(data);
}

function getSampler(sketch){
  if(!samplers)
    return null;
  for(const sampler of samplers){
    if(sampler.sketches.some(sk => sk.id == sketch.id))
      return sampler;
  }
  return null;
}
function getSamplers(){
  return samplers;
}

function getTraceIndex(sampler){
  if(!traces)
    return -1;
  return traces.findIndex(tr => tr.sampler === sampler);
}

function getTrace(sampler){
  if(!traces)
    return null;
  return traces.find(tr => tr.sampler === sampler);
}

function getTraces(){
  return traces;
}

function getNodeIndex(tidx){
  return (nodeIndices || [])[tidx];
}

function reset(){
  init();
  samplers = null;
  traces = null;
  nodeIndices = null;
  knitouts = null;
  samplingDist = 1;
  stage = 0;
}

function clear(send = true){
  reset();
  if(send)
    worker.postMessage(null);
}

function registerCallback(func){
  assert(func && typeof func === 'function', 'Callback must be a function');
  listeners.push(func);
}

module.exports = Object.assign(S, {
  // actions
  updateMeshes, clear,
  updateSeams,
  // accessors
  getSampler, getSamplers,
  getTrace, getTraces, getTraceIndex,
  getNodeIndex,
  // registration
  registerCallback
  // helpers
});
