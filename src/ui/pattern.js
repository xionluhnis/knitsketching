// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
// const Action = require('../algo/compiler/action.js');
const assert = require('../assert.js');
const env = require('../env.js');
const { open: openPanel } = require('./panel.js');
const geom = require('../geom.js');
const sk = require('../sketch.js');
const { triggerUpdate } = require('./program.js');
const util = require('./util.js');
const {
  imgToStr, strToImg,
  chars, codeToChar,
  PatternImage
} = require('../algo/compiler/layers/stitchpattern.js');
const d3 = require('d3');
const draw = require('./draw.js');
const colors = require('./colors.js');
const DSL = require('../dsl.js');
const CarrierConfig = require('../carriers.js');

let editor = null;
class PatternEditor {
  constructor(){
    // layer data
    this.layerData = null;
    this.pattern = PatternImage.create(1, 1);
    this.mapping = new Map([[0, 0]]);

    // html data
    this.mainCanvas  = document.getElementById('pattern');
    this.mainContext = this.mainCanvas.getContext('2d', { alpha: true });
    this.highCanvas  = document.createElement('canvas');
    this.highContext = this.highCanvas.getContext('2d', { alpha: true });
    this.mainCanvas.parentElement.insertBefore(
      this.highCanvas, this.mainCanvas.nextSibling
    );
    this.drawCanvas  = document.createElement('canvas');
    this.drawContext = this.drawCanvas.getContext('2d', { alpha: true });
    this.drawDirty   = true;
    this.mapList = document.getElementById('mapping');
    this.mapItemTmpl = document.getElementById('mapping-item').content.firstElementChild;
    this.mapNewTmpl  = document.getElementById('mapping-new').content.firstElementChild;
    this.mapSimpTmpl = document.getElementById('mapping-simplify').content.firstElementChild;
    const file = document.getElementById('pattern-file');
    const load = document.getElementById('pattern-load');

    // long-term events
    for(const id of ['pattern-save-png', 'pattern-save-txt']){
      document.getElementById(id).addEventListener('click', event => {
        this.saveToFile(
          event, 'pattern.' + id.slice(id.length - 3)
        );
      });
    }
    file.addEventListener('change', () => this.loadFile(file.files[0]));
    load.addEventListener('click', () => file.click());
    this.lastBlob = null;

    // image tools
    this.patternTile = false;
    for(const [id, call] of [
      ['pattern-rotate', () => this.rotate()],
      ['pattern-rotate2', () => this.rotate(-1)],
      ['pattern-hflip', () => this.hflip()],
      ['pattern-vflip', () => this.vflip()],
      ['pattern-tile', () => {
        this.patternTile = !this.patternTile;
        this.updateCanvas();
      }]
    ]){
      document.getElementById(id).addEventListener('click', call);
    }
    for(const which of ['width', 'height']){
      document.getElementById('pattern-' + which).addEventListener('change', () => {
        this.resize();
      });
    }

    // pixel click
    this.pressing = false;
    this.onCanvas = false;
    this.mouseX = this.mouseY = -1;
    this.patternX = this.patternY = -1;
    this.mainCanvas.addEventListener('mousemove', event => {
      this.onCanvas = true;
      // update mouse position in pattern space
      const transform = this.transform || { x: 0, y: 0, k: 1 };
      this.mouseX = event.offsetX;
      this.mouseY = event.offsetY;
      this.patternX = (this.mouseX - transform.x) / transform.k;
      this.patternY = (this.mouseY - transform.y) / transform.k;

      if(!this.usingBrush)
        return; // no brush to consider

      // if pressing, then trigger new brush stroke
      // => will redraw the whole scene and highlight
      // else, just redraw the highlight
      if(this.pressing)
        this.pressBrush({ x: this.patternX, y: this.patternY }, true);
      else
        this.drawHighlight();
    });
    this.mainCanvas.addEventListener('pointerdown', () => {
      this.pressing = true;
      // trigger brush stroke
      if(this.usingBrush)
        this.pressBrush();
    });
    for(const event of ['pointerup', 'mouseout']){
      this.mainCanvas.addEventListener(event, () => {
        this.pressing = false;
        this.onCanvas = event !== 'mouseout';
        if(this.usingBrush && event === 'mouseout')
          this.drawHighlight(); // to clear brush completely
      });
    }
    // brush types
    this.brushIndex = 0;
    this.brushSize  = 10;
    this.brushValue = 0;
    this.brushFunc  = null;
    this.brushes    = [];
    for(const input of document.querySelectorAll('#pattern-editor .options input.brush')){
      const idx = this.brushes.length;
      input.dataset.index = idx;
      if(input.dataset.func){
        this.brushes.push(
          DSL.exprFunction(
            input.dataset.func,
            ['p', 'q', 'R', 'geom']
          )
        );
      } else
        this.brushes.push(null);
      input.addEventListener('click', () => {
        const usingBrush = !!idx;
        if(this.usingBrush && !usingBrush)
          this.enablePaning();
        else if(!this.usingBrush && usingBrush && !this.shiftKey)
          this.disablePaning();
        this.brushIndex = idx;
        this.updateCanvas();
      });
    }
    document.getElementById('brush-size').addEventListener('change', event => {
      this.brushSize = parseInt(event.target.value);
      this.updateUI();
    });

    // zoom / pan mechanism
    this.width = this.mainCanvas.clientWidth;
    this.transform = { x: 0, y: 0, k: 1 };
    // this.visibleExtents = { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
    this.zoom = d3.zoom();
    /*
    this.zoom.filter(() => {
      return (!this.actionMode || this.moveMode) && !d3.event.button;
    });
    */
    this.zoom.scaleExtent(this.zoomExtents = [0.5, 50]);
    this.zoom.on('zoom', () => {
      this.updateCanvas();
    });
    this.updateExtent();
    // apply zoom on canvas
    d3.select(this.mainCanvas).call(this.zoom);

    // panning
    this.shiftKey = false;
    window.addEventListener('keydown', event => {
      this.shiftKey = event.shiftKey;
      if(this.usingBrush && event.keyCode === 16)
        this.enablePaning();
    });
    window.addEventListener('keyup', event => {
      this.shiftKey = event.shiftKey;
      if(this.usingBrush && event.keyCode === 16)
        this.disablePaning();
    });
    // this.disablePaning();

    this.centerLayout();
  }
  get usingBrush(){ return !!this.brushIndex; }
  keepRatio(){
    return !!document.getElementById('pattern-scaling').checked;
  }
  charMode(){
    return !this.layerData
        || this.layerData.layerType === 'stitch-pattern';
  }
  selectedMappingItem(){
    return this.mapList.querySelector('input[name=pattern-mapping]:checked');
  }
  selectedMappingKey(){
    const selItem = this.selectedMappingItem();
    if(selItem)
      return parseInt(selItem.dataset.text) || 0;
    else
      return 0;
  }

