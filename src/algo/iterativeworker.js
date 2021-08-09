// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');

class IterativeWorker {
  constructor(preload = []){
    // worker definition
    this.stages = [];
    this.postMessage = () => assert.error('postMessage was not created correctly', this);
    // initial promises to resolve
    this.resolveList = preload;
    // state
    this.transferDelta = 150;
    this.updateDelta = 60;
    this.timeout = -1;
    this.lastUT = 0; // last update time
    this.lastTT = 0; // last transfer time
    // iteration index
    this.stage = 0;
    this.subStage = 0;
  }

  doStep(){
    const { stage, subStage } = this;
    const stageIter = this.stages[this.stage];
    // extract information
    const { algorithms, steps } = stageIter;
    assert(algorithms, 'Invalid iteration stage', algorithms);
    assert(0 <= subStage && subStage < steps.length, 'Invalid sub stage', subStage, steps);
    const [ stepFun, msg ] = steps[subStage];
    const message = typeof msg === 'function' ? msg(algorithms[0]) : msg;

    // do iteration and compute parallel state
    const done = algorithms.map(algo => {
      const res = stepFun(algo);
      return res || res === undefined; // undefined => always done by default
    });
    const fullyDone = done.every(isDone => isDone !== false);
    const progress = algorithms.reduce((sum, algo) => sum + algo.progress(), 0) / algorithms.length;

    // return data
    const retData = {
      progress: fullyDone ? 1 : progress,
      stage, subStage, message,
      done: fullyDone
    };
    // store data function if outputting
    if(stageIter.outputs[subStage]){
      const index = subStage;
      retData.minimize = () => {
        delete retData.minimize; // cannot be cloned
        stageIter.data(algorithms, retData, index);
        return retData;
      };
    }
    // update stage
    if(fullyDone){
      ++this.subStage;
      if(this.subStage === stageIter.steps.length){
        ++this.stage;
        this.subStage = 0;
      }
    }
    return retData;
  }
  
  update(){
    // if meshes disappeared, we should stop
    if(!this.stages || !this.stages.length){
      this.timeout = -1;
      return;
    }

    // if we have promises to resolve, take care of them
    if(this.resolveList.length){
      // resolve all promises
      const list = this.resolveList.slice();
      this.resolveList = [];
      Promise.all(list).then(() => {
        // go on with updates
        this.scheduleUpdate();

      }).catch(err => {
        // log error
        console.error(err);
        // but we still want an update
        this.scheduleUpdate();
      });
      return;
    }

    let event;
    let nextUpdateTime = this.lastUT + this.updateDelta;
    do {
      // do one stage iteration step
      event = this.doStep();

      // until we've spent enough time for an update
    } while(Date.now() < nextUpdateTime && !event.done);

    // send update information
    if(Date.now() >= this.lastTT + this.transferDelta || event.done){
      // transfer
      const data = Object.assign(event.minimize ? event.minimize() : event);
      if(!('stage' in data))
        data.stage = this.stage;
      this.postMessage(data, data.buffers || []);
      this.lastUT = this.lastTT = Date.now();
    } else {
      const { progress = 1, message = '', stage: iterStage = this.stage, empty = false } = event;
      this.postMessage({ stage: iterStage, progress, message, empty });
      this.lastUT = Date.now();
    }
    // unless we're fully done, we schedule another update
    // this is so that we can receive updates (non-blocking)
    if(!event.done || this.stage < this.stages.length){
      this.timeout = setTimeout(() => this.update(), 0);
    }
  }
  
  clearUpdate(){
    if(this.timeout > -1){
      clearTimeout(this.timeout);
      this.timeout = -1;
    }
  }

  scheduleUpdate(){
    clearTimeout(this.timeout);
    // clear timings
    this.lastUT = Date.now();
    this.timeout = setTimeout(() => this.update(), 0);
  }

  static create(onMessage, preload = []){
    assert(typeof onMessage === 'function',
      'Invalid argument, should be a function', onMessage);
    const iterWorker = new IterativeWorker(preload);
    return function(self){
      iterWorker.postMessage = self.postMessage.bind(self);
      self.addEventListener('message', function(event){
        // reset
        if(event.data){
          // update timings (if passed as parameters)
          if(event.data.transferDelta)
            iterWorker.transferDelta = event.data.transferDelta;
          if(event.data.updateDelta)
            iterWorker.updateDelta = event.data.updateDelta;
          // create stages and schedule update => worker starting!
          iterWorker.stages = onMessage(event.data, iterWorker.stages);
          iterWorker.scheduleUpdate();
        } else {
          iterWorker.stages = []; // reset
          iterWorker.clearUpdate();
          iterWorker.postMessage(null); // clearing channel
        }
        iterWorker.stage = 0; // always start at stage 0
        iterWorker.subStage = 0;
      });
    };
  }
}

module.exports = IterativeWorker;