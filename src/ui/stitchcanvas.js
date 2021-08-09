// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const geom = require('../geom.js');
const colors = require('./colors.js');
const draw = require('./draw.js');
const StitchSampler = require('../algo/stitch/stitchsampler.js');
const Schedule = require('../algo/schedule.js');
const THREE = require('three');
const Transform = require('../sketch/transform.js');

// constants
// - renderer type
const CANVAS = 'canvas';
const WEBGL  = 'webgl';
// - default parameters
const Origin = { x: 0, y: 0 };
const EmptyBBox = { min: Origin, max: Origin };
const RenderParams = [
  'nodeValue',
  'progPass',
  'showAccuracy',
  'showIrregular',
  'showNode',
  'stitchMode',
  'showStitchFaces',
  'showTrace',
  'queryFunc'
];
function paramsFrom(params){
  return RenderParams.reduce((obj, name) => {
    obj[name] = params[name];
    return obj;
  }, {});
}
function getParam(p, idx){
  return Array.isArray(p) ? p[idx] : p[RenderParams[idx]];
}
function sameParams(p1, p2){
  for(let i = 0; i < RenderParams.length; ++i){
    if(getParam(p1, i) !== getParam(p2, i))
      return false;
  }
  return true;
}
function sameBBoxes(bbox1, bbox2){
  return bbox1.min.x === bbox2.min.x
      && bbox1.min.y === bbox2.min.y
      && bbox1.max.x === bbox2.max.x
      && bbox1.max.y === bbox2.max.y;
}
function isIrregular(stitch){
  return stitch.countPrevWales() > 1 || stitch.countNextWales() > 1;
}

class CanvasStitchRenderer {
  constructor(parent){
    this.parent = parent;
    // two main rotating canvases
    this.screenCanvas = document.createElement('canvas');
    this.bufferCanvas = document.createElement('canvas');
    this.renderCanvas = document.createElement('canvas');
    this.copyCanvas   = document.createElement('canvas');
    // state
    this.usingCopy = false;
    // copy state
    this.copyTransform = Transform.identity();
    // rendering state
    this.renderID     = -1;
    this.renderIndexD = 0;
    this.renderIndexS = 0;
    this.renderIndexY = 0;
    this.renderData   = null;
    this.renderParams = [];
    this.renderTransform = Transform.identity();
    this.renderExtents   = EmptyBBox;
    // last state
    this.lastExtents  = EmptyBBox;
    this.lastParams   = [];
    this.lastArgs     = null;
  }
  get mode(){ return CANVAS; }
  get sketch(){ return this.layer.sketch; }
  get canvas(){ return this.screenCanvas; }
  get lastTransform(){ return this.parent.lastTransform; }
  get width(){ return this.canvas.width; }
  get height(){ return this.canvas.height; }
  set width(width){ this.setSize({ width }); }
  set height(height){ this.setSize({ height }); }
  get visibleCanvas(){
    if(this.screenCanvas.parentNode)
      return this.screenCanvas;
    else if(this.copyCanvas.parentNode)
      return this.copyCanvas;
    else if(this.renderCanvas.parentNode)
      return this.renderCanvas;
    else
      return null;
  }

  setSize({ width = this.canvas.width, height = this.canvas.height } = {}){
    if(this.screenCanvas.width !== width)
      this.screenCanvas.width = width;
    if(this.bufferCanvas.width !== width)
      this.bufferCanvas.width = width;

    if(this.screenCanvas.height !== height)
      this.screenCanvas.height = height;
    if(this.bufferCanvas.height !== height)
      this.bufferCanvas.height = height;
  }

  setCopyCanvas(canvas, transform = this.lastTransform){
    if(canvas === this.bufferCanvas){
      [this.bufferCanvas, this.copyCanvas] = [this.copyCanvas, canvas];
      this.setSize(); // apply screen size to new buffer

    } else if(canvas === this.renderCanvas){
      [this.renderCanvas, this.copyCanvas] = [this.copyCanvas, canvas];

    } else {
      assert(canvas !== this.screenCanvas,
        'You should NOT swap screen and copy directly, use the buffer');
    }
    this.usingCopy = true;
    this.copyTransform = Transform.from(transform);
  }

