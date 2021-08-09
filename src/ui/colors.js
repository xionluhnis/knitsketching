// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const chroma = require('chroma-js');
const {
  getDeviceInfo, getIndexedDeviceInfo
} = require('../carriers.js');

// color maps
const timeColorMap = chroma.scale('Spectral').domain([1,0]);
const stressColorMap = timeColorMap;
const timeStretchColor = '#FF3333';
const timeStretchColorMap = chroma.scale([
  timeStretchColor + 'FF', '#FFFFFF33' /*'#DDCCEE', '#0033FF33' */]
).mode('lch');
const timeShrinkColor = '#FF33FF';
const timeShrinkColorMap = chroma.scale([
  timeShrinkColor + 'FF', '#FFFFFF33'
]).mode('lch');
const courseColorMap = chroma.scale([
  '#CCCCFF', '#3333FF'
]);
const linkColorMap = chroma.scale([
  '#FFFF66', '#FF6666'
]);
const crsAccColorMap = chroma.scale([
  '#FFFFFF', '#FFFFFF', '#9999FF', '#0033AA', '#000000'
]);
const waleAccColorMap = chroma.scale([
  '#FFFFFF', '#FFFFFF', '#FF9999', '#AA3300', '#000000'
]);
const accuracyColorMap = chroma.scale([
  '#0033AA', '#9999FF', '#FFFFFF', '#FF9999', '#AA3300'
]);

// color wheel
const colorWheel = createWheel();

/**
 * Base textual RGB palette
 */
const palette = [
'rgb( 255,   0,  16)',
'rgb(  43, 206,  72)',
'rgb( 255, 255, 128)',
'rgb(  94, 241, 242)',
'rgb(   0, 129,  69)',
'rgb(   0,  92,  49)',
'rgb( 255,   0, 190)',
'rgb( 194,   0, 136)',
'rgb( 126,   0, 149)',
'rgb(  96,   0, 112)',
'rgb( 179, 179, 179)',
'rgb( 128, 128, 128)',
'rgb( 255, 230,   6)',
'rgb( 255, 164,   4)',
'rgb(   0, 164, 255)',
'rgb(   0, 117, 220)',
'rgb( 117,  59,  59)'
];

/**
 * Color alphabet
 * 
 * From P. Green-Armytage (2010): A Colour Alphabet and the Limits of Colour Coding. 
 * Colour: Design & Creativity (5) (2010): 10, 1-23
 * 
 * @see https://graphicdesign.stackexchange.com/questions/3682/where-can-i-find-a-large-palette-set-of-contrasting-colors-for-coloring-many-d
 * @see http://eleanormaclure.files.wordpress.com/2011/03/colour-coding.pdf
 */
const rgbAlphabet = [
  [0,117,220],
  [255,255,128],
  [43,206,72],
  [153,0,0],
  [128,128,128],
  [240,163,255],
  [153,63,0],
  [76,0,92],
  [0,92,49],
  [255,204,153],
  [148,255,181],
  [143,124,0],
  [157,204,0],
  [194,0,136],
  [0,51,128],
  [255,164,5],
  [255,168,187],
  [66,102,0],
  [255,0,16],
  [94,241,242],
  [0,153,143],
  [224,255,102],
  [116,10,255],
  [255,255,0],
  [255,80,5],
  [25,25,25] 
];

const alphabetPalette = rgbAlphabet.map(([r,g,b]) => {
  return 'rgb(' + r + ',' + g + ',' + b + ')';
});

/**
 * RGB array palette
 */
const rgbPalette = palette.map(str => {
  const tokens = str.substring(4, 18).split(',');
  return tokens.map(str => parseInt(str));
});

/**
 * Hex string palettes
 */
const hexPalette = rgbPalette.map(rgb2hex);
const hexAlphabet = rgbAlphabet.map(rgb2hex);

/**
 * Chroma palette
 */
const chrAlphabet = hexAlphabet.map(hex => chroma(hex));

/**
 * Pattern color pattern from Inverse Neural Knitting
 * 
 * Neural Inverse Knitting: From Images to Manufacturing Instructions
 * Alexandre Kaspar, Tae-Hyun Oh, Liane Makatura, Petr Kellnhofer and Wojciech Matusik
 * ICML 2019
 * 
 * @see https://github.com/xionluhnis/neural_inverse_knitting
 * @see https://github.com/xionluhnis/neural_inverse_knitting/blob/master/util/instr.py
 */
