// Alexandre Kaspar
"use strict";

/* jshint evil: true */

// special input argument
const This = Symbol('this');

/**
 * Range syntactic sugar similar to matlab's from:step:end,
 * which gets replaced to [from, end, step].
 * The keyword `end` gets replaced by -1.
 * Expressions on that keyword are supported as long as they evaluate to a correct number.
 *
 * e.g. 1:end-2 => [1, -1-2], or 0.5:2:end => [0.5, -1, 2]
 *
 * @param code input code
 * @return code modified to support range syntax
 */
function range(code){
  code = code.replace(/([0-9]):end/g, "$1:-1");
  code = code.replace(/(0?\.[0-9]+|[0-9]+):([0-9]+):(0?\.[0-9]+|-?[0-9]+-?[0-9]*)/g, '[$1, $3, $2]');
  code = code.replace(/(0?\.[0-9]+|[0-9]+):(0?\.[0-9]+|-?[0-9]+-?[0-9]*)/g, '[$1, $2, 1]');
  return code;
}

/**
 * Mapping syntactic sugar for shaper functions
 *
 * i -> j;
 * (i1, i2) -> j;
 * i -> (j1, j2);
 *
 * @param code input code
 * @return code modified to support shaper mappings
 */
function shaper(code){
  code = code.replace(/(.+)\s+(-\>|to|into)\s+\((.+),(.+)\);?/g, "splitInto($1,$3,$4);"); // a -> (b, c) || a into (b, c)
  code = code.replace(/\((.+),(.+)\)\s+(-\>|to|onto)\s+(.*);?/g, "mergeOnto($1,$2,$4);"); // (a, b) -> c || (a, b) onto c 
  return code.replace(/(.+)\s+(-\>|to)\s+([^;]+);?/g, "mapTo($1,$3);\n"); // a -> b || i to i
}

/**
 * Returns the result of an expression
 *
 * @param code the expression
 * @return the code for returning that expression
 */
function returnExpr(code){
  return 'return (' + code + ');';
}

/**
 * Create a safe DSL function using strict mode
 *
 * @param code the execution code
 * @param argNames the list of argument names
 * @param modifiers the list of DSL modifiers
 * @param verbose whether to output the function before returning
 * @return the DSL function that can be evaluated
 */
function createFunction(code, argNames, modifiers, verbose){
  // normalize arguments
  if(!argNames)
    argNames = [];
  else if(!Array.isArray(argNames))
    argNames = [ argNames ];
  if(!modifiers)
    modifiers = [];
  if(!Array.isArray(modifiers))
    modifiers = [modifiers];
  // create preamble for all inputs and postamble
  const preamble = '"use strict"; return (function(' + argNames.join(', ') + '){ ';
  const postamble = '\n})'; // needs the \n in case last line is a line comment
  // syntactic sugar
  code = modifiers.reduce((str, map) => map(str), code);
  // verbose output
  if(verbose){
    if(typeof verbose == 'string')
      console.log(verbose + preamble + code + postamble);
    else
      console.log('Function: ' + preamble + code + postamble);
  }
  // create function (= compile program)
  return new Function(preamble + code + postamble)();
}

function safeFunction(code, argNames, modifiers, verbose, safeCreation = true){
  let func;
  try {
    func = createFunction(code, argNames, modifiers, verbose);
  } catch(err){
    if(safeCreation)
      return null;
    else 
      throw err;
  }
  return (...args) => {
    try {
      return func(...args);
    } catch(err){
    }
  };
}
function exprFunction(expr, argNames, modifiers = [], verbose = false){
  if(!modifiers.includes(returnExpr))
    modifiers = modifiers.concat([returnExpr]);
  return createFunction(expr, argNames, modifiers, verbose);
}
function safeExprFunction(expr, argNames, defaultRet, modifiers = [], verbose = false, safeCreation = true){
  let func;
  try {
    if(!modifiers.includes(returnExpr))
      modifiers = modifiers.concat([returnExpr]);
    func = createFunction(expr, argNames, modifiers, verbose);
  } catch(err){
    if(safeCreation)
      return null;
    else 
      throw err;
  }
  return (...args) => {
    try {
      return func(...args);
    } catch(err){
      return defaultRet;
    }
  };
}

/**
 * Create a DSL function and evaluate it
 *
 * @param code the code to evaluate
 * @param inputs an object with argument names and values
 * @param modifiers the list of DSL modifiers
 * @param verbose whether to output the program before executing it
 * @return the output of the program if any
 */
function evalCode(code, inputs, modifiers, verbose){
  // normalize inputs
  if(!inputs)
    inputs = {};
  // create argument list
  const argNames = Object.keys(inputs); // [[This]] is not enumerable => not in argNames
  const argValues = argNames.map(arg => inputs[arg]);
  // create function (= compile program)
  const f = createFunction(code, argNames, modifiers, verbose && typeof verbose != 'string' ? 'Evaluating: ' : false);
  // apply program
  const base = This in inputs ? inputs[This] : null;
  const res = f.apply(base, argValues);
  // return output of program (if any)
  return res;
}

/**
 * Create a DSL function and evaluate it safely,
 * returning its value if all right, or a default value upon error.
 *
 * @see evalCode
 */
function safeEvalCode(code, inputs, defaultValue, modifiers, verbose){
  try {
    const value = evalCode(code, inputs, modifiers, verbose);
    return value;
  } catch(e) {
    return defaultValue;
  }
}

/**
 * Evaluate an expression via a DSL function returning its value
 *
 * @param expr the string expression
 * @param inputs an object containing the expression's inputs
 * @param modifiers a list of DSL modifiers
 * @param verbose whether to output the program before executing it
 * @return the expression value
 */
function evalExpr(expr, inputs, modifiers, verbose){
  if(!modifiers)
    modifiers = [];
  if(!Array.isArray(modifiers))
    modifiers = [modifiers];
  if(modifiers.indexOf(returnExpr) == -1)
    modifiers.push(returnExpr);
  return evalCode(expr, inputs, modifiers, verbose && typeof verbose != 'string' ? 'Expr: ' : verbose);
}

/**
 * Safe evaluation of an expression,
 * returning the expression value if successful,
 * a provided default value otherwise
 *
 * @see evalExpr
 */
function safeEvalExpr(expr, inputs, defaultValue, modifiers, verbose){
  try {
    const value = evalExpr(expr, inputs, modifiers, verbose);
    return value;
  } catch (e) {
    return defaultValue;
  }
}

module.exports = {
  // function generation (to call later)
  create: createFunction,
  createFunction, safeFunction,
  exprFunction, safeExprFunction,
  // expression direct evaluations (returns a value)
  safeEval: safeEvalCode,
  eval: evalCode,
  expr: evalExpr,
  safeExpr: safeEvalExpr,
  // modifiers / syntactic sugar
  range, returnExpr, shaper,
  // special input symbol
  This
};
