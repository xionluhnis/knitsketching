// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const ContextMenu = require('./contextmenu.js');
const SketchAction = require('./actions/action.js');
const ActionContext = require('./actions/actioncontext.js');
const { snapshotTime } = require('./history.js');
const { triggerUpdate } = require('./program.js');

// load implemented actions
require('./actions/*.js', { mode: 'expand' });

// the basic ones
const Select  = require('./actions/select.js');
const Move    = require('./actions/move.js');

// constants
const MaxClickDelta = 500;

module.exports = {
  initInteraction(){

    // interaction data
    this.clicking = this.dragging = false;
    this.selection = [];
    this.selectionMap = {};
    this.highlight = [];
    this.highlightMap = {};
    // x / y
    this.mouseX = this.mouseY = 0;
    this.lastMouseX = this.lastMouseY = 0;
    this.clientX = this.clientY = 0;
    // index / time
    this.mouseIndex = this.mouseTime = 0;
    this.targetIndex = this.targetTime = 0;
    this.lastTargetIndex = this.lastTargetTime = 0;
    // state
    this.clicking = this.dragging = false;
    this.actionStartTime = 0;

    // action state
    this.actionMode = Select;
    this.action = new Select();

    // drag mode for non-select action
    // note: canvas doesn't get keydown unless it has tabindex
    this.moveMode = false;
    this.ctrlKey = false;
    this.shiftKey = false;

    // post-action callbacks
    this.postActionCallbacks = new Set();
  },

  triggerPostAction(action = this.action){
    // trigger post-action callbacks
    for(const cb of this.postActionCallbacks)
      cb(action);
  },

  addPostActionCallback(cb){
    this.postActionCallbacks.add(cb);
  },

  startInteraction() {
    // create contextmenu
    this.menu = new ContextMenu([ { text: 'Knitting Sketch' } ]);
    this.canvas.addEventListener('contextmenu', event => {
      this.menu.reload(this.getMenu());
      // this.tooltip(); // hide tooltip
      this.menu.show(event);
    });

    // create interactions
    this.canvas.addEventListener('mousemove', event => {
      const transform = this.transform || { x: 0, y: 0, k: 1 };
      // raw mouse
      this.lastMouseX = this.mouseX;
      this.lastMouseY = this.mouseY;
      this.mouseX = event.offsetX;
      this.mouseY = event.offsetY;
      this.clientX = event.clientX;
      this.clientY = event.clientY;
      // sketch global location
      this.lastSketchX = this.sketchX;
      this.lastSketchY = this.sketchY;
      this.sketchX = (this.mouseX - transform.x) / transform.k;
      this.sketchY = (this.mouseY - transform.y) / transform.k;
      // interaction state
      this.dragging = this.clicking;
      // update visual highlight
      if(!this.updateHighlight())
        this.drawFront();
    });
    this.canvas.addEventListener('mouseout', (/*event*/) => {
      this.clicking = this.dragging = false;
      // this.tooltip();
    });
    this.canvas.addEventListener('click', event => {
      // click timing
      const actionDuration = Date.now() - this.actionStartTime;
      if(actionDuration > MaxClickDelta)
        return;

      // click hook
      const lastTime = snapshotTime();
      if(SketchAction.triggerHook(this, SketchAction.CLICK, event)){
        if(snapshotTime() !== lastTime)
          this.triggerPostAction();
        return; // caught!
      }

      // update paning mode when with a selection
      if(this.selection.length && !event.shiftKey){
        this.disablePaning();
      } else {
        this.enablePaning();
      }
    });
    this.canvas.addEventListener('dblclick', event => {
      // dblclick hook
      if(SketchAction.triggerHook(this, SketchAction.DBLCLICK, event))
        return;
      // no target => centering
      this.centerLayout();
    });
    this.canvas.addEventListener('pointerdown', event => {
      this.clicking = event.button === 0;
      this.actionStartTime = Date.now();
      // left click = action
      if(this.clicking){
        if(this.moveMode){
          this.canvas.style.cursor = 'grabbing';
        } else if(this.actionMode !== Select || this.selection.length){
          this.actionStart(event);
        }
      }
    });
    // /!\ mouseup does not trigger on Chrome with Shift
    this.canvas.addEventListener('pointerup', event => {
      // state out
      this.clicking = this.dragging = false;
      if(this.moveMode)
        this.canvas.style.cursor = 'grab';
      else {
        this.actionStop(event);
      }
    });

    // tooltip
    // this.tooltipContainer = util.createElement('div', ['tooltip', 'hidden']);
    // container.appendChild(this.tooltipContainer);

    // toolbar modes
    for(const input of document.querySelectorAll('#toolbar input[name=skaction]')){
      const inputAction = input.id.replace('curve-', ''); // .replace(/-/g, '_').toUpperCase()];
      input.addEventListener('change', () => {
        this.setActionMode(inputAction);
      });
    }
    this.canvas.style.cursor = 'default';

    // draw UI
    // this.initDrawUI();
    window.addEventListener('keydown', event => {
      this.ctrlKey = event.ctrlKey;
      this.shiftKey = event.shiftKey;
      // shift => allow paning if in not select mode
      if(this.moveMode)
        return true;
      if(this.actionMode != Select && event.keyCode == 16){
        this.enablePaning();
        this.moveMode = true;
        this.canvas.style.cursor = 'grab';
        return true;
      }
    });
    const undo = document.getElementById('undo');
    const redo = document.getElementById('redo');
    window.addEventListener('keyup', event => {
      this.ctrlKey = event.ctrlKey;
      this.shiftKey = event.shiftKey;

      // reject if we're in a text area
      // or some input that accepts text
      if(event.target){
        if(event.target.tagName.toLowerCase() === 'textarea')
          return;
        if(event.target.tagName.toLowerCase() === 'input'
        && ['text', 'number'].includes(event.target.type))
          return;
      }

      const keyChar = event.key || String.fromCharCode(event.charCode);
      if(this.ctrlKey && keyChar === 'z' && !undo.disabled){
        // undo
        undo.click();

      } else if(this.ctrlKey && (keyChar === 'Z' || keyChar === 'y') && !redo.disabled){
        // redo
        redo.click();

      } else if(this.actionMode != Select && event.keyCode == 16){
        // <Shift>
        this.moveMode = false;
        this.canvas.style.cursor = '';
        this.disablePaning();

      } else if(event.keyCode == 27){
        // <Escape>
        this.actionClose(event);

      } else if(keyChar === 'u'){
        // trigger program update
        triggerUpdate();

      } else {
        // special capture modes
        if(this.actionMode === Select
        && '0123456789'.includes(keyChar))
          return this.setCaptureMode(keyChar.charCodeAt(0) - '0'.charCodeAt(0));
        // input action
        // /!\ those can prevent shortcuts!
        if(SketchAction.triggerHook(this, SketchAction.INPUT, event))
          return;

        // potential action shortcut
        const actionMode = SketchAction.getActionByShortcut(keyChar);
        if(actionMode){
          // switch action mode
          this.setActionMode(actionMode);
        }
      }
    });
  },

  setAction(action, updateHTML = true){
    assert(action, 'Cannot pass empty action');

    // remember past action
    const lastAction = this.action;

    // switch mode
    this.actionMode = action.ctor;
    this.action = action;

    // abort previous mode
    SketchAction.triggerHook(
      new ActionContext(this, lastAction),
      SketchAction.ABORT
    );

    // click actions trigger on last selection
    if(SketchAction.getActionFlag(action.id, SketchAction.IS_CLICK)){
      this.actionStop(false);
    }
    this.updateInteraction();
    this.canvas.style.cursor = 'default';
    if(updateHTML){
      let elem = document.getElementById(action.id);
      if(!elem)
        elem = document.getElementById('curve-' + action.id);
      if(elem)
        elem.checked = true;
      // action class
      for(const actName of SketchAction.actionIds()){
        document.body.classList.toggle(
          'action-' + actName,
          action.id === actName
        );
      }
      // action-specific classes
      for(const actName of SketchAction.actionClasses())
        document.body.classList.toggle(actName, false);
      for(const actName of action.getClasses())
        document.body.classList.toggle(actName, true);
      // elem.click();
    }
  },

  resetAction(){
    SketchAction.triggerHook(
      new ActionContext(this, this.action), SketchAction.CLOSE
    );
  },

  setActionMode(actionMode, ...args){
    this.setAction(SketchAction.create(actionMode, ...args), true);
  },

  updateInteraction(){
    if(this.actionMode == Select)
      this.enablePaning();
    else {
      this.disablePaning();
    }
  },

  actionStart(event){
    SketchAction.triggerHook(this, SketchAction.START, event);
  },

  drawAction(){
    SketchAction.triggerHook(this, SketchAction.MOVE);
  },

  actionStop(event){
    // clear action target
    this.canvas.style.cursor = ''; // reset cursor
    const lastTime = snapshotTime();
    const actionMode = this.actionMode;
    SketchAction.triggerHook(this, SketchAction.STOP, event);

    // check if action had a potential state impact
    // that is worth anything
    if(actionMode === Select)
      return; // not worth anything
    if(actionMode === Move){
      if(!this.selection.length
      || this.selection[0].type === 'pcurve'
      || (!this.updatingLayers && this.selection[0].type === 'sketch'))
        return; // no impact
    }
    if(snapshotTime() === lastTime)
      return; // no history snapshot => not important
    
    // trigger post-action callbacks
    this.triggerPostAction();
  },

  actionClose(event){
    SketchAction.triggerHook(this, SketchAction.CLOSE, event);
  },

  // capture modes
  setCaptureMode(cmode){
    const click = id => document.getElementById(id).click();
    const mode = m => {
      document.querySelector('#sketch-mode input[value=' + m + ']').click();
    };
    const toggle = (id, state) => {
      const el = document.getElementById(id);
      if((el.checked && !state)
      || (!el.checked && state))
        el.click();
    };
    const startDebug = () => (console.debug || console.log)('-----');

    // defaults
    click('display-none');
    for(const id of [
      'showBG',
      'showPCurves',
      'showIsolines',
      'showLinks',
      'showFlowConstraints',
      'flow-update',
      'schedule-update'
    ]){
      toggle(id, false);
    }
    toggle('showIrregular', true);
    switch(cmode){

      // linking
      case 1:
        mode('linking');
        toggle('showLinks', true);
        break;

      // constraints
      case 2:
        mode('flow');
        toggle('showFlowConstraints', true);
        break;

      // time
      case 3:
        mode('flow');
        click('display-time');
        startDebug();
        toggle('flow-update', true);
        break;

      // time stretch
      case 4:
        mode('flow');
        click('display-stretch');
        startDebug();
        toggle('flow-update', true);
        break;

      // region graph
      case 5:
        mode('flow');
        click('display-region');
        startDebug();
        toggle('flow-update', true);
        break;

      // stitch graph
      case 6:
        mode('schedule');
        startDebug();
        toggle('schedule-update', true);
        break;
    }
  }

};
