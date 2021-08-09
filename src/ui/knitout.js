// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global CodeMirror */

// modules
const assert = require('../assert.js');
const env = require('../env.js');
const { isOpen: isPanelOpen } = require('./panel.js');
const Knitout = require('../knitout.js');
const util = require('./util.js');

let editor = null;
let processing = false;
function withoutUpdate(f){
  processing = true;
  try {
    f();
  } finally {
    processing = false;
  }
}
function editKnitout(knitoutTarget){
  const target = document.getElementById('knitout_target');
  if(!knitoutTarget)
    knitoutTarget = target.value;
  else
    target.value = knitoutTarget;
  target.onchange = function(){
    editKnitout(target.value);
  };

  // editor
  if(!editor)
    initEditor();

  // save pattern to file
  const save = document.getElementById('save_knitout');
  save.onclick = function(){
    const code = editor.getValue();
    const fname = knitoutTarget.endsWith('.k') ? knitoutTarget : knitoutTarget + '.k';
    util.exportFile(fname, code, { type: 'application/knitout', link: save });
  };

  // load pattern from file
  const file = document.getElementById('file_knitout');
  const load = document.getElementById('load_knitout');
  load.onclick = function(){
    file.click();
  };
  file.onchange = function(){
    loadKnitout(file.files[0]);
  };

  // set pattern
  selectKnitout(knitoutTarget);
}

function resetTargets(){
  const target = document.getElementById('knitout_target');
  while(target.firstChild)
    target.removeChild(target.firstChild);

  // add options
  for(const source of env.getOutputSources()){
    const outputs = env.getOutputs(source);
    assert(outputs.length >= 1, 'Invalid outputs');
    if(outputs.length === 1){
      target.appendChild(util.createOption(source, util.capitalize(source)));
    } else {
      for(let i = 0; i < outputs.length; ++i){
        target.appendChild(util.createOption(
          source + '_' + i,
          util.capitalize(source) + ', part ' + (i + 1)
        ));
      }
    } // endif else
  } // endfor source
}

function trimIndentation(str){
  return str.replace(/(^|\n)(\s+)/g, '$1');
}

function initEditor(){
  // trim left indentation
  const knitout = document.getElementById('knitout');
  knitout.textContent = trimIndentation(knitout.textContent);
  // codemirror
  editor = CodeMirror.fromTextArea(knitout, {
    lineNumbers: true,
    tabSize: 2,
    lineWrapping: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    mode: 'application/knitout'
  });
  editor.on('change', () => {
    storeKnitout();
  });

  // target change
  env.addOutputListener((outputs, source) => {
    if(processing)
      return; // skip update
    resetTargets();
    if(!isPanelOpen('knitout'))
      return;
    if(outputs.length > 1){
      editKnitout(source + '_0');
    } else {
      editKnitout(source);
    }
  });

  // documentation
  const docu = document.getElementById('knitout_docu');
  let docSource = '';
  const typeNames = {
    [Knitout.DIRECTION]:    'direction: + or -',
    [Knitout.NEEDLE]:       'needle: e.g. f10, b-42, fs8',
    [Knitout.CARRIERS]:     'carrier list (one or multiple)',
    [Knitout.RACKING]:      'racking: e.g. 0.75, -4, 1.25',
    [Knitout.STITCH_UNIT]:  'stitch unit (integer)'
  };
  for(const [opName, ...argTypes] of Knitout.OPERATIONS){
    if(opName.length === 0)
      continue;
    docSource += '<li><strong>' + opName + '</strong> <ul>';
    for(const type of argTypes){
      docSource += '<li><code title="' + typeNames[type] + '">' + type + '</code></li>';
    }
    docSource += '</ul></li>';
  }
  docu.innerHTML = docSource;
}

function selectKnitout(knitoutTarget){
  if(!knitoutTarget.length){
    // update editor from itself
    editor.refresh();
    return;
  }
  console.log('Selecting knitout target', knitoutTarget);
  let k;
  if(env.hasOutputSource(knitoutTarget)){
    const ks = env.getOutputs(knitoutTarget);
    assert(ks.length === 1, 'Direct source with no or multiple outputs?');
    k = ks[0];
    // record selection
    env.setSelectedOutput(knitoutTarget, 0);

  } else {
    // likely partial output sketch_i
    const [source, part] = knitoutTarget.split('_');
    assert(env.hasOutputSource(source), 'Output source not found', source, knitoutTarget);
    // get source
    const ks = env.getOutputs(source);
    const idx = parseInt(part) || 0;
    k = ks[idx];
    // record selection
    env.setSelectedOutput(source, idx);

  }
  // set code
  if(k){
    const code = k.toString();
    withoutUpdate(() => {
      editor.setValue(code);
    });
  }
}

let storeTimeout = -1;
const storeTiming = 3000;
function storeKnitout(){
  // prevent timeout from happening
  clearTimeout(storeTimeout);

  // try extracting knitout data
  const knitoutTarget = document.getElementById('knitout_target').value;
  const info = document.getElementById('knitout_info');
  assert.catching(() => {
    const k = Knitout.from(editor.getValue(), env.verbose, true); // keep empty lines
    if(k){
      if(env.verbose)
        console.log('Checked knitout', knitoutTarget);

      // only save after N idle seconds
      storeTimeout = setTimeout(() => {
        withoutUpdate(() => {
          if(!knitoutTarget.length)
            return; // nothing to do
          if(env.verbose)
            console.log('Storing knitout', knitoutTarget);
          if(knitoutTarget.endsWith('.k')){
            env.setOutputs([ k ], knitoutTarget);
          } else {
            const [ source, part ] = knitoutTarget.split('_');
            const i = parseInt(part) || 0;
            const list = env.getOutputs(source) || [];
            list[i] = k;
            env.setOutputs(list, source);
          }
        });
      }, storeTiming);
    } // endif k

    // no error until here
    info.classList.remove('error');
    info.textContent = 'No error';

  }, err => {
    info.classList.add('error');
    info.textContent = err;
  });
}

let lastFile = null;
function loadKnitout(file, fname, callback){
  if(!file)
    file = lastFile;
  if(!file)
    return;
  if(!fname)
    fname = file.name || '?.k';
  let reader = new FileReader();
  reader.onload = function(event){
    let data = event.target.result;
    if(!data){
      if(callback)
        callback();
      return;
    }
    // try generating a Knitout file
    try {
      const k = Knitout.from(data, env.verbose, true);
      // store as outputs
      env.setOutputs([ k ], fname);

    } catch(err){
      console.log('Error with knitout file', data);
    }
    // callback
    if(callback)
      callback();
  };
  reader.readAsText(file);
}

function initKnitout(){
  if(!editor)
    initEditor();
}

// export
module.exports = { initKnitout, editKnitout, loadKnitout };
