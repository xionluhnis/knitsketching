"use strict";
/* global Module */

/**
 * Wrapper code over WASM for short-row sampling
 */
class InvalidArgumentError extends Error {
    constructor(message){
        super();
        this.message = message;
    }
}

const sr = Module;
sr.nlopt_optimize = function nlopt_optimize(params){
    // extract main data
    const cdata = params.cdata;
    const weights = params.weights || [1, 0.1];
    const circular = !!params.circular;
    const verbose = !!params.verbose;

    // check main parameters{
    if(!cdata)
        throw new InvalidArgumentError('Missing cdata');
    if(!cdata.length)
        throw new InvalidArgumentError('Graph data is empty');

    const numSamples = cdata.length;

    // 1 = allocate problem
    sr._allocate(numSamples);

    // 2 = set problem data
    for(let i = 0; i < numSamples; ++i)
        sr._set_cdata(i, cdata[i]);
    sr._set_weights(weights[0], weights[1]);
    sr._set_circular(circular);

    // 3 = set potential parameters
    for(const pair of [
        ['seed', 'seed'],
        ['simplicityPower', 'simplicity_power'],
        ['useNoise', 'use_noise'],
        ['mainAlgo', 'main_algorithm'],
        ['localAlgo', 'local_algorithm'],
        ['maxEval', 'max_eval'],
        ['maxTime', 'max_time'],
        ['mainFTolRel', 'main_ftol_rel'],
        ['localFTolRel', 'local_ftol_rel']
    ]){
        const [name, key] = pair;
        if(name in params){
            const value = params[name];
            const setter = sr['_set_' + key];
            setter(value);
        }
    }

    // 4 = solve the problem
    const now = Date.now();
    const rc = sr._solve(verbose);
    if(verbose){
        const duration = (Date.now() - now) / 1000.0;
        console.log('Return code: ' + rc);
        console.log('Objective: ' + sr._get_objective_value());
        console.log('Duration: ' + duration.toFixed(3) + 's');
    }
    
    // 5 = extract solution
    return cdata.map((_, i) => {
        return sr._get_variable_value(i);
    });
};