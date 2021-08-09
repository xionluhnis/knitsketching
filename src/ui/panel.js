// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const util = require('./util.js');

// constants
const panelEvents = {};
const panelSources = {};
const panelListeners = new Map();

function register(name, toggleFunc, elem){
  assert(!(name in panelEvents), 'Double registration of a panel');
  panelEvents[name] = toggleFunc;
  panelSources[name] = elem;
}
function addListener(name, callback){
  if(panelListeners.has(name))
    panelListeners.get(name).add(callback);
  else
    panelListeners.set(name, new Set([callback]));
}
function removeListener(name, callback){
  assert(panelListeners.has(name), 'No callback for panel ', name);
  panelListeners.get(name).delete(callback);
}
function fireEvent(name, state){
  if(panelListeners.has(name)){
    assert(typeof state === 'boolean', 'Invalid state');
    for(const cb of panelListeners.get(name))
      cb(state);
  }
}
function open(name) {
  assert(name in panelEvents, 'Invalid panel');
  return (panelEvents[name] || function(){})(true);
}
function close(name) {
  assert(name in panelEvents, 'Invalid panel');
  return (panelEvents[name] || function(){})(false);
}
function isClosed(name){
  const elem = panelSources[name];
  if(!elem)
    return true;
  return elem.classList.contains('closed');
}

function panelName(el){
  return el.id.replace('-editor', '');
}

function init(){
  // initialize each panel and register them
  document.querySelectorAll('.panel').forEach(e => {
    // register globally
    const name = panelName(e);
    register(name, (state) => {
      toggle(e, state);
    }, e);
    e.dataset.title = name;
    toggle(e, false); // closed by default

    // create links
    for(const [clazz, title, text, func] of [
      ['overlay', 'Toggle overlay', '~', () => { toggleOverlay(e); }],
      ['left', 'Swap to left', '<', () => { swap(e); }],
      ['right', 'Swap to right', '>', () => { swap(e); }],
      ['hide', 'Hide panel', '', () => { toggle(e); }]
    ]){
      const link = util.createLink(clazz, title, text, func);
      e.insertBefore(link, e.firstChild);
    }
  });
}

function swap(panel, newPos){
  if(typeof panel == 'string')
    panel = document.getElementById(panel);
  assert(!!panel, 'Invalid panel');

  if(newPos === undefined)
    newPos = !panel.classList.contains('right');
  newPos = !!newPos;

  // if there's another panel on the same side, switch it off
  document.querySelectorAll('.panel').forEach(el => {
    // skip closed ones
    if(el == panel || el.classList.contains('closed'))
      return;
    // check if on the same side
    if(newPos == el.classList.contains('right')){
      // toggle off
      toggle(el, false);
    }
  });

  // set side information
  if(newPos)
    panel.classList.add('right');
  else
    panel.classList.remove('right');
}

function toggleOverlay(panel, newState){
  if(typeof panel == 'string')
    panel = document.getElementById(panel);
  assert(!!panel, 'Invalid panel');
  if(newState === undefined){
    newState = !panel.classList.contains('overlay');
  }
  // toggle this panel off
  panel.classList.toggle('overlay', newState);
}

function toggle(panel, newState){
  if(typeof panel == 'string')
    panel = document.getElementById(panel);
  assert(!!panel, 'Invalid panel');

  if(newState === undefined){
    newState = panel.classList.contains('closed');
  }

  // figure side of current panel
  const side = panel.classList.contains('right');

  if(newState){
    // check whether we need to toggle another panel off
    // or if we can toggle this current panel onto the other side
    const others = []; // the other visible panels
    document.querySelectorAll('.panel').forEach(el => {
      if(el != panel && !el.classList.contains('closed'))
        others.push(el);
    });
    // check occupancy
    const sameSide = others.filter(el => el.classList.contains('right') == side);
    const oppoSide = others.filter(el => el.classList.contains('right') != side);
    // is there a conflict?
    if(sameSide.length){
      // can we swap side to fix it?
      if(!oppoSide.length){
        if(side)
          panel.classList.remove('right');
        else
          panel.classList.add('right');
      } else {
        // we must remove the conflict
        for(const el of sameSide)
          toggle(el, false);
      }
    }
    // finally toggle this panel on
    panel.classList.remove('closed');
  } else {
    // toggle this panel off
    panel.classList.add('closed');
  }

  // potentially update sidebar
  let tab = document.querySelector('#sidebar .tab[data-panel=' + panel.id + ']');
  if(tab){
    if(newState)
      tab.classList.add('active');
    else
      tab.classList.remove('active');
  }

  // fire panel event
  fireEvent(panelName(panel), newState);

  return newState;
}

module.exports = {
  register,
  addListener,
  removeListener,
  fireEvent,
  open,
  close,
  isClosed,
  isOpen: name => !isClosed(name),
  init,
  swap,
  toggle,
  toggleOverlay
};