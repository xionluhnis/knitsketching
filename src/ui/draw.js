// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const geom = require('../geom.js');
const env = require('../env.js');

// text
function highlightText(ctx, text, x, y, fillColor, strokeColor, font = env.global.labelStyle){
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  const textHeight = ctx.measureText('M').width; // hack
  ctx.fillStyle = fillColor || '#FFFFFFAA';
  ctx.fillRect(x, y - textHeight, textWidth, textHeight + 2);
  ctx.fillStyle = strokeColor || '#000';
  ctx.fillText(text, x, y);
}
function centeredText(ctx, text, x, y, fillColor, strokeColor, font = env.global.labelStyle){
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  const textHeight = ctx.measureText('M').width; // hack
  ctx.fillStyle = fillColor || '#FFFFFFAA';
  ctx.fillRect(x - textWidth * 0.5, y - textHeight, textWidth, textHeight + 2);
  ctx.fillStyle = strokeColor || '#000';
  ctx.fillText(text, x - textWidth * 0.5, y);
}
function label(ctx, label, { x, y }, highlight, font = env.global.labelStyle){
  // set font
  ctx.font = font;
  // measure label
  const w = ctx.measureText(label).width;
  // label text
  ctx.fillStyle = highlight ? '#000' : '#aaa';
  ctx.fillText(label, x - w * 0.5, y);
}
function ryLabel(ctx, label, { x, y }, highlight, font = env.global.labelStyle){
  // set font
  ctx.font = font;
  // measure label
  const w = ctx.measureText(label).width;
  // label text
  ctx.fillStyle = highlight ? '#000' : '#aaa';
  // y flipping
  ctx.save();
  ctx.translate(x - w * 0.5, y);
  ctx.scale(1, -1);
  // text label
  ctx.fillText(label, 0, 0);
  // restore context
  ctx.restore();
}
function segmentLength(ctx, curve, segIdx, { k }, fillColor, strokeColor){
  const segment = curve.getSegment(segIdx);
  const { x: cx, y: cy } = curve.localToGlobal(segment.get(0.5));
  const len = segment.length();
  centeredText(
    ctx,
    'len=' + geom.toDecimalString(len, 1),
    cx * k, (cy - 0) * k,
    fillColor,
    strokeColor
  );
}

