// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const SketchLayer = require('../algo/compiler/sketchlayer.js');
const StitchProgram = require('../algo/compiler/stitchprog.js');
const DSL = require('../dsl.js');
const env = require('../env.js');
const util = require('./util.js');
const {
  registerUpdateCallback, triggerUpdate
} = require('./program.js');
const geom = util.geom;
const sk = require('../sketch.js');
const { appendUserText } = require('./textui.js');

module.exports = {

  resetSchedule(){
    if(this.updatingSchedule){
      // update flow first (unless flowData.ready)
      if(this.flowData.ready){
        // update schedule
        sk.updateSchedule();
      } else {
        sk.updateFlow();
      }
    } else {
      sk.clearSchedule();
    }
  },

  initScheduleUI(){

    // sizing UI
    for(const sizing of document.querySelectorAll('#toolbar [name=sksizing]')){
      switch(sizing.id){
        case 'sizing-sketch':
          sizing.addEventListener('click', event => {
            // switch to sketch sizing mode
            const currScale = env.global.sizing.sketch ? env.global.sizing.sketch.scale : '1 mm / px';
            // trigger askString for getting scale
            // and update sizing text
            util.askForString('Sketch scale:', currScale).then(scale => {
              // check the scale is a valid size ratio
              const u = sk.Sizing.parseAsRatio(scale, 'mm', 'px');
              if(u){
                env.global.sizing.sketch.type = "sketch";
                env.global.sizing.sketch.scale = scale;
                // update string
                sizing.dataset.text = 'Sketch: ' + scale;

                // invalidate any action callback
                if(this.actionMode == 'segment-select')
                  this.setActionMode('select');

              } else {
                event.preventDefault();
              }

            }).catch(() => event.preventDefault());
          });
          // set default text
          sizing.dataset.text = 'Sketch: ' + env.global.sizing.sketch.scale;
          break;

        case 'sizing-border':
          sizing.addEventListener('click', () => {
            // get current scale
            // const currScale = env.global.sizing.sketch ? env.global.sizing.sketch.scale : '1 mm / px';
            // switch border sizing mode
            sizing.dataset.text = "Select border";

            // previous action
            const prevAction = this.action;

            // in segment-select action mode
            // with callback provided as first argument
            this.setActionMode('segment-select', (curve, segIdx) => {
              const len = curve.getSegmentLength(segIdx);
              // Upon border selection, trigger askString for getting scale
              // while updating sizing text at each step!
              util.askForString('Border size:', '100 mm').then(size => {
                // check the size is a valid size
                const u = sk.Sizing.parseAs(size, 'mm');
                if(u){
                  env.global.sizing.sketch.type = 'border';
                  const scale = size + ' / ' + util.toDecimalString(len, 1) + ' px';
                  env.global.sizing.sketch.scale = scale;
                  // update text
                  sizing.dataset.text = 'Border: ' + scale;
                  // env.global.sizing.sketch.curve = curve;
                  // env.global.sizing.sketch.segIdx = segIdx;
                }
              }).catch(util.noop);

              // and reset to previous action
              this.setAction(prevAction, true);
            });
          });
          break;

        default:
          assert.error('Unsupported sizing mode', sizing.id, sizing);
      }
    }

    // schedule update
    const scheduleUpdate = document.getElementById('schedule-update');
    this.updatingSchedule = scheduleUpdate.checked;
    scheduleUpdate.addEventListener('click', event => {
      this.updatingSchedule = event.target.checked;
      this.resetSchedule();
    });
    sk.Flow.registerCallback(data => {
      if(data.ready && this.updatingSchedule){
        sk.updateSchedule();
      }
    });
    this.scheduleData = {};
    this.nodeValue = -1;
    const nodeRange = document.getElementById('node-range');
    sk.Schedule.registerCallback(data => {
      this.scheduleData = data;
      if(data.nodeIndices){
        const max = data.nodeIndices.reduce((max, nodeIndex) => Math.max(max, nodeIndex.length), 1);
        nodeRange.min = 0;
        nodeRange.max = max - 1;
        nodeRange.value = Math.min(
          Math.floor(max / 2),
          parseInt(nodeRange.value)
        );
        this.nodeValue = parseInt(nodeRange.value);
        
      } else {
        this.nodeValue = -1;
      }
      this.updateSchedule(data);
    });

    // slider update
    nodeRange.addEventListener('change', () => {
      this.nodeValue = parseInt(nodeRange.value);
      this.drawStitches();
    });

    // toggle modes
    for(const [propId, propName] of [
      ['show-trace',      'showTrace'],
      ['show-node',       'showNode'],
      ['show-accuracy',   'showAccuracy']
    ]){
      const showXXX = document.getElementById(propId);
      this[propName] = !!showXXX.checked;
      showXXX.addEventListener('click', () => {
        this[propName] = !!showXXX.checked;
        this.drawStitches();
      });
    }
    for(const showXXX of document.querySelectorAll('[name=stitchviz]')){
      const id = showXXX.id.replace('show-', '');
      if(showXXX.checked)
        this.stitchMode = id;
      showXXX.addEventListener('click', () => {
        this.stitchMode = id;
        this.drawStitches();
      });
    }

    // retracing mode
    const retrace = document.getElementById('retrace');
    retrace.addEventListener('click', () => {
      triggerUpdate();
    });

    // program updates
    this.progPass = 0;
    const canShowProgram = () => {
      return this.showTrace
          && this.stitchMode !== 'none'
          && this.scheduleData
          && this.scheduleData.traces
          && this.scheduleData.nodeIndices;
    };
    registerUpdateCallback('trace-viz', () => {
      const stitchProgram = env.global.stitchProgram;
      if(canShowProgram()){
        // increment program pass (to invalidate cache)
        this.progPass++;

        // reset user programs
        StitchProgram.resetPrograms();

        // whether to retrace
        const needsTracing = !!retrace.checked;

        // update traces using base stitch program and layers
        for(let [i, trace] of this.scheduleData.traces.entries()){
          let nodeIndex = this.scheduleData.nodeIndices[i];

          // retrace if needed
          if(needsTracing){
            const TA = require('../algo/trace/tracing.js');

            // clear sampler
            StitchProgram.clear(trace.sampler);

            // apply sketch layers to sampler
            SketchLayer.applyTo(trace.sampler, []);

            // re-trace using tracing algorithm
            const ta = new TA(trace.sampler, env.global);
            ta.init();
            while(!ta.traceYarn());
            ta.finish();

            // store updated trace
            trace = this.scheduleData.traces[i] = ta.trace;

              // XXX update node index upon retrace
            // } catch(e){}

          } else {
            // clear trace information
            StitchProgram.clear(trace);
          }

          // some things might fail, so we better be careful here
          if(stitchProgram && stitchProgram.length){
            try {
              StitchProgram.transform(trace, nodeIndex, stitchProgram);
            } catch(e){}
          }

          // apply sketch layers to trace
          SketchLayer.applyTo(trace, nodeIndex);
        }
        this.drawStitches(); // update trace
      }
    });

    // visualization query
    this.queryFunc = null;
    document.getElementById('show-query').addEventListener('click', event => {
      if(event.target.checked){
        util.askForString('Query', 'q.index === 0').then(code => {
          this.queryFunc = DSL.safeFunction(
            code, // user code
            ['q'], // arguments: (q) => code
            [DSL.returnExpr], // return (code);
            env.verbose
          );
          this.drawStitches();

        }).catch(() => {
          this.queryFunc = null;
        });
      } else {
        this.queryFunc = null;
        this.drawStitches();
      }
    });

    // global program modifiers
    for(const modName of ['gauge', 'subdiv']){
      assert(modName in env.global,
        'Invalid modifier name', modName);
      const modType = typeof env.global[modName];
      for(const mode of document.querySelectorAll('[name=' + modName + ']')){
        mode.addEventListener('click', event => {
          const id = event.target.id;
          const valStr = id.replace(modName, '').replace(/\-/g, '');
          if(modType === 'string')
            env.global[modName] = valStr;
          else if(modType === 'number')
            env.global[modName] = parseInt(valStr);
          else
            assert.error('Unsupported parameter type', modType);

          // reset program computation
          // XXX no need to resample the stitches and schedule!
          this.resetSchedule();
        });
      }
    }

    // seam editing
    const seamUpdate = document.getElementById('seam-update');
    this.updatingSeam = seamUpdate.checked;
    seamUpdate.addEventListener('click', () => {
      this.updatingSeam = seamUpdate.checked;
      const meshes = sk.Flow.getMeshes() || [];
      const samplers = this.scheduleData && this.scheduleData.samplers;
      const canUpdate = meshes.length && samplers && samplers.length;
      if(this.updatingSeam){
        if(canUpdate){
          sk.Schedule.updateSeams(meshes);
        }
      } else if(canUpdate && env.global.seamStop !== 'none'){
        // we were with an incomplete pipeline process
        // => we need to complete it now that we're out of seam edit
        sk.Schedule.updateSeams(meshes);
      }
    });

    const layerUpdate = document.getElementById('layer-update');
    this.updatingLayers = layerUpdate.checked;
    layerUpdate.addEventListener('click', () => {
      this.updatingLayers = layerUpdate.checked;
      if(this.updatingLayers){
        triggerUpdate();
      }
    });

    // pipeline updates
    this.addPostActionCallback((/* action */) => {
      const meshes = sk.Flow.getMeshes() || [];
      const samplers = (this.scheduleData && this.scheduleData.samplers) || [];
      
      if(this.updatingLayers && canShowProgram()){
        triggerUpdate();

      } else if(meshes.length && samplers.length && this.updatingSeam){
        sk.Schedule.updateSeams(meshes);

      } else if(meshes.length && this.updatingSchedule && this.flowData.ready){
        sk.updateSchedule();

      } else if(this.updatingFlow){
        sk.updateFlow();
      }
    });

    // update on weight change
    document.getElementById('seam-weight').addEventListener('change', event => {
      const value = parseFloat(event.target.value) || 0;
      document.getElementById('seam_weight').value = value;
      env.global.seamWeight = value;
      this.triggerPostAction();
    });
  },

  updateSchedule(data){
    this.scheduleData = data;
    this.drawFront();
    this.drawStitches();
  },

  drawScheduleState(ctx){
    const { progress, message } = this.scheduleData;
    if(typeof progress != 'number' || progress == 1){
      return false;
    }
    this.drawProgress(ctx, progress, message);
    return true;
  },

  drawCurrentStitches(ctx){
    if(!this.highlight.length && !this.selection.length)
      return;
    const curve = this.highlight[0] || this.selection[0];
    const sketch = curve.parent ? curve.parent : curve;
    if(!(sketch instanceof sk.Sketch))
        return;

    // get mesh layer (to measure time)
    const layer = sk.Flow.getMeshLayer(sketch);
    if(!layer)
      return;

    // get stitch sampler (to visualize stitches)
    const sampler = sk.Schedule.getSampler(sketch);
    if(!sampler)
      return;

    // get mouse location within sketch
    const p = { x: this.sketchX, y: this.sketchY };
    const mouse = sketch.globalToLocal(p);

    // transform to layer space
    const mloc = layer.sketchToGrid(mouse);
    const snh = layer.layerQuery(mloc, 3, true); // project if needed
    if(!snh)
      return;

    // get sampled time
    // const sampleDist = this.scheduleData.samplingDist;
    // const sampleRate = 1 / sampleDist;
    const t = snh.time(); // * sampleRate;  //  * layer.eta
    if(typeof t !== 'number' || Number.isNaN(t))
      return;

    // find closest stitch
    let closestStitch = null;
    let closestDistance = Infinity;
    for(const stitch of sampler.stitchesWithinTimeRange(t - 2, t + 2)){
      // first filter by layer
      if(stitch.getLayerIndex() != layer.index)
        continue;
      // then check distance
      const stitchPos = stitch.getPosition();
      const stitchDist = geom.distBetween(mouse, stitchPos);
      if(stitchDist < closestDistance){
        closestDistance = stitchDist;
        closestStitch = stitch;
      }
    }

    // if no stitch => don't show anything
    if(!closestStitch && this.previewMode !== 'slice')
      return;
    
    // debug content
    if(closestStitch){
      this.debugCurrentSchedule(ctx, closestStitch);
      // console.log('@time', closestStitch.getTime(), 'for', t);
    }
  },

  debugCurrentSchedule(ctx, stitch){
    assert(stitch, 'Invalid call, need existing stitch');
    // debug information only for verbose mode
    if(!env.verbose)
      return;

    // debug stitch sampler
    // compute list of text info
    const text = []; // from top to bottom

    // neighbors
    text.push('Pointers:');
    text.push('\tptr ' + stitch.pointer);
    for(const key of ['nw1', 'nw0', 'pw1', 'pw0', 'nc', 'pc'])
      text.push('\t' + key + ' ' + stitch.get(key));
    text.push('');

    // stitch info
    text.push('Stitch:');
    for(const key of ['sy', 'sx'])
      text.push('\t' + key + ' ' + stitch.get(key).toFixed(2));
    text.push('\tst ' + stitch.getTime().toFixed(2));
    if(stitch.hasAlpha())
      text.push('\tsa ' + stitch.getAlpha().toFixed(2));
    text.push('\tsl ' + stitch.getLayerIndex());
    if(stitch.isShortRow())
      text.push('\tri ' + stitch.getShortRowIndex());
    else
      text.push('\tci ' + stitch.getCourseIndex());

    appendUserText(...text.reverse());
  }
};
