// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global CodeMirror */

// modules
const Action = require('../algo/compiler/action.js');
const geom = require('../geom.js');
const noise = require('simplenoise');
const StitchProgram = require('../algo/compiler/stitchprog.js');
const env = require('../env.js');
const { open: openPanel } = require('./panel.js');
const util = require('./util.js');

let editor = null;
let lastCode = '';
let lastCodeID = -1;
let changeID = 0;
let updateInt = -1;
let listeners = {};

function registerUpdateCallback(name, callback){
  listeners[name] = callback;
}

function editProgram(){
  // show panel
  openPanel('program');

  // editor
  if(!editor)
    initEditor();

  // save pattern to file
  const save = document.querySelector('#program-save');
  save.onclick = function(){
    util.exportFile('sprog.js', editor.getValue(), { link: save });
  };

  // load pattern from file
  const file = document.querySelector('#program-file');
  const load = document.querySelector('#program-load');
  load.onclick = function(){
    file.click();
  };
  file.onchange = function(){
    loadProgram(file.files[0]);
  };

  // set program in editor
  editor.setValue(env.global.stitchProgram || '');

  // update stream
  if(updateInt >= 0){
    clearInterval(updateInt);
    updateInt = -1;
  }
  updateInt = setInterval(updateProgram, 1000);

  generateDocu();
}

function initEditor(){
  // codemirror
  editor = CodeMirror.fromTextArea(document.querySelector('#program'), {
    lineNumbers: true, tabSize: 2, lineWrapping: true
  });
  editor.on('change', function(){
    changeID += 1;
  });
}

function storeProgram(){
  env.global.stitchProgram = editor.getValue();
  if(env.verbose)
    console.log('Storing stitch program');
}

let lastBlob = null;
function loadProgram(blob){
  if(!blob)
    blob = lastBlob;
  if(!blob)
    return;
  const reader = new FileReader();
  reader.onload = function(event){
    let data = event.target.result;
    if(data){
      editor.setValue(data);
      storeProgram();
    }
  };
  reader.readAsText(blob);
}

function updateProgram(){
  if(lastCodeID == changeID)
    return;
  const code = editor.getValue();
  if(code == lastCode)
    return;

  // cache code
  lastCode = code;
  lastCodeID = changeID;

  // update node
  storeProgram();

  // provide error feedback
  const info = document.querySelector('#program-info');
  const err = StitchProgram.check(code);
  if(err){
    info.classList.add('error');
    info.textContent = err;

  }else {
    // no error until here
    info.classList.remove('error');
    info.textContent = 'No error';

    // trigger update
    triggerUpdate();
  }

  // stop update when closing panel
  if(document.querySelector('#program-editor').classList.contains('closed')){
    clearInterval(updateInt);
    updateInt = -1;
  }
}

function triggerUpdate(){
  // trigger update
  for(const callback of Object.values(listeners)){
    callback();
  }
}

function generateDocu(){
  // generate documentation
  const docu = document.querySelector('#program-docu');
  // documentation object
  const objects = {
    'prog': StitchProgram.prototype,
    'Action': Action,
    'geom': geom,
    // 'kn.*': KnitSelection.prototype,
    'noise': noise,
    'math': {}
  };
  // Math is not enumerable
  ['abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atan2', 'atanh', 'cbrt', 'ceil', 'clz32', 'cos', 'cosh', 'exp', 'expm1', 'floor', 'fround', 'hypot', 'imul', 'log', 'log10', 'log1p', 'log2', 'max', 'min', 'pow', 'random', 'round', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh', 'trunc'].forEach(function(funName){
    objects.math[funName] = Math[funName];
  });
  ['E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'PI', 'SQRT1_2', 'SQRT2'].forEach(function(constName){
    objects.math[constName] = Math[constName];
  });

  // extra help
  const helpText = {
    'prog': 'chainable program methods',
    'Action': 'user action handler',
    'geom': 'geometric functions',
    'noise': 'pseudo-random noise',
    'math': 'math functions'
  };

  // documentation
  let docSource = '';
  for(const name in objects){
    const o = objects[name];
    docSource += '<li><label class="field" for="docu-' + name + '"><strong>' + name + '</strong> (' + helpText[name] + ')</label>';
    docSource += '<input type="checkbox" id="docu-' + name + '" class="field"><ul>';
    const isObj = Object.getPrototypeOf(o) === Object.prototype;
    const entries = isObj ? Object.entries(o) : [];
    if(entries.length === 0){
      entries.push(...Object.getOwnPropertyNames(o).flatMap(name => {
        const descr = Object.getOwnPropertyDescriptor(o, name);
        if(['constructor', 'name', 'prototype', 'length'].includes(name)
        || descr.get)
          return []; // skip constructor and getters
        else
          return [ [name, o[name]] ];
      }));
    }
    for(const [prop, value] of entries){
      let type;
      if(typeof(value) == 'function')
        type = 'fun';
      else
        type = 'const';
      docSource += '<li class="' + type + '"><code>';
      docSource += type;
      docSource += ' ' + name + '.<strong>' + prop + '</strong>';
      if(type == 'fun')
        docSource += '(' + ('xyzabcdef'.slice(0, value.length).split('').join(',')) + ')';
      docSource += '</code></li>';
    }
    docSource += '</ul></li>';
  }
  docu.innerHTML = docSource;

}

// export
module.exports = { editProgram, registerUpdateCallback, triggerUpdate };
