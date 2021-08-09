"use strict";
/* global Module */

/**
 * Wrapper code over WASM for global_sampling
 */
class InvalidArgumentError extends Error {
    constructor(message){
        super();
        this.message = message;
    }
}

const g = Module;
g.nlopt_optimize = function nlopt_optimize(params){
    // extract main data
    const cdata = params.cdata;
    const wdata = params.wdata;
    const nodes = params.nodes;
    const weights = params.weights || [1, 0.1];
    const verbose = !!params.verbose;

    // check main parameters{
    if(!cdata || !wdata || !nodes)
        throw new InvalidArgumentError('Missing cdata or wdata or nodes');
    if(!cdata.length || !wdata.length || !nodes.length)
        throw new InvalidArgumentError('Graph data is empty');
    if(wdata.length !== nodes.length)
        throw new InvalidArgumentError('Graph data is not coherent');// default arguments
    
    const numEdges = cdata.length;
    const numNodes = wdata.length;

    // 1 = allocate problem
    g._allocate(numEdges, numNodes);

    // 2 = set problem data
    for(let i = 0; i < numEdges; ++i)
        g._set_cdata(i, cdata[i]);
    for(let i = 0; i < numNodes; ++i){
        g._set_wdata(i, wdata[i]);
        // set node data
        const { inp, out, simple } = nodes[i];
        if(!Array.isArray(inp)
        || !Array.isArray(out)
        || typeof simple !== 'boolean')
            throw new InvalidArgumentError('Nodes must have the form { inp, out, simple }');
        g._allocate_node(i, simple, inp.length, out.length);
        for(let idx = 0; idx < inp.length; ++idx)
            g._set_node_input(i, idx, inp[idx]);
        for(let idx = 0; idx < out.length; ++idx)
            g._set_node_output(i, idx, out[idx]);
    }
    g._set_weights(weights[0], weights[1], weights[2]);

    // 3 = set potential parameters
    for(const pair of [
        ['globalShaping', 'global_shaping'],
        ['seed', 'seed'],
        ['useNoise', 'use_noise'],
        ['mainAlgo', 'main_algorithm'],
        ['localAlgo', 'local_algorithm'],
        ['maxEval', 'max_eval'],
        ['maxTime', 'max_time'],
        ['mainFTolRel', 'main_ftol_rel'],
        ['localFTolRel', 'local_ftol_rel'],
        ['constraintTol', 'constraint_tol'],
        ['aliasingLevel', 'aliasing_level']
    ]){
        const [name, key] = pair;
        if(name in params){
            const value = params[name];
            const setter = g['_set_' + key];
            setter(value);
        }
    }

    // 4 = solve the problem
    const now = Date.now();
    const rc = g._solve(verbose);
    if(verbose){
        const duration = (Date.now() - now) / 1000.0;
        console.log('Return code: ' + rc);
        console.log('Objective: ' + g._get_objective_value());
        console.log('Constraint: ' + g._get_constraint_error());
        console.log('Duration: ' + duration.toFixed(3) + 's');
    }
    
    // 5 = extract solution
    return cdata.map((_, i) => {
        return g._get_variable_value(i);
    });
};