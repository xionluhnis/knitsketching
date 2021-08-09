// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// - modules
const ForceGraph3D = require('3d-force-graph');
const three = require('three');
const assert = require('../assert.js');
const sk = require('../sketch.js');
const geom = require('../geom.js');
const util = require('./util.js');
const Panel = require('./panel.js');
// const { hexColor, patternColor } = require('./colors.js');
// const ContextMenu = require('./contextmenu.js');

// - constants
const space = 1;

// data
let layout = null;
let meshes = [];
let meshIdx = 0;

function SimulationLayout(container){
  this.container = container;
  this.graphData = {};
  this.graph = null;
  this.mesh = null;
  this.lastMeshUpdate = Date.now();
  // mouse location
  /*
  this.clientX = 0;
  this.clientY = 0;
  container.querySelector('canvas').addEventListener('mousemove', event => {
    this.clientX = event.clientX;
    this.clientY = event.clientY;
  });
  */
  // this.resetSize();
}

SimulationLayout.prototype.resetSize = function(){
};

SimulationLayout.prototype.linkID = function(n1, n2){
  return [n1, n2].sort().join('/');
};

SimulationLayout.prototype.resetData = function(){
  this.graphData = { mesh: null, nodes: [], links: [], nodeMap: {}, linkMap: {} };
  return this.graphData;
};

SimulationLayout.prototype.getEngine = function(){
  return document.getElementById('mesh-engine').value;
};

SimulationLayout.prototype.getMeshIndex = function(){
  return parseInt(document.getElementById('mesh-index').value) || 0;
};

SimulationLayout.prototype.getLevel = function(){
  return parseInt(document.getElementById('mesh-level').value) || 0;
};

SimulationLayout.prototype.updateMeshes = function(){
  // XXX reuse meshes when available
  // update meshes
  meshes = sk.createMesh() || [];
  // get current mesh index from UI (user may have changed it)
  meshIdx = Math.max(0, Math.min(meshes.length - 1, this.getMeshIndex()));
  // retrieve corresponding mesh (if any)
  this.mesh = meshes[meshIdx];

  // check whether the number of meshes changed
  const numMeshes = meshes.length;
  const meshUI = document.getElementById('mesh-index');
  if(numMeshes !== meshUI.children.length){
    // get new current mesh index
    meshIdx = Math.min(this.getMeshIndex(), numMeshes - 1);
    this.mesh = meshes[meshIdx];
    // update level selection
    while(meshUI.firstChild)
      meshUI.removeChild(meshUI.firstChild);
    for(let i = 0; i < numMeshes; ++i){
      meshUI.appendChild(util.createOption(i, 'Mesh ' + i));
    }
    meshUI.value = meshIdx;
  }
};

SimulationLayout.prototype.updateLevels = function(){
  if(!this.mesh)
    return;
  const meshLevels = this.mesh.levels.length;
  const levelUI = document.getElementById('mesh-level');
  const currLevels = levelUI.children.length;
  if(meshLevels !== currLevels){
    // get current level
    const level = Math.min(this.getLevel(), meshLevels - 1);
    // update level selection
    while(levelUI.firstChild)
      levelUI.removeChild(levelUI.firstChild);
    for(let i = 0; i < meshLevels; ++i){
      levelUI.appendChild(util.createOption(i, 'Level ' + i));
    }
    levelUI.value = level;
  }
};

SimulationLayout.prototype.updateData = function(){
  // update meshes
  layout.updateMeshes();
  // update levels
  layout.updateLevels();
};

