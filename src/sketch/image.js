// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchObject = require('./object.js');
const Transform = require('./transform.js');
const geom = require('../geom.js');

class SketchImage extends SketchObject {
  constructor(src, img){
    super();
    this.src = src;
    if(img){
      this.img = img;
    } else {
      this.img = new Image();
      this.img.src = src; // /!\ loading is asynchronous!
    }
    this.opacity = 1.0;
  }
  get type(){ return 'image'; }
  get width(){ return this.img.width; }
  set width(w){ this.img.width = w; }
  get height(){ return this.img.height; }
  set height(h){ this.img.height = h; }
  serialize(opts){
    return Object.assign(super.serialize(opts), {
      src: this.src,
      width: this.img.width,
      height: this.img.height,
      opacity: this.opacity
    });
  }
  deserialize(data, map, useID){
    super.deserialize(data, map, useID);
    // load image-specific data
    if(data.width)
      this.img.width = data.width;
    if(data.height)
      this.img.height = data.height;
    if(data.opacity)
      this.opacity = data.opacity;
  }
  static fromJSON(data, map, useID){
    const img = new SketchImage(data.src);
    img.deserialize(data, map, useID);
    return img;
  }

  drawPath(ctx){
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
  }

  get centroid(){
    return {
      x: this.width * 0.5,
      y: this.height * 0.5
    };
  }

  extents(currExt){
    if(currExt){
      return {
        min: {
          x: Math.min(currExt.min.x, 0),
          y: Math.min(currExt.min.y, 0)
        },
        max: {
          x: Math.max(currExt.max.x, this.width),
          y: Math.max(currExt.max.y, this.height)
        }
      };
    } else {
      return {
        min: { x: 0, y: 0 },
        max: { x: this.width, y: this.height }
      };
    }
  }

  hitTest(p){ return this.withinExtents(p); }

  static fromURL(src){
    return new Promise((accept, reject) => {
      const img = new Image();
      // setup event handlers
      img.onload = () => {
        const si = new SketchImage(src, img);
        accept(si);
      };
      img.onerror = error => {
        reject(error);
      };
      // start loading
      img.src = src;
    });
  }

  applySVGTransform(xform, offset = { x: 0, y: 0 }){
    // we need the image to have loaded
    const { width, height } = this;
    // => use promise call
    SketchImage.fromURL(this.src).then(si => {
      // compute transform extents
      // - initial hull, without offset
      const corners = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height }
      ];
      // - transformed hull, with offset
      const xcorners = corners.map(p => {
        const q = geom.axpby(1, p, 1, offset);
        return Transform.applySVGTransform(xform, q);
      });
      // - extents of the transformed image (from transformed hull)
      const { min, max } = geom.extents(xcorners);

      // get new width/height information for rendering
      const newWidth = Math.ceil(max.x - min.x) || 1;
      const newHeight = Math.ceil(max.y - min.y) || 1;
      
      // set base translation transform
      this.setTransform(Transform.translation(min.x, min.y));

      // create canvas
      const density = 4.0;
      const canvas = document.createElement('canvas');
      canvas.width = newWidth * density;
      canvas.height = newHeight * density;
      const ctx = canvas.getContext('2d');
      // upscale for density
      ctx.scale(density, density);
      // ensure we end up drawing within the canvas
      ctx.translate(-min.x, -min.y);
      // apply SVG transformation
      const { a, b, c, d, e, f } = xform;
      ctx.transform(a, b, c, d, e, f);
      // draw image in expected initial offset-width/height region
      ctx.drawImage(si.img, offset.x, offset.y, width, height);

      // set new source and underlying image from canvas
      this.src = canvas.toDataURL();
      this.img = new Image(canvas.width, canvas.height);
      this.img.src = this.src;
      // note: we store the expected width/height instead of
      // the canvas size because of density upscaling (for rendering)
      this.img.width = newWidth;
      this.img.height = newHeight;

    }).catch(err => {
      console.warn('Cannot set SVG transform on invalid image', err);
    });
  }
}

module.exports = SketchImage;
