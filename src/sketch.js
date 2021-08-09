// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('./assert.js');
const Transform = require('./sketch/transform.js');
const SketchObject = require('./sketch/object.js');
const Curve = require('./sketch/curve.js');
const PCurve = require('./sketch/pcurve.js');
const Sketch = require('./sketch/sketch.js');
const SketchImage = require('./sketch/image.js');
const SketchAnchor = require('./sketch/anchor.js');
const SketchRectangle = require('./sketch/rectangle.js');
const FlowConstraint = require('./sketch/constraint.js');
const Link = require('./sketch/link.js');
const Seam = require('./sketch/seam.js');
const Flow = require('./algo/flow.js');
const Schedule = require('./algo/schedule.js');
const Mesh = require('./algo/mesh/mesh.js');
const Sizing = require('./sizing.js');
const SketchLayer = require('./algo/compiler/sketchlayer.js');
const StitchSampler = require('./algo/stitch/stitchsampler.js');
const Trace = require('./algo/trace/trace.js');
const env = require('./env.js');

// state (temporary)
const sketches = [];
const curves = [];
const pcurves = [];
const images = [];

const S = {
  // axes
  X: 1,
  Y: 2
};

function newCurve(start, open){
  const c = new Curve(open);
  c.addPoint(start);
  curves.push(c);
  return c;
}

function newPCurve(){
  const c = new PCurve();
  pcurves.push(c);
  return c;
}

function newSegmentPCurve(curve, segIdx, t0 = 0, t1 = 1){
  const c = PCurve.fromCurveSegment(curve, segIdx, t0, t1);
  pcurves.push(c);
  return c;
}

function newSketch(start){
  const s = new Sketch();
  s.addPoint(start);
  sketches.push(s);
  return s;
}

function newImage(src){
  return SketchImage.fromURL(src).then(img => {
    images.push(img);
  });
}

function deleteImage(img){
  const idx = images.indexOf(img);
  if(idx != -1){
    images.splice(idx, 1);
  }
}

function deleteObject(skobj){
  if(skobj instanceof Curve)
    deleteCurve(skobj);
  else if(skobj instanceof PCurve)
    deletePCurve(skobj);
  else if(skobj instanceof SketchImage)
    deleteImage(skobj);
  else if(skobj.parent && skobj.parent instanceof Sketch)
    skobj.setParent(null);
}

function *allSketches(backToFront) {
  if(backToFront){
    for(let i = 0; i < sketches.length; ++i){
      const s = sketches[i];
      // skip child sketches
      if(s.parent)
        continue;
      // go over root sketch
      yield s;
      // go over its children from back to front
      for(let j = s.children.length - 1; j >= 0; --j){
        const c = s.children[j];
        if(c instanceof Sketch)
          yield c;
      }
    }
  } else {
    yield *sketches;
  }
}

function *allRootSketches(){
  for(let i = 0; i < sketches.length; ++i){
    const sketch = sketches[i];
    if(sketch.parent)
      continue;
    else
      yield sketch;
  }
}

function *allNCChildren(){
  for(const sketch of allRootCurves()){
    for(const c of sketch.children){
      if(c instanceof Curve
      || c instanceof PCurve)
        continue;
      yield c;
    }
  }
}

function *allCurves(strict){
  if(!strict)
    yield *sketches;
  yield *curves;
  yield *pcurves;
}

function *allRootCurves(strict){
  if(!strict)
    yield *allRootSketches();
  for(let i = 0; i < curves.length; ++i){
    const curve = curves[i];
    if(curve.parent)
      continue;
    else
      yield curve;
  }
  // note: pcurves are not to appear on root
}

function *allPCurves(){
  yield *pcurves;
}

function *allImages(){
  yield *images;
}

function *allRootImages(){
  for(let i = 0; i < images.length; ++i){
    const img = images[i];
    if(img.parent)
      continue;
    else
      yield img;
  }
}

function getHITTarget(q){
  const [target] = getHITTargets(q, 1);
  return target;
}

