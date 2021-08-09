"use strict";

const main_algo = parseInt(process.argv[2]) || -1;
const local_algo = parseInt(process.argv[3]) || -1;
const alias_level = parseInt(process.argv[4]) || 0;

const cdata = [68.05490826222794, 5.54905638880421, 5.549369713936603, 137.31307004016142, 119.04036561980092, 119.04036561980092, 94.48654281818386, 94.48654281818386, 72.25052538227843, 72.25052538227843, 57.04732297248323, 57.04732297248323, 38.196159696912645, 35.93222687588386, 35.93222687588386, 32.86427625205463, 32.86427625205463, 32.223571208656324, 32.223571208656324, 27.85507423642383, 27.85507423642383, 29.629364297231202, 29.629364297231202, 28.339365086466287, 28.339365086466287, 27.245284770473756, 27.245284770473756, 29.176608305684674, 29.176608305684674, 34.87401879512933, 68.3361487221548, 68.3361487221548, 67.36088373709774, 67.36088373709774, 65.97477357642184, 65.97477357642184, 61.20542600752404, 61.20542600752404, 59.69675685691615, 59.69675685691615, 58.15360427651758, 58.15360427651758, 56.761694802974155, 56.761694802974155, 55.70001154511542, 55.70001154511542, 55.183551885764345, 55.183551885764345, 55.5699015426579, 55.5699015426579, 57.80265022537859, 57.80265022537859, 67.90269060805292, 35.86123758430743, 35.86123758430743, 33.089427113816456, 33.089427113816456, 32.52263157398544, 32.52263157398544, 31.779586716857594, 31.779586716857594, 28.546717780331075, 28.546717780331075, 28.41049912977197, 28.41049912977197, 28.67338662029141, 28.67338662029141, 30.337137506655424, 30.337137506655424, 35.448178264356926];
const wdata = [0, 0, 0, 0, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2];
const nodes = [
  {"inp":[], "out":[0], "simple":false}, 
  {"inp":[], "out":[1], "simple":false}, 
  {"inp":[], "out":[2], "simple":false}, 
  {"inp":[29, 52, 69], "out":[3], "simple":false}, 
  {"inp":[12], "out":[], "simple":false}, 
  {"inp":[3], "out":[4], "simple":true}, 
  {"inp":[4], "out":[5], "simple":false}, 
  {"inp":[5], "out":[6], "simple":true}, 
  {"inp":[6], "out":[7], "simple":false}, 
  {"inp":[7], "out":[8], "simple":true}, 
  {"inp":[8], "out":[9], "simple":false}, 
  {"inp":[9], "out":[10], "simple":true}, 
  {"inp":[10], "out":[11], "simple":false}, 
  {"inp":[11], "out":[12], "simple":true}, 
  {"inp":[2], "out":[13], "simple":true}, 
  {"inp":[13], "out":[14], "simple":false}, 
  {"inp":[14], "out":[15], "simple":true}, 
  {"inp":[15], "out":[16], "simple":false}, 
  {"inp":[16], "out":[17], "simple":true}, 
  {"inp":[17], "out":[18], "simple":false}, 
  {"inp":[18], "out":[19], "simple":true}, 
  {"inp":[19], "out":[20], "simple":false}, 
  {"inp":[20], "out":[21], "simple":true}, 
  {"inp":[21], "out":[22], "simple":false}, 
  {"inp":[22], "out":[23], "simple":true}, 
  {"inp":[23], "out":[24], "simple":false}, 
  {"inp":[24], "out":[25], "simple":true}, 
  {"inp":[25], "out":[26], "simple":false}, 
  {"inp":[26], "out":[27], "simple":true}, 
  {"inp":[27], "out":[28], "simple":false}, 
  {"inp":[28], "out":[29], "simple":true}, 
  {"inp":[0], "out":[30], "simple":true}, 
  {"inp":[30], "out":[31], "simple":false}, 
  {"inp":[31], "out":[32], "simple":true}, 
  {"inp":[32], "out":[33], "simple":false}, 
  {"inp":[33], "out":[34], "simple":true}, 
  {"inp":[34], "out":[35], "simple":false}, 
  {"inp":[35], "out":[36], "simple":true}, 
  {"inp":[36], "out":[37], "simple":false}, 
  {"inp":[37], "out":[38], "simple":true}, 
  {"inp":[38], "out":[39], "simple":false}, 
  {"inp":[39], "out":[40], "simple":true}, 
  {"inp":[40], "out":[41], "simple":false}, 
  {"inp":[41], "out":[42], "simple":true}, 
  {"inp":[42], "out":[43], "simple":false}, 
  {"inp":[43], "out":[44], "simple":true}, 
  {"inp":[44], "out":[45], "simple":false}, 
  {"inp":[45], "out":[46], "simple":true}, 
  {"inp":[46], "out":[47], "simple":false}, 
  {"inp":[47], "out":[48], "simple":true}, 
  {"inp":[48], "out":[49], "simple":false}, 
  {"inp":[49], "out":[50], "simple":true}, 
  {"inp":[50], "out":[51], "simple":false}, 
  {"inp":[51], "out":[52], "simple":true}, 
  {"inp":[1], "out":[53], "simple":true}, 
  {"inp":[53], "out":[54], "simple":false}, 
  {"inp":[54], "out":[55], "simple":true}, 
  {"inp":[55], "out":[56], "simple":false}, 
  {"inp":[56], "out":[57], "simple":true}, 
  {"inp":[57], "out":[58], "simple":false}, 
  {"inp":[58], "out":[59], "simple":true}, 
  {"inp":[59], "out":[60], "simple":false}, 
  {"inp":[60], "out":[61], "simple":true}, 
  {"inp":[61], "out":[62], "simple":false}, 
  {"inp":[62], "out":[63], "simple":true}, 
  {"inp":[63], "out":[64], "simple":false}, 
  {"inp":[64], "out":[65], "simple":true}, 
  {"inp":[65], "out":[66], "simple":false}, 
  {"inp":[66], "out":[67], "simple":true}, 
  {"inp":[67], "out":[68], "simple":false}, 
  {"inp":[68], "out":[69], "simple":true}
];

const g_module = require('./global_sampling.js');
g_module().then(g => {

  console.log('Allocating problem size');
  g._allocate(cdata.length, wdata.length);

  console.log('Setting cdata');
  for(let i = 0; i < cdata.length; ++i)
    g._set_cdata(i, cdata[i]);

  console.log('Setting wdata');
  for(let i = 0; i < wdata.length; ++i)
    g._set_wdata(i, wdata[i]);

  console.log('Setting node data');
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
  g._set_max_eval(1e3);
  g._set_local_ftol_rel(1e-3);
  g._set_constraint_tol(1e-2);
  g._set_verbose(true);
  // g._set_use_constraints(false);

  // check gradient before
  g._check_gradient(true, 1e-4);

  // solve
  console.log('Solving');
  console.log('---');
  const rc = g._solve(true); // verbose
  /*
  g._set_verbose(false);
  for(let i = 0; i < 10; ++i){
    g._solve(false);
    console.log('Resolve #' + i + ' => ' + g._get_objective_value());
  }
  */
  console.log('---');
  console.log('RC=' + rc);

  // check gradient after
  g._check_gradient(true, 1e-1);
  g._check_gradient(true, 1e-2);
  g._check_gradient(true, 1e-3);
  g._check_gradient(true, 1e-4);
  g._check_gradient(true, 1e-5);

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
