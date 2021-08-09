// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const sk = require('../../sketch.js');
// const Select = require('./select.js');
const SketchAction = require('./action.js');

class QueryGeodesic extends SketchAction {
  constructor(sketch = null){
    super();
    this.sketch = sketch;
    this.query  = null;
  }

  getQueryPos(){
    if(!this.sketch || !this.query)
      return null;
    // get source layer
    const srcLayer = sk.Flow.getMeshLayer(this.sketch);
    if(!srcLayer)
      return;
    else
      return { layer: srcLayer, x: this.query.x, y: this.query.y };
  }

  move(uictx){
    const queryPos = this.getQueryPos();
    if(!queryPos)
      return;
    const srcLayer = queryPos.layer;
    // get target sketch and query
    const curve = uictx.getHITTarget();
    if(!curve)
      return;
    const trgLayer = sk.Flow.getMeshLayer(curve.root());
    if(!trgLayer || trgLayer.parent !== srcLayer.parent)
      return;
    const trgSketch = trgLayer.sketch;
    const trgP = trgSketch.globalToLocal(uictx.getSketchPos());

    // compute geodesic path and visualize it
    const distSampler = trgLayer.parent.getDistanceSampler();
    if(!distSampler)
      return;
    const { path } = distSampler.sketchQueryBetween(
      srcLayer, this.query,
      trgLayer, trgP
    );
    if(!path)
      return;

    // drawing context
    const ctx = uictx.getDrawingContext();

    // draw geodesic path
    ctx.beginPath();
    let lastLayer = null;
    for(const { layer, x, y, fromLink = false } of path){
      const p = layer.sketch.localToGlobal({ x, y });
      if(layer !== lastLayer || fromLink)
        ctx.moveTo(p.x, p.y);
      else
        ctx.lineTo(p.x, p.y);
      lastLayer = layer;
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#66F';
    ctx.stroke();
  }

  stop(uictx){
    // reset selection
    const curve = uictx.getHITTarget();
    if(!curve){
      return;
    }
    const sketch = curve.root();
    if(!(sketch instanceof sk.Sketch)){
      return;
    }
    // store associated sketch
    this.sketch = sketch;
    this.query = sketch.globalToLocal(uictx.getSketchPos());
    // if displaying geodesic layer, then we need an update
    if(document.getElementById('display-geodesic').checked){
      uictx.update();
    }
  }

  // aliasses
  click(uictx){ this.stop(uictx); }
}

module.exports = SketchAction.register('query-geodesic', QueryGeodesic, {
  shortcuts: ['F7']
});