function getHITTargets(q, n = 1000, pred = () => true){
  const targets = [];
  for(let i = sketches.length - 1; i >= 0 && n > 0; --i){
    const s = sketches[i];
    // skip child sketches at this level
    if(s.parent)
      continue;

    // check if point is within sketch
    const q_s = s.globalToLocal(q);
    if(!s.hitTest(q_s))
      continue;

    // go over its children from back to front
    for(let j = s.children.length - 1; j >= 0 && n > 0; --j){
      const c = s.children[j];
      const q_c = c.parentToLocal(q_s);
      if(c.hitTest(q_c) && pred(c, q_c)){
        targets.push(c);
        --n;
      }
    }
    if(n > 0 && pred(s, q_s)){
      targets.push(s);
      --n;
    }
  }
  for(let i = images.length - 1; i >= 0 && n > 0; --i){
    const img = images[i];
    // skip child images
    if(img.parent)
      continue;
    
    // check if point is within image
    const q_i = img.globalToLocal(q);
    if(img.hitTest(q_i) && pred(img, q_i)){
      targets.push(img);
      --n;
    }
  }
  return targets;
}

function extents(){
  if(!sketches.length && !images.length)
    return { min: {x:0, y:0}, max: {x:0, y:0} };

  // /!\ note: Curve's methods are local (except for globalXXX methods)
  let currExt;
  for(let i = 0; i < sketches.length; ++i){
    currExt = sketches[i].globalExtents(currExt);
  }
  for(let i = 0; i < images.length; ++i){
    currExt = images[i].globalExtents(currExt);
  }
  return currExt;
}

function getObjectList(curve, internal = {}){
  if(curve instanceof Sketch)
    return sketches;
  else if(curve instanceof Curve)
    return curves;
  else if(curve instanceof PCurve)
    return pcurves;
  else if(curve instanceof SketchImage)
    return images;
  else if(curve instanceof SketchObject){
    // internal sketch object without public list
    if(curve.type in internal)
      return internal[curve.type];
    // create internal list for that type
    const list = internal[curve.type] = [];
    return list;

  } else {
    assert.error('Not a valid sketch object!');
    return [];
  }
}

function moveToFront(skobj){
  if(skobj.parent){
    return skobj.parent.moveChildToFront(skobj);
  }
  // either a sketch or a curve
  const list = getObjectList(skobj);
  const idx = list.indexOf(skobj);
  if(idx === -1){
    assert.error('Invalid sketch object, not found');
    return false;
  } else if(idx != list.length - 1){
    list.splice(idx, 1);
    list.push(skobj);
    return true;
  }
  return false;
}

function deleteCurve(curve){
  assert(curve, 'Need a curve');

  // unlink all segments if a sketch
  if(curve instanceof Sketch){
    curve.clear();
  }

  // separate from parent
  curve.setParent(null);

  // transfer children to global scope (or previous parent)
  while(curve.children.length){
    const c = curve.children[curve.children.length - 1];
    c.setParent(null); // set to global scope
    // if not a sketch, delete recursively
    if(!(c instanceof Sketch)){
      deleteCurve(c);
    }
  }

  // remove from list of sketches
  const list = getObjectList(curve);
  list.splice(list.indexOf(curve), 1);

  // remove references to this curve
  for(const pcurve of allPCurves()){
    pcurve.unrefCurve(curve);
  }
}

function deletePCurve(pcurve, deleteUnrefs = false){
  assert(pcurve, 'Need a parametric curve');

  // separate from parent and remove constraint
  if(pcurve.parent){
    const sketch = pcurve.parent;
    const constr = sketch.getConstraint(pcurve);
    if(constr)
      sketch.setConstraint(pcurve, null);
    pcurve.setParent(null);
  }

  // delete any sample that references it
  const unrefCurves = [];
  for(const pc of pcurves){
    const res = pc.unrefCurve(pcurve);
    if(res && deleteUnrefs){
      unrefCurves.push(pc);
    }
  }
  while(unrefCurves.length){
    const unrefCurve = unrefCurves.pop();
    deletePCurve(unrefCurve, deleteUnrefs);
  }

  // remove from list of pcurves
  const list = getObjectList(pcurve);
  list.splice(list.indexOf(pcurve), 1);
}

function copyCurve(curve){
  const copy = curve.copy();
  const { min, max } = curve.extents();
  copy.transform.x += max.x - min.x + 50;
  copy.updateTransform();
  getObjectList(copy).push(copy);
}

function createBack(sketch){
  // cannot create double back
  // cannot create back of child sketch
  if(sketch.hasBack() || sketch.parent)
    return;
  const back = sketch.createBack();
  const { min, max } = sketch.extents();
  back.transform.x += max.x - min.x + 50;
  back.updateTransform();
  sketches.push(back);
}

