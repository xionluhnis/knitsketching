// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const colors = require('./colors.js');
const env = require('../env.js');
const { Sketch, Flow, updateFlow, clearFlow } = require('../sketch.js');
const { sampleIsoline, SKETCH } = require('../algo/mesh/isoline.js');
const draw = require('./draw.js');
const util = require('./util.js');
const Delaunator = require('delaunator');
const { draw: drawKappa } = require('./actions/kappa-select.js');
const { appendUserText } = require('./textui.js');

module.exports = {

  initFlowUI(){

    // flow update
    this.updatingFlow = false;
    document.getElementById('flow-update').addEventListener('click', event => {
      this.updatingFlow = event.target.checked;
      if(this.updatingFlow){
        updateFlow();
      } else {
        clearFlow();
        this.flowData = {};
      }
    });
    this.flowData = {};
    Flow.registerCallback(data => {
      this.updateFlow(data);
    });

    // display mode update
    this.displayMode = 'time';
    for(const disp of document.querySelectorAll('[name=skdisplay]')){
      disp.addEventListener('click', event => {
        this.displayMode = event.target.id.replace('display-', '');
        this.update();
      });
      if(disp.checked)
        this.displayMode = disp.id.replace('display-', '');
    }

    // face coloring update
    const colorFaceMode = document.getElementById('showColorFaces');
    this.colorFaces = !!colorFaceMode.checked;
    colorFaceMode.addEventListener('click', event => {
      this.colorFaces = event.target.checked;
      this.update();
    });

    // region threshold updates
    const regionVars = [
      'minRegionDT', 'maxRegionDT',
      'uniformRegionSplit',
      'invertTime'
    ];
    const regionUpdate = event => {
      const varName = event.target.dataset.env;
      const e = document.querySelector('input[data-env=' + varName + ']');
      const varType = typeof env.global[varName];
      if(varType === 'number'){
        env.global[varName] = parseFloat(e.value);
      } else {
        assert(varType === 'boolean', 'Unsupported variable type');
        env.global[varName] = !!e.checked;
      }
      // update mesh regions
      const meshes = Flow.getMeshes();
      for(const mesh of meshes){
        switch(varName){

          case 'invertTime':
            mesh.invertTime();
            mesh.segment(env.global, true); // re-segment
            break;

          default:
            mesh.reduce(env.global); // only reduce again
            break;
        }
      }
      if(meshes.length){
        this.update();
      }
    };
    for(const varName of regionVars){
      const e = document.querySelector('input[data-env=' + varName + ']');
      const varType = typeof env.global[varName];
      if(varType === 'number'){
        e.addEventListener('change', regionUpdate);
        e.addEventListener('input', util.throttle(regionUpdate, 100));
      } else {
        e.addEventListener('click', regionUpdate);
      }
    }
  },

  updateFlow(data){
    this.flowData = data;
    if(data.type === Flow.MESH || data.type === Flow.CLEAR){
      this.update();
    } else {
      assert(data.type == Flow.PROGRESS, 'Unsupported flow update type');
      this.drawFront();
    }
  },

  getFlowLevel(currLevel, numLevels){
    // note: this.zoomExtents = [0.1, 8]
    const zoom = this.transform.k;
    const [coarsest, finest] = this.zoomExtents;
    let level = 0; // = -1; // to get full intervals
    for(const zoomStop of util.geomspace(coarsest, finest, numLevels + 1)){
      if(zoom > zoomStop)
        ++level;
      else
        break;
    }
    // note: this does never reach level 0 (except on exact full zoom out)
    // but it is on purpose (i.e. we assume the next zoom level)
    return Math.max(0, Math.min(currLevel, level));
  },

  drawFlow(ctx, sketch){
    const { mesh, layers, current } = Flow.getMeshLayers(sketch);
    if(current == -1)
      return;
    const level = this.getFlowLevel(current, mesh.levels.length);
    const layer = layers[level];

    // draw annotations (only if on last level)
    if(layers[layers.length - 1])
      this.drawFlowAnnotations(ctx, sketch, layers, current);
    // draw mesh at current level
    if(this.showMesh === 'mesh')
      this.drawMesh(ctx, sketch, layer);
    else if(this.showMesh !== 'none')
      this.drawTriMesh(ctx, sketch, layer);
    // draw flow (whatever the level)
    if(this.displayMode !== 'none')
      this.drawFlowDirection(ctx, sketch, layer);
    // draw isolines (only if on last level)
    if(layers[layers.length - 1] && this.showIsolines){
      const lastLayer = layers[layers.length - 1];
      this.drawIsolines(ctx, mesh.isolines, lastLayer, {
        lineDash: [3, 3], lineWidth: 3,
      });
      this.drawIsolines(ctx, mesh.subIsolines(), lastLayer, {
        lineDash: [1, 1], lineWidth: 1, stroke: '#999999'
      });
    }
  },

  drawFlowAnnotations(ctx, sketch, layers, current){

    // choose level given zoom
    // const mirror = sketch.transform.mirrorX;
    const level = this.getFlowLevel(current);
    const layer = layers[level];

    // draw issue locations in background
    const lastLayer = layers[layers.length - 1];
    for(let [ issues, color, onlyLast ] of [
      // [ lastLayer.parent.invalidLoop, '#66666666', true ],
      [ lastLayer.errors, '#FF666688', false ],
      [ lastLayer.warnings, '#6666FF88', false ]
    ]){
      if(issues.length){
        const r = onlyLast ? layers[layers.length - 1].eta / 2 : Math.min(layers[1].eta, layer.eta) / 2;
        for(let { center } of issues){
          if(!this.isPointVisible(sketch.localToGlobal(center)))
            continue;
          ctx.beginPath();
          ctx.moveTo(center.x, center.y - r);
          ctx.lineTo(center.x - r, center.y + r);
          ctx.lineTo(center.x + r, center.y + r);
          ctx.closePath();
          ctx.fillStyle = '#FFF';
          ctx.fill();
          ctx.strokeStyle = '#FFF';
          ctx.stroke();
          ctx.strokeStyle = color;
          ctx.stroke();
        } // endfor center
      } // endif issues.length
    } // for [issues, color]
  },

  drawMesh(ctx, sketch, layer){
    // flow element size
    const prevWidth = ctx.lineWidth;
    ctx.lineWidth = draw.getConstantRadius(this.transform, 1);
    const showingFlow = this.sketchMode === 'flow';
    const alpha = showingFlow ? '44' : '22';
    const dashed = draw.getConstantRadius(this.transform, 5);
    const dotted = draw.getConstantRadius(this.transform, 2);

    // draw wireframe
    for(const sample of layer.samples()){
      // skip invisible points
      const p = sample.getSketchPos();
      if(!this.isPointVisible(sketch.localToGlobal(p)))
        continue;

      // create edge path
      ctx.beginPath();
      
      // neighbor edges
      for(const nsample of sample.directNeighbors()){
        const np = nsample.getSketchPos();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(np.x, np.y);
      }
      
      // style depends on sample type
      if(sample.isBorder()){
        ctx.setLineDash([dotted, dotted]);

      } else if(sample.isIntermediate()){
        ctx.setLineDash([dashed, dashed]);

      } else {
        // regular case
        ctx.setLineDash([]);
      }
      ctx.strokeStyle = '#000000' + alpha;
      ctx.stroke();
    
    } // endfor sample
    ctx.lineWidth = prevWidth;
    ctx.setLineDash([]);
  },

  drawTriMesh(ctx, sketch, layer){
    let samples;
    if(this.showMesh === 'tri-all')
      samples = Array.from(layer.samples());
    else if(this.showMesh === 'tri-bb')
      samples = Array.from(layer.samples()).filter(s => !s.isRegular());

    const t0 = Date.now();
    const delaunay = Delaunator.from(samples, s => s.x, s => s.y);
    if(env.verbose)
      console.log('dt in ' + (Date.now() - t0) + 'ms');
    // visualize triangles
    // flow element size
    const prevWidth = ctx.lineWidth;
    ctx.lineWidth = draw.getConstantRadius(this.transform, 1);
    const showingFlow = this.sketchMode === 'flow';
    const alpha = showingFlow ? '44' : '22';
    ctx.strokeStyle = '#000000' + alpha;
    ctx.beginPath();

    // draw wireframe
    for(let i = 0; i < delaunay.triangles.length; i += 3){
      // skip invisible points
      const ss = [
        samples[delaunay.triangles[i + 0]],
        samples[delaunay.triangles[i + 1]],
        samples[delaunay.triangles[i + 2]]
      ];
      const ps = ss.map(s => s.getSketchPos());
      if(!this.isPointVisible(sketch.localToGlobal(ps[0])))
        continue;

      // draw triangle
      ctx.moveTo(ps[2].x, ps[2].y);
      for(const p of ps)
        ctx.lineTo(p.x, p.y);
    
    } // endfor i < #delaunay.triangles
    ctx.stroke();
    ctx.lineWidth = prevWidth;
  },

  drawFlowDirection(ctx, sketch, layer){
    // flow element size
    const radius = layer.eta / 3;
    const s = radius * Math.sqrt(2);
    const w = s / 4;
    const showingFlow = this.sketchMode === 'flow';
    const wh = draw.getConstantRadius(this.transform, 3);
    const colorFaces = this.colorFaces;

    // draw flow on top
    for(const sample of layer.samples()){
      // skip invisible points
      const p = sample.getSketchPos();
      if(!this.isPointVisible(sketch.localToGlobal(p)))
        continue;

      // draw flow circle + arrow
      const uv = sample.flow();

      // smaller radius for borders
      const r = sample.isBorder() ? radius * 0.5 : radius;
      
      // coloring
      let highlight = 0;
      ctx.beginPath();
      let alphaStr = showingFlow ? '44' : '22';
      if(this.displayMode === 'kappa'){
        const k = sample.kappa();
        ctx.fillStyle = colors.getTimeStretchColor(k);

      } else if(this.displayMode === 'flow'){
        ctx.fillStyle = colors.getFlowColor(uv.x, uv.y); // '#FFFFFF99';

      } else if(this.displayMode === 'stress'){
        const s = sample.stress();
        ctx.fillStyle = colors.getStressColor(s);

      } else if(this.displayMode === 'time'){
        const t = sample.time();
        if(isNaN(t))
          ctx.fillStyle = '#FFFFFF';
        else {
          ctx.fillStyle = colors.getTimeColor(t, layer.minT, layer.maxT);
          highlight = sample.isBorder() && sample.isBorderExtremum();
        }
        
      } else if(this.displayMode === 'stretch'){
        const ts = sample.timeStretch();
        ctx.fillStyle = colors.getTimeStretchColor(ts);

      } else if(this.displayMode === 'region'){
        const r = sample.region();
        ctx.fillStyle = colors.getRegionColor(r);

      } else if(this.displayMode === 'geodesic'){
        const mesh = layer.parent;
        const queryAction = this.action;
        const distSampler = mesh.getDistanceSampler();
        let distRatio = -1;
        if(distSampler && queryAction.id === 'query-geodesic'){
          // try getting distance information
          const queryPos = queryAction.getQueryPos();
          if(queryPos){
            // get appropriate target layer
            const trgLayer = mesh.layers[sample.layer.index];
            const { dist = -1 } = distSampler.sketchQueryBetween(
              queryPos.layer, queryPos,
              trgLayer, sample.getSketchPos()
            );
            distRatio = dist / distSampler.getMaxSketchDistance();
          }
        }
        if(Number.isNaN(distRatio) || distRatio < 0.0){
          ctx.fillStyle = '#FFFFFF';
        } else {
          ctx.fillStyle = colors.getGeodesicColor(distRatio);
        }

      } else {
        ctx.fillStyle = '#FFFFFF';
      }
      if(ctx.fillStyle.length === 7)
        ctx.fillStyle += alphaStr;
      if(!colorFaces){
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        
      } else {
        // only consider areas in this layer
        for(const f of sample.areaNeighborhoods(false)){
          // two sides
          const P = f.samples.map(s => s.getSketchPos());
          const N = f.samples.length;
          const na = P[1]; // f.samples[1].getSketchPos();
          const pa = util.axpby(0.5, p, 0.5, na);
          const nb = P[N-1]; // f.samples[N-1].getSketchPos();
          const pb = util.axpby(0.5, p, 0.5, nb);
          const pc = util.meanVector(P);
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(pa.x, pa.y);
          ctx.lineTo(pc.x, pc.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.lineTo(p.x, p.y); // closing face quad
        }
      }
      ctx.fill();
      if(highlight && !colorFaces){
        ctx.lineWidth = wh;
        ctx.strokeStyle = '#000000' + alphaStr;
        ctx.stroke();
      }

      // arrow
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const dx = sketch.transform.mirrorX ? -uv.x : uv.x;
      ctx.lineTo(p.x + s * dx, p.y + s * uv.y);
      if(colorFaces){
        // additional orthogonal tick
        const b = util.rightNormal({ x: dx, y: uv.y });
        const bd = 0.25;
        ctx.moveTo(p.x + s * b.x * bd, p.y + s * b.y * bd);
        ctx.lineTo(p.x - s * b.x * bd, p.y - s * b.y * bd);
      }
      if(highlight && colorFaces)
        ctx.strokeStyle = '#00000099';
      else
        ctx.strokeStyle = '#00000044';
      ctx.lineWidth = w;
      ctx.stroke();
    } // endfor sample
  },

  drawCurrentFlow(ctx){
    if(!this.highlight.length && !this.selection.length)
      return;
    const curve = this.highlight[0] || this.selection[0];
    const sketch = curve.root();
    if(!(sketch instanceof Sketch))
        return;
    // get mesh layer
    const layer = Flow.getMeshLayer(sketch);
    if(!layer)
      return;

    // get mouse location within sketch
    const sketchPos = { x: this.sketchX, y: this.sketchY };
    const mouse = sketch.globalToLocal(sketchPos);

    // transform to layer space
    const mloc = layer.sketchToGrid(mouse);
    const snh = layer.layerQuery(mloc, 3, true); // project if needed
    // check it's within the grid
    //if(mloc.x < 0 || mloc.x >= layer.width
    //|| mloc.y < 0 || mloc.y >= layer.height)
    //  return;
    if(!snh)
      return;

    // find continuous location within grid
    const { x: u, y: v } = snh.flow();
    assert(!isNaN(u) && !isNaN(v), 'Invalid flow');
    //const u = layer.at(mloc.y, mloc.x, Mesh.U);
    //const v = layer.at(mloc.y, mloc.x, Mesh.V);
    // check we have a valid flow
    // if(!u && !v)
    //  return;

    // transform
    const xform = this.transform;

    // unapply mirroring if any
    // ctx.save();
    // if(sketch.transform.mirrorX)
      // ctx.scale(-1, 1);

    if(env.verbose){
      // visualize query neighborhood
      for(const sample of snh.samples){
        const r = 3;
        const p = sketch.localToGlobal(sample.getSketchPos());
        ctx.beginPath();
        ctx.moveTo(p.x + r, p.y);
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#FFFFFF88';
        ctx.fill();
        ctx.lineWidth = draw.getConstantRadius(xform, 1);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#00000044';
        ctx.stroke();
      }
      ctx.setLineDash([]);
      // highlight border / inner samples
      if(snh.isBorder()){
        const s = snh.baseSample;
        for(const [n, color] of [
          [s, '#00000044'],
          [s.nextSample, '#FF993344'],
          [s.prevSample, '#3399FF44'],
          ...Array.from(s.innerSamples || s.interSamples, s => [s, '#88888844'])
        ]){
          const r = 1;
          const p = sketch.localToGlobal(n.getSketchPos());
          ctx.beginPath();
          ctx.moveTo(p.x + r, p.y);
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
    }

    // draw dimensions
    const r = draw.getConstantRadius(xform, 10); //  / this.transform.k;
    const s = r * Math.sqrt(2);
    const w = s / 4;

    // circle
    const p = sketch.localToGlobal(snh.getSketchPos());
    ctx.beginPath();
    ctx.moveTo(p.x + r, p.y);
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    if(this.displayMode === 'kappa'){
      const k = snh.kappa();
      ctx.fillStyle = colors.getTimeStretchColor(k);

    } else if(this.displayMode === 'flow'){
      ctx.fillStyle = colors.getFlowColor(u, v) + '66'; // '#FFFFFF99';

    } else if(this.displayMode === 'stress'){
      const s = snh.stress();
      ctx.fillStyle = colors.getStressColor(s) + '99';

    } else if(this.displayMode === 'time'){
      const t = snh.time(); // layer.timeAt(q.y, q.x);
      if(!isNaN(t) && layer.minT <= t && t <= layer.maxT)
        ctx.fillStyle = colors.getTimeColor(t, layer.minT, layer.maxT) + '99';
      else
        ctx.fillStyle = '#FFFFFF44';

    } else if(this.displayMode === 'stretch'){
      const ts = snh.timeStretch(); // layer.timeStretchAt(q.y, q.x);
      ctx.fillStyle = colors.getTimeStretchColor(ts);

    } else if(this.displayMode === 'region'){
      const r = snh.baseSample.region(); // projected on base sample
      ctx.fillStyle = colors.getRegionColor(r);

    } else {
      ctx.fillStyle = '#FFFFFF44';
    }
    ctx.fill();

    // arrow
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // const dx = sketch.transform.mirrorX ? -u : u;
    ctx.lineTo(p.x + s * u, p.y + s * v);
    ctx.strokeStyle = '#00000088';
    ctx.lineWidth = w;
    ctx.stroke();

    // go over isoline
    if(layer.isLastLevel()){
      this.drawCurrentIsoline(ctx, layer, snh.getSketchPos());
      if(this.displayMode === 'region'){
        this.drawCurrentBoundaries(ctx, layer, snh.baseSample.region());
      }
    }

    this.debugCurrent(ctx, layer, snh);
  },

  drawIsolines(ctx, isolines, layer, params = {}){
    for(const iso of isolines){
      this.drawIsolineChains(ctx, iso.chains, layer, params);
    }
  },

  drawIsolineChains(ctx, chains, layer, {
    lineDash = [1, 1], 
    lineWidth = 0,
    radius = 0, 
    stroke = '#66666666'
  } = {}){
    const prevLineWidth = ctx.lineWidth;
    const noLayer = { index: -1 };
    let prevLayer = layer || noLayer;
    const useLayer = layer ? () => false : layer => {
      if(prevLayer.index !== layer.index){
        if(prevLayer !== noLayer){
          draw.exitContext(ctx, prevLayer.sketch);
        }
        if(layer !== noLayer){
          draw.enterContext(ctx, layer.sketch);
        }
        prevLayer = layer;
        return true;
      }
      return false;
    };
    const r = radius ? draw.getConstantRadius(this.transform, radius) : 0;
    ctx.setLineDash(lineDash.map(l => {
      return draw.getConstantRadius(this.transform, l);
    }));
    if(lineWidth)
      ctx.lineWidth = draw.getConstantRadius(this.transform, lineWidth);
    ctx.strokeStyle = stroke;
    // go over chains
    ctx.beginPath();
    for(const chain of chains){
      for(const [l, p, start] of chain.renderSteps(layer)){
        if(useLayer(l) || start){
          if(r){
            ctx.moveTo(p.x + r, p.y);
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          }
          ctx.moveTo(p.x, p.y);
        } else
          ctx.lineTo(p.x, p.y);
      } // endfor [l, p, start]
    } // endfor chain of ig.chains
    ctx.stroke();
    // back style
    if(lineWidth)
      ctx.lineWidth = prevLineWidth;
    // go out of layer
    if(!layer)
      useLayer(noLayer);
  },

  drawCurrentBoundaries(ctx, layer, region){
    if(!region)
      return;
    // use reduction
    region = region.reduction();
    if(!region)
      return;
    // draw region boundary isolines
    for(const nreg of region.neighbors()){
      // styling
      let lineWidth = 0, stroke;
      switch(nreg.getStatus()){
        case 1: // warning
          lineWidth = 2;
          stroke = '#FFCCCC';
          break;
        case 2: // error
          lineWidth = 3;
          stroke = '#FF6666';
          break;
        default:
          stroke = '#00000066';
      }
      
      this.drawIsolines(ctx, nreg.isolines(), null, {
        lineDash: [], lineWidth, radius: 3, stroke
      });
    }
  },

  drawCurrentIsoline(ctx, layer, mouse){
    if(this.showFullIsolines){
      const noLayer = { index: -1 };
      let prevLayer = noLayer;
      const useLayer = layer => {
        if(prevLayer.index !== layer.index){
          if(prevLayer !== noLayer){
            draw.exitContext(ctx, prevLayer.sketch);
          }
          if(layer !== noLayer){
            draw.enterContext(ctx, layer.sketch);
          }
          prevLayer = layer;
          return true;
        }
        return false;
      };
      ctx.beginPath();
      const isoline = sampleIsoline(layer, mouse, SKETCH, env.verbose);
      for(let i = 0; i < isoline.length; ++i){
        const [l, p, start] = isoline[i];
        if(useLayer(l) || start)
          ctx.moveTo(p.x, p.y);
        else
          ctx.lineTo(p.x, p.y);
      }
      ctx.setLineDash([]);
      ctx.strokeStyle = '#66666666';
      ctx.stroke();
      // go out of layer
      useLayer(noLayer);

    } else {
      draw.withinContext(ctx, layer.sketch, () => {
        ctx.beginPath();
        const isoline = sampleIsoline(layer, mouse);
        for(let i = 0, prevLayer = { index: -1 }; i < isoline.length; ++i){
          const [l, p, start] = isoline[i];
          if(l.index !== layer.index
          || prevLayer.index !== layer.index
          || start){
            ctx.moveTo(p.x, p.y);
          } else {
            ctx.lineTo(p.x, p.y);
          }
          // remember previous layer
          prevLayer = layer;
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = '#66666666';
        ctx.stroke();
      });
    }
  },

  debugCurrent(ctx, layer, snh){
    // debug information only for verbose mode
    if(!env.verbose || !snh)
      return;

    // flow debug
    const uv = snh.flow();
    const t = snh.time();
    const sampleDist = (this.scheduleData || {}).samplingDist || 0;
    // const sampleRate = 1 / sampleDist;
    // compute list of text info
    const text = []; // from top to bottom
    if(snh.isBorder()){
      const samp = snh.baseSample;
      text.push('Border #' + samp.dataIndex + ' | ' + samp.sampleId);
      text.push('\tsi ' + samp.segIndex.join('/'));
      text.push('\ta  ' + samp.alphas.map(a => a.toFixed(1)).join('/'));
      if(samp.nextSample){
        text.push('\tnb #' + samp.nextSample.dataIndex
          + ' ' + util.toParString(samp.nextSample, 1)
        );
      }
      if(samp.prevSample){
        text.push('\tpb #' + samp.prevSample.dataIndex
          + ' ' + util.toParString(samp.prevSample, 1)
        );
      }
      if(samp.isPrevEdgeOpen || samp.isNextEdgeOpen){
        const list = [];
        if(samp.isPrevEdgeOpen)
          list.push('prev');
        if(samp.isNextEdgeOpen)
          list.push('next');
        assert(list.length, 'Empty opening list');
        text.push('\topen: ' + list.join('+'));
      }
      if(samp.innerSamples && samp.innerSamples.length){
        text.push('\tis ' + samp.innerSamples.map(p => util.toParString(p)).join(', '));
      }
      if(samp.interSamples && samp.interSamples.length){
        text.push('\tit ' + samp.interSamples.map(p => util.toParString(p)).join(', '));
      }
      if(samp.borderSamples.length){
        text.push('\tbs ' + samp.borderSamples.map(p => {
          return '#' + p.dataIndex + ' ' + util.toParString(p, 1);
        }));
      }
      for(let i = 0; i < samp.links.length; ++i){
        const ls = samp.linkSamples[i];
        text.push('Link ' + (i + 1));
        text.push('\t- ' + ls.layer.index
                + ' #' + ls.dataIndex
                + ' ' + util.toParString(ls, 1));
        const rot = samp.rotations[i];
        text.push('\t- r ' + util.toParString(rot, 1)
                  + ' a ' + util.vectorAngle(rot, true, true));
        
        const luv = ls.flow();
        text.push('\t- uv ' + util.toParString(luv, 2));
        const uv_r = util.rotateVector(luv, rot);
        text.push('\t- UV ' + util.toParString(uv_r, 2));
      }
    }
    layer: {
      // location
      const samp = snh.baseSample;
      const q = samp.getLayerPos();
      text.push('Layer ' + layer.index);
      text.push('\tx ' + q.x.toFixed(2)
            + ', y ' + q.y.toFixed(2));

      // values
      const ts = sampleDist > 0 ? t * layer.eta / sampleDist : NaN;
      text.push('\tu ' + uv.x.toFixed(2) + ', v ' + uv.y.toFixed(2));
      text.push('\ta ' + util.vectorAngle(uv, true, true));
      if(sampleDist > 0)
        text.push('\tt ' + t.toFixed(2) + ' (' + ts.toFixed(2) + ')');
      else
        text.push('\tt ' + t.toFixed(2) + ' (' + samp.time().toFixed(2) + ')');
      text.push('\ts ' + snh.stress().toFixed(2));
      text.push(
        '\tts ' + snh.timeStretch().toFixed(2)
      + ' k ' + snh.kappa().toFixed(2)
      );
      const r = samp.region();
      text.push('\tr ' + (r ? r.index : '-'));
      const R = r ? r.reduction() : null;
      text.push('\tn ' + (R ? R.index : '-'));
    }
    appendUserText(...text.reverse());
    // ctx.restore();
  },

  drawFlowState(ctx){
    const { progress, message } = this.flowData;
    if(typeof progress != 'number' || progress == 1){
      return false;
    }
    this.drawProgress(ctx, progress, message);
    return true;
  },

  drawFlowConstraint(ctx, constr, inContext, highlight){
    if(highlight === undefined){
      highlight = this.sketchMode === 'flow';
    }
    const showSeams = this.sketchMode === 'seam';
    const borderConstr = !!constr.target.subCurve;
    // enter correct context
    let stack = [];
    if(!inContext)
      stack = constr.target.getContextStack();
    else
      stack = [ constr.target ];
    draw.enterContext(ctx, stack);

    // set style
    const width = borderConstr ? 4 : 3;
    let dash;
    if(this.sketchMode === 'flow'){
      if(constr.type === Sketch.DIRECTION)
        dash = [9, 1];
      else if(constr.type === Sketch.ISOLINE)
        dash = [5, 5];
      else
        dash = [];
    } else
      dash = [];
    // const d = this.getConstantRadius(width || 3);
    const xform = this.transform;
    ctx.lineWidth = draw.getConstantRadius(xform, width);
    ctx.strokeStyle = (constr.color || '#000000') + (highlight ? '' : '66');
    ctx.setLineDash(dash.map(n => draw.getConstantRadius(xform, n)));

    // draw curve
    if(!showSeams)
      draw.drawCurvePath(ctx, constr.target, true);

    // append arrow for direction
    const r = draw.getConstantRadius(xform, 15);
    switch(constr.type){

      case Sketch.DIRECTION:
        if(constr.isDirectional()){
          for(const segment of constr.segments()){
            const q = segment.get(0.5);
            const n = util.scale(
              util.unitVector(segment.derivative(0.5)), constr.dir
            );
            // const p = util.axpby(1, q, -0.3 * r, n);
            draw.arrowHead(ctx, q, util.scale(n, -1), r);
          }
        }
        break;

      case Sketch.ISOLINE:
        if(constr.isDirectional()){
          ctx.stroke();
          ctx.beginPath();
          ctx.setLineDash([]);
          for(const segment of constr.segments()){
            const q = segment.get(0.5);
            const n = util.scale(segment.normal(0.5), constr.dir);
            const p0 = util.axpby(1, q, r, n);
            const p1 = util.axpby(1, p0, r * 2, n);
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            draw.arrowHead(ctx, p1, util.scale(n, -1), r);
          }
        }
        break;
    }

    // actual draw
    ctx.stroke();

    // draw seam data
    if(showSeams && !borderConstr)
      this.drawSeams(ctx, constr.target);

    // exit context
    draw.exitContext(ctx, stack);
  },

  drawKappaConstraint(ctx, constr, inContext, highlight){
    if(highlight === undefined){
      highlight = this.sketchMode === 'kappa';
    }
    drawKappa(ctx, constr, {
      highlight, inContext,
      transform: this.transform
    });
  }

};