SimulationLayout.prototype.getGraphData = function(useQuadDiaLink = true){
  const level = this.getLevel();
  const layers = this.mesh.getLayers(level);
  const nodes = [];
  const nodeMap = {};
  const links = [];
  const linkMap = {};
  const faces = [];
  const faceMap = {};

  // create nodes from sample vertices
  for(const sample of this.mesh.vertices(level)){
    const layer = sample.layer;
    const p = sample.getSketchPos();
    const nid = sample.vertexId;
    nodes.push({
      id: nid,
      x: p.x * space, y: p.y * space, z: layer.index * layers[0].eta,
      index: nodes.length
    });
    nodeMap[nid] = nodes[nodes.length - 1];

    // go over links
    for(const [nsample, source] of sample.neighbors()){
      const nnid = nsample.vertexId;
      // only create link if both nodes exist already
      // => it only gets created once
      if(nnid in nodeMap){
        // only create if the node already exists
        const linkId = this.linkID(nid, nnid);
        if(linkId in linkMap)
          continue; // already created
        const distance = geom.distBetween(source, nsample) * space;
        const link = {
          id: linkId,
          source: nid,
          target: nnid,
          distance
        };
        links.push(link);
        linkMap[link.id] = link;
      }
    }
  }

  // create faces
  for(const fnh of this.mesh.faces(true, level)){
    const fid = fnh.areaId;
    // register face
    const nodes = fnh.samples.map(s => s.vertexId);
    const face = {
      id: fid, nodes
    };
    faces.push(face);
    faceMap[face.id] = face;
    // search for potential missing diagonal link
    if(useQuadDiaLink){
      for(const [s00, s11] of geom.circularPairs(fnh.samples)){
        const i00 = s00.vertexId;
        const i11 = s11.vertexId;
        const linkId = this.linkID(i00, i11);
        if(!(linkId in linkMap)){
          const link = {
            id: linkId,
            source: i00,
            target: i11,
            distance: space * Math.SQRT2
          };
          links.push(link);
          linkMap[link.id] = link;
        }
      } // endfor [s00, s11] of geom.circularPairs(face.samples)
    } // endif useQuadDiaLink
  } // endfor face of mesh.faces

  // save initial locations
  for(let n of nodes){
    n.x0 = n.x;
    n.y0 = n.y;
    n.z0 = n.z;
  }

  this.graphData = {
    mesh: this.mesh, layers,
    nodes, nodeMap,
    links, linkMap,
    faces, faceMap
  };
  return this.graphData;
};

SimulationLayout.prototype.start = function(){
  const engine = this.getEngine();
  switch(engine){

    case 'd3':
    case 'ngraph':
      this.startForceGraph(engine);
      break;

    default:
      assert.error('Unsupported engine', engine);
  }
};

SimulationLayout.prototype.startForceGraph = function(type){
  if(!this.graph){
    // create force-graph layout
    this.graph = ForceGraph3D({
      controlType: 'trackball', // one of ['trackball', 'orbit', 'fly']
      rendererConfig: {
        alpha: true
      }
    })(this.container);

    // change base camera setting
    const cam = this.graph.camera();
    cam.position.set(0, 0, -cam.position.z);
    cam.up.set(0, -1, 0);
    cam.lookAt(0, 0, 0);

  } else {
    this.graph.cooldownTicks(Infinity);
    this.graph.pauseAnimation();
    this.graph.resumeAnimation();
  }

  // update graph with simulation
  this.graph.onEngineTick(() => {
    const meshId = 3;// magic number here 
    if (Date.now() - this.lastMeshUpdate > 1000){
      this.lastMeshUpdate = Date.now();

      const scene = this.graph.scene();
      const nodeCount = this.graphData.nodes.length;
      let triMesh = scene.children[meshId];
      // potentially remove existing if not matching vertex count
      if(triMesh
      && triMesh.geometry.vertices.length !== nodeCount){
        scene.remove(triMesh);
        triMesh = null;
      }
      if (!triMesh) {
        const triGeom = new three.Geometry(); 
        for(const n of this.graphData.nodes){   
          triGeom.vertices.push(new three.Vector3(n.x, n.y, n.z));
        }
        for(const f of this.graphData.faces){
          triGeom.faces.push(new three.Face3(
            this.graphData.nodeMap[f.nodes[0]].index, 
            this.graphData.nodeMap[f.nodes[1]].index, 
            this.graphData.nodeMap[f.nodes[2]].index
          )); 
        }
        const triMat = new three.MeshBasicMaterial({ 
          color: 0xFFFFFF,
          transparent: true,
          opacity: 0.7,
          depthTest: false,
          side: three.DoubleSide 
        }); 
        const triangleMesh = new three.Mesh(
          triGeom, triMat
        );
        scene.add(triangleMesh);

      } else {

        triMesh = scene.children[meshId];
        for(let i = 0; i < nodeCount; ++i){
          const n = this.graphData.nodes[i];
          const v = triMesh.geometry.vertices[i];
          v.x = n.x;
          v.y = n.y;
          v.z = n.z;
        } // endfor i < #nodes
        triMesh.geometry.verticesNeedUpdate = true;
      }
      // scene.fog = new three.FogExp2(0xFFFFFF, 1e-3);
    }
  });

  const fg = this.graph;
  fg.forceEngine(type || 'd3');
  fg.width(this.container.clientWidth);
  fg.height(this.container.clientHeight);

  // fixed settings
  fg.backgroundColor('#FF666600')
    .linkWidth(3)
    .nodeRelSize(10);

  // force settings
  const link = fg.d3Force('link');
  link.distance(link => {
    return (link.distance || 1) * 30;
  });
  link.strength(0.25); // uniform, no reduction based on valence
  /*
  fg.d3AlphaDecay(0.0128) // 0.0228);
    .d3VelocityDecay(0.1); // 05);
  const charge = fg.d3Force('charge');
  charge.strength(-20);
  charge.distanceMax(1000);
  */
  // g.d3Force('link').strength(10);

  // node hover
  fg.onNodeHover(node => {
    this.container.style.cursor = node ? '-webkit-grab' : null;
  });

  // set the data
  fg.graphData(this.getGraphData());
};