const patternPalette = [
  [ 255,   0,  16 ], // K
  [  43, 206,  72 ], // P
  [ 255, 255, 128 ], // T
  [  94, 241, 242 ], // M
  [   0, 129,  69 ], // FR1
  [   0,  92,  49 ], // FR2
  [ 255,   0, 190 ], // FL1
  [ 194,   0, 136 ], // FL2
  [ 126,   0, 149 ], // BR1
  [  96,   0, 112 ], // BR2
  [ 179, 179, 179 ], // BL1
  [ 128, 128, 128 ], // BL2
  [ 255, 230,   6 ], // XR+
  [ 255, 164,   4 ], // XR-
  [   0, 164, 255 ], // XL+
  [   0, 117, 220 ], // XL-
  [ 117,  59,  59 ]  // S
];
const patternCodes = [
  'K', 'P', 'T', 'M',
  'FR1', 'FR2', 'FL1', 'FL2',
  'BR1', 'BR2', 'BL1', 'BL2',
  'XR+', 'XR-', 'XL+', 'XL-',
  'S'
];
const patternCodeToColor = patternCodes.reduce((map, c, i) => {
  return Object.assign(map, { [c]: patternPalette[i]});
}, {});

const ColorDelta = 100;

/**
 * Color of pattern instruction
 *
 * @param pattern the pattern instruction
 * @param s whether to change the alpha value
 * @param alpha the alpha value
 * @return a string representing the color
 */
function patternColor(pattern, s, alpha){
  if(s){
    if(alpha === undefined)
      alpha = 0.5;
    let r = 0, g = 0, b = 0;
    if(pattern >= 1 && pattern <= rgbPalette.length)
      [r, g, b] = rgbPalette[pattern - 1];
    r = Math.min(255, r + ColorDelta);
    g = Math.min(255, g + ColorDelta);
    b = Math.min(255, b + ColorDelta);
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + alpha + ')';
  } else {
    return hexPalette[pattern - 1] || '#000';
  }
}

/**
 * Padd string with zeros on the left
 *
 * @param str the string to pad
 * @param width the required width
 * @return a string left-zero-padded to reach a given width
 */
function leftZeroPad(str, width){
  while(str.length < width)
    str = '0' + str;
  return str;
}

/**
 * Return a hex color string
 *
 * @param hex the hexadecimal integer color
 * @param s the color flag (0 for front, 1 for back)
 * @param alpha the alpha value to use in [0;1] or (1;255]
 * @return #RRGGBBAA modulated for the given side
 */
function hexColor(hex, s, alpha){
  // color dependent on side
  if(s){
    if(alpha === undefined)
      alpha = 0.5;
    let r = Math.min(255, ((hex >> 16) & 0xFF) + ColorDelta);
    let g = Math.min(255, ((hex >> 8)  & 0xFF) + ColorDelta);
    let b = Math.min(255, ((hex)       & 0xFF) + ColorDelta);
    hex = (r << 16) | (g << 8) | b;
  }

  // alpha(0 or 2)
  let alphaStr;
  if(alpha)
    alphaStr = leftZeroPad((alpha <= 1.0 ? Math.round(255 * alpha) : alpha).toString(16), 2);
  else
    alphaStr = '';
  // #color(6) | alpha(0 or 2)
  return '#' + leftZeroPad(hex.toString(16), 6) + alphaStr;
}

/**
 * Transform an integer into an [r,g,b] value
 *
 * @param n 24-bit integer
 * @return the [r, g, b] vector, each component for 8 bits
 */
function numberToRGB(n){
  const r = (n >> 16) & 0xFF;
  const g = (n >> 8) & 0xFF;
  const b = (n >> 0) & 0xFF;
  return [r, g, b];
}

/**
 * Interpolates linearly between two colors
 *
 * @param c1 the first color (hex or [r,g,b])
 * @param c2 the second color (hex or [r,g,b])
 * @param t the interpolation value in [0;1]
 * @param asRGB whether to return a vector or hex string
 */
function colorInterp(c1, c2, t, asRGB){
  if(typeof c1 == 'number')
    c1 = numberToRGB(c1);
  if(typeof c2 == 'number')
    c2 = numberToRGB(c2);
  const s = 1 - t;
  const rgb = [
    Math.round(c1[0] * s + c2[0] * t),
    Math.round(c1[1] * s + c2[1] * t),
    Math.round(c1[2] * s + c2[2] * t)
  ];
  if(asRGB)
    return rgb;
  else
    return '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);
}

/**
 * Create a flow color wheel
 */