function circle(ctx, cx, cy, r){
  ctx.moveTo(cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
}

// shapes
const COS_45 = Math.sqrt(2) / 2;
const SIN_45 = COS_45;
const PI_4 = Math.PI / 4;
const Octagon = [
  [+COS_45, +SIN_45],
  [0, +1],
  [-COS_45, +SIN_45],
  [-1, 0],
  [-COS_45, -SIN_45],
  [0, -1],
  [+COS_45, -SIN_45],
  [+1, 0]
];
function octagon(ctx, cx, cy, r){
  ctx.moveTo(cx + r, cy);
  for(let i = 0; i < 8; ++i){
    ctx.lineTo(
      cx + Octagon[i][0] * r,
      cy + Octagon[i][1] * r
    );
  }
}
const Diamond = [
  [0, +1],
  [-1, 0],
  [0, -1],
  [+1, 0]
];
function diamond(ctx, cx, cy, r){
  ctx.moveTo(cx + r, cy);
  for(let i = 0; i < 4; ++i){
    ctx.lineTo(
      cx + Diamond[i][0] * r,
      cy + Diamond[i][1] * r
    );
  }
}
function adaptiveCircle(ctx, cx, cy, r, lod){
  if(lod >= 2){
    circle(ctx, cx, cy, r);
  } else if(lod === 1) {
    octagon(ctx, cx, cy, r);
  } else {
    diamond(ctx, cx, cy, r);
  }
}
function arrow(ctx, { x, y }, d, r){
  const b = { x: -d.y, y: d.x }; // util.rightNormal(d)
  ctx.moveTo(x, y); // center
  // triangle
  ctx.lineTo(x - b.x * r, y - b.y * r);
  ctx.lineTo(x + d.x * r, y + d.y * r);
  ctx.lineTo(x + b.x * r, y + b.y * r);
  ctx.lineTo(x, y);
  // tail
  ctx.lineTo(x - d.x * r, y - d.y * r);
}
function arrowHead(ctx, p, n, r){
  const b = { x: -n.y, y: n.x }; // util.rightNormal(n); // { x: -n.y, y: n.x };
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + (n.x + b.x) * r, p.y + (n.y + b.y) * r);
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + (n.x - b.x) * r, p.y + (n.y - b.y) * r);
}
function arrowTriangle(ctx, p, n, h, s = h){
  const b = { x: -n.y, y: n.x }; // util.rightNormal(n); // { x: -n.y, y: n.x };
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x - b.x * s, p.y - b.y * s);
  ctx.lineTo(p.x + n.x * h, p.y + n.y * h);
  ctx.lineTo(p.x + b.x * s, p.y + b.y * s);
  ctx.lineTo(p.x, p.y); // closing
}
function arrowLine(ctx, ps, pe, r, loc = 'end'){
  const Dx = pe.x - ps.x;
  const Dy = pe.y - ps.y;
  const len = Math.sqrt(Dx * Dx + Dy * Dy);
  const dx = Dx / len;
  const dy = Dy / len;
  const s = r;
  let f;
  if(loc === 'end'){
    f = Math.max(0, 1 - r / len);
  } else if(loc === 'middle'){
    f = Math.max(0, 0.5 - r / len * 0.5);
  } else {
    assert(typeof loc === 'number', 'Location is either end/middle or a fp within [0;1]');
    f = loc;
  }
  // line from ps to location at f
  const pf = { x: ps.x + Dx * f, y: ps.y + Dy * f };
  ctx.moveTo(ps.x, ps.y);
  ctx.lineTo(pf.x, pf.y);
  // arrow triangle from f
  arrowTriangle(ctx, pf, { x: dx, y: dy }, r, s);
  // line from triangle top to pe
  if(r < len){
    ctx.moveTo(pf.x + dx * r, pf.y + dy * r);
    ctx.lineTo(pe.x, pe.y);
  }
}
function times(ctx, cx, cy, r){
  ctx.moveTo(cx - r, cy - r);
  ctx.lineTo(cx + r, cy + r);
  ctx.moveTo(cx + r, cy - r);
  ctx.lineTo(cx - r, cy + r);
}
function plus(ctx, cx, cy, r){
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
}
function rect(ctx, x, y, w, h){
  ctx.moveTo(x, y); // /!\ starts on top-left => may get bad line caps!
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y); // closing
}
function crect(ctx, cx, cy, rx, ry){
  ctx.moveTo(cx + 0,  cy - ry); // starts in top-center => getter line caps
  ctx.lineTo(cx + rx, cy - ry);
  ctx.lineTo(cx + rx, cy + ry);
  ctx.lineTo(cx - rx, cy + ry);
  ctx.lineTo(cx - rx, cy - ry);
  ctx.lineTo(cx + 0,  cy - ry); // closing
}

// knitting operation
function adaptiveKnit(ctx, cx, cy, r, lod){
  adaptiveCircle(ctx, cx, cy, r, lod);
}
function adaptiveTuck(ctx, cx, cy, r /*, lod */){
  ctx.moveTo(cx, cy + r);
  ctx.lineTo(cx + r, cy + r);
  ctx.lineTo(cx, cy - r);
  ctx.lineTo(cx - r, cy + r);
  ctx.lineTo(cx, cy + r);
}
function adaptiveMiss(ctx, cx, cy, r /*, lod */){
  const hh = r * 0.3;
  crect(ctx, cx, cy, r, hh);
}

function adaptiveDrop(ctx, cx, cy, r /*, lod */){
  times(ctx, cx, cy, r);
}

function adaptiveAmiss(ctx, cx, cy, r, lod){
  const hh = r * 0.3;
  const hy = r * 0.7;
  let dys;
  if(lod >= 2)
    dys = [-hy, 0, hy];
  else if(lod === 1)
    dys = [-0.5 * hy, +0.5 * hy];
  else
    dys = [0];
  for(const dy of dys){
    ctx.moveTo(cx - r, cy - hh - dy);
    ctx.lineTo(cx, cy + hh - dy);
    ctx.lineTo(cx + r, cy - hh - dy);
  }
}