  saveToFile(event, fname){
    const link = event ? event.target : null;
    if(fname.endsWith('txt')){
      const pattern = imgToStr(this.pattern, this.mapping);
      util.exportFile(fname, pattern, { link });
    } else {
      const dataURL = this.pattern.toDataURL();
      util.exportDataURL(fname, dataURL, { link });
    }
  }

  loadFile(blob, fname){
    if(!blob)
      blob = this.lastBlob;
    if(!blob)
      return;
    if(!fname)
      fname = blob.name.toLowerCase();
    assert(fname, 'Missing file name');
    if(fname.endsWith('.txt') || fname.endsWith('.pat'))
      this.loadTextFile(blob);
    else
      this.loadImageFile(blob);
  }
  loadImageFile(blob){
    const reader = new FileReader();
    reader.onload = event => {
      const data = event.target.result;
      if(data){
        // remember blob
        this.lastBlob = blob;

        util.loadImage(data, false).then(imgData => {
          // load pattern data
          this.pattern = PatternImage.fromImage(imgData);
          const valueMap = this.pattern.valueMap();
          const mainValue = Array.from(
            valueMap.entries()
          ).reduce(([maxV, maxN], [v,n]) => {
            return n > maxN ? [v,n] : [maxV, maxN];
          }, [0, -1])[0];
          this.mapping = new Map(Array.from(this.pattern.values(), v => {
            return v === mainValue ? [v, 0] : [v, 1];
          }));

          // update layer data
          this.updateFromContent();
          this.centerLayout();

        }).catch(err => {
          console.warn('Image loading error', err);
        });
      }
    };
    reader.readAsDataURL(blob);
  }
  loadTextFile(blob){
    assert(['.txt', '.pat'].some(str => blob.name.endsWith(str)),
      'Unsupported file extension', blob.name);
    const reader = new FileReader();
    reader.onload = event => {
      const data = event.target.result;
      if(data){
        // remember blob
        this.lastBlob = blob;

        // load pattern data
        this.pattern = strToImg(data);
        this.mapping = new Map(Array.from(this.pattern.values(), v => [v, v]));

        // update layer data and UI
        this.updateFromContent();
        this.centerLayout();
      }
    };
    reader.readAsText(blob);
  }
  rotate(k = 1){
    if(k % 4 === 0)
      return; // nothing to do
    this.pattern.rotate(k);
    this.updateFromContent();
  }
  hflip(){
    this.pattern.hflip();
    this.updateFromContent();
  }
  vflip(){
    this.pattern.vflip();
    this.updateFromContent();
  }
  resize(){
    // XXX implement resizing with and without fixed ratio
    const patternWidth = document.getElementById('pattern-width');
    const patternHeight = document.getElementById('pattern-height');
    let w = parseInt(patternWidth.value);
    let h = parseInt(patternHeight.value);
    const { width, height } = this.pattern;
    if(w === width && h === height)
      return; // no change of size

    // two modes of resizing:
    // - rescaling = keep w/h ratio as close as possible
    // - resizing  = extend/shrink pixel grid as necessary
    if(this.keepRatio()){
      if(w === width && h === height)
        return; // nothing to do
      else if(w !== width){
        assert(h === height,
          'Concurrent size modification');
        h = Math.max(1, Math.round(w / width * height));
        if(h !== height)
          patternHeight.value = h;
      } else if(h !== height){
        assert(w === width,
          'Concurrent size modification');
        w = Math.max(1, Math.round(h / height * width));
        if(w !== width)
          patternWidth.value = w;
      }
      this.pattern = this.pattern.rescale(w, h);
    } else {
      this.pattern = this.pattern.resize(w, h);
    }
    this.updateFromContent();
  }