function mirrorCurve(curve, axes){
  if(!axes || !(axes & (S.X | S.Y)))
    return;
  // remove all links before mirroring
  // /!\ note: links do not make sense to keep
  // since this is an explicit mirroring, not a back mirroring
  if(curve instanceof Sketch){
    for(let i = 0; i < curve.length; ++i){
      const link = curve.getLink(i);
      if(link)
        link.remove();
    }
  } else if(curve instanceof PCurve){
    // XXX maybe we could have a parametric curve
    //     function that mirrors the data, but not important yet
    return;
  }

  // before mirroring, center around centroid
  curve.shiftAll(curve.centroid, -1);

  // mirror points and control points along selected axes
  for(let i = 0; i < curve.length; ++i){
    const p = curve.getPoint(i);
    const cs = curve.getControlPoint(i, Curve.CTRL_START);
    const ce = curve.getControlPoint(i, Curve.CTRL_END);
    if(axes & S.X){
      p.x = -p.x;
      if(cs)
        cs.dx = -cs.dx;
      if(ce)
        ce.dx = -ce.dx;
    }
    if(axes & S.Y){
      p.y = -p.y;
      if(cs)
        cs.dy = -cs.dy;
      if(ce)
        ce.dy = -ce.dy;
    }
  }
  // note: no need to update modes or check validity
  // since we mirror the whole shape which leads to a valid shape
  // provided the original shape was valid
}

function availableParentsFor(curve){
  const list = [];
  // backed curves cannot have parents
  if(curve.hasBack())
    return list;
  // find other sketches without parent
  for(let s of sketches){
    if(!s.parent && s != curve)
      list.push(s);
  }
  return list;
}

/**
 * Load sketch objects (notably curves) from an SVG
 * 
 * @param {string|SVGDocument} svg an SVG document (or string)
 * @param {boolean} justReturn whether to not add curves to the current lists, but only return them
 */
function loadCurvesFromSVG(svg, justReturn){
  if(typeof svg == 'string'){
    // @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser#Browser_compatibility
    const parser = new DOMParser();
    svg = parser.parseFromString(svg, 'image/svg+xml');
  }
  // svg should be a SVGDocument object
  // => go to root
  svg = svg.querySelector('svg');
  if(env.verbose){
    console.log('Loading paths from svg', svg);
  }
  // create processing queue with its children
  const queue = Array.from(svg.children).filter(node => {
    return node.transform;
  }).map(node => {
    const xform = node.transform.baseVal[0];
    return {
      node,
      transform: xform ? xform.matrix : null
    };
  });
  const objectMap = {};
  const newObjects = [];
  let legacySketch = false;
  while(queue.length){
    const { node, transform } = queue.pop();
    switch(node.tagName){

      case 'g':
        if(env.verbose)
          console.log('Processing group', node);
        // process children
        for(let n of node.children){
          if(['g', 'path', 'image'].includes(n.tagName)){
            // compute new transform
            const xform = n.transform.baseVal[0];
            let newTransform;
            if(xform){
              if(transform)
                newTransform = transform.multiply(xform.matrix); // XXX or opposite?
              else
                newTransform = xform.matrix;
            } else
              newTransform = transform;
            // push onto queue
            queue.push({ node: n, transform: newTransform });
          }
        }
        break;

      case 'path': {
        if(env.verbose)
          console.log('Processing path', node);
        const curve = getCurveFromPathString(node.getAttribute('d'), node.dataset.transform ? null : transform);
        if(!justReturn){
          getObjectList(curve).push(curve);
        }
        if(node.dataset.id){
          legacySketch = true;
          objectMap[node.dataset.id] = { object: curve, node };
        }
        newObjects.push(curve);
      } break;

      case 'image': {
        if(env.verbose)
          console.log('Processing image', node);
        const image = new SketchImage(
          node.getAttribute('href') || node.getAttribute('xlink:href')
        );
        let x = parseFloat(node.getAttribute('x')) || 0;
        let y = parseFloat(node.getAttribute('y')) || 0;
        let w = 0, h = 0;
        if(node.hasAttribute('width'))
          w = parseFloat(node.getAttribute('width'));
        if(node.hasAttribute('height'))
          h = parseFloat(node.getAttribute('height'));
        // apply sizing
        if(w && h){
          image.width = w;
          image.height = h;
        }
        // opacity from style
        if(node.style.opacity){
          image.opacity = parseFloat(node.style.opacity);
        }
        // apply transformation
        if(transform)
          image.applySVGTransform(transform, { x, y });
        else
          image.setTransform(Transform.from({ x, y }));
        if(!justReturn){
          getObjectList(image).push(image);
        }
        if(node.dataset.id){
          legacySketch = true;
          objectMap[node.dataset.id] = { object: image, node };
        }
        newObjects.push(image);
      } break;

      default:
        if(env.verbose)
          console.log('Skipping unsupported tag', node.tagName);
        break;
    }
  }

  // legacy sketch import
  if(legacySketch){
    loadLegacySketchData(objectMap);
  }
  return newObjects;
}