function createWheel(){
  // relative lengths of color transitions:
  // these are chosen based on perceptual similarity
  // (e.g. one can distinguish more shades between red and yellow
  //  than between yellow and green)
  const RY = 15;
  const YG = 6;
  const GC = 4;
  const CB = 11;
  const BM = 13;
  const MR = 6;
  const length = RY + YG + GC + CB + BM + MR;
  const wheel = [];
  wheel.push(...Array.from({ length }, () => [0, 0, 0]));
  const setcols = (r, g, b, i) => {
    wheel[i] = [r, g, b];
  };
  let k = 0;
  for (let i = 0; i < RY; i++) setcols(255,           255*i/RY,     0,            k++);
  for (let i = 0; i < YG; i++) setcols(255-255*i/YG,  255,          0,            k++);
  for (let i = 0; i < GC; i++) setcols(0,             255,          255*i/GC,     k++);
  for (let i = 0; i < CB; i++) setcols(0,             255-255*i/CB, 255,          k++);
  for (let i = 0; i < BM; i++) setcols(255*i/BM,      0,            255,          k++);
  for (let i = 0; i < MR; i++) setcols(255,           0,            255-255*i/MR, k++);
  return wheel;
}

/**
 * Return a 2-digit hex color component
 *
 * @param i the 8-bit color component
 * @return the 2-char hex string representation
 */
function hex2(i){
  return ('00' + i.toString(16)).slice(-2);
}

/**
 * Converts a [r,g,b] value into a hex string
 * 
 * @param {[number,number,number]} rgb array of colors [r,g,b]
 * @return {string} the hex color string (with # prepended)
 */
function rgb2hex([r,g,b]){
  return '#' + hex2(r) + hex2(g) + hex2(b);
}

/**
 * Return a flow color
 *
 * @param u the flow u component in [-1;+1]
 * @param v the flow v component in [-1;+1]
 * @param asRGB whether to return a color vector (true) or a hex string (false)
 * @param alpha a possible alpha value (integer within [0;255])
 * @return the hex string or [rgb]/[rgba] array
 */
function getFlowColor(u, v, asRGB, alpha){
  const rad = Math.sqrt(u * u + v * v);
  const a = Math.atan2(-v, -u) / Math.PI;
  const fk = (a + 1) / 2 * (colorWheel.length - 1);
  const k0 = Math.floor(fk);
  const k1 = (k0 + 1) % colorWheel.length;
  const f = fk - k0; //f = 0; // uncomment to see original color wheel
  const rgb = [0, 0, 0];
  for (let b = 0; b < 3; b++) {
    const col0 = colorWheel[k0][b] / 255.0;
    const col1 = colorWheel[k1][b] / 255.0;
    let col = (1 - f) * col0 + f * col1;
    if(rad <= 1)
      col = 1 - rad * (1 - col); // increase saturation with radius
    else
      col *= 0.75; // out of range
    rgb[2 - b] = Math.floor(255 * col);
  }
  if(asRGB){
    if(alpha === undefined)
      return rgb;
    else
      return [rgb[0], rgb[1], rgb[2], alpha];
  }
  if(alpha === undefined)
    return '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]);
  else
    return '#' + hex2(rgb[0]) + hex2(rgb[1]) + hex2(rgb[2]) + hex2(alpha);
}

/**
 * Return a delta-time color
 *
 * @param time the corresponding time
 * @param maxTime the maximum possible time
 * @return a hex color string
 */
function getDTimeColor(time, maxTime){
  if(!maxTime || maxTime == 1)
    return '#FFFFFF'; // time is not valid
  assert(time <= maxTime, 'Invalid time pair');
  // full color version:
  // return timeColorMap(Math.max(0, time - 1) / (maxTime - 1)).hex().toUpperCase();

  // strided version:
  const colors = [ '#FFFFFF', /* '#FFFF00', */ '#90EE90', '#008AE5' ];
  return colors[time % colors.length];
}

/**
 * Return a time color
 *
 * @param time the corresponding time
 * @param minTime the minimum possible time
 * @param maxTime the maximum possible time
 * @param asHex whether to return the hex string (default, true) or the chroma color (false)
 * @return a hex color string or chroma color
 */
function getTimeColor(time, minTime, maxTime, asHex = true){
  assert(time <= maxTime + 1e-3 && time >= minTime - 1e-3, 'Invalid time range');
  // full color version:
  const color = timeColorMap(
    Math.min(1, Math.max(0, time - minTime) / (maxTime - minTime))
  );
  return asHex ? color.hex().toUpperCase() : color;
}

function getGeodesicColor(normDist, asHex = true){
  const color = timeColorMap(Math.max(0.0, Math.min(1.0, normDist)));
  return asHex ? color.hex().toUpperCase() : color;
}

/**
 * Return a stress color
 *
 * @param stress the stress within [0;2]
 * @param asHex whether to return the hex string (default, true) or the chroma color (false)
 * @return a hex color string
 */
function getStressColor(stress, asHex = true){
  assert(stress >= 0 && stress <= 2, 'Invalid stress level', stress);
  const color = stressColorMap(
    Math.min(1, Math.max(0, Math.sqrt(stress)))
  );
  return asHex ? color.hex().toUpperCase() : color;
}

