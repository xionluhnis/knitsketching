// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
// const assert = require('../../assert.js');
const sk = require('../../sketch.js');
const draw = require('../draw.js');
const { Curve, PCurve, SketchAnchor, SketchRectangle } = sk;
const util = require('../util.js');
const SketchAction = require('./action.js');

// constants
const SELECT        = 'select';
const EDIT_POINT    = 'point';
const EDIT_CONTROL  = 'control';
const EDIT_SEGMENT  = 'segment';

class Edit extends SketchAction {
  constructor(curve = null, showControls = true, selColor = '#FF6', crossRadius = 0){
    super();
    // parameters
    this.showControls = showControls;
    this.selectColor  = selColor;
    this.crossRadius  = crossRadius; // disable cross by default
    // edit target
    this.curve = curve;
    this.editMode = SELECT;
    this.targetIdx  = -1; // point/segment index
    this.targetArg  = -1; // side/t-value
    this.targetArg2 = 0;  // strut
    this.targets    = []; // indices
    // mouse information
    this.sketchStart  = null;
    this.curveStart   = null;
  }

  resetTarget(){
    this.targetIdx = -1;
    this.targetArg = -1;
    this.targets = [];
  }

  static findCurvePoint(curve, localPos, radius){
    return curve.points.findIndex(p => {
      return util.distBetween(p, localPos) <= radius;
    });
  }

  static findControlPoint(curve, localPos, radius, indices){
    // pcurves don't have control points
    if(curve instanceof PCurve
    || curve instanceof SketchRectangle
    || curve instanceof SketchAnchor)
      return { index: -1 };
    
    const fullIndices = new Set();
    for(const i of indices){
      fullIndices.add(i - 1);
      fullIndices.add(i);
    }
    for(const i of fullIndices){
      // test both possible control points
      for(const [index, side] of [
        [i + 0, Curve.CTRL_START],
        [i + 1, Curve.CTRL_END]
      ]){
        const cp = curve.getControlPoint(index, side);
        if(!cp)
          continue;
        const cpp = cp.pos();
        if(util.distBetween(cpp, localPos) <= radius){
          return {
            index, side
          };
        } // endif within radius
      } // endfor [index, side]
    } // endfor i of fullIndices
    return { index: -1 };
  }

  getCurveData(uictx, curve, radius = 7){
    return {
      curvePos: curve.fullTransform.unapplyFrom(uictx.getSketchPos()),
      radius:   draw.getConstantRadius(uictx.transform, radius)
    }; 
  }

  getCurvePos(uictxOrPoint){
    if(uictxOrPoint.getSketchPos)
      return this.curve.fullTransform.unapplyFrom(uictxOrPoint.getSketchPos());
    else
      return this.curve.fullTransform.unapplyFrom(uictxOrPoint);
  }

  canEdit(curve = this.curve){
    return curve instanceof Curve
        || curve instanceof SketchRectangle;
  }

