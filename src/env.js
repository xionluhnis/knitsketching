// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// import
const assert = require('./assert.js');
const defaultGlobal = require('./defaults.js');

// private stores
const selectedOutput = { source: null, index: 0 };
const outputStore = new Map();
const outputListeners = new Set();

// export
const env = module.exports = {
  // global variables
  global: defaultGlobal(),

  // special parameter
  get verbose(){
    return env.global.verbose;
  },
  set verbose(v){
    env.global.verbose = v;
  },

  resetGlobal(){
    env.global = defaultGlobal();
  },

  // output management
  setOutputs(data, source = 'Sketch'){
    assert(Array.isArray(data), 'Outputs must be an array of Knitout objects', data);
    assert(typeof source == 'string', 'Output source must be a string', source);
    outputStore.set(source, data);

    // select if it's the only one
    if(outputStore.size === 1){
      selectedOutput.source = source;
      if(selectedOutput.index >= data.length)
        selectedOutput.index = 0;
    }

    // trigger update
    for(const callback of outputListeners){
      callback(data.slice(), source);
    }
  },
  setSelectedOutput(source, index = 0){
    assert(outputStore.has(source),
      'Selected source does not exist', source, index, outputStore);
    assert(index < (env.getOutputs(source) || []).length,
      'Selected index is out of bounds', source, index, outputStore);
    selectedOutput.source = source;
    selectedOutput.index  = index;
  },
  getSelectedOutput(){
    return Object.assign({}, selectedOutput);
  },
  getOutputs(source = 'Sketch'){
    return outputStore.get(source);
  },
  getOutputSources(){
    return outputStore.keys();
  },
  hasOutputSource(source){
    return outputStore.has(source);
  },
  addOutputListener(cb){
    outputListeners.add(cb);
  },
  removeOutputListener(cb){
    assert(outputListeners.has(cb), 'Callback was not registered yet', cb, outputListeners);
    outputListeners.remove(cb);
  },

  // ui settings
  getUISetting(input){
    if(typeof input === 'string'){
      const name = input;
      input = document.getElementById(name);
      assert(input, 'Name does not match a UI input variable', input);
    }
    if(input instanceof HTMLSelectElement){
      return input.value;
    } else if(input instanceof HTMLInputElement){
      if('checked' in input)
        return input.checked;
      else
        return input.value;
    } else {
      assert.error('Unsupported html input element', input);
    }
  },
  setUISetting(name, value){
    const input = document.getElementById(name);
    if(!input){
      console.warn('Name does not match a UI input variable', name);
      return;
    }
    if((value === true || value === false) && 'checked' in input){
      input.checked = value;
    } else {
      input.value = value;
    }
  },

  // output mode
  getOutputMode(){
    const mode = Array.from(document.querySelectorAll('#context input')).filter(input => {
      return input.checked;
    })[0];
    return mode.dataset.mode;
  },
  setOutputMode(mode){
    const input = document.querySelector('#context input[data-mode=' + mode + ']');
    assert(input, 'Output mode not found', mode);
    if(input)
      input.click();
  },
  addOutputModeListener(cb){
    for(const input of document.querySelectorAll('#context input')){
      input.addEventListener('click', () => cb(input.dataset.mode));
    }
  },
  removeOutputModeListener(cb){
    for(const input of document.querySelectorAll('#context input')){
      input.removeEventListener('click', cb);
    }
  },

  // serialization
  serializeSketch(){
    const sk = require('./sketch.js');
    return sk.saveToJSON();
  },
  serializeUI(){
    const settings = document.getElementById('settings');
    const inputs = settings.querySelectorAll('select, input');
    const data = {};
    for(const input of inputs){
      data[input.id] = env.getUISetting(input);
    }
    return data;
  },
  serialize(){
    return {
      sketch: env.serializeSketch(),
      global: Object.assign({}, env.global),
      ui: env.serializeUI()
    };
  },
  // deserialization
  loadSketch(sketchData, reset = true){
    const sk = require('./sketch.js');
    // load (and reset)
    sk.loadFromJSON(sketchData, reset); // true => reset
  },
  load(envData, overwriteLoadGlobals = false, reset = true){
    // load skeleton
    assert('sketch' in envData, 'Invalid environment data');
    env.loadSketch(envData.sketch, reset);

    // the rest depends on a global parameter
    if(!overwriteLoadGlobals && !env.global.loadGlobals){
      // only load the potential stitch program
      if(envData.global
      && envData.global.stitchProgram
      && envData.global.stitchProgram.length)
        env.global.stitchProgram = envData.global.stitchProgram;
      return;
    }
      
    // load global pattern
    if('global' in envData){
      if(env.verbose){
        console.log(
          'Loading globals: '
          + Object.keys(envData.global).length + 'entries'
        );
      }
      Object.assign(env.global, envData.global, {
        loadGlobals: env.global.loadGlobals // keep current
      });
    }

    // load ui information
    for(const key in envData.ui){
      env.setUISetting(key, envData.ui[key]);
    }
  }
};
