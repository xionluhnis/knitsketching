// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const moment = require('moment');
const assert = require('../assert.js');
const env = require('../env.js');
const util = require('./util.js');

// variables
const snapshots = [];
const intervalTime = 5000; // every 5s
let interval = -1;
let historyPointer = -1;
let historySize = Infinity;

function getHistoryType(){
  return document.getElementById('history-type').value;
}

function snapshotTime(){
  return (snapshots[historyPointer] || { time: 0 }).time;
}

function createSnapshot(label, type){
  if(!type)
    type = getHistoryType();
  else {
    // skip if not the correct type (unless from a click)
    if(getHistoryType() !== type && type !== 'click')
      return;
  }
  if(!type || !type.length || type === 'none')
    return;
  const snap = env.serialize();
  if(!isDifferent(snap))
    return; // skip if the snapshot has nothing new (except its time)
  
  // annotate snapshot
  snap.time  = +new Date();
  snap.label = label || 'Snapshot';
  snap.type  = type;
  
  // act depending on pointer location
  if(0 <= historyPointer && historyPointer < snapshots.length - 1){
    while(historyPointer < snapshots.length - 1)
      snapshots.pop();
  }
  snapshots.push(snap); // add at the end

  // constraint memory
  if(snapshots.length > historySize){
    // remove extraneous block
    snapshots.splice(0, snapshots.length - historySize);
  }

  // update pointer to be at the end
  historyPointer = snapshots.length - 1;

  // update history UI if open
  if(isHistoryVisible()){
    editHistory();
  }
  // update undo-redo UI
  updateUndoRedo();
}

function isHistoryVisible(){
  return !document.getElementById('history-editor').classList.contains('closed');
}

function storeLocalSnapshot(snap){
  if(!snap)
    snap = snapshots[snapshots.length - 1];
  if(!snap)
    return; // nothing to do
  try {
    const store = window.localStorage;
    store.setItem('history', JSON.stringify(snap));
  } catch (err) {
    assert.error(err);
  }
}

function getLocalSnapshot(){
  let snap = null;
  try {
    const store = window.localStorage;
    const value = store.getItem('history');
    snap  = JSON.parse(value);

  } catch (err) {
    assert.error(err);
  }
  return snap;
}

function loadLocalSnapshot(){
  const snap = getLocalSnapshot();
  if(snap){
    snap.label = 'previous session';
    snapshots.push(snap);
    historyPointer = snapshots.length - 1;
  }
}

function isDifferent(snap){
  if(!snapshots.length || historyPointer < 0)
    return true; // different from nothing
  // else check which to compare
  return isDifferentFrom(
    snap,
    snapshots[historyPointer] || {}
  );
}

function isDifferentFrom(snap, other){
  const ctxQueue = Object.keys(snap).map(key => {
    return { key, src: snap, trg: other };
  });
  while(ctxQueue.length){
    let { key, src, trg } = ctxQueue.pop();
    if(key == 'time')
      continue; // do not treat those keys as different
    const srcVal = src[key];
    const trgVal = trg[key];
    const srcType = typeof srcVal;
    const trgType = typeof trgVal;
    // check types
    if(srcType !== trgType)
      return true;
    // typed check
    switch(srcType){
      case 'boolean':
      case 'number':
      case 'string':
        if(srcVal !== trgVal)
          return true;
        break;
      default: {
        // undefined / null
        let isNull = false;
        for(const val of [null, undefined]){
          if(srcVal === val){
            isNull = true;
            if(trgVal !== val)
              return true;
          } else if(trgVal === val){
            isNull = true;
            if(srcVal !== val)
              return true;
          }
          // else neither is
        }
        // null value cannot be introspected
        if(isNull)
          continue;
        // thus we should be able to introspect
        // let's just make sure (better safe than sorry)
        assert(srcVal && trgVal,
          'Introspecting value that cannot be');
        // array
        if(Array.isArray(srcVal)){
          // check length
          if(srcVal.length !== trgVal.length)
            return true;
          // check all children values
          for(let i = 0; i < srcVal.length; ++i)
            ctxQueue.push({ key: i, src: srcVal, trg: trgVal });
        } else {
          // object
          const srcKeys = Object.keys(srcVal);
          const trgKeys = Object.keys(trgVal);
          // check number of keys
          if(srcKeys.length !== trgKeys.length)
            return true;
          // check all key values
          for(const newKey of srcKeys){
            // check that other has the key
            if(!(newKey in trgVal))
              return true;
            // check corresponding mapping
            ctxQueue.push({ key: newKey, src: srcVal, trg: trgVal });
          }
        }
      } break;
    }
    // the same up to this level
  }
  return false;
}