/**
 * Transforms an SVG path string into a Curve instance
 * 
 * @param {string} path an svg path ('d' attribute)
 * @param {SVGMatrix} transform a transform matrix {a,b,c,d,e,f}
 * @return {Curve} the corresponding Curve
 */
function getCurveFromPathString(path, transform){
  const curve = Curve.fromString(path);
  // apply transform
  if(transform){
    // note: transform is already transform from local to global
    // => no need to take transform.inverse()
    const xform = transform;
    const unproject = (pt) => {
      // @see https://developer.mozilla.org/en-US/docs/Web/API/SVGMatrix
      // @see https://developer.mozilla.org/en-US/docs/Web/API/DOMMatrix
      return pt ? Transform.applySVGTransform(xform, pt) : null;
    };
    for(let i = 0; i < curve.length; ++i){
      const p = curve.getPoint(i);
      const cs = curve.getControlPoint(i, Curve.CTRL_START);
      const ce = curve.getControlPoint(i, Curve.CTRL_END);
      // resolve absolute control point positions
      // /!\ this is necessary because we're changing p in between
      const csp = cs ? cs.pos() : null;
      const cep = ce ? ce.pos() : null;
      curve.setPoint(i, unproject(p));
      curve.setControlPoint(i, Curve.CTRL_START, unproject(csp));
      curve.setControlPoint(i, Curve.CTRL_END, unproject(cep));
    }
  }

  if(curve.open){
    return curve;
  } else {
    return Sketch.fromCurve(curve);
  }
}

function loadLegacySketchData(objectMap){
  // apply data-* information
  // 1) for individual properties
  for(const { object, node } of Object.values(objectMap)){
    // SketchObject
    if(node.dataset.name)
      object.name = node.dataset.name;
    if(node.dataset.transform){
      // full transform
      // /!\ gets reduced when parenting
      const arr = JSON.parse(node.dataset.transform);
      object.setTransform(new Transform(...arr));
    }
    // Curve
    if(node.dataset.ctrlModes){
      const modes = node.dataset.ctrlModes.split(';');
      if(modes.length === object.length){
        for(let i = 0; i < object.length; ++i)
          object.setControlMode(i, modes[i] || Curve.CORNER);
      } else {
        console.log('Control modes length does not match, expected', object.length, ', but got', modes.length);
      }
    }
    // Sketch
    if(node.dataset.other){
      const { object: other } = objectMap[node.dataset.other] || {};
      if(other){
        object.other = other;
        other.other = object; // necessary for creating the links below (because of assertion on link creation)
      }
    }
    // SketchImage
    if(node.dataset.opacity){
      object.opacity = parseFloat(node.dataset.opacity);
    }
  } // endif {object, node} of objectMap entries

  // 2) for connections
  for(const { object, node } of Object.values(objectMap)){
    // SketchObject
    // /!\ parenting needs individual full transforms to have been applied
    //     before the parenting link is created (else the transforms will be messed up)
    if(node.dataset.parent){
      const { object: parent } = objectMap[node.dataset.parent] || {};
      if(parent){
        object.setParent(parent);
      }
    }
    // Curve
    // Sketch
    // /!\ constraints should not be created before parenting, else parenting would happen
    //     and mess up individual transforms for the same reason (by creating parenting)
    if(node.dataset.constraints){
      const constraints = node.dataset.constraints.split(';');
      for(let i = 0; i < constraints.length; ++i){
        const params = constraints[i].split(',');
        assert(params.length === 4, 'Invalid constraint parameters');
        // legacy:
        //    [mode, type, target, dir]
        //    (str,  str,  num,    str)
        // new:
        //    [target, type, dir, weight]
        //    (num,    str,  num, num)
        // check types
        const NUM = 'number';
        const STR = 'string';
        const ptypes = params.map(p => isNaN(p) ? STR : NUM);
        const legacyTypes = [STR, STR, NUM, STR];
        const newTypes    = [NUM, STR, NUM, NUM];
        const isLegacy = ptypes.every((p,i) => p === legacyTypes[i]);
        const isNew    = ptypes.every((p,i) => p === newTypes[i]);
        //
        if(isLegacy){
          const [mode, type, targetIdx, dir] = constraints[i].split(',');
          const newDir = {
            'forward': 1, 'backward': -1, 'none': 0
          };
          if(mode === 'border'){
            const pcurve = newSegmentPCurve(object, parseInt(targetIdx));
            object.setConstraint(pcurve, type, newDir[dir]);

          } else {
            const child = (objectMap[targetIdx] || {}).object;
            assert(child, 'Invalid child constraint', targetIdx);
            object.setConstraint(child, type, newDir[dir]);
          }

        } else {
          assert(isNew, 'Invalid parameters', params);
          // all as child constraints
          const [target, type, dir, weight] = params;
          const child = (objectMap[target] || {}).object;
          assert(child, 'Invalid constraint', params);
          object.setConstraint(child, type, dir, parseFloat(weight));
        }
      }
    }
    // /!\ links can be to parent, in which case the parenting should have happened because
    //     some of the assertions check the parenting state with the index (-1 only for parented)
    if(node.dataset.links){
      const links = node.dataset.links.split(';');
      if(links.length === object.length){
        for(let i = 0; i < object.length; ++i){
          const link = links[i];
          if(!link.length)
            continue;
          const [trg, targetIdx, mirror] = link.split(',').map(s => parseInt(s));
          const { object: target } = objectMap[trg] || {};
          if(target && targetIdx < target.length){
            object.setLink(i, target, targetIdx, mirror);
          } else {
            assert.error('Invalid link', target, targetIdx, object.length);
          }
        }
      } else {
        console.log('Links length does not match, expected', object.length, ', but got', links.length);
      }
    }
  } // endif {object, node} of objectMap entries
}

