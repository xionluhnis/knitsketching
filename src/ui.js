// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global dialogPolyfill */

// modules
const assert = require('./assert.js');
const { initKnitout, editKnitout, loadKnitout } = require('./ui/knitout.js');
const { editProgram } = require('./ui/program.js');
const { editPCurve } = require('./ui/parametric.js');
const { initHistory, editHistory, setHistoryType, createSnapshot } = require('./ui/history.js');
const { initSketch, loadSVG, loadSketch, exportKnitoutData } = require('./ui/sketch.js');
const { initKnitoutLayout, refreshKnitoutLayout } = require('./ui/output-knitout.js');
const { initSimulation, viewSimulation } = require('./ui/output-simulation.js');
const { initSettings } = require('./ui/settings.js');
const { getMeshes } = require('./algo/flow.js');
const util = require('./ui/util.js');
const env = require('./env.js');
const { editPattern } = require('./ui/pattern.js');
const { initTextUI } = require('./ui/textui.js');
const Panel = require('./ui/panel.js');

function triggerEvent(element, eventType){
  try{
    const event = new Event(eventType);
    return element.dispatchEvent(event);
  } catch(err){}
}

function init(actions){
  if(!actions)
    actions = [];
  if(typeof actions == 'string'){
    actions = actions.split(',').filter(str => str.length).map(token => {
      return token.split(':');
    });
  }
  for(let act of actions){
    // parsing
    let what, args;
    if(Array.isArray(act)){
      what = act.shift();
      args = act;
    } else {
      what = act;
      args = [];
    }
    // actual actions
    try {
      switch(what){
        case 'open':
          Panel.open(args.join());
          break;
        case 'close':
          Panel.close(args.join());
          break;
        case 'panel':
          document.querySelector('#sidebar .tab[data-panel=' + args.join() + '-editor]').click();
          break;
        case 'swap':
          Panel.swap(args.join());
          break;
        case 'click':
          document.getElementById(args[0]).click();
          break;
        case 'set': {
          const el = document.getElementById(args[0]);
          if(el.type === 'checkbox'){
            const prev = !!el.checked;
            const value = !!args[1].match(/true|on|1/i);
            if(prev !== value)
              el.click();
          } else
            el.value = args[1];
          if(el.onchange)
            el.onchange();
          
          triggerEvent(el, 'change');
        } break;
        case 'check':
        case 'uncheck': {
          const el = document.getElementById(args[0]);
          el.checked = what == 'check';
          if(el.onchange)
            el.onchange();
          triggerEvent(el, 'change');
          if(el.onclick)
            el.onclick();
          triggerEvent(el, 'click');
        } break;
        case 'mode':
          env.setOutputMode(args[0]);
          break;
        case 'sketch-mode':
          document.querySelector('#sketch-mode input[value=' + args[0] + ']').click();
          break;
        case 'history':
          document.getElementById('history-type').value = args[0];
          setHistoryType(args[0]);
          break;
        case 'sketch-scale': // common alias
          args = ['sizing', 'sketch', 'scale', ...args];
          /* fall through */
        case 'env': {
          let container = env.global;
          for(let i = 0; i < args.length - 2; ++i)
            container = container[args[i]];
          const type = typeof container[args[args.length - 2]];
          let value = args[args.length - 1];
          if(type === 'number')
            value = parseFloat(value);
          else if(type === 'boolean')
            value = value === 'true';
          else
            assert(type === 'string', 'Unsupported type', type);
          container[args[args.length - 2]] = value;
        } break;
        default:
          console.log('Unsupported action ', what, ' with arguments ', args.join(':'));
          break;
      }
    } catch (err){
      console.warn(err);
    }
  }
  initHistory();
}

function loadFile(name, file, cb, reset = true){
  const callback = (...args) => {
    // call real callback first
    if(cb)
      cb(...args);
    // create history snapshot from "click"
    createSnapshot('load ' + name, 'click');
  };
  if(name.endsWith('.k')){
    loadKnitout(file, name.split('/').pop(), callback);
  } else if(name.endsWith('.svg'))
    loadSVG(file, callback);
  else if(name.endsWith('.sk') || name.endsWith('.json'))
    loadSketch(file, callback, reset);
  else {
    console.log('Unsupported file', name);
    return;
  }
}

function exportData(linkSrc){
  let fname;
  let blob;
  switch(env.getOutputMode()){

    case 'sketch': {
      const str = JSON.stringify(env.serialize());
      fname = 'sketch.json';
      blob = new Blob([str], {type: 'application/json'});
    } break;

    case 'knitout': {
      const { source, index } = env.getSelectedOutput();
      if(source === 'Sketch'){
        exportKnitoutData(linkSrc);
        return;

      } else {
        // get knitout data directly
        fname = source;
        blob = new Blob([(env.getOutputs(source) || [''])[index].toString()], { type: 'octet/stream' });
      }
    } break;

    case 'yarn': {
      // let data = env.serializeSkeleton();
      const data = env.serialize();
      const str = JSON.stringify(data);
      fname = 'sketch.json';
      blob = new Blob([str], { type: "octet/stream" });
    } break;

    default:
      assert.error('Export mode not supported');
      return;
  }
  util.exportFile(fname, blob, { link: linkSrc });
}