function editHistory(){
  const list = document.getElementById('history');
  // clear history list
  while(list.firstChild)
    list.removeChild(list.firstChild);
  // generate history list
  for(let i = 0; i < snapshots.length; ++i){
    const snap = snapshots[i];
    const item = document.createElement('li');
    // highlight current snapshot
    if(i === historyPointer){
      item.classList.add('current');
    }
    // time information
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = moment(snap.time).fromNow();
    item.appendChild(time);
    // label
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = snap.label;
    item.appendChild(label);
    // summary
    const summary = document.createElement('span');
    summary.className = 'summary';
    const sNum = snap.sketch.sketches.length;
    const cNum = snap.sketch.curves.length;
    const iNum = snap.sketch.images.length;
    summary.textContent = (sNum + cNum + iNum) + ' objects: '
                        + sNum + 's ' + cNum + 'c ' + iNum + 'i';
    item.appendChild(summary);
    // add all to list
    list.appendChild(item);
    item.addEventListener('click', () => {
      loadHistory(snap);
    });
  }

  const save = document.getElementById('save_history');
  save.addEventListener('click', () => {
    const str = JSON.stringify(snapshots);
    util.exportFile('history.json', str, { link: save });
  });
  const load = document.getElementById('load_history');
  const file = document.getElementById('file_history');
  load.onclick = function(){
    file.click();
  };
  file.onchange = function(){
    loadHistoryFile(file.files[0]);
  };
}

function setHistoryType(type){
  clearInterval(interval);
  switch(type){
    case 'by-action':
      break;
    case 'by-time':
      interval = setInterval(() => {
        createSnapshot('Timed');
      }, intervalTime);
      break;
    default:
      // nothing to do
      return;
  }
  // if empty history, create initial snapshot
  if(snapshots.length === 0){
    createSnapshot('initial', type);
  }
}

function loadHistory(snap, noSnapshot){
  // load serialized history
  env.load(snap, true);

  // if history on, this creates a new history snapshot
  if(!noSnapshot){
    const idx = snapshots.indexOf(snap);
    createSnapshot('load (' + (idx != -1 ? idx + 1 : '?') + ')', 'click');
  }

  // update UI
  const { updateSketch } = require('./sketch.js');
  updateSketch(true); // and center
}

function initHistory(){
  // list to history type change
  document.getElementById('history-type').addEventListener('change', event => {
    setHistoryType(event.target.value);
  });
  document.getElementById('history-size').addEventListener('change', event => {
    historySize = parseInt(event.target.value) || Infinity;
    if(env.verbose)
      console.log('History size set to ' + historySize);
  });
  // load initial local snapshot
  loadLocalSnapshot();
  // register handler to store to local storage before closing app
  window.addEventListener('beforeunload', () => {
    storeLocalSnapshot(); // to allow reloading the last session
  });

  if(!snapshots.length){
    setHistoryType(getHistoryType());
  }
  // set undo/redo actions and states
  document.getElementById('undo').addEventListener('click', undoHistory);
  document.getElementById('redo').addEventListener('click', redoHistory);
  updateUndoRedo();
}

let lastBlob = null;
function loadHistoryFile(blob){
  if(!blob)
    blob = lastBlob;
  if(!blob)
    return;
  const reader = new FileReader();
  reader.onload = function(event){
    let data = event.target.result;
    if(!data)
      return;
    let list;
    try {
      list = JSON.parse(data);
    } catch(err){
      console.log('Error while loading history file:', err);
      return;
    }
    if(!list){
      console.log('Invalid history file');
      return;
    }
    if(!Array.isArray(list)){
      console.log('History file must contain an array of snapshots');
      return;
    }
    // replace current snapshots
    snapshots.splice(0, snapshots.length);
    snapshots.push(...list);
    historyPointer = snapshots.length - 1;

    // loading the last snapshot, without creating a new one for that
    loadHistory(snapshots[historyPointer], true);

    // update this panel
    editHistory();
  };
  reader.readAsText(blob);
}

function updateUndoRedo(){
  const type = getHistoryType();
  document.getElementById('undo').disabled = 
    historyPointer <= 0 || type === 'none';
  document.getElementById('redo').disabled = 
    historyPointer >= snapshots.length - 1 || type === 'none';
}

function undoHistory(){
  if(historyPointer <= 0){
    updateUndoRedo();
    return false;
  }
  // go back in history
  loadHistory(snapshots[--historyPointer], true); // do not record change
  // update history UI if open
  if(isHistoryVisible())
    editHistory();
  // update UI states
  updateUndoRedo();
  return true;
}

function redoHistory(){
  if(historyPointer >= snapshots.length - 1){
    updateUndoRedo();
    return false; // cannot redo anything
  }
  loadHistory(snapshots[++historyPointer], true); // do not record change
  // update history UI if open
  if(isHistoryVisible())
    editHistory();
  // update UI states
  updateUndoRedo();
  return true;
}

module.exports = {
  createSnapshot,
  initHistory,
  editHistory,
  setHistoryType,
  getLocalSnapshot,
  loadLocalSnapshot,
  storeLocalSnapshot,
  snapshotTime
};