  isRendering(){ return this.renderID !== -1; }

  render(params){
    // get new transform
    const transform = Transform.from(
      params.transform || Transform.identity()
    );

    // draw on screen
    const { width, height } = this.screenCanvas;
    // special case when not drawing stitches
    if(!params.showStitches){
      const ctx = this.screenCanvas.getContext('2d', { alpha: true });
      ctx.clearRect(0, 0, width, height);
      return;
    }
    if(this.usingCopy){
      const ctx = this.screenCanvas.getContext('2d', { alpha: true });
      ctx.clearRect(0, 0, width, height);
      draw.withinViewport(ctx, transform, () => {
        draw.withinViewport(ctx, this.copyTransform.inverse(), () => {
          ctx.drawImage(this.copyCanvas, 0, 0);
        });
      });

    } else if(!transform.matches(this.lastTransform)){
      // we must go in copy mode
      // but should do so without creating flicker
      // => draw screen canvas to buffer, then swap
      const ctx = this.bufferCanvas.getContext('2d', { alpha: true });
      ctx.clearRect(0, 0, width, height);
      draw.withinViewport(ctx, transform, () => {
        draw.withinViewport(ctx, this.lastTransform.inverse(), () => {
          ctx.drawImage(this.screenCanvas, 0, 0);
        });
      });
      // replace screen with buffer
      this.parent.container.replaceChild(
        this.bufferCanvas, this.screenCanvas
      );
      [this.screenCanvas, this.bufferCanvas] = [
        this.bufferCanvas, this.screenCanvas
      ];
      // transfer new buffer (old screen) as copy
      this.setCopyCanvas(this.bufferCanvas, this.lastTransform);
    }
    // else nothing to draw directly

    // record last parameters
    this.lastParams = paramsFrom(params);
    this.lastArgs = params;

    // trigger potential offscreen render if not pending
    if(!this.isRendering()){
      this.startRender(transform, params);
    }
  }

  getData(trace = false){
    if(trace){
      const traces = Schedule.getTraces();
      if(traces && traces.length)
        return [traces, true];
    }
    return [Schedule.getSamplers(), false];
  }

  startRender(transform, params){
    // check that we need a new rendering
    let trace = params.showTrace;
    let renderData;
    let change = false;
    if(!transform.matches(this.renderTransform))
      change = true; // must update render transform
    else if(!sameBBoxes(params.visibleExtents, this.renderExtents))
      change = true; // must update render extents
    else if(!sameParams(params, this.renderParams))
      change = true; // must update render parameters
    else {
      [renderData, trace] = this.getData(trace);
      change = renderData !== this.renderData;
    }
    if(!change)
      return; // nothing to do, abort

    // get render data if missing
    if(!renderData)
      [renderData, trace] = this.getData(trace);

    // else we need to schedule a new rendering
    // get visible extents
    const { min = Origin, max = Origin } = params.visibleExtents;
    // store rendering data
    this.renderIndexD = 0; // data index
    this.renderIndexS = 0; // stitch index
    this.renderIndexY = 0; // yarn index
    this.renderData = renderData;
    this.renderExtents = {
      min: Object.assign({}, min),
      max: Object.assign({}, max)
    };
    this.renderParams = paramsFrom(params);
    this.renderTransform = transform;

    // initialize rendering
    this.initRender();

    // start rendering
    this.renderStitches(trace);
  }

  initRender(){
    const ctx = this.renderCanvas.getContext('2d', { alpha: true });
    // ensure same size as screen one
    if(this.renderCanvas.width !== this.width)
      this.renderCanvas.width = this.width;
    if(this.renderCanvas.height !== this.height)
      this.renderCanvas.height = this.height;
    // clear context
    ctx.clearRect(
      0, 0,
      this.renderCanvas.width,
      this.renderCanvas.height
    );
  }