function getTimeStretchColor(timeStretch, asHex = true, withAlpha = true){
  assert(timeStretch >= 0, 'Invalid time stretch level', timeStretch);
  let color;
  if(timeStretch < 1)
    color = timeStretchColorMap(timeStretch);
  else
    color = timeShrinkColorMap(1 / timeStretch);
  if(!withAlpha)
    color.alpha(1.0);
  return asHex ? color.hex().toUpperCase() : color;
}

function getLinkQualityColor(error, asHex = true){
  if(error.error)
    error = error.error;
  assert(typeof error === 'number', 'Invalid argument');
  // check for special errors
  if(Number.isNaN(error) || !Number.isFinite(error))
    return '#000000';
  // else we use the link color map
  const color = linkColorMap(error);
  return asHex ? color.hex().toUpperCase() : color;
}

/**
 * Return a course color
 *
 * @param yarnIdx the yarn index
 * @param totalYarns the total number of yarns
 * @return a hex color string
 */
function courseColor(yarnIdx, totalYarns){
  if(!totalYarns || totalYarns <= 1)
    return '#9999FF';
  return courseColorMap(Math.max(0, Math.min(1, yarnIdx / (totalYarns - 1)))).hex().toUpperCase();
}

function courseAccuracyColor(dist, courseDist){
  const val = 0.5 + 0.5 * (dist - courseDist) / courseDist;
  return crsAccColorMap(Math.max(0, Math.min(1, val))).hex().toUpperCase();
}

/**
 * Return the wale color
 *
 * @return a hex color string
 */
function waleColor(){
  return '#FF9999';
}

function waleAccuracyColor(dist, waleDist){
  const val = 0.5 + 0.5 * (dist - waleDist) / waleDist;
  return waleAccColorMap(val).hex().toUpperCase();
}

function getAccuracyColor(dist, expDist){
  const val = 0.5 + 0.5 * (dist - expDist) / expDist;
  return accuracyColorMap(val).hex().toUpperCase();
}

function getSegmentWrapColor(index){
  return hexAlphabet[index % hexAlphabet.length];
}

function getSegmentFadeColor(index){
  if(index < hexAlphabet.length)
    return hexAlphabet[index] + 'FF';
  const alpha = Math.max(0, 255 - Math.floor(index / hexAlphabet.length));
  return hexAlphabet[index % hexAlphabet.length] + hex2(alpha);
}

function getAlphabet(index, withDivider = false){
  const alpha = Math.max(0, 255 - Math.floor(index / chrAlphabet.length));
  const chr = chrAlphabet[index % chrAlphabet.length];
  return withDivider ? [chr, alpha] : chr;
}

function getRegionColor(region){
  if(!region)
    return '#FFFFFF';
  // compute reduction
  const red = region.reduction();
  if(!red)
    return '#99FFFFFF'; // this is a reduction error
  if(red.isInterface()){
    // if originally non-interface, and currently boundary
    // then we don't want to highlight it (but hide it)
    if(red.isBoundary() && region.isArea())
      return '#FFFFFFFF';
    else
      return '#000000FF';
  } else
    return getSegmentFadeColor(red.rank);
}

function getPatternColor(code){
  if(typeof code === 'string')
    return chroma(patternCodeToColor[code] || [0, 0, 0]);
  else
    return chroma(patternPalette[Math.max(0, code-1)] || [0, 0, 0]);
}

function getYarnsColor(yarns){
  return chroma(getDeviceInfo(yarns, 'color', '#FFFFFF'));
}

module.exports = {
  // generic functions
  hex2,
  rgb2hex,
  hexColor,
  colorInterp,
  // domain color functions
  patternColor,
  getFlowColor,
  getDTimeColor,
  getTimeColor,
  getGeodesicColor,
  getStressColor,
  getTimeStretchColor,
  timeShrinkColor: () => timeShrinkColor,
  timeStretchColor: () => timeStretchColor,
  getLinkQualityColor,
  courseColor, courseAccuracyColor,
  waleColor, waleAccuracyColor,
  getAccuracyColor,
  getSegmentWrapColor,
  getSegmentFadeColor,
  getRegionColor,
  getAlphabet,
  getPatternColor,
  getYarnsColor,

  // palettes
  palette,
  rgbPalette,
  hexPalette,
  patternPalette,
  // alphabet
  alphabetPalette,
  rgbAlphabet,
  hexAlphabet,
  chrAlphabet,
  // chroma constants
  white: chroma([255, 255, 255]),
  black: chroma([0, 0, 0]),
  // chroma access
  chroma
};
