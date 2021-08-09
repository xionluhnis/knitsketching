// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
// const assert = require('../../../assert.js');
const Action = require('../action.js');
const SketchLayer = require('./base.js');
const { TILED, SCALED } = SketchLayer;
const PatternImage = require('./image.js');
const { ImageType, MappingType, ReferenceType } = require('./param.js');
const StitchProgram = require('../stitchprog.js');
const { strToGrid } = StitchProgram;

// pattern codes
const EMPTY = 0;
const KNIT = 1;
const PURL = 2;
const TUCK = 3;
const MISS = 4;
const MOVE_L1 = 5;
const MOVE_R1 = 6;
const CHAR_TO_CODE = {
  ' ': EMPTY,
  K: KNIT, P: PURL,
  T: TUCK, M: MISS, 
  L: MOVE_L1, R: MOVE_R1
};
const CODE_TO_CHAR = Array.from(Object.entries(CHAR_TO_CODE)).reduce((map, [s, c]) => {
  return Object.assign(map, { [c]: s });
}, {});
const CODES = Array.from({ length: 7 }, (_, i) => i);
const CHARS = CODES.map(i => CODE_TO_CHAR[i]);

class StitchPattern extends SketchLayer {

  static charToCode(c){ return CHAR_TO_CODE[c.toUpperCase()] || EMPTY; }
  static codeToChar(c){ return CODE_TO_CHAR[c] || ' '; }
  static chars(){ return CHARS.slice(); }
  static strToImg(str){
    // get pattern information
    const grid = strToGrid(str);
    const w = grid.reduce((w, row) => Math.max(w, row.length), 0);
    const h = grid.length;
    const img = PatternImage.create(w, h);
    for(let y = 0; y < h; ++y){
      for(let x = 0; x < w; ++x){
        const c = StitchPattern.charToCode(grid[y][x]);
        img.setPixel(x, y, c);
      }
    }
    return img;
  }
  static imgToStr(img, map){
    let str = '';
    for(let y = 0; y < img.height; ++y){
      for(let x = 0; x < img.width; ++x){
        const v = img.pixel(x, y);
        str += StitchPattern.codeToChar(map.get(v));
      }
      str += '\n';
    }
    return str;
  }

  static getProgramId(code){
    switch(code){
      case KNIT: return Action.KNIT;
      case TUCK: return Action.TUCK;
      case MISS: return Action.MISS;

      // non-standard actions
      case PURL: return Action.register({
        pre: ({ k, n, rn }) => k.xfer(n, rn),
        main: ({ k, d, rn, cs }) => k.knit(d, rn, cs),
        post: ({ k, rn, n }) => k.xfer(rn, n),
        splitBySide: true
      }, 'purl').progId;

      case MOVE_L1: return Action.register({
        main: Action.knit,
        post: ({ move }) => move(-1)
      }, 'left').progId;

      case MOVE_R1: return Action.register({
        main: Action.knit,
        post: ({ move }) => move(1)
      }, 'right').progId;
    }
    // default program (progId 0)
    return Action.KNIT;
  }

  markStitch(sprog, value /*, px, py, gx, gy */){
    // set stitch type
    sprog.type(value);
  }

  unify(/* layers */){
    this.prog.each(s => {
      if(s.getProgram() !== 0)
        return; // already user-programed
      if(s.countYarns() > 1)
        return; // taken care of by a different layer (multi-yarn pattern)
      // unification = program from stitch type only
      const type = s.getStitchType();
      const progId = StitchPattern.getProgramId(type);
      s.setProgram(progId || 0);
    });
  }

}

module.exports = Object.assign(SketchLayer.register('stitch-pattern', StitchPattern, [
  ['spreadMode',  [TILED, SCALED]],
  ['clipping',    new ReferenceType('sketch')],
  ['pattern',     ImageType],
  ['mapping',     MappingType]
], [
  'anchorgrid', 'rectangle'
]), {
  KNIT, TUCK, MISS, PURL, MOVE_L1, MOVE_R1, EMPTY,
  PatternImage
});