function initUI(){

  // initialize panels
  Panel.init();

  // init sketch interface
  initSketch();
  initSimulation();
  initSettings();
  initKnitout();
  initKnitoutLayout();
  initTextUI();

  // create logic for file save / load
  const file = document.getElementById('file');
  const load = document.getElementById('load');
  const server = document.getElementById('load_server');
  load.addEventListener('click', () => {
    // transfer to file
    file.click();
  });
  file.addEventListener('change', () => {
    if(file.files.length){
      const f = file.files[0];
      const name = f.name.toLowerCase();
      loadFile(name, f);
    }
    file.value = ''; // to allow loading the same file multiple times
  });
  document.getElementById('file-add').addEventListener('change', event => {
    if(event.target.files.length){
      const f = event.target.files[0];
      const name = f.name.toLowerCase();
      loadFile(name, f, null, false);
    }
    event.target.value = ''; // to allow loading the same file multiple times
  });
  const dialog = document.getElementById('loadfile');
  dialogPolyfill.registerDialog(dialog);
  server.addEventListener('click', () => {
    // show dialog
    dialog.showModal();
  });
  fetch('sketches/list.json')
    .then(res => res.json())
    .then(json => {
    assert(Array.isArray(json), 'Invalid list');
    while(dialog.firstChild)
      dialog.removeChild(dialog.firstChild);
    for(const entry of json){
      let item;
      if(typeof entry === 'string')
        item = util.createElement('div', 'section', entry);
      else {
        assert('path' in entry, 'Invalid entry without path');
        const path = entry.path || '?';
        let params = entry.params || '';
        if(Array.isArray(params))
          params = params.join(',');
        assert(typeof params === 'string', 'Invalid params type');
        const linkName = path.replace(/([^\/]*\/)/g, '').replace(/\..*$/, '');
        item = util.createElement('a', 'link', linkName);
        item.dataset.params = params;
        const scale = (params.match(/env:sizing:sketch:scale:([^,]+)/) || [])[1];
        if(scale)
          item.dataset.scale = scale;
        item.title = params.replace(/,/g, ' | ');
        item.href = './index.html?loadPath=sketches/' + path;
        if(params.length)
          item.href += '&init=' + params;
      }
      dialog.appendChild(item);
    }
    const close = util.createElement('a', 'close', 'close');
    dialog.appendChild(close);
    close.onclick = () => dialog.close();
  });

  const save = document.getElementById('save');
  save.addEventListener('click', () => {
    exportData(save);
  });

  // output type
  const updateOptions = mode => {
    const outputPanel = document.getElementById('output');
    outputPanel.className = mode;
  };
  env.addOutputModeListener(mode => {
    updateOptions(mode);
    // special cases
    if(mode === 'knitout')
      refreshKnitoutLayout();
  });
  updateOptions(env.getOutputMode());

  // global parameters
  for(const elem of document.querySelectorAll('#settings [data-env]')){
    const name = elem.dataset.env;
    assert(name in env.global, 'Environment variable missing');
    if(typeof env.global[name] === 'string'){
      elem.addEventListener('change', () => {
        env.global[name] = elem.value;
        // XXX trigger pipeline update
      });

    } else if(typeof env.global[name] === 'number'){
      elem.addEventListener('change', () => {
        env.global[name] = parseFloat(elem.value);
        // XXX trigger pipeline update
      });

    } else {
      elem.addEventListener('click', () => {
        env.global[name] = elem.checked;
        // update class of body
        if(name === 'verbose'
        || name === 'expertMode'){
          const shortName = name.replace('Mode', '');
          document.body.classList.toggle(shortName, !!elem.checked);
        }
        // XXX trigger pipeline update
      });
    }
  }

  // mesh profiles
  const meshProfile = document.getElementById('mesh_profile');
  const meshParams = [
    ['mesh_levels', 'meshLevels'],
    ['level_factor', 'levelFactor'],
    ['min_resolution', 'minResolution']
  ];
  meshProfile.addEventListener('change', () => {
    const profile = meshProfile.value;
    meshProfile.parentNode.classList.toggle(
      'custom', profile === 'custom'
    );
    if(profile === 'custom'){
      for(const [id, key] of meshParams){
        const value = parseInt(document.getElementById(id).value);
        env.global[key] = value;
      }
    } else {
      for(const [, key, val,] of profile.matchAll(/([^=,]+)\=([^,]+)/g)){
        assert(key in env.global, 'Invalid key', key);
        const value = parseInt(val);
        env.global[key] = value;
      }
    }
  });

  // geodesic information
  for(const geoId of [
    'geodesic_mode',
    'geodesic_refinement',
    'refinement_threshold'
  ]){
    const el = document.getElementById(geoId);
    const updateParameters = () => {
      for(const mesh of getMeshes()){
        mesh.updateDistanceParameters(env.global);
      }
    };
    el.addEventListener('change', updateParameters);
    el.addEventListener('click', updateParameters);
  }

  // initialize sidebar tabs
  for(const [panel, func] of [
    ['simulation', () => viewSimulation()],
    ['knitout', () => editKnitout()],
    ['parametric', () => editPCurve()],
    ['program', () => editProgram()],
    ['pattern', () => editPattern()],
    ['history', editHistory]]){
    const tab = document.querySelector('#sidebar .tab[data-panel=' + panel + '-editor]');
    assert(tab, 'Selector did not match anything for panel ' + panel);
    tab.onclick = () => {
      if(Panel.toggle(panel + '-editor'))
        func();
    };
  }

  // @see https://developer.mozilla.org/en-US/docs/Web/API/URL/searchParams#Example
  const params = (new URL(document.location)).searchParams;
  const loadPath = params.get('loadPath');
  const initActions = params.get('init');
  if(loadPath){
    // note: this requires running from an http server (for security reasons)
    fetch(loadPath)
      .then(res => res.blob())
      .then(res => {
        loadFile(loadPath, res, () => init(initActions));
      })
      .catch(err => console.log('Load path error: ', err));
  } else {
    init(initActions);
    // create initial empty snapshot
    createSnapshot('start', 'click');
  }
}

window.addEventListener('load', initUI);