  renderStitches(trace = false){
    const startTime = Date.now();
    const maxTime = startTime + 15;
    const ctx = this.renderCanvas.getContext('2d', { alpha: true });

    // actual rendering
    const renderData = this.renderData || [];
    draw.withinViewport(ctx, this.renderTransform, () => {
      while(this.renderIndexD < renderData.length){
        // get data
        const data = renderData[this.renderIndexD];

        // render data as much as possible
        if(trace){
          const nodeIndex = Schedule.getNodeIndex(this.renderIndexD);
          [this.renderIndexS, this.renderIndexY] = this.drawTraceFrom(
            ctx, data, nodeIndex,
            this.renderIndexS, this.renderIndexY,
            maxTime
          );

        } else {
          this.renderIndexS = this.drawStitchesFrom(
            ctx, data, this.renderIndexS, maxTime
          );
        }

        // if done with data segment
        // reset go to next data segment 
        if(this.renderIndexS >= data.length){
          this.renderIndexS = 0;
          this.renderIndexY = 0;
          ++this.renderIndexD;

        } else {
          break;
        }
      }
    });

    // are we done?
    if(this.renderIndexD >= renderData.length){
      // we're done!
      this.renderID = -1;

      // if render matches last parameters, swap with screen
      if(this.width === this.renderCanvas.width
      && this.height === this.renderCanvas.height
      && sameBBoxes(this.lastExtents, this.renderExtents)
      && this.lastTransform.matches(this.renderTransform)){
        [this.screenCanvas, this.renderCanvas] = [
          this.renderCanvas, this.screenCanvas
        ];
        this.parent.container.replaceChild(
          this.screenCanvas, this.renderCanvas
        );
        this.usingCopy = false;
      }
      // else set as copy
      else {
        this.setCopyCanvas(this.renderCanvas, this.renderTransform);
      }

      // trigger redrawing
      setTimeout(() => {
        this.render(this.lastArgs);
      }, 0);

    } else {
      // we're not done
      this.renderID = setTimeout(() => {
        this.renderStitches(trace);
      }, 0);
    }
  }

  getVisibilityTests(sampler){
    return sampler.sketches.map(sketch => {
      const transform = sketch.fullTransform;
      const visibleExtents = geom.extents([
        transform.unapplyFrom(this.renderExtents.min),
        transform.unapplyFrom(this.renderExtents.max)
      ]);
      return p => geom.bboxContains(visibleExtents, p);
    });
  }

  drawStitchesFrom(
    ctx, sampler, fromIdx = 0, maxTime = Date.now() + 15
  ){
    // per-sketch visibility tests
    const visTests = this.getVisibilityTests(sampler);

    // yarn width based on course/wale distances
    const yw = this.getYarnWidth(sampler);
    ctx.lineWidth = yw;

    // extract parameters
    const { queryFunc, showAccuracy, showIrregular } = this.renderParams;

    // go over stitches
    for(let i = fromIdx; i < sampler.length; ++i){
      const stitch = sampler.getStitch(i);
      const layerIdx = stitch.getLayerIndex();
      const isVisible = visTests[layerIdx];

      // get low-left half of the neighbors (filtered by layer)
      const sp = stitch.getPosition();
      if(!isVisible(sp))
        continue; // skip invisible stitches

      // get sketch and draw within its context
      const sketch = sampler.sketches[layerIdx];
      draw.withinContext(ctx, sketch, () => {
        // draw courses + wales
        for(const [types, color, baseDist] of [
          [StitchSampler.ALL_COURSES, '#99F', sampler.courseDist],
          [StitchSampler.ALL_PREV_WALES, '#F99', sampler.waleDist]
        ]){
          for(const nstitch of stitch.getNeighbors(types)){
            if(nstitch.getLayerIndex() !== layerIdx)
              continue;
            const np = nstitch.getPosition();
            const dist = geom.distBetween(sp, np);
            const dash = dist > 3 * baseDist;
            ctx.beginPath();
            ctx.moveTo(sp.x, sp.y);
            ctx.lineTo(np.x, np.y);
            if(dash)
              ctx.setLineDash([baseDist/4, baseDist/4]);
            else
              ctx.setLineDash([]);
            if(showAccuracy)
              ctx.strokeStyle = colors.getAccuracyColor(dist, baseDist);
            else
              ctx.strokeStyle = color;
            ctx.stroke();
          }
        }

        // highlight irregulars
        let stroke;
        const irregular = showIrregular && isIrregular(stitch);
        if(irregular)
          stroke = '#000';

        // check if queried by user
        const queried = queryFunc && queryFunc(stitch);
        if(queried)
          this.drawStitch(ctx, stitch, { fill: '#000', stroke }, 2, yw, { irregular, queried });
        else
          this.drawStitch(ctx, stitch, { fill: '#999', stroke }, 1, yw, { irregular, queried });
      });

      // check if we need to stop drawing for now
      if(Date.now() > maxTime)
        return i + 1; // return next index to draw from
    }
    return sampler.length; // done
  }