  storePattern(){
    if(!this.layerData)
      return;
    // store pattern + mapping into layerData
    this.layerData.setParam(this.patternName, this.pattern);
    this.layerData.setParam('mapping', this.mapping);
    if(env.verbose)
      console.log('Storing layer pattern');
  }
  setLayerData(ld, patternName = 'pattern', update = true){
    if(!ld)
      return;
    this.layerData = ld;
    this.patternName = patternName;
    this.pattern = ld.getParam(patternName);
    this.mapping = ld.getParam('mapping');
    for(const v of this.pattern.values()){
      if(!this.mapping.has(v))
        this.mapping.set(v, 0);
    }
    // disable (or not) text export
    document.getElementById(
      'pattern-save-txt'
    ).classList.toggle('disabled', !this.charMode());
    // update editor
    if(update){
      this.updateFromContent();
      this.centerLayout();
    }
  }
  enablePaning(){
    d3.select(this.mainCanvas).call(this.zoom);
  }
  disablePaning(){
    // @see https://stackoverflow.com/questions/13713528/how-to-disable-pan-for-d3-behavior-zoom
    d3.select(this.mainCanvas)
      .on('mousedown.zoom', null)
      .on('dblclick.zoom', null);
      // .on('mousemove.zoom', null)
      // .on('mouseup.zoom', null)
      // .on('touchstart.zoom', null)
      // .on('touchmove.zoom', null)
      // .on('touchend.zoom', null);
  }
  centerLayout(scale = 0){
    const width  = Math.max(1, this.pattern.width);
    const height = Math.max(1, this.pattern.height);
    // find appropriate zoom level
    if(!scale){
      scale = Math.max(
        0.5, Math.min(10, 
          Math.max(
          this.mainCanvas.width / width * 0.9,
          this.mainCanvas.height / height * 0.9)
        )
      );
    }
    const newTransform = d3.zoomIdentity.translate(
      this.mainCanvas.width / 2 - width / 2 * scale,
      this.mainCanvas.height / 2 - height / 2 * scale
    ).scale(scale);
    d3.select(this.mainCanvas)
      .transition()
      .duration(750)
      .call(
          this.zoom.transform,
          newTransform
      );
  }
  updateExtent(){
    const transform = sk.Transform.from(this.transform);
    const w = this.width;
    this.visibleExtents = {
      min: transform.unapplyFrom({ x: 0, y: 0 }),
      max: transform.unapplyFrom({ x: w, y: w })
    };
    /*
    return;
    const w = Math.max(1, this.pattern.width);
    const h = Math.max(1, this.pattern.height);
    // extents = [ [left, top], [right, bottom] ]
    this.zoom.translateExtent(this.extents = [
      [0, -h], // [ (-w * 0.5), (-h * 0.5) ],
      [w, 0] // [ ( w * 0.5), ( h * 0.5) ]
    ]);
    */
  }
  isPointVisible(p){
    return util.bboxContains(this.visibleExtents, p);
  }
  isPixelVisible(x, y){
    return this.isPointVisible({ x: x + 0.5, y: y + 0.5});
  }
  updateFromContent(){
    this.drawDirty = true;
    this.updateExtent();
    this.storePattern();
    this.updateUI();
    if(this.layerData)
      triggerUpdate();
  }
  updateUI(){

    // update canvas given content
    this.updateCanvas();

    // update mapping UI
    this.updateMapping();
  }
  updateCanvas(){
    // update width/height
    const width  = this.mainCanvas.clientWidth;
    const height = this.mainCanvas.clientHeight;
    if(width !== this.width
    || width !== height){
      this.width = width;
      this.mainCanvas.width = width;
      this.highCanvas.width = width;
      this.mainCanvas.height = width;
      this.highCanvas.height = width;
    }
    // get transform for pan/zoom
    const transform = d3.zoomTransform(this.mainCanvas);
    this.transform = transform;

    // update extents
    this.updateExtent();

    // if drawCanvas is dirty, we must transfer again
    if(this.drawDirty)
      this.transferPatternToCanvas();

    // draw image data
    this.drawPattern();

    // draw highlight data
    this.drawHighlight();
  }
  transferPatternToCanvas(){
    // reset draw canvas
    const w = this.drawCanvas.width = this.pattern.width;
    const h = this.drawCanvas.height = this.pattern.height;
    const ctx = this.drawContext;
    ctx.clearRect(0, 0, w, h);

    // get image data
    let img;
    if(this.charMode()){
      img = this.pattern.toImageData(v => {
        const code = this.mapping.get(v) || 0;
        if(!code)
          return [0, 0, 0, 0];
        else {
          let ch = codeToChar(code);
          if('LR'.includes(ch))
            ch = 'F' + ch + '1';
          const [r, g, b] = colors.getPatternColor(ch).rgb();
          return [r, g, b, 255];
        }
      });
    } else {
      const cc = CarrierConfig.fromEnv();
      const cache = new Map([
        [0, [0, 0, 0, 0]]
      ]);
      img = this.pattern.toImageData(v => {
        const code = this.mapping.get(v) || 0;
        if(!cache.has(code)){
          const colorStr = cc.getDeviceInfo(code, 'color', '#000000');
          const [r, g, b] = colors.chroma(colorStr).rgb();
          cache.set(code, [r, g, b, 255]);
        }
        return cache.get(code);
      });
    }
    ctx.putImageData(img, 0, 0);

    // not dirty anymore
    this.drawDirty = false;
  }
  drawPattern(){
    const ctx = this.mainContext;
    const transform = this.transform;

    // clear background
    ctx.clearRect(0, 0, this.width, this.width);
    // pattern size
    const w = this.drawCanvas.width;
    const h = this.drawCanvas.height;
    // ctx.save();
    // ctx.translate(this.width / 2, this.height / 2);

    draw.withinViewport(ctx, transform, () => {
      // ctx.translate(-this.drawCanvas.width / 2, -this.drawCanvas.height / 2);
      ctx.fillStyle = '#eeeeee';
      ctx.fillRect(0, 0, w, h);
      // draw highlight of selection
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.drawCanvas, 0, 0, w, h);
      // tile image in lower alpha
      if(this.patternTile){
        ctx.globalAlpha = 0.3;
        for(let dy = -1; dy <= 1; ++dy){
          for(let dx = -1; dx <= 1; ++dx){
            if(dx === 0 && dy === 0)
              continue;
            ctx.drawImage(
              this.drawCanvas,
              dx * w,
              dy * h,
              w, h
            );
          }
        }
        ctx.globalAlpha = 1.0;
      }

      // draw pixel edges when zooming
      if(transform.k < 4)
        return;
      ctx.beginPath();
      ctx.strokeStyle = '#00000099';
      ctx.lineWidth = 0.5 / transform.k;
      for(let x = 0; x <= w; ++x){
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
      }
      for(let y = 0; y <= h; ++y){
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      // draw characters
      if(!this.charMode() || transform.k < 12)
        return;
      for(const [x, y, v] of this.pattern.pixels()){
        if(!this.isPixelVisible(x, y))
          continue;
        const code = this.mapping.get(v);
        if(!code)
          continue;
        const str = codeToChar(code);
        draw.label(ctx, str,
          { x: x + 0.5, y: y + 0.8 }, true,
          '1px Arial'
        );
      }
    });
    // ctx.restore();
  }
  drawHighlight(){
    const ctx = this.highContext;
    const transform = this.transform;

    // clear background
    ctx.clearRect(0, 0, this.width, this.width);

    // visualize brush
    if(!this.usingBrush)
      return; // nothing to visualize?
    draw.withinViewport(ctx, transform, () => {
      // draw brush center
      ctx.beginPath();
      ctx.strokeStyle = '#000000AA';
      draw.plus(ctx,
        this.patternX, this.patternY,
        1.5 / transform.k
      );
      ctx.stroke();
      // draw highlight of brush
      // const v = this.brushValue;
      ctx.fillStyle = '#00000066';
      for(const [x, y] of this.patternPixelsFromBrush()){
        ctx.fillRect(x, y, 1, 1);
      }
    });
  }
  *patternPixelsFromBrush(p = { x: this.patternX, y: this.patternY }){
    const R = Math.max(0.5, this.brushSize / this.transform.k);
    const brushFun = this.brushes[this.brushIndex];
    if(!brushFun)
      return;

    // we only consider the pixels within the largest domain
    // of interaction of the brush (= the square of radius R)
    const y0 = Math.round(p.y);
    const x0 = Math.round(p.x);
    const r0 = Math.ceil(R);
    for(let y = y0 - r0, yn = y0 + r0; y <= yn; ++y){
      if(y < 0 || y >= this.pattern.height)
        continue;
      for(let x = x0 - r0, xn = x0 + r0; x <= xn; ++x){
        if(x < 0 || x >= this.pattern.width)
          continue;
        // check if under the brush
        const brush = brushFun(p, { x: x + 0.5, y: y + 0.5 }, R, geom);
        if(brush) // || (x === x0 && y === y0))
          yield [x, y, this.pattern.pixel(x, y)];
      }
    }
  }
  pressBrush(p = { x: this.patternX, y: this.patternY }, alwaysUpdate = false){
    const brushFun = this.brushes[this.brushIndex];
    assert(brushFun, 'No brush function');
    const val = this.brushValue;

    // go over brush pixels
    let changed = false;
    for(const [x, y, v] of this.patternPixelsFromBrush(p)){
      if(v !== val){
        changed = true;
        this.pattern.setPixel(x, y, val);
      }
    }

    // UI updates
    if(changed)
      this.updateFromContent();
    else if(alwaysUpdate)
      this.drawHighlight();
  }
  getOptions(){
    if(this.charMode()){
      return Array.from(chars(), (char, idx) => {
        return util.createOption(
          idx, char.toUpperCase()
        );
      });
    } else {
      return [
        util.createOption(' '),
        ...Array.from(CarrierConfig.devices(), c => {
          return util.createOption(
            c.bitmask.toString(), c.name
          );
        })
      ];
    }
  }
  updateMapping(){
    // update width/height input values
    document.getElementById('pattern-width').value = this.pattern.width;
    document.getElementById('pattern-height').value = this.pattern.height;
    // measure current selected mapping
    const currKey = this.selectedMappingKey();
    // clear list
    while(this.mapList.firstChild)
      this.mapList.removeChild(this.mapList.firstChild);

    // create list from mapping
    let someSel = false;
    const keys = Array.from(this.mapping.keys());
    for(let i = 0; i < keys.length; ++i){
      const key = keys[i];
      const val = this.mapping.get(key);
      const entry = this.mapItemTmpl.cloneNode(true); // deep cloning
      const input = entry.querySelector('input.key');
      input.dataset.text = key;
      if(currKey === key || this.mapping.size === 1){
        someSel = input.checked = true;
        this.brushValue = key;
      }
      input.onclick = () => {
        this.brushValue = key;
      };
      const select = entry.querySelector('select');
      while(select.firstChild)
        select.removeChild(select.firstChild);
      for(const option of this.getOptions()){
        if(option.value === val + '')
          option.selected = true;
        if(!option.textContent || !option.textContent.length)
          option.textContent = '-';
        select.appendChild(option);
      }
      // changing the mapping
      select.onchange = () => {
        this.mapping.set(key, parseInt(select.value));
        this.updateFromContent();
      };
      // removing the mapping
      if(this.mapping.size > 1){
        entry.querySelector('a').onclick = () => {
          const mergeKey = i > 0 ? keys[i-1] : keys[i+1];
          assert(typeof mergeKey === 'number' && 0 <= mergeKey && mergeKey <= 255,
            'Invalid merging key');
          util.askForNumber('Replace with entry number', mergeKey, {
            integer: true, min: 0, max: 255
          }).then(newKey => {
            if(key === newKey)
              return; // nothing to do
            // remove current key
            this.mapping.delete(key);
            // check whether key is within other available keys
            if(!this.mapping.has(newKey)){
              this.mapping.set(newKey, val);
            } // else no need to create an entry
            // replace the keys
            this.pattern.replace(key, newKey);

            // update data + visual update
            this.updateFromContent();
            
          }).catch(util.noop);
        };
      } else {
        // disallow if last mapping value
        entry.querySelector('a').classList.toggle('disabled', true);
        entry.removeChild(entry.lastChild);
      }
      this.mapList.appendChild(entry);
    }
    // set first as selected if none available
    if(!someSel){
      this.mapList.firstChild.querySelector('input').checked = true;
      this.brushValue = keys[0];
    }

    // add new mapping item
    const newMappingItem = this.mapNewTmpl.cloneNode(true);
    this.mapList.appendChild(newMappingItem);
    newMappingItem.querySelector('a').onclick = () => {
      let freeKey = 0;
      for(; this.mapping.has(freeKey) && freeKey <= 255; ++freeKey);
      if(freeKey >= 256)
        return; // cannot create new entry
      util.askForNumber('New pixel value [0-255]', freeKey, {
        integer: true, min: 0, max: 255
      }).then(newKey => {
        if(this.mapping.has(newKey)){
          alert('Pixel value ' + newKey + ' already exists');
          return;
        }
        // new entry
        this.mapping.set(newKey, 0);
        this.updateFromContent();

      }).catch(util.noop);
    };

    // check if we can simplify the mapping
    const mapValues = new Set(this.mapping.values());
    if(this.mapping.size !== mapValues.size){
      assert(this.mapping.size > mapValues.size,
        'Cannot have more values than keys');
      // add simplify mapping item
      const simpMappingItem = this.mapSimpTmpl.cloneNode(true);
      this.mapList.appendChild(simpMappingItem);
      simpMappingItem.querySelector('a').onclick = () => {
        const newMapping = new Map();
        const invMapping = new Map();
        const oldToNew = new Map();
        for(const [k, v] of this.mapping){
          if(invMapping.has(v)){
            // merge with existing
            oldToNew.set(k, invMapping.get(v));
          } else {
            // register entry
            newMapping.set(k, v);
            invMapping.set(v, k);
          }
        }
        // update pattern
        this.pattern = this.pattern.map(k => {
          if(oldToNew.has(k))
            return oldToNew.get(k);
          else
            return k;
        });
        this.mapping = newMapping;
        this.updateFromContent();
      };
    }
  }
}

function editPattern(...args){
  // initialize editor if necessary
  if(!editor)
    editor = new PatternEditor();

  // show panel
  openPanel('pattern');

  // set editor target => updates the UI
  if(args.length)
    editor.setLayerData(...args);
  else
    editor.updateFromContent();
}

// export
module.exports = { editPattern };