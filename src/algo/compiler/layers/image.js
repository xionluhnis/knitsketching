// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/* global ImageData */

// modules
const assert = require('../../../assert.js');
const { Buffer } = require('buffer');

class PatternImage {
  constructor(data, w, h){
    assert(data instanceof Uint8ClampedArray,
      'Data has invalid type, must be Uint8ClampedArray');
    this.data = data;
    this.width = w;
    this.height = h;
    assert(typeof w === 'number' && typeof h === 'number'
        && w > 0 && h > 0,
      'Invalid width or height arguments');
    assert(this.data.length === w * h,
      'Invalid data size, got', this.data.length,
      'expected', w * h);
  }

  pixel(x, y){ return this.data[this.index(x, y)]; }
  setPixel(x, y, v){
    this.data[this.index(x, y)] = v;
  }
  index(x, y){ return PatternImage.pixelIndex(this.width, x, y, 1); }
  replace(src, trg){
    assert(typeof src === 'number' && typeof trg === 'number'
        && 0 <= src && src <= 255 && 0 <= trg && trg <= 255
        && Number.isInteger(src) && Number.isInteger(trg),
      'Invalid source or target arguments');
    for(const [x, y, v] of this.pixels()){
      if(v === src)
        this.setPixel(x, y, trg);
    }
  }
  *pixels(){
    for(let y = 0; y < this.height; ++y){
      for(let x = 0; x < this.width; ++x){
        yield [x, y, this.pixel(x, y)];
      }
    }
  }
  valueMap(){
    const count = new Map();
    for(const v of this.data){
      if(count.has(v))
        count.set(v, count.get(v) + 1);
      else
        count.set(v, 1);
    }
    return count;
  }
  *values(){
    yield *this.valueMap().keys();
  }
  copy(){
    const data = new Uint8ClampedArray(this.data);
    const img = new PatternImage(data, this.width, this.height);
    return img;
  }
  rotate(k = 1){
    assert(typeof k === 'number' && Number.isInteger(k),
      'Invalid rotation argument');
    if(k < 0){
      k = -k;
      k = k % 4;
      k = 4 - k;
    }
    const { width, height } = this;
    switch(k % 4){

      case 1:
        return this.remap((x, y) => {
          return this.pixel(
            width - 1 - y,
            x
          );
        }, height, width, true);
      
      case 2:
        return this.remap((x, y) => {
          return this.pixel(
            width - 1 - x,
            height - 1 - y
          );
        }, width, height, true);

      case 3:
        return this.remap((x, y) => {
          return this.pixel(
            y,
            height - 1 - x
          );
        }, height, width, true);

      default:
        return this;
    }
  }
  hflip(){
    return this.remap((x, y) => {
      return this.pixel(
        this.width - 1 - x,
        y
      );
    }, this.width, this.height, true);
  }
  vflip(){
    return this.remap((x, y) => {
      return this.pixel(
        x,
        this.height - 1 - y
      );
    }, this.width, this.height, true);
  }
  remap(map,
    newWidth = this.width,
    newHeight = this.height,
    inline = false
  ){
    const img = PatternImage.create(newWidth, newHeight);
    for(const [x, y] of img.pixels()){
      img.setPixel(x, y, map(x, y));
    }
    if(inline){
      this.data = img.data;
      this.width = img.width;
      this.height = img.height;
      return this;
    } else {
      return img;
    }
  }
  map(map){
    return this.remap((x, y) => map(this.pixel(x, y), x, y));
  }
  resize(w, h){
    assert(w >= 1 && h >= 1, 'Invalid arguments');
    const img = PatternImage.create(w, h);
    for(const [x, y] of img.pixels()){
      if(x < this.width && y < this.height){
        img.setPixel(x, y, this.pixel(x, y));
      }
    }
    return img;
  }
  rescale(w, h){
    assert(w >= 1 && h >= 1, 'Invalid arguments');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: true });
    ctx.clearRect(0, 0, w, h);
    const img = this.toCanvas();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    return PatternImage.fromImageChannel(imgData, 0);
  }
  toImageData(map){
    if(!map)
      map = v => [v, v, v, v ? 255 : 0];
    const imgData = new ImageData(this.width, this.height);
    for(const [x, y, v] of this.pixels()){
      const idx = PatternImage.pixelIndex(this.width, x, y, 4);
      const [r, g, b, a] = map(v);
      imgData.data[idx + 0] = r;
      imgData.data[idx + 1] = g;
      imgData.data[idx + 2] = b;
      imgData.data[idx + 3] = a;
    }
    return imgData;
  }
  toCanvas(map){
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, this.width, this.height);
    const img = this.toImageData(map);
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
  toDataURL(map){ return this.toCanvas(map).toDataURL(); }
  toData(){
    return {
      data: this.data, width: this.width, height: this.height
    };
  }
  toJSON(){
    return {
      data: Buffer.from(this.data).toString('base64'),
      width: this.width, height: this.height,
    };
  }
  static fromData(img){
    if(typeof img.data === 'string')
      return PatternImage.fromJSON(img);
    else
      return new PatternImage(img.data, img.width, img.height);
  }
  static fromJSON(img){
    assert(typeof img.data === 'string', 'Invalid img datatype');
    return new PatternImage(
      new Uint8ClampedArray(Buffer.from(img.data, 'base64')),
      img.width, img.height
    );
  }
  static pixelIndex(w, x, y, nc = 1){
    assert(0 <= x && x < w, 'Argument x is out of bounds');
    return (y * w + x) * nc;
  }
  static create(w, h){
    return new PatternImage(new Uint8ClampedArray(w * h), w, h);
  }
  static fromImageChannel(imgData, c = 0){
    return PatternImage.fromImage(imgData, (x, y) => {
      const idx = PatternImage.pixelIndex(imgData.width, x, y, 4);
      return imgData.data[idx + c];
    });
  }
  static pixelHash(imgData, x, y){
    const idx = PatternImage.pixelIndex(imgData.width, x, y, 4);
    const r = imgData.data[idx + 0];
    const g = imgData.data[idx + 1];
    const b = imgData.data[idx + 2];
    const a = imgData.data[idx + 3];
    return (r << 24) | (g << 16) | (b << 8) | a;
  }
  static pixelMap(imgData){
    const map = new Map();
    for(let y = 0; y < imgData.height; ++y){
      for(let x = 0; x < imgData.width; ++x){
        const p = PatternImage.pixelHash(imgData, x, y);
        if(map.has(p))
          continue;
        if(map.size >= 256){
          console.warn('More than 256 different pixel colors!');
          map.set(p, 0); // collapse to 0
        } else
          map.set(p, map.size);
      }
    }
    return map;
  }
  static fromImage(imgData, map, flipY = false){
    if(!map){
      // compute pixel statistics
      const pToI = PatternImage.pixelMap(imgData);
      map = (x, y) => {
        const p = PatternImage.pixelHash(imgData, x, y);
        return pToI.get(p) || 0;
      };
    }
    const { width, height } = imgData;
    const data = new Uint8ClampedArray(width * height);
    const img = new PatternImage(data, width, height);
    for(let y = 0; y < height; ++y){
      for(let x = 0; x < width; ++x){
        img.setPixel(x, y, map(x, flipY ? height - 1 - y : y));
      }
    }
    return img;
  }
}

module.exports = PatternImage;