  drawTraceFrom(
    ctx, trace, nodeIndex, startIdx = 0, yarnIdx = 0, maxTime = Date.now() + 15
  ){
    // unroll data
    const sampler = trace.sampler;
    const visTests = this.getVisibilityTests(sampler);

    // yarn width
    const yw = this.getYarnWidth(trace.sampler);
    ctx.lineWidth = yw;

    // extract parameters
    const {
      queryFunc, showAccuracy, showIrregular,
      nodeValue, showNode, stitchMode, showStitchFaces
    } = this.renderParams;

    // check which range to highlight (if any)
    let highlightStart = Infinity;
    let highlightEnd = -Infinity;
    if(nodeIndex && showNode && nodeValue !== -1){
      // find node index given stitch
      // => get two associated trace stitches
      const nidx = Math.min(nodeValue, nodeIndex.length - 1);
      ({ start: highlightStart = Infinity, end: highlightEnd = -Infinity } = nodeIndex[nidx] || {});
    }

    const waleColor = colors.waleColor() + '66';
    
    let lastTS, prevLayerIndex, prevPos;
    if(startIdx){
      lastTS = trace.getTracedStitchAt(startIdx - 1);
      prevLayerIndex = lastTS.stitch.getLayerIndex();
      prevPos = lastTS.getPosition();
    }
    for(let i = startIdx; i < trace.length; ++i){
      const ts = trace.getTracedStitchAt(i);
      const layerIdx = ts.stitch.getLayerIndex();
      const sketch = sampler.sketches[layerIdx];
      const isVisible = visTests[layerIdx];
      const sp = ts.getPosition();
      const { start, end, pass: secondPass } = trace.getFlags(i, true);
      const localStart = ts.isLocalStart();
      const localEnd = ts.isLocalEnd();

      // memory for state update
      const remember = () => {
        lastTS = ts;
        prevLayerIndex = lastTS.stitch.getLayerIndex();
        prevPos = sp;
        if(end || localEnd){
          // yarnIdx++;
          lastTS = prevLayerIndex = prevPos = null; // those are meaningless
        }
      };

      // check that stitch is visible
      if(!isVisible(sp)){
        remember();
        continue; // skip invisible stitches
      }

      // draw within sketch
      draw.withinContext(ctx, sketch, () => {

        // start / end
        if(start){
          // colors.courseColor(yarnIdx, trace.yarns)
          this.drawYarnStart(ctx, sp, '#9999FF', 2 * yw);
        }
        if(end){
          this.drawYarnEnd(ctx, sp, '#9999FF', 2 * yw);
        }
        if(localStart || localEnd){
          const color = '#9999FF' + (localEnd ? '66' : '');
          this.drawYarnSwitch(ctx, sp, color, 2 * yw);
        }

        // highlight irregulars
        let stroke;
        const irregular = showIrregular && isIrregular(ts);
        if(irregular)
          stroke = '#000';

        // highlight user queries
        const queried = queryFunc && queryFunc(ts);

        // drawing the stitch
        const radius = queried ? 1.2 : 0.8;
        const drawStitch = () => {
          this.drawStitch(ctx, ts, {
            fill: queried ? '#000' : (ts.pass ? '#CCC' : '#999'), stroke
          }, radius, yw, { stitchMode, showStitchFaces, irregular, queried });
        };
        const showLater = stitchMode !== 'none' && !showStitchFaces;
        // if not showing program (or showing as face),
        // then we should draw the stitch first
        if(!showLater)
          drawStitch();

        // wales
        for(const pws of ts.getPrevWales()){
          if(pws.stitch.getLayerIndex() !== layerIdx)
            continue;
          const np = pws.getPosition();
          const dist = geom.distBetween(sp, np);
          const dash = dist > 3 * trace.waleDist;
          ctx.beginPath();
          ctx.moveTo(sp.x, sp.y);
          ctx.lineTo(np.x, np.y);
          if(dash)
            ctx.setLineDash([trace.waleDist/4, trace.waleDist/4]);
          else
            ctx.setLineDash([]);
          if(showAccuracy)
            ctx.strokeStyle = colors.getAccuracyColor(dist, trace.waleDist);
          else
            ctx.strokeStyle = waleColor;
          ctx.stroke();
        }

        // potentially reconnected when yarn restarts locally
        if(!lastTS && localStart){
          const prev = ts.getPrev();
          if(prev){
            const pli = prev.stitch.getLayerIndex();
            if(pli === layerIdx){
              lastTS = prev;
              prevLayerIndex = pli;
              prevPos = lastTS.getPosition();
            }
          }
        } // endif !lastTS and localStart

        // draw yarn, unless out of layer, or we just started one
        if(start
        || prevLayerIndex !== layerIdx){
          // if showing program, draw stitch last
          if(showLater)
            drawStitch();
          return; // will remember out of the draw.withinContext() call
        }

        ctx.beginPath();
        const highlight = highlightStart <= i && i <= highlightEnd;
        let style;
        if(highlight)
          style = '#000000';
        else
          style = '#9999FF'; // colors.courseColor(yarnIdx, trace.yarns);
        if(secondPass)
          style += '99';
        let dash = [];

        if(!ts.needsCastOff()){
          // default simple case
          ctx.moveTo(prevPos.x, prevPos.y);
          ctx.lineTo(sp.x, sp.y);

          if(lastTS && ts.stitch.index !== lastTS.stitch.index
          && !ts.stitch.isCourseConnectedTo(lastTS.stitch)){
            dash = [2, 2];
          } else {
            dash = [];
          }

        } else {
          assert(secondPass || ts.isSingularCastOff(),
            'Invalid cast-off on first pass');
          // cast-off case
          const d = geom.unitVector(geom.axpby(1, sp, -1, prevPos));
          const n = geom.rightNormal(d);
          let dn = 3;

          // direction fix given wale orientation
          // - try using previous wales
          const pws = ts.stitch.getPrevWales().find(pws => {
            return pws.getLayerIndex() === layerIdx;
          });
          if(pws){
            const pwp = pws.getPosition();
            const pwd = geom.axpby(1, pwp, -1, sp);
            if(geom.dot(n, pwd) > 0)
              dn *= -1; // n matches pwp direction => bad!

            ctx.moveTo(prevPos.x + dn * n.x, prevPos.y + dn * n.y);
            ctx.lineTo(sp.x + dn * n.x, sp.y + dn * n.y);

            dash = [3, 1, 1, 1];
            style = '#00000099';
          }
        }

        // reduce visual impact if large course (across links?)
        const dist = geom.distBetween(prevPos, sp);
        if(dist > 3 * trace.courseDist){
          dash = [trace.courseDist/4, trace.courseDist/4];
        }

        // accuracy
        if(showAccuracy){
          style = colors.getAccuracyColor(dist, trace.courseDist);
        }
        
        // actual graphics
        ctx.setLineDash(dash);
        ctx.strokeStyle = style;
        ctx.stroke();
        ctx.setLineDash([]);

        // when showing program, draw stitch last
        if(showLater)
          drawStitch();

      });

      // remember current info (and potentially update yarn)
      remember();

      // check if we need to stop drawing for now
      if(Date.now() > maxTime){
        return [i + 1, yarnIdx];
      }
    }
    return [trace.length, yarnIdx];
  }