function getSketchesAsSVG(){
  // @see https://stackoverflow.com/questions/38477972/javascript-save-svg-element-to-file-on-disk?rq=1
  // create a doctype
  const svgDocType = document.implementation.createDocumentType('svg', "-//W3C//DTD SVG 1.1//EN", "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd");
  // a fresh svg document
  const svgDoc = document.implementation.createDocument('http://www.w3.org/2000/svg', 'svg', svgDocType);
  const svg = svgDoc.documentElement;
  // global style
  svg.setAttribute('style', 'background: #F0F0FF;');
  // save all curves with metadata
  for(const curve of allCurves()){
    // create group to encapsulate transform
    const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grp.setAttribute('transform', curve.fullTransform.toSVGString());
    // create curve path
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', curve.pathString());
    // store JSON data in <![CDATA[ ]]> section
    const cdata = svgDoc.createCDATASection(JSON.stringify(curve.toJSON()));
    path.appendChild(cdata);
    // style (for SVG)
    let fill = '';
    let stroke = 'stroke: #000; stroke-dasharray: 5px 5px; ';
    if(!curve.open){
      fill = 'fill: #FFFFFFAA; ';

    } else if(curve.parent) {
      fill = 'fill: none; ';
      // check if a constraint
      const sketch = curve.root();
      const constr = sketch.getConstraint(curve);
      if(constr){
        // constraint curve
        stroke = 'stroke: ' + constr.color + 'AA; stroke-width: 2px;';

      } else {
        // construction curve
        stroke = 'stroke: #999';
      }
    }
    path.setAttribute('style', fill + stroke);
    grp.appendChild(path);
    svg.appendChild(grp);
  }

  // save all images with metadata
  for(let image of allImages()){
    const grp = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    grp.setAttribute('transform', image.fullTransform.toSVGString());
    // create image tag
    const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    img.setAttribute('href', image.src);
    img.setAttribute('width', image.width);
    img.setAttribute('height', image.height);
    // store JSON as data in <![CDATA[ ]]> section
    const cdata = svgDoc.createCDATASection(JSON.stringify(img.toJSON()));
    img.appendChild(cdata);
    // style (for SVG)
    img.setAttribute('style', 'opacity: ' + image.opacity);
    grp.appendChild(img);
    svg.appendChild(grp);
  }

  // get the data as string
  const svgData = (new XMLSerializer()).serializeToString(svgDoc);
  return svgData.replace(/></g, '>\n\r<'); // for easy view in text editors
}

