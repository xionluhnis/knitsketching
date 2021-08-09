"use strict";
/* global Module */

/**
 * Wrapper code over WASM for local sampling
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
    const start = params.start;
    const end   = params.end;
    const shaping = params.shaping || 2.0;
    const weights = params.weights || [1, 0.1];
    const verbose = !!params.verbose;

    // check main parameters{
    if(!cdata)
        throw new InvalidArgumentError('Missing cdata');
    if(!cdata.length)
        throw new InvalidArgumentError('Graph data is empty');

    const numEdges = cdata.length;

    // 1 = allocate problem
    g._allocate(numEdges);

    // 2 = set problem data
    for(let i = 0; i < numEdges; ++i)
        g._set_cdata(i, cdata[i]);
    g._set_ns_start(start);
    g._set_ns_end(end);
    g._set_shaping(shaping);
    g._set_weights(weights[0], weights[1]);

    // 3 = set potential parameters
    for(const pair of [
        ['seed', 'seed'],
        ['useNoise', 'use_noise'],
        ['mainAlgo', 'main_algorithm'],
        ['localAlgo', 'local_algorithm'],
        ['maxEval', 'max_eval'],
        ['maxTime', 'max_time'],
        ['mainFTolRel', 'main_ftol_rel'],
        ['localFTolRel', 'local_ftol_rel'],
        ['constraintTol', 'constraint_tol']
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