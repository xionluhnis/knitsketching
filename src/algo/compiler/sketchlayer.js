// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const SketchLayer = require('./layers/base.js');
require('./layers/*.js', { mode: 'expand' });

// export to the world
module.exports = SketchLayer;