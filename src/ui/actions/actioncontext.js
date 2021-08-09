// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const { Transform, updateFlow, getHITTargets } = require('../../sketch.js');
const { createSnapshot, snapshotTime } = require('../history.js');

// constants
const FRONT   = 'frontContext';
const BACK    = 'backContext';

class ActionContext {
  constructor(parent, lastAction = null){
    this.parent = parent;
    this.lastAction = lastAction;
    this.lastTime = snapshotTime();
    this.valid  = true;
  }

  // action ------------------------------------------------------------------
  setAction(...args){ this.parent.setAction(...args); }
  setActionMode(...args){ this.parent.setActionMode(...args); }
  setSelectMode(){ this.parent.setActionMode('select', true); }
  setEditMode(){ this.parent.setActionMode('edit', true); }
  getActionMode(){ return this.parent.actionMode; }
  reject(){ this.valid = false; }
  renew(){ return new ActionContext(this.parent, this.lastAction); }

  // history -----------------------------------------------------------------
  commitHistory(label = this.parent.action.id){
    createSnapshot(label, 'by-action');
  }
  historyChanged(){ return this.lastTime !== snapshotTime(); }

  // drawing context ---------------------------------------------------------
  getDrawingContext(type = FRONT){
    const ctx = this.parent[type];
    assert(ctx instanceof CanvasRenderingContext2D,
      'Invalid context type or context missing');
    return ctx;
  }

  // selection ---------------------------------------------------------------
  selectionSize(){ return this.parent.selection.length; }
  hasSelection(){ return this.selectionSize() > 0; }
  *selection(){ yield *this.parent.selection; }
  copySelection(){ return this.parent.selection.slice(); }
  firstSelection(){ return this.parent.selection[0]; }
  lastSelection(){ return this.parent.selection[this.selectionSize() - 1]; }
  clearSelection(){ this.parent.clearSelection(); }
  updateSelection(...args){ this.parent.updateSelection(...args); }
  unhighlight(...args){ this.parent.removeFromHighlight(...args); }

  // action target -----------------------------------------------------------
  getHITTarget(withIndex = false, baseTarget = false){
    const hit = this.parent.getHITTarget(this.mouseX, this.mouseY, withIndex);
    if(!baseTarget)
      return hit;
    // else we check for a subCurve below that hit
    const curve = withIndex ? hit[0] : hit;
    if(curve && curve.subCurve){
      const sample = curve.firstSample;
      return withIndex ? [sample.curve, sample.segIdx] : sample.curve;
    } else
      return hit;
  }
  getHITTargets(sketchPos = this.sketchPos, n = 1000, pred = () => true){
    return getHITTargets(sketchPos, n, pred);
  }

  // keys --------------------------------------------------------------------
  get ctrlKey(){ return this.parent.ctrlKey; }
  get shiftKey(){ return this.parent.shiftKey; }

  // mouse -------------------------------------------------------------------
  get sketchX(){ return this.parent.sketchX; }
  get sketchY(){ return this.parent.sketchY; }
  get sketchPos(){
    return {
      x: this.sketchX,
      y: this.sketchY
    };
  }
  get mouseX(){ return this.parent.mouseX; }
  get mouseY(){ return this.parent.mouseY; }
  get clicking(){ return this.parent.clicking; }
  get dragging(){ return this.parent.dragging; }
  get transform(){ return Transform.from(this.parent.transform); }
  get moveMode(){ return this.parent.moveMode; }
  enablePaning(){ return this.parent.enablePaning(); }
  disablePaning(){ return this.parent.disablePaning(); }
  setPaning(flag){
    if(flag)
      this.enablePaning();
    else
      this.disablePaning();
  }
  getSketchPos(){ return { x: this.sketchX, y: this.sketchY }; }
  getMousePos(){ return { x: this.mouseX, y: this.mouseY }; }

  // update ------------------------------------------------------------------
  updateAction(){ this.parent.drawFront(); }
  update(){ this.parent.update(); }
  updateContent(){ this.parent.updateFromContent(); }
  updateHighlight(){ this.parent.drawHighlight(); }
  updateFlow(){
    if(this.parent.updatingFlow)
      updateFlow();
  }
}

module.exports = Object.assign(ActionContext, {
  FRONT,
  BACK
});