function normalizeSketches(){
  // normalize scale across sketches
  for(let sketch of sketches)
    sketch.applyScale(true); // recursively
}

function updateFlow(){
  normalizeSketches();
  Flow.updateSketches(sketches.filter(s => !s.parent));
}

function createMesh(){
  normalizeSketches();
  return Mesh.fromSketches(sketches.filter(s => !s.parent), env.global);
}

function clearFlow(){
  Flow.clear();
}

function updateSchedule(){
  const meshes = Flow.getMeshes();
  if(meshes.length && meshes.every(mesh => mesh.ready)){
    Schedule.updateMeshes(meshes);
  }
}

function clearSchedule(){
  Schedule.clear();
}

function saveToJSON(){
  return {
    sketches: sketches.flatMap(sk => sk.isRoot() ? [ sk.toJSON() ] : []),
    curves:   curves.flatMap(c => c.isRoot() ? [ c.toJSON() ] : []),
    pcurves:  pcurves.flatMap(c => c.isRoot() ? [ c.toJSON() ] : []),
    images:   images.flatMap(img => img.isRoot() ? [ img.toJSON() ] : [])
  };
}

function loadFromJSON(data, reset = false){
  assert('sketches' in data && Array.isArray(data.sketches)
      && 'curves'   in data && Array.isArray(data.curves)
      // && 'pcurves'  in data && Array.isArray(data.pcurves)
      && 'images'   in data && Array.isArray(data.images), 'Invalid data, missing fields');
  if(reset){
    clearAll();
  }
  // go over sketches and curves and recreate them
  const skobjMap = {};
  for(const skData of data.sketches){
    const sk = new Sketch();
    sk.deserialize(skData, skobjMap, reset);
  }
  for(const cData of data.curves){
    const c = new Curve();
    c.deserialize(cData, skobjMap, reset);
  }
  for(const pData of data.pcurves || []){
    const p = new PCurve();
    p.deserialize(pData, skobjMap, reset);
  }
  for(const iData of data.images){
    SketchImage.fromJSON(iData, skobjMap, reset);
  }

  // internal lists for book-keeping
  const internal = {};

  // remap JSON data
  for(const [, skobj] of Object.entries(skobjMap)){
    // only remap from roots
    if(skobj.isRoot()){
      skobj.remap(id => {
        assert(id in skobjMap, 'Missing entry in sketch object map', id, skobjMap);
        return skobjMap[id];
      });
    }
    // add to necessary list
    // but ensure there's no conflict
    const list = getObjectList(skobj, internal);
    assert(!list.find(sko => sko.id === skobj.id),
      'Sketch object is already in its list or there is an id conflict', skobj, list);
    list.push(skobj);
  }

  if(env.verbose)
    console.log('Loaded JSON data', skobjMap);
}

function clearAll(){
  sketches.splice(0, sketches.length);
  curves.splice(0, curves.length);
  pcurves.splice(0, pcurves.length);
  images.splice(0, images.length);
  SketchObject.resetUUID();
  Link.clear();
  clearSchedule();
  clearFlow();
  if(env.verbose)
    console.log('Clearing sketch data');
}


module.exports = Object.assign({
  // classes
  Sketch, Curve, PCurve, Transform, SketchImage, FlowConstraint, Link,
  Seam, Flow, Mesh, Sizing, Schedule, StitchSampler, Trace, SketchLayer,
  SketchAnchor, SketchRectangle,
  // curve methods
  newCurve, moveToFront, deleteCurve, copyCurve, availableParentsFor,
  newSketch, createBack, mirrorCurve,
  newPCurve, newSegmentPCurve, deletePCurve,
  // image methods
  newImage, deleteImage,
  // generic methods
  deleteObject,
  // static transforms
  identity: Transform.identity,
  translation: Transform.translation,
  scaling: Transform.scaling,
  // global accessors
  allCurves, allRootCurves, allPCurves, allNCChildren,
  allSketches, allRootSketches, extents,
  allImages, allRootImages,
  getHITTarget, getHITTargets,
  // flow
  updateFlow, clearFlow,
  // mesh
  createMesh,
  // schedule
  updateSchedule, clearSchedule,
  // import / export
  loadCurvesFromSVG,
  getSketchesAsSVG,
  loadFromJSON,
  saveToJSON,
  clearAll
}, S);