function adaptiveLineJoin(lod){
  if(lod >= 2)
    return 'round';
  else if(lod === 1)
    return 'bevel';
  else
    return 'miter';
}

// ###########################################################################
// ##### Transformations #####################################################
// ###########################################################################

function enterLabelViewport(ctx, transform){
  ctx.save();
  ctx.translate(transform.x, transform.y);
}

function enterViewport(ctx, transform){
  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);
}

function exitViewport(ctx){
  ctx.restore();
}

function withinViewport(ctx, transform, func){
  enterViewport(ctx, transform);
  func();
  exitViewport(ctx);
}

function outsideViewport(ctx, transform, func){
  exitViewport(ctx);
  func();
  enterViewport(ctx, transform);
}

function withinLabelViewport(ctx, transform, func, fromViewport = false){
  if(fromViewport)
    exitViewport(ctx);
  enterLabelViewport(ctx, transform);
  func();
  exitViewport(ctx);
  if(fromViewport)
    enterViewport(ctx, transform);
}

function withinContext(ctx, obj, func){
  const stack = Array.isArray(obj) ? obj : obj.getContextStack();
  enterContext(ctx, stack);
  func();
  exitContext(ctx, stack);
}

/**
 * Enter the context of a sketch object's transform
 *
 * @param ctx the drawing context
 * @param arg a SketchObject or the stack of its context
 */
function enterContext(ctx, arg){
  const stack = Array.isArray(arg) ? arg : arg.getContextStack();
  // go over stack from last to first
  for(let i = stack.length - 1; i >= 0; --i){
    ctx.save();
    const obj = stack[i];
    if(obj.transform.x || obj.transform.y)
      ctx.translate(obj.transform.x, obj.transform.y);
    if(obj.transform.kx !== 1 || obj.transform.ky !== 1)
      ctx.scale(obj.transform.kx, obj.transform.ky);
  }
}

/**
 * Leave the context of a sketch object's transform
 *
 * @param ctx the drawing context
 * @param arg a SketchObject or the stack of its context
 */
function exitContext(ctx, arg){
  const stack = Array.isArray(arg) ? arg : arg.getContextStack();
  // go over stack from first to last
  for(let i = 0; i < stack.length; ++i)
    ctx.restore();
}

// ###########################################################################
// ##### Curves ##############################################################
// ###########################################################################

function drawCurvePath(ctx, curve, inContext){
  if(!inContext){
    enterContext(ctx, curve);
  }
  curve.drawPath(ctx);
  if(!inContext){
    exitContext(ctx, curve);
  }
}

function drawCurveSegment(ctx, curve, i, inContext){
  if(!inContext){
    enterContext(ctx, curve);
  }
  curve.drawSegment(ctx, i);
  if(!inContext){
    exitContext(ctx, curve);
  }
}

function getAdaptiveRadius(transform, skCtx, minR, scaleR){
  const xform = 'k' in skCtx ? skCtx : skCtx.fullTransform;
  const zoom = transform.k;
  return Math.min(minR || 7, (scaleR || 4) * zoom / xform.k) / zoom;
}

function getConstantRadius(transform, radius){
  return (radius || 7) / transform.k;
}

module.exports = {
  // text
  highlightText,
  centeredText,
  label, ryLabel,
  segmentLength,
  // shapes
  adaptiveCircle,
  arrow,
  arrowHead,
  arrowTriangle,
  arrowLine,
  circle,
  octagon,
  diamond,
  plus,
  times,
  rect,
  crect,
  // knit operations
  adaptiveKnit,
  adaptiveTuck,
  adaptiveMiss,
  adaptiveDrop,
  adaptiveAmiss,
  // properties
  adaptiveLineJoin,

  // viewport + context management
  enterViewport,
  enterLabelViewport,
  exitViewport,
  withinViewport,
  withinLabelViewport,
  outsideViewport,
  enterContext,
  exitContext,
  withinContext,

  // curves
  drawCurvePath,
  drawCurveSegment,

  // adaptive sizing
  getAdaptiveRadius,
  getConstantRadius,

  // constants
  PI_4
};
