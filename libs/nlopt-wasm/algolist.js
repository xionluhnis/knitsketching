"use strict";
const gs_module = require('./global_sampling.js');
gs_module().then(gs => {
  gs._print_algorithm_list();
});