  getYarnWidth(sampler){
    // yarn width based on course/wale distances
    const sampDist = (sampler.waleDist + sampler.courseDist) * 0.5;
    return sampDist / 15;
  }

  drawYarnStart(ctx, pos, style, radius = 3){
    ctx.strokeStyle = style;
    ctx.strokeRect(pos.x - radius, pos.y - radius, radius * 2, radius * 2);
  }

  drawYarnEnd(ctx, pos, style, radius = 3){
    ctx.beginPath();
    ctx.moveTo(pos.x - radius, pos.y - radius);
    ctx.lineTo(pos.x + radius, pos.y + radius);
    ctx.moveTo(pos.x - radius, pos.y + radius);
    ctx.lineTo(pos.x + radius, pos.y - radius);
    ctx.strokeStyle = style;
    ctx.stroke();
  }

  drawYarnSwitch(ctx, pos, style, radius = 3){
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y - radius);
    ctx.lineTo(pos.x - radius, pos.y);
    ctx.lineTo(pos.x, pos.y + radius);
    ctx.lineTo(pos.x + radius, pos.y);
    ctx.lineTo(pos.x, pos.y - radius);
    ctx.strokeStyle = style;
    ctx.stroke();
  }

  drawStitch(
    ctx, stitch, style,
    radiusFactor = 1, yw = 0,
  {
    stitchMode = 'none', showStitchFaces = false,
    irregular = false, queried = false
  } = {}){
    if(!yw){
      const { courseDist, waleDist } = stitch.sampler;
      yw = (courseDist + waleDist) * 0.5 / 15; 
    }
    const p = stitch.getPosition();

    // program color and background
    let lod = 1;
    if(stitchMode !== 'none' && stitch.getProgram){
      let color;
      switch(stitchMode){
        case 'program':
          color = colors.getAlphabet(stitch.getProgram());
          break;
        case 'type':
          color = colors.getPatternColor(stitch.getStitchType());
          break;
        case 'fyarn':
          color = colors.getYarnsColor(stitch.getFrontYarns());
          break;
        default:
          color = colors.white;
          break;
      }
      if(showStitchFaces){
        style = {
          fill: queried ? '#000000AA' : '#00000066',
          stroke: irregular ? 'black' : null
        };
        lod = 0;
        // color goes into background
        this.drawStitchFace(ctx, stitch, color, p);

      } else {
        style = { fill: color.hex() };
      }
    }
    const r = 2 * radiusFactor * yw;
    ctx.beginPath();
    draw.adaptiveCircle(ctx, p.x, p.y, r, lod);
    if(style){
      const { fill, stroke } = style;
      if(fill){
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if(stroke){
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
  }

  drawStitchFace(ctx, stitch, color, p = stitch.getPosition()){
    const layerIdx = stitch.stitch.getLayerIndex();
    const maxDist = Math.max(
      stitch.trace.waleDist, stitch.trace.courseDist
    ) * 3;
    const ps = stitch.getPrev();
    const ns = stitch.getNext();
    const nws = stitch.getNextWales();
    const pws = stitch.getPrevWales();
    const pairs = [];
    const isCCW = stitch.isCCW();
    if(ps){
      if(nws.length)
        pairs.push([ps, nws[isCCW ? 0 : nws.length-1], +1, -1]);
      if(pws.length)
        pairs.push([ps, pws[isCCW ? 0 : pws.length-1], -1, -1]);
    }
    if(ns){
      if(nws.length)
        pairs.push([ns, nws[isCCW ? nws.length-1 : 0], +1, +1]);
      if(pws.length)
        pairs.push([ns, pws[isCCW ? pws.length-1 : 0], -1, +1]);
    }
    if(nws.length > 1)
      pairs.push(nws);
    if(pws.length > 1)
      pairs.push(pws);
    // face drawings
    ctx.fillStyle = color.alpha(0.3).hex();
    for(const [s1, s2, dir = 0, side = 0] of pairs){
      if(s1.stitch.getLayerIndex() !== layerIdx
      || s2.stitch.getLayerIndex() !== layerIdx)
        continue; // no easy face
      // get positions
      const p1 = s1.getPosition();
      if(geom.distBetweenAbove(p, p1, maxDist))
        continue; // too far, dangerous
      const p2 = s2.getPosition();
      if(geom.distBetweenAbove(p, p2, maxDist))
        continue; // too far, dangerous
      // draw triangle
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const a = geom.axpby(0.5, p, 0.5, p1);
      ctx.lineTo(a.x, a.y);
      const b = geom.axpby(0.5, p, 0.5, p2);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(p.x, p.y);
      ctx.fill();

      // if pair is a corner (dir !== 0)
      // then we should try to get two additional locations
      if(dir === 0 || side === 0)
        continue; // can be skipped

      // area on the side with s1 = prev or next yarn stitch
      const dss = dir > 0 ? s1.getNextWales() : s1.getPrevWales();
      const sss = [s2.getNext(), s2.getPrev()];
      // const ss = side > 0 ? s2.getNext() : s2.getPrev();
      const ds = dss.find(s => {
        return s.matches(s2) // shaping (increase/decrease)
            || sss.some(ss => s.matches(ss));
      });
      if(ds && ds.stitch.getLayerIndex() === layerIdx){
        const p3 = ds.getPosition();
        if(geom.distBetweenAbove(p, p3, maxDist * 2))
          continue; // too far, dangerous
        const c = geom.axpby(0.5, p1, 0.5, p2);
        const d = geom.axpby(0.5, p, 0.5, p3);
        const e = geom.axpby(0.5, c, 0.5, d); // better center
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(e.x, e.y);
        ctx.fill();
      }
    } // endfor [s1, s2]
  }
}

class WebGLStitchRenderer {
  constructor(parent){
    this.parent = parent;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(
      0, 100, 0, 100, 0, 1
    );
    //this.camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 );
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setPixelRatio( window.devicePixelRatio );
    this.renderer.setClearColor( 0x000000, 0.0 );
    this.renderer.setSize(100, 100);
    this.geometry = null;

    // generic data
    this.canvas = this.renderer.domElement;
    this.canvas.width = 100;
    this.canvas.height = 100;
  }
  get mode(){ return WEBGL; }
  get width(){ return this.canvas.width; }
  get height(){ return this.canvas.height; }
  set width(width){ this.setSize({ width }); }
  set height(height){ this.setSize({ height }); }

  setSize({ width = this.canvas.width, height = this.canvas.height }){
    if(this.canvas.width !== width)
      this.canvas.width = width;
    if(this.canvas.height !== height)
      this.canvas.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.right = width;
    this.camera.bottom = height;
    this.camera.updateProjectionMatrix();
  }
}

class StitchCanvas {
  constructor(container){
    this.container = container;
    // renderers
    this.webglRenderer = new WebGLStitchRenderer(this);
    this.canvasRenderer = new CanvasStitchRenderer(this);
    this.mode = 'none';

    // html canvas
    for(const r of this.renderers)
      container.appendChild(r.canvas);

    // set mode
    this.setMode(CANVAS);

    // state
    this.lastTransform = Transform.identity();
    this.lastParams = {};
  }
  get renderer(){
    return this.mode === CANVAS ? this.canvasRenderer : this.webglRenderer;
  }
  get screenCanvas(){ return this.renderer.canvas; }
  get renderers(){
    return [this.webglRenderer, this.canvasRenderer];
  }

  get width(){ return this.screenCanvas.width; }
  get height(){ return this.screenCanvas.height; }
  set width(w){
    for(const r of this.renderers)
      r.width = w;
  }
  set height(h){
    for(const r of this.renderers)
      r.height = h;
  }

  setMode(mode){
    if(this.mode === mode)
      return; // nothing to do
    assert([CANVAS, WEBGL].includes(mode), 'Invalid mode');
    this.mode = mode;
    for(const r of this.renderers)
      r.canvas.classList.toggle('hidden', r.mode !== mode);
  }

  /**
   * Draws the stitch information (if necessary)
   * 
   * @param {Object}  params drawing parameters
   * @param {{x,y,k}} params.transform the zoom/pan transformation
   * @param {{min,max}} params.visibleExtents the visible extents
   * @param {boolean} params.showNode whether to show node information
   * @param {boolean} params.showProg whether to show node program data
   * @param {boolean} params.showTrace whether to display the traced stitches
   * @param {Function} queryFunc the stitch query function for highlights
   */
  draw(params){
    this.renderer.render(params);
    this.lastTransform = Transform.from(params.transform);
  }
}

module.exports = Object.assign(StitchCanvas, {
  // classes
  CanvasStitchRenderer,
  WebGLStitchRenderer,
  // constants
  CANVAS, WEBGL
});