// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');

// constants
let cmID = 0;

function ContextMenu(menu, options){
  this.id = cmID++;
  this.menu = menu || [];
  this.container = null;
  this.options = options || {};
  this.contextTarget = null;
  this.closeCallback = () => {
    this.hide();
  };
  assert(menu instanceof Array, 'Menu must be an array');
  // create menu
  this.reload();
}

ContextMenu.DIVIDER = 'divider';

ContextMenu.prototype.reload = function(menu, options) {
  if(menu)
    this.menu = menu;
  if(options)
    this.options = options;
  // generate element if necessary
  if(!this.container){
    this.container = document.createElement('div');
    this.container.className = 'contextmenu';
    this.container.id = this.options.id || 'cm-' + this.id;
    document.body.appendChild(this.container);
  }

  // remove all children
  while(this.container.firstChild)
    this.container.removeChild(this.container.firstChild);

  // create content
  this.container.appendChild(this.createMenu(this.menu));
};

function createElement(tag, clazz){
  const el = document.createElement(tag);
  el.className = clazz;
  return el;
}

ContextMenu.prototype.createMenu = function(menu){
  const list = document.createElement('ul');
  for(let item of menu){
    const li = document.createElement('li');
    li.menu = this;
    if(item == ContextMenu.DIVIDER){
      li.className = 'divider';
    } else {
      // for simplified strings
      if(typeof item == 'string')
        item = { text: item };
      // icon
      const icon = createElement('span', 'icon');
      icon.innerHTML = item.icon || this.options.defaultIcon || '';
      li.appendChild(icon);
      // text
      const text = createElement('span', 'text');
      text.innerHTML = item.text || 'undefined';
      li.appendChild(text);
      // submenu
      if(item.menu){
        const sub = createElement('span', 'sub');
        sub.innerHTML = item.subIcon || this.options.defaultSubIcon || '&rsaquo;';
        li.appendChild(sub);
      }
      // disabled state
      if(item.disabled){
        li.setAttribute('disabled', '');
        li.classList.add('disabled');
      } else {
        // event information
        if(item.events){
          for(const key in item.events){
            li.addEventListener(key, item.events[key]);
          }
        } else if(item.event){
          li.addEventListener('click', item.event);
        }
        // submenu
        if(item.menu){
          li.appendChild(this.createMenu(item.menu));
        }
      }
    }
    list.appendChild(li);
  }
  return list;
};

ContextMenu.prototype.show = function(event, target) {
  // store target
  if(target !== undefined)
    this.contextTarget = target;
  else
    this.contextTarget = event.target;

  // workspace
  const coords = {
    x: event.clientX,
    y: event.clientY
  };
  const menuWidth = this.container.offsetWidth + 4;
  const menuHeight = this.container.offsetHeight + 4;
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;
  const mouseOffset = this.options.mouseOffset || 2;

  // positioning
  if((winWidth - coords.x) < menuWidth){
    this.container.style.left = (winWidth - menuWidth) + 'px';
  } else {
    this.container.style.left = (coords.x + mouseOffset) + 'px';
  }
  if((winHeight - coords.y) < menuHeight){
    this.container.style.top = (winHeight - menuHeight) + 'px';
  } else {
    this.container.style.top = (coords.y + mouseOffset) + 'px';
  }

  // show by triggering visible class
  this.container.classList.add('visible');

  // sub-menu positioning
  /*
  this.setHiddenMenuPosition(
    this.container.firstElementChild,
    coords, 1, 1
  );
  */
 setTimeout(() => {
  this.setMenuPosition(this.container.firstElementChild, 1, 1);
 }, 100);

  // add event for closing
  window.addEventListener('click', this.closeCallback);

  // prevent the default context menu to appear
  event.preventDefault();
};

ContextMenu.prototype.setMenuPosition = function(menu, dx, dy){
  assert(menu.tagName.toLowerCase() === 'ul',
    'Menu is not a unordered list tag');
  assert([-1, +1].includes(dx) && [-1, +1].includes(dy),
    'Invalid dx/dy arguments');
  // workspace parameters
  const margin = 10;
  const winWidth = window.innerWidth;
  const winHeight = window.innerHeight;
  const {
    x: menuX, y: menuY, width: menuWidth, height: menuHeight
  } = menu.getClientRects()[0];
  menu.dataset.x = Math.round(menuX);
  menu.dataset.y = Math.round(menuY);
  menu.dataset.w = Math.round(menuWidth);
  menu.dataset.h = Math.round(menuHeight);
  // go over items and move position pointer
  let start, end;
  if(dy > 0){
    start = 0;
    end = menu.children.length;
  } else {
    start = menu.children.length - 1;
    end = -1;
  }
  // let lastItem = null;
  // const y0 = y;
  for(let i = start; i !== end; i += dy){
    const item = menu.children.item(i);
    const subMenu = item.lastElementChild;
    if(!subMenu || subMenu.tagName.toLowerCase() !== 'ul')
      continue; // no recursion
    // get submenu client rect information
    const { x, y } = item.getClientRects()[0];
    const { width: w, height: h } = subMenu.getClientRects()[0];
    // select left/right positioning
    let subX, sdx;
    if((dx > 0 && x + menuWidth + w + margin > winWidth)
    || (dx < 0 && x - menuWidth - w - margin > 0)){
      // either going right, but exceeding window width (>winWidth)
      // or going left, and staying within window viewport (>0)
      // => go left with submenu
      subMenu.classList.add('border-right');
      subX = x - menuWidth;
      sdx  = -1;
      const sub = subMenu.previousElementSibling;
      sub.innerHTML = '&lsaquo;';
      sub.classList.add('left');
      item.classList.add('left');

    } else {
      subMenu.classList.remove('border-right');
      subX = x + menuWidth;
      sdx  = 1;
    }
    // select top/bottom positioning
    let subY, sdy;
    if((dy > 0 && y + h + margin > winHeight)
    || (dy < 0 && y + dy - h - margin > 0)){
      // either going down, but exceeding window height (>winHeight)
      // or going up, and staying within window viewport (>0)
      subMenu.classList.add('border-bottom');
      subY = (dy > 0 ? y + h : y);
      sdy  = -1;
    } else {
      subMenu.classList.remove('border-bottom');
      subY = (dy > 0 ? y : y - h);
      sdy  = 1;
    }
    // recursively set position of submenu
    this.setMenuPosition(subMenu, sdx, sdy);
  }
};

ContextMenu.prototype.hide = function() {
  // remove visibility trick
  this.container.classList.remove('visible');
  // stop listening for clicks
  window.removeEventListener('click', this.closeCallback);
};

// export
module.exports = ContextMenu;
