// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const env = require('../env.js');
// const geom = require('../geom.js');
const workify = require('webworkify');
const Mesh = require('./mesh/mesh.js');

// worker-related
let listeners = [];
let worker = null;

// data related
let sketchMap = {};
let meshes = null;
let message = null;
let level = 0;
let progress = 0;
let ready = false;

const F = {
  CLEAR: 'clear',
  MESH: 'mesh',
  PROGRESS: 'progress'
};

function init(){
  if(worker)
    return;
  worker = workify(require('./flow-compute.js'));
  worker.addEventListener('message', event => {
    if(!event.data){
      // clear message
      clear(false); // do not send clear message (else we have a loop)
      for(let callback of listeners){
        callback({ type: F.CLEAR });
      }
      return;
    }
    let type = F.PROGRESS;
    ready = false;
    progress = event.data.progress || 0;
    message  = event.data.message  || '';
    if(event.data.meshes){
      type = F.MESH;
      // instantiate mesh data
      meshes = event.data.meshes.map(meshData => {
        return Mesh.fromData(meshData).remapData(id => sketchMap[id]);
      });
      level = meshes.reduce((lvl, mesh) => Math.min(mesh.currentLevel, lvl), Infinity);
      if(env.verbose && meshes.every(mesh => mesh.currentLevel == mesh.lastLevel) && progress == 1){
        // re-check flow on client for debug
        for(const mesh of meshes){
          mesh.checkFlowAndTime();
          mesh.segment(env.global);
        }
      }
      // readiness
      ready = meshes.every(mesh => mesh.ready);
    }
    for(const callback of listeners){
      callback({ type, progress, message, level, meshes, ready });
    }
  });
}

function updateSketches(sketches){
  init();
  // save sketches locally
  sketchMap = {};
  for(const sketch of sketches || []){
    sketchMap[sketch.id] = sketch;
  }
  // /!\ compute meshes (using DOM)
  const meshes = Mesh.fromSketches(sketches, env.global);
  const buffers = meshes.map(mesh => mesh.getBuffers()).flat();
  // send to web worker, transferring the buffers
  const data = {
    sketches: sketches.map(sketch => sketch.toData({ noLayerData: true })),
    meshes: meshes.map(mesh => mesh.toData()),
    verbose: env.verbose,
    params: env.global
  };
  worker.postMessage(data, buffers);
}

function getMeshes(){
  return meshes ? meshes.slice() : [];
}

function getMeshLayers(sketch){
  if(!meshes)
    return { layers: [], current: -1 };
  for(const mesh of meshes){
    const idx = mesh.levels[0].findIndex(layer => layer.sketch == sketch);
    if(idx != -1)
      return { mesh, layers: mesh.levels.map(level => level[idx]), current: mesh.currentLevel };
  }
  return { layers: [], current: -1 };
}

function getMeshLayer(sketch){
  if(!meshes)
    return null;
  for(const mesh of meshes){
    const idx = mesh.levels[0].findIndex(layer => layer.sketch == sketch);
    if(idx != -1)
      return mesh.levels[mesh.currentLevel][idx];
  }
  return null;
}

function getLevel(){
  return level;
}

function getProgress(){
  return progress;
}

function getData(){
  return { progress, level, meshes, ready };
}

function clear(send = true){
  init();
  meshes = null;
  progress = 0;
  message = null;
  ready = false;
  if(send)
    worker.postMessage(null);
}

function registerCallback(func){
  assert(func && typeof func === 'function', 'Callback must be a function');
  listeners.push(func);
}

module.exports = Object.assign(F, {
  // actions
  updateSketches, clear,
  // accessors
  getMeshes, getMeshLayers, getMeshLayer, getLevel, getProgress, getData,
  // registration
  registerCallback
});
