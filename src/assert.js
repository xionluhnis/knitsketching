// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// local storage
const globalErrors = [];
const localErrors = {};

class AssertionError extends Error {
  constructor(message){
    super(message);
    this.name = 'AssertionError';
  }
}

function assertFunction(namespace){
  let errorList;
  if(namespace){
    if(namespace in localErrors)
      errorList = localErrors[namespace];
    else {
      errorList = localErrors[namespace] = [];
    }
  } else {
    errorList = globalErrors;
  }
  let throwing = false;
  let debugging = false;
  const assert = function(predicate, ...args){
    if(!predicate)
      errorList.push({ time: +new Date(), args });
    if(throwing){
      if(!predicate)
        throw new AssertionError(args.join(' '));
    } else {
      console.assert(predicate, ...args);
      if(!predicate && debugging){
        /* jshint -W087 */
        debugger;
        /* jshint +W087 */
      }
    }
  };
  assert.as = function(subspace){
    return assertFunction(namespace ? namespace + '/' + subspace : subspace);
  };
  assert.raise =
  assert.error = function(...args){
    if(throwing){
      throw new AssertionError(args.join(' '));
    } else {
      errorList.push({ time: +new Date(), args });
      console.assert(false, ...args);
      if(debugging){
        /* jshint -W087 */
        debugger;
        /* jshint +W087 */
      }
    }
  };
  assert.errorList = function(){
    return errorList.slice();
  };
  assert.clear = function(){
    errorList.splice(0, errorList.length);
  };
  assert.clearAll = function(){
    globalErrors.splice(0, globalErrors.length);
    for(let name in localErrors){
      let errList = localErrors[name];
      errList.splice(0, errList.length);
    }
  };
  assert.throwing = function(fun){
    throwing = true;
    try {
      fun();
      throwing = false;

    } catch (err){
      throwing = false;
      throw err; // re-throw after cleaning the state change
    }
  };
  assert.debugging = function(fun){
    debugging = true;
    try {
      fun();
      debugging = false;
    } catch(err){
      console.warn(err);
      debugging = false;
      /* jshint -W087 */
      debugger;
      /* jshint +W087 */
    }
  };
  assert.catching = function(fun, errFun){
    try {
      throwing = true;
      fun();
      throwing = false;
    } catch (err) {
      throwing = false;
      errFun(err);
    }
  };
  return assert;
}

module.exports = assertFunction();
