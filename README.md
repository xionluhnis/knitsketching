# Knit Sketching

This is the open source implementation of the paper

**Knit Sketching: from Cut & Sew Patterns to Machine-Knit Garments**.

The project page is there: http://knitsketching.csail.mit.edu/

This implementation deviates slightly from the paper description.
Notably, it adds support for layer metadata that describes patterns and colorwork on top of the sketches.

This is a prototype; expect bugs.

## Dependencies

The system is a web client written mostly in Javascript with some HTML/CSS layouts.<br>
The Javascript development is made with [Node.js](https://nodejs.org/en/) and [Browserify](http://browserify.org/).

Was developed and tested on Ubuntu 18.04 and MacOS High Sierra (10.13).<br>
Compilation currently tested with Node.js 12.18 and 13.10.
Client tested mainly with Chrome. It should work with Firefox.

To install all dependencies, use [npm](https://www.npmjs.com/):
```
npm install
```

## Development

If you want to compile the system, you can use npm scripts:

* `npm run build` will output the full compiled code in `./js/sketching.js` and the main page as `./index.html`
* `npm run watch` will use [watchify](https://github.com/browserify/watchify) to continuously update the code as code changes (while providing debugging information)

## Serving

The system uses a few WebAssembly modules as well as file capabilities (and serving capabilities) that require the environment to be served through a server instead of directly from the file system.
Some functionalities are working without server, but not all (and it's tested only from the served variant).

Upon cloning the repository, a preliminary linking step is necessary to setup the base path (needed only once).
This can be done by creating a symlink with:
```
npm run link
```

Assuming the base path is properly setup, the simplest way to serve the files is then with the script
```bash
npm run serve
```

This requires Python (2.7 or 3) and instantiates a local http server to serve the content of the repository under `localhost`.<br>
Then you can access the system at http://localhost:7000.

The URL can be parameterized with arguments to preload sketches and/or set UI parameters.<br>
The two main arguments are:

* `loadPath=path-to-sketch` - with a path to some file to be loaded upon startup. The following extensions are supported:
   * `sketch.json` loads a JSON sketch that was saved through the interface
   * `file.svg` loads polygons (and images) from a SVG file (some data may not be supported, but it's a good way to start)
   * `file.k` loads a knitout file (accessible from the Knitout view, with limited interactions)
* `init=action1:args1,action2:args2,...` is a sequence of actions to trigger in the interface. For the list of actions, see `src/ui.js` and the `init(actions)` function. Notable ones include:
   * `check:id` (and `uncheck:id`) set the `checked` attribute of a HTML element (identified by `id`) and triggers an update
   * `click:id` explicitly clicks on a HTML element (identified by `id`)
   * `mode:value` sets the viewer mode (one of `sketch`, `knitout` or `yarn`)
   * `set:id:value` sets the `value` attribute of a HTML element (identified by `id`) and triggers an update
   * `sketch-mode:mode` sets the base sketch-mode (one of `shape`, `linking`, `density`, `flow`, `schedule`, `pattern`)
   * `history:mode` sets the type of history (one of `by-action`, `by-time` or `none`)

Example:
```
http://localhost:7000/index.html?loadPath=sketches/sweater/sweater.json&init=sketch-mode:flow,click:display-region,click:verbose,click:expert_mode,set:iso_threshold:1,set:geodesic_mode:heat
```
- preloads sketches/sweater/sweater.json
- switches to flow editing
- switches to region display
- toggles verbose and expert modes (both off by default, now on)
- sets the *isoline threshold* parameter to 1
- switches the geodesic mode parameter to `heat`

Another useful example:
```
http://localhost:7000/?init=click:load_server
```
triggers the server load file dialog that displays the available files from the demo.

### Base path

The default system is served assuming the base path `/knitsketching` (because this is the path used for the online demo on Github pages).
However, when serving locally from a fresh repository, this is not the case, and thus the need to create a symlink `knitsketching` that points to the base directory itself.

There are technically two ways to fix this:
1. Use `npm run link` to creates the necessary symlink (*suggested by default*), or
2. Change the base path in `basepath.json` and rebuild the system to take it into account.

## Third party libraries

This project is making use of many third-party libraries for its development.
See the list of dependencies in `package.json`.

Notable third-party libraries (in `libs/`) include:
- [AutoKnit](https://github.com/textiles-lab/autoknit) for their needle transfer scheduling implementation
- [CodeMirror](https://github.com/codemirror/codemirror) for their Javascript-based online editors
- [NLOpt](https://github.com/stevengj/nlopt) for the sampling optimizations
- [Geometry Central](https://github.com/nmwsharp/geometry-central) for the Heat Method implementation

## Separate development sources

The WebAssembly code is stored in `libs` together with necessary compilation code.<br>
Pre-compiled Wasm files are provided to simplify development.

If you plan on modifying some of those modules, you want to load the submodules with git:
```
git submodule init
git submodule update
```

Compilation currently relies on [emscripten](https://emscripten.org/) SDK 1.39.18.


## Code Output

Upon pressing "Time", the time function and region graph are computed and visualized.
Upon pressing "Program", the rest of the pipeline is triggered, which samples the stitch graph, traces it, schedules it and generates [Knitout](https://textiles-lab.github.io/knitout/knitout.html) code.

To save the `.k` file, switch to the knitout output tab on the left and press "Save".
Note that if you do not switch tab, clicking the button saves the `.json` file corresponding to the sketch.


## Issues and debugging

The default code is built in debug mode so that sourcemaps are encoded in the output.
If you open the developer tools (e.g., on chrome or firefox), then you can get useful information in case something unexpected happens (or the system fails at providing an expected result).


## References

If you make use of this software, we would be grateful if you can cite us:
```bibtex
@article{kaspar2021knitsketching,
  title={Knit Sketching: from Cut \& Sew Patterns to Machine-Knit Garments},
  author={Kaspar, Alexandre and Wu, Kui and Luo, Yiyue and Makatura, Liane and Matusik, Wojciech},
  journal={ACM Transactions on Graphics (Proc. SIGGRAPH)},
  volume={40},
  number={4},
  year={2021},
  publisher={ACM}
}
```

