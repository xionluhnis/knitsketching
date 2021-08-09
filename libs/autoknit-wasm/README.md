# WebAssembly module for plan_transfers

This is a module to provide a Javascript interface to the `plan_transfers` method from C++.
This is done as a [WebAssembly](https://developer.mozilla.org/en-US/docs/WebAssembly) module.

## Steps

1. Install the [emscripten](https://emscripten.org/docs/getting_started/downloads.html) environment.
2. Compile the WASM module with `make`

The second step requires `em++` which is shipped with emscripten and should thus have been installed in the first step.

The outputs include:
* `plan_transfers.wasm` = the compiled web assembly module (binary file)
* `plan_transfers.js` = a file that wraps the complexity of loading the wasm file, together with some wrapper methods

## How do I use it in Javascript / Node.js?

```js
const xfer = require('./plan_transfers.js');

const list = xfer.plan_transfers(
    ['f0', 'f1', 'b1', 'b0'], // the needles of the source bed configuration (cycle must be CCW)
    ['f1', 'b1', 'b0', 'f0'], // the needles of the target bed configuration (cycle must be CCW)
    { slack: 2, max_racking: 2 } // additional parameters (all optional)
);
console.log(list); // the list of transfers
/*
 Output:
[
  [ 'f0', 'bs1' ],   [ 'f1', 'b2' ],
  [ 'bs1', 'f0' ],   [ 'b0', 'fs-1' ],
  [ 'b1', 'fs0' ],   [ 'b2', 'fs1' ],
  [ 'fs0', 'b0' ],   [ 'fs1', 'b1' ],
  [ 'fs-1', 'b-2' ], [ 'b1', 'fs1' ],
  [ 'b0', 'fs0' ],   [ 'b-2', 'f-1' ],
  [ 'fs0', 'b0' ],   [ 'fs1', 'b1' ],
  [ 'f-1', 'bs-1' ], [ 'f0', 'bs0' ],
  [ 'bs-1', 'f0' ],  [ 'bs0', 'f1' ]
]
*/
``` 

## Arguments to `plan_transfers`

* `from` (**required** `[n1, n2, ... nn]`) is an array of knitout needle strings in CCW orientation (as a cycle)
* `to` (**required** `[m1, m2, ... mn]`) is a similar array (must have the same size)
* `params` (*optional*) a set of parameters (slack, free range, max racking, and output mode)
  * `slack` (defaults to 2) either a minimum slack number, or an array of slack numbers for each needle
  * `max_racking` (defaults to 4) the maximum allowed racking
  * `min_free` (defaults to -Infinity) the minimum needle available (requires `max_free` be provided too)
  * `max_free` (defaults to +Infinity) the maximum needle available (requires `min_free` be provided too)
  * `needles_as_array` (defaults to false) whether the needle outputs should be arrays `[side, offset]` (true) or strings (false)

Here is an example with different parameters, but same beds:
```js
const xfer = require('./plan_transfers.js');

const list = xfer.plan_transfers(
    ['f0', 'f1', 'b1', 'b0'], // the needles of the source bed configuration (cycle must be CCW)
    ['f1', 'b1', 'b0', 'f0'], // the needles of the target bed configuration (cycle must be CCW)
    { min_free: 0, max_free: 10, needles_as_array: true }
);
console.log(list); // the list of transfers
/*
 Output:
[
  [ [ 'f', 0 ], [ 'bs', 1 ] ],
  [ [ 'f', 1 ], [ 'b', 2 ] ],
  [ [ 'bs', 1 ], [ 'f', 1 ] ],
  [ [ 'b', 0 ], [ 'fs', 0 ] ],
  [ [ 'b', 1 ], [ 'fs', 1 ] ],
  [ [ 'b', 2 ], [ 'fs', 2 ] ],
  [ [ 'fs', 1 ], [ 'b', 1 ] ],
  [ [ 'fs', 2 ], [ 'b', 2 ] ],
  [ [ 'fs', 0 ], [ 'b', 0 ] ],
  [ [ 'b', 0 ], [ 'f', 0 ] ],
  [ [ 'b', 1 ], [ 'fs', 0 ] ],
  [ [ 'b', 2 ], [ 'fs', 1 ] ],
  [ [ 'fs', 0 ], [ 'b', 0 ] ],
  [ [ 'fs', 1 ], [ 'b', 1 ] ],
  [ [ 'f', 0 ], [ 'bs', 0 ] ],
  [ [ 'f', 1 ], [ 'bs', 1 ] ],
  [ [ 'bs', 0 ], [ 'f', 0 ] ],
  [ [ 'bs', 1 ], [ 'f', 1 ] ]
]
*/
``` 

As expected, none of the bed offsets are below 0 since the minimum free needle was set to that.
Also, the output needles are arrays `[side, offset]` given that `needles_as_array` is true.

## Modularize=1

In case you need to generate the module as a function (to which you can pass the initial Module object),
then simply call `make module` instead of the default `make`.