SimulationLayout.prototype.stop = function(){
  switch(this.getEngine()){
    case 'd3':
    case 'ngraph':
      if(this.graph){
        this.graph.pauseAnimation();
        this.graph.cooldownTicks(1);
      }
      break;
  }
};

SimulationLayout.prototype.getOBJ = function(rest){
  const lines = [];
  const nodeIndex = {};
  // vertex list
  for(let n of this.graphData.nodes){
    if(rest)
      lines.push(['v', n.x0, n.y0, n.z0].join(' '));
    else
      lines.push(['v', n.x, n.y, n.z].join(' '));
    nodeIndex[n.id] = lines.length;
  }
  // face list
  for(let { nodes } of this.graphData.faces){
    lines.push(['f', ...nodes.map(nid => {
      const node = this.graphData.nodeMap[nid]; // resolve real id (for merged nodes)
      return nodeIndex[node.id];
    })].join(' '));
  }
  return lines.join('\n');
};

function saveOBJ(link, rest){
  const str = layout.getOBJ(rest); // rest ? getRestOBJ() : getCurrentOBJ();
  const blob = new Blob([str], { type: 'octet/stream' });
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = rest ? 'mesh-rest.obj' : 'mesh-full.obj';

  // revoke url after click
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

function initSimulation(){
  if(!layout){
    const container = document.getElementById('output-simulation');
    layout = new SimulationLayout(container);
  }
  Panel.addListener('simulation', state => {
    if(state){
      // reload data
      layout.updateData();
      // start simulation engine
      layout.start();

    } else {
      layout.stop();
    }
  });
  const restart = () => {
    layout.stop();
    layout.updateData();
    layout.start();
  };
  document.getElementById('mesh-engine').addEventListener('change', restart);
  document.getElementById('mesh-index').addEventListener('change', restart);
  document.getElementById('mesh-level').addEventListener('change', restart);
  document.getElementById('mesh-update').addEventListener('click', restart);
  // export obj files
  document.getElementById('mesh-export-rest').addEventListener('click', event => {
    saveOBJ(event.target, true);
  });
  document.getElementById('mesh-export-full').addEventListener('click', event => {
    saveOBJ(event.target, false);
  });
}

function viewSimulation(){
  Panel.open('simulation');
}

module.exports = { initSimulation, viewSimulation };
