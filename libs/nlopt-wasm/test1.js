"use strict";

const main_algo = parseInt(process.argv[2]) || -1;
const local_algo = parseInt(process.argv[3]) || -1;
const alias_level = parseInt(process.argv[4]) || 0;

const g_module = require('./global_sampling.js');
g_module().then(g => {

  console.log('Allocating problem size');

  g._allocate(8, 9);

  console.log('Setting cdata');

  const cdata = [68.05490826222794, 5.54905638880421, 5.549369713936603, 137.31307004016142, 38.196159696912645, 34.87401879512933, 67.90269060805292, 35.448178264356926];
  for(let i = 0; i < cdata.length; ++i)
    g._set_cdata(i, cdata[i]);

  console.log('Setting wdata');

  const wdata = [0, 0, 0, 0, 0, 14, 28, 38, 28];
  for(let i = 0; i < wdata.length; ++i)
    g._set_wdata(i, wdata[i]);

  console.log('Setting node data');

  const nodes = [
    { inp: [], out: [0], simple: false },
    { inp: [], out: [1], simple: false },
    { inp: [], out: [2], simple: false },
    { inp: [5,6,7], out: [3], simple: false },
    { inp: [4], out: [], simple: false },
    { inp: [3], out: [4], simple: true },
    { inp: [2], out: [5], simple: true },
    { inp: [0], out: [6], simple: true },
    { inp: [1], out: [7], simple: true }
  ];
  for(let i = 0; i < nodes.length; ++i){

    const { inp, out, simple } = nodes[i];
    g._allocate_node(i, simple, inp.length, out.length);

    for(let idx = 0; idx < inp.length; ++idx)
      g._set_node_input(i, idx, inp[idx]);
    for(let idx = 0; idx < out.length; ++idx)
      g._set_node_output(i, idx, out[idx]);
  }

  // params
  if(main_algo >= 0)
    g._set_main_algorithm(main_algo);
  if(local_algo >= 0)
    g._set_local_algorithm(local_algo);
  g._set_aliasing_level(alias_level);
  g._set_max_eval(1e2);
  g._set_local_ftol_rel(1e-3);
  g._set_constraint_tol(2);
  g._set_verbose(true);
  // g._set_use_constraints(false);

  // check gradient before
  g._check_gradient(true, 1e-4);

  // solve
  console.log('Solving');
  console.log('---');
  const rc = g._solve(true); // verbose
  console.log('---');
  console.log('RC=' + rc);

  // get result
  console.log('Result');
  for(let i = 0; i < cdata.length; ++i){
    console.log('ns[' + i + '] = ' + g._get_variable_value(i));
  }

  console.log('Objective');
  console.log(g._get_objective_value());
  console.log('Constraint');
  console.log('* sum', g._get_constraint_error());
  console.log('* max', g._get_constraint_max_error());
  console.log('* avg', g._get_constraint_mean_error());

});
