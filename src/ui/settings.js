// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global CodeMirror */

// modules
const env = require('../env.js');
const util = require('./util.js');
const CarrierConfig = require('../carriers.js');

let editor = null;

function editSettings(settingName){
  const target = document.getElementById('settings_target');
  if(!settingName)
    settingName = target.value;
  target.onchange = function(){
    editSettings(target.value);
  };

  // editor
  if(!editor)
    initEditor();

  // save pattern to file
  let save = document.querySelector('#save_settings');
  save.onclick = function(){
    const code = editor.getValue();
    util.exportFile(target.value + '.json', code, { type: 'application/json', link: save });
  };

  // load pattern from file
  let file = document.getElementById('file_settings');
  let load = document.getElementById('load_settings');
  load.onclick = function(){
    file.click();
  };
  file.onchange = function(){
    loadSettings(file.files[0]);
  };

  // set pattern
  selectSettings(settingName);
}

function initEditor(){
  // codemirror
  editor = CodeMirror.fromTextArea(document.getElementById('settings_editor'), {
    lineNumbers: true,
    tabSize: 2,
    lineWrapping: true,
    matchBrackets: true,
    autoCloseBrackets: true,
    mode: 'application/ld+json'
  });
  editor.on('change', function(){
    storeSettings();
  });
}

function selectSettings(settingName){
  let code = '';
  code = JSON.stringify(env.global[settingName] || {}, null, "\t");
  editor.setValue(code || '{}');
}

function storeSettings(){
  const settingName = document.getElementById('settings_target').value;
  const info = document.getElementById('settings_info');
  try {
    const settings = JSON.parse(editor.getValue());
    if(settings){
      // checks depending on the setting type
      if(settingName === 'carriers')
        CarrierConfig.check(settings);
        
      // actually set it
      env.global[settingName] = settings;
      if(env.verbose)
        console.log('Storing settings', settingName, settings);
    }

    // no error until here
    info.classList.remove('error');
    info.textContent = 'No error';

  } catch(err){
    info.classList.add('error');
    info.textContent = err;
  }
}

let lastBlob = null;
function loadSettings(blob){
  if(!blob)
    blob = lastBlob;
  if(!blob)
    return;
  let reader = new FileReader();
  reader.onload = function(event){
    let data = event.target.result;
    if(data){
      editor.setValue(data);
      storeSettings();
      editSettings();
    }
  };
  reader.readAsText(blob);
}

function initSettings(){
  env.addOutputModeListener(output => {
    if(output === 'yarn'){
      setTimeout(() => {
        editSettings();
      }, 500);
    }
  });
}

// export
module.exports = { editSettings, initSettings };
