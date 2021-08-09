// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const draw = require('../draw.js');
const Edit = require('./edit.js');

class NodeEdit extends Edit {
  constructor(curve = null, selColor = '#FF6', crossRadius = 0){
    super(curve, false, selColor, crossRadius);
  }

  start(uictx){
    // clear selection if any
    if(uictx.hasSelection())
      uictx.clearSelection();
    
    super.start(uictx);
    // but revert action to SELECT
    // => we do not modify things like Edit does
    this.editMode = Edit.SELECT;
  }

  move(uictx){
    if(!this.curve)
      return;
    const ctx = uictx.getDrawingContext();

    // draw any segment hit
    const [ curve, segIdx ] = uictx.getHITTarget(true);
    if(curve && segIdx !== -1){
      draw.withinContext(ctx, curve, () => {
        ctx.strokeStyle = this.selectColor;
        ctx.lineWidth = draw.getConstantRadius(uictx.transform, 4);
        ctx.setLineDash([]);
        curve.drawSegment(ctx, segIdx);
        ctx.stroke();
      });
    }

    // draw rest
    super.move(uictx);
  }

  getNodes(backToFront = true){
    const nodes = Array.from(new Set(this.targets));
    if(backToFront){
      nodes.sort((i1, i2) => i2 - i1);
    }
    return nodes;
  }

  nodeAction(/* uictx, indices */){}

  stop(uictx){
    if(this.targets.length && this.canEdit()){
      // ready to delete
      // note: action depends on node count vs curve length
      const indices = this.getNodes();

      // action to be customized
      this.nodeAction(uictx, indices);
      
      // update content
      uictx.updateContent();
      // commit history
      uictx.commitHistory();

    } else {
      // update edit curve
      this.curve = uictx.getHITTarget();
    }

    // reset mouse information
    this.sketchStart = null;
    this.curveStart  = null;
  }

  dblclick(uictx){
    if(this.curve){
      // select all nodes
      this.targets = Array.from({ length: this.curve.length },
        (_, i) => i
      );
      this.stop(uictx);
    }
  }
}

module.exports = NodeEdit;