  start(uictx){
    // only go farther if with a selection
    if(!this.curve
    || !this.curve.points){
      // be consistent with selection
      // => remove it if no curve linked
      if(uictx.hasSelection())
        uictx.clearSelection();
      return;
    }
    const sketchPos = uictx.getSketchPos();
    const radius    = draw.getConstantRadius(uictx.transform); // this.getAdaptiveRadius(fullTransform);
    const curvePos  = this.getCurvePos(sketchPos);

    // store start point
    this.sketchStart = sketchPos;
    this.curveStart  = curvePos;

    // try selecting a previously selected point's control point
    if(this.showControls && this.targets.length > 0){
      const { index, side } = Edit.findControlPoint(
        this.curve, curvePos, radius, this.targets
      );
      if(index !== -1){
        this.editMode  = EDIT_CONTROL;
        this.targetIdx = index;
        this.targetArg = side;
        if(!this.targets.includes(index))
          this.targets.push(index);
        return;
      }
    }

    // try selecting a single point
    const pointIdx = Edit.findCurvePoint(this.curve, curvePos, radius);
    if(pointIdx >= 0){
      this.editMode  = EDIT_POINT;
      this.targetIdx = pointIdx;
      this.targetArg = -1;
      this.targets   = [ pointIdx ];
      return;
    }

    // check for segment hit target
    const [curve, segIdx] = uictx.getHITTarget(true);
    if(curve === this.curve && segIdx !== -1){
      // get target information
      this.editMode  = EDIT_SEGMENT;
      this.targetIdx = segIdx;
      // segment parameters t (and d1)
      const segment  = curve.getSegment(segIdx);
      const p = segment.project(curvePos);
      this.targetArg = p.t;
      if(curve.getDegree(segIdx) === 3){
        const e1 = segment.hull(p.t)[7];
        const d1 = util.distBetween(e1, p);
        this.targetArg2 = Math.min(d1,
          util.distBetween(segment.get(0), segment.get(1))
        );
      } else
        this.targetArg2 = 0; // use default
      // segment point indices
      this.targets   = [ segIdx, (segIdx+1) % curve.length ];

    } else {
      // default is empty selection
      this.editMode  = SELECT;
      this.targetIdx = -1;
      this.targetArg = -1;
      this.targets = [];
    }
  }

  move(uictx){
    if(!this.curve)
      return;
    else if(this.curve instanceof PCurve){
      // check that it's complete
      if(!this.curve.isComplete()){
        // remove from edit action
        this.curve = null;
        return;
      }
    }

    // draw base edit points
    this.drawEditPoints(uictx);
    if(this.showControls)
      this.drawControlPoints(uictx);

    if(!this.sketchStart)
      return;

    // apply edit action during move
    // 1 = apply specific action
    // 2 = draw impact
    switch(this.editMode){

      case SELECT:
        this.editSelection(uictx);
        this.drawSelection(uictx);
        break;

      case EDIT_POINT:
        this.editPoint(uictx);
        this.drawCurve(uictx);
        break;

      case EDIT_CONTROL:
        this.editControl(uictx);
        this.drawCurve(uictx);
        break;

      case EDIT_SEGMENT:
        this.editSegment(uictx);
        this.drawCurve(uictx);
        break;
    }
  }

  drawEditPoints(uictx){
    // front drawing context
    const ctx = uictx.getDrawingContext();

    // get information
    const { curvePos, radius } = this.getCurveData(uictx, this.curve);

    // always display points at least
    draw.withinContext(ctx, this.curve, () => {
      for(let i = 0; i < this.curve.length; ++i){
        const p = this.curve.getPoint(i);
        if(!p)
          continue;
        const { x, y } = p;

        // distance to  mouse
        const mouseDist = util.distBetween({ x, y }, curvePos);

        // selected state
        const selected = mouseDist <= radius || this.targets.includes(i);

        // different anchors depending on mode 
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = selected ? this.selectColor : '#FFF';
        ctx.fill();
        ctx.strokeStyle = selected ? this.selectColor : '#000';
        ctx.stroke();

        // potentially draw a cross on top of selected elements
        if(selected && this.crossRadius){
          // draw cross
          const n = this.crossRadius;
          ctx.beginPath();
          ctx.moveTo(x - n * radius, y - n * radius);
          ctx.lineTo(x + n * radius, y + n * radius);
          ctx.moveTo(x + n * radius, y - n * radius);
          ctx.lineTo(x - n * radius, y + n * radius);
          ctx.stroke();
        }
      } // endfor i < #curve
    }); // end withinContext
  }

  drawControlPoints(uictx){
    // not for pcurves
    if(this.curve instanceof PCurve
    || this.curve instanceof SketchRectangle
    || this.curve instanceof SketchAnchor)
      return;
    // front drawing context
    const ctx = uictx.getDrawingContext();

    // get information
    const { curvePos, radius } = this.getCurveData(uictx, this.curve);

    draw.withinContext(ctx, this.curve, () => {
      // display controls of selection
      const fullIndices = new Set();
      for(let i of this.targets){
        fullIndices.add(i - 1);
        fullIndices.add(i);
      }
      for(let i of fullIndices){
        const ps = this.curve.getPoint(i);
        const pe = this.curve.getPoint(i + 1);
        const cs = this.curve.getControlPoint(i,   Curve.CTRL_START);
        const ce = this.curve.getControlPoint(i+1, Curve.CTRL_END);
        // different connections depending on degree
        if(ce){
          // cubic
          for(let [pt, cp] of [[ps, cs], [pe, ce]]){
            const mouseDist = util.distBetween(cp, curvePos);
            const selected = mouseDist <= radius;

            ctx.beginPath();
            ctx.moveTo(pt.x, pt.y);
            ctx.lineTo(cp.x, cp.y);
            ctx.setLineDash([1, 1]);
            ctx.strokeStyle = '#AAA';
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(cp.x + radius, cp.y);
            ctx.arc(cp.x, cp.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = selected ? this.selectColor : '#FFFFFFAA';
            ctx.fill();
            ctx.setLineDash([]);
            ctx.strokeStyle = '#999';
            ctx.stroke();
          } // endfor cp

        } else if(cs){
          // quadratic
          const mouseDist = util.distBetween(cs, curvePos);
          const selected = mouseDist <= radius;

          ctx.beginPath();
          ctx.moveTo(ps.x, ps.y); // start
          ctx.lineTo(cs.x, cs.y); // control point
          ctx.lineTo(pe.x, pe.y); // end
          ctx.setLineDash([1, 1]);
          ctx.strokeStyle = '#FFA';
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(cs.x + radius, cs.y);
          ctx.arc(cs.x, cs.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = selected ? this.selectColor : '#FFFFFFAA';
          ctx.fill();
          ctx.setLineDash([]);
          ctx.strokeStyle = '#999';
          ctx.stroke();

        }
      } // endfor i < #indices
    });
  }

  editPoint(uictx){
    if(!this.canEdit())
      return; // XXX trigger parametric panel?
    const curvePos = this.curve.globalToLocal(uictx.getSketchPos());
    const mousePos = uictx.ctrlKey ?
      util.alignPoint(curvePos, this.curveStart)
    : curvePos;
    // modify the target point location
    this.curve.setPoint(this.targetIdx, mousePos);
  }

  editControl(uictx){
    if(!this.canEdit())
      return; // XXX trigger parametric panel?
    const curvePos = this.curve.globalToLocal(uictx.getSketchPos());
    const mousePos = uictx.ctrlKey ?
      util.alignPoint(curvePos, this.curveStart)
    : curvePos;
    // modify control point's location
    this.curve.setControlPoint(this.targetIdx, this.targetArg, mousePos);
  }

  editSegment(uictx){
    if(!this.canEdit())
      return; // XXX trigger parametric panel?
    const curvePos = this.curve.globalToLocal(uictx.getSketchPos());
    const mousePos = uictx.ctrlKey ?
      util.alignPoint(curvePos, this.curveStart)
    : curvePos;
    // modify segment using t value
    this.curve.setSegmentPoint(
      this.targetIdx, mousePos,
      this.targetArg, this.targetArg2
    );
  }

  drawCurve(uictxOrCtx){
    const ctx = uictxOrCtx.getDrawingContext ?
      uictxOrCtx.getDrawingContext()
    : uictxOrCtx;
    // draw updated shape on overlay
    draw.drawCurvePath(ctx, this.curve);
    if(!this.curve.open){
      ctx.fillStyle = '#FFFFFFAA';
      ctx.fill();
    }
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.setLineDash([]);
  }

  editSelection(uictx){
    const { left, right, top, bottom } = this.getSelectionRectangle(uictx);
    // update indices
    this.targets = [];
    const xform = this.curve.fullTransform; // .inverse()
    for(let i = 0; i < this.curve.length; ++i){
      const { x, y } = xform.applyTo(this.curve.getPoint(i));
      if(x >= left && x <= right
      && y >= top  && y <= bottom){
        this.targets.push(i);
      }
    }
  }

  getSelectionRectangle(uictx){
    const sketchPos = uictx.getSketchPos();
    let left, top, right, bottom;
    if(this.sketchStart.x < sketchPos.x){
      left = this.sketchStart.x;
      right = sketchPos.x;
    } else {
      left = sketchPos.x;
      right = this.sketchStart.x;
    }
    if(this.sketchStart.y < sketchPos.y){
      top = this.sketchStart.y;
      bottom = sketchPos.y;
    } else {
      top = sketchPos.y;
      bottom = this.sketchStart.y;
    }
    return { left, right, top, bottom };
  }

  drawSelection(uictx){
    const ctx = uictx.getDrawingContext();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = '#999999AA';
    const { left, right, top, bottom } = this.getSelectionRectangle(uictx);
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.setLineDash([]);
  }

  stop(uictx){
    // update edit mode or the curve
    if(this.targets.length){
      if(this.editMode !== SELECT){
        // commit history
        uictx.commitHistory('edit ' + this.editMode);
      }

      // change target type to selection by default
      this.editMode = SELECT;
      
    } else {
      // update edit curve
      this.curve = uictx.getHITTarget();
    }

    // reset mouse information
    this.sketchStart = null;
    this.curveStart  = null;

    // we may have changed content
    uictx.updateContent();
  }

  click(uictx){
    if(this.editMode !== SELECT)
      return; // no meaningful click

    // check if target is of interest
    const curve = uictx.getHITTarget();
    if(curve && this.curve !== curve){
      this.curve = curve;
      this.resetTarget();
      uictx.updateAction();
    }
  }
  dblclick(uictx){
    if(this.editMode === SELECT){
      // if on segment, trigger segment split
      const [curve, segIdx] = uictx.getHITTarget(true);
      if(curve === this.curve && segIdx !== -1){
        if(this.canEdit()){
          const curvePos = curve.globalToLocal(uictx.getSketchPos());
          const segment = curve.getSegment(segIdx);
          const clickT = segment.project(curvePos).t;
          curve.divideSegment(segIdx, clickT);

          // update content
          uictx.updateContent();
          // commit history
          uictx.commitHistory('divide segment');
        } else {
          // open pcurve editor
          // /!\ delayed require because of cyclic dependencies
          const { editPCurve } = require('../parametric.js');
          editPCurve(curve.id);
        }
      }

    } else {
      // else, just a normal click
      this.click(uictx);
    }
  }

  close(uictx){
    if(this.curve){
      // reset selection
      this.curve = null;
      this.editMode = SELECT;
      this.resetTarget();

    } else {
      // no curve => let others take us over
      uictx.reject(); // let someone catch it!
    }
  }

  caught(uictx, hook){
    if(hook === SketchAction.DBLCLICK){
      const curve = uictx.getHITTarget();
      if(curve){
        uictx.setAction(this, true);
        this.curve = curve;
        return; // we caught it!
      }
    }
    uictx.reject(); // by default, we skip it
  }

  static get classes(){ return ['edit']; }
}
Object.assign(Edit, {
  SELECT,
  EDIT_CONTROL, EDIT_POINT, EDIT_SEGMENT,
  // short versions (for namespaced Edit.XXX)
  CONTROL:  EDIT_CONTROL,
  POINT:    EDIT_POINT,
  SEGMENT:  EDIT_SEGMENT
});

module.exports = SketchAction.register('edit', Edit, {
  shortcuts: ['e'],
  [SketchAction.IS_EDIT]: true
});