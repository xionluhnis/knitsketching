// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const draw = require('./draw.js');
const geom = require('../geom.js');

function createCanvas(parent, prepend){
  assert(!(parent instanceof HTMLCanvasElement),
    'Layout requires a container (not a canvas)');
  const canvas = document.createElement('canvas');
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
  if(prepend)
    parent.insertBefore(canvas, parent.firstChild);
  else
    parent.appendChild(canvas);
  return canvas;
}

function createHitCanvas(parent){
  // should be using OffscreenCanvas
  // but the support is not yet perfect
  // @see https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
  const canvas = document.createElement('canvas');
  canvas.width = parent.clientWidth;
  canvas.height = parent.clientHeight;
  return canvas;
}

function createElement(tag, clazz, text){
  const el = document.createElement(tag);
  if(Array.isArray(clazz)){
    for(let c of clazz)
      el.classList.add(c);
  } else
    el.className = clazz;
  if(text)
    el.textContent = text;
  return el;
}

function createOption(value, text){
  const option = createElement('option');
  option.value = value;
  option.textContent = text || value;
  return option;
}

function createLink(clazz, title, text, func){
  let link = document.createElement('a');
  link.classList.add(clazz);
  link.title = title;
  if(text && text.length)
    link.textContent = text;
  link.onclick = func;
  return link;
}

function askForString(message, value){
  // XXX use a nicer UI than the browser prompt!
  let str = prompt(message, value || '');
  return new Promise((resolve, reject) => {
    if(str !== null)
      resolve(str);
    else
      reject();
  });
}

function askForNumber(message, value, constraints = {}){
  let str = prompt(message, value);
  return new Promise((resolve, reject) => {
    if(str !== null){
      let num;
      if('integer' in constraints)
        num = parseInt(str);
      else
        num = parseFloat(str);
      if('min' in constraints)
        num = Math.max(constraints.min, num);
      if('max' in constraints)
        num = Math.min(constraints.max, num);
      resolve(num);
    } else
      reject();
  });
}

function capitalize(str){
  return str.replace(/^\w/, c => c.toUpperCase());
}

function exportFile(fname, data, { type = 'octet/stream', link } = {}){
  // @see https://stackoverflow.com/questions/13405129/javascript-create-and-save-file#30832210
  const fromLink = !!link;
  const blob = data instanceof Blob ? data : new Blob([ data ], { type });
  const url = URL.createObjectURL(blob);
  link = exportDataURL(fname, url, { type, link });

  // revoke url after click
  setTimeout(() => {
    if(!fromLink)
      document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, 10);
}

function exportDataURL(fname, url, { type = 'octet/stream', link } = {}){
  // @see https://stackoverflow.com/questions/13405129/javascript-create-and-save-file#30832210
  const fromLink = !!link;
  if(!link)
    link = document.createElement('a');
  link.href = url;
  link.download = fname;
  // add link to body if not from link
  if(!fromLink){
    document.body.appendChild(link);
    link.click(); // trigger press
  }
  return link;
}

function sameArrays(a, b){
  // special cases
  if(a === b) return true;
  if(!a || !b) return false;
  if(a.length !== b.length) return false;
  // else we check all members
  for(let i = 0; i < a.length; ++i){
    if(a[i] !== b[i])
      return false; // difference found!
  }
  return true; // all the same
}

function getSides(){
  const isFront = document.getElementById('front').checked;
  const isBack  = document.getElementById('back').checked;
  const twoSided = document.getElementById('twosided').checked;
  assert(isFront !== isBack, 'Both front and back have the same selection state?');
  if(twoSided)
    return isFront ? ['front', 'back'] : ['back', 'front'];
  else
    return isFront ? ['front'] : ['back'];
}

function addSidesListener(cb){
  const listener = () => cb(getSides());
  document.getElementById('front').addEventListener('click', listener);
  document.getElementById('back').addEventListener('click', listener);
  document.getElementById('twosided').addEventListener('click', listener);
}

function throttle(func, minDelta = 100, triggerLast = false){
  let lastT = Date.now();
  let timeout = -1;
  const newFunc = function(...args) {
    const currT = Date.now();
    const deltaT = currT - lastT;
    if(deltaT >= minDelta){
      // update time
      lastT = currT;
      // remove later trigger
      if(triggerLast && timeout !== -1){
        clearTimeout(timeout);
        timeout = -1;
      }
      // trigger now
      func(...args);

    } else {
      // minDelta > deltaT

      // postpone for later trigger
      if(triggerLast && timeout !== -1){
        timeout = setTimeout(
          () => newFunc(...args),
          minDelta - deltaT
        );
      }
      // else we just do not trigger
    }
  };
  return newFunc;
}

function loadImage(url, flipY = true){
  return new Promise((accept, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      let ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, img.width, img.height);
      if(flipY){
        ctx.translate(0, img.height-1);
        ctx.scale(1, -1);
      }
      ctx.drawImage(img, 0, 0, img.width, img.height);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      accept(data);
    };
    img.onerror = reject;
    img.src = url;
  });
}

module.exports = Object.assign({
  // HTML
  createCanvas,
  createHitCanvas,
  createElement,
  createLink,
  createOption,
  // user input
  askForString,
  askForNumber,
  // user output
  exportFile,
  exportDataURL,
  // text variations
  capitalize,
  // image loading
  loadImage,
  // settings
  getSides,
  addSidesListener,
  // misc
  sameArrays,
  noop: () => {},
  throttle,
  // aliased libraries
  geom,
  draw
}, geom, draw);
