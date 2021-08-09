// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const fs = require('fs');
const pathData = fs.readFileSync(__dirname + '/../basepath.json');
const basePath = location.origin + JSON.parse(pathData);

module.exports = {
  basePath
};