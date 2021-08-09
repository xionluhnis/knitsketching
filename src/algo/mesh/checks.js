// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
// const assert = require('../../assert.js');
const geom = require('../../geom.js');

function checkFlowAndTime(mesh, verbose = true){
  // clear current arrays
  mesh.errors = [];
  mesh.warnings = [];

  // compute errors and warnings
  const meanTS = geom.runningMean();
  let minTS = 1;
  let maxTS = 1;
  for(const layer of mesh.getLayers(mesh.lastLevel)){
    // reset layer data
    layer.errors = [];
    layer.warnings = [];

    // note: no need to randomize traversal
    for(const sample of layer.samples()){

      // measure time stretch
      const ts = sample.timeStretch();
      meanTS.push(ts);

      // skip border samples
      if(sample.isBorder())
        continue;

      // use range information only inside
      minTS = Math.min(minTS, ts);
      maxTS = Math.max(maxTS, ts);

      const { x, y } = sample;
      const uv = sample.flow();

      // detect neighbors with ~90deg flows
      const neighbors = [];
      // check right and bottom neighbors
      const r = layer.isValid(y, x + 1) && x < layer.width - 1;
      const b = layer.isValid(y + 1, x) && y < layer.height - 1;
      if(r)
        neighbors.push({ x: x + 1, y });
      if(b)
        neighbors.push({ x, y: y + 1 });
      const uvs = [ uv ];
      for(const n of neighbors){
        const nsample = layer.getSample(n.y, n.x);
        const uv_n = nsample.flow();
        uvs.push(uv_n);

        const dot = geom.dot(uv, uv_n);
        const center = layer.gridToSketch({
          x: (x + n.x) * 0.5,
          y: (y + n.y) * 0.5
        });
        if(dot <= 0.0){
          layer.errors.push({
            x, y, n, dot, center,
            message: 'Two opposing flows do not merge.'
          });

        } else if(dot < 0.15){
          // XXX what is a good threshold?
          layer.warnings.push({
            x, y, n, dot, center,
            message: 'Flow changes too fast.'
          });
        }
      } // endfor n

      // check discrete curl is small
      if(neighbors.length === 2
      && layer.isValid(y + 1, x + 1)){
        const csample = layer.getSample(y + 1, x + 1);
        uvs.push(csample.flow());

        // uvs = [ uv(x,y), uv(x+1,y), uv(x,y+1), uv(x+1,y+1) ]
        // curl = [(v_i+1,j - v_i,j)/dx + (v_i+1,j+1 - v_i,j+1)/dx]/2
        //      - [(u_i,j+1 - u_i,j)/dy + (u_i+1,j+1 - u_i+1,j)/dy]/2
        const curl = (uvs[1].y - uvs[0].y + uvs[3].y - uvs[2].y) * 0.5
                   + (uvs[2].x - uvs[0].x + uvs[3].x - uvs[1].x) * 0.5;
        if(Math.abs(curl) >= 1){
          layer.errors.push({
            x, y, center: layer.gridToSketch({ x, y }), curl,
            message: 'Large interior flow rotation.'
          });
        }
      }

      if(sample.isBorder())
        continue;

      // check that we are not at a local time extrema inside
      const t = sample.time();
      const dtSigns = new Set();
      for(const [nsample] of sample.neighbors()){
        const t_n = nsample.time();
        const sign = Math.sign(t_n - t);
        dtSigns.add(sign);
      }
      if(dtSigns.size === 1){
        layer.errors.push({
          x, y, center: layer.gridToSketch({ x, y }), dtSigns,
          message: 'Local internal time extrema.'
        });
      }
    } // endfor { x, y }
  } // endfor layer
  for(const vertex of mesh.vertices()){
    if(vertex.isBorder()){
      // check that the time value at each family sample
      // is exactly the same! (even though floating point!)
      const t = vertex.time();
      for(const s of vertex.family()){
        if(s.time() !== t){
          s.layer.errors.push({
            x: s.x, y: s.y, center: s.getSketchPos(),
            message: 'Sample has different time from vertex'
          });
        }
      }
    }
  }

  // accumulate summary information
  const errorMap = {};
  const warningMap = {};
  for(const layer of mesh.getLayers(mesh.lastLevel)){
    for(const [issues, issueMap] of [
      [layer.errors, errorMap],
      [layer.warnings, warningMap]
    ]){
      for(const { message } of issues){
        issueMap[message] = (issueMap[message] || 0) + 1;
      }
    }
  }
  // create summaries
  for(const [issues, issueMap] of [
    [mesh.errors, errorMap],
    [mesh.warnings, warningMap]
  ]){
    for(const [message, count] of Object.entries(issueMap)){
      issues.push({ message, count });
    }
  }

  // check average time stretch
  if(meanTS.value < 0.5 || meanTS.value > 2){
    console.warn(
      'Unusual global time stretch (mean=' + meanTS.value
    + '). Likely due to time loop.'
    );
    mesh.errors.push({
      message: 'Bad time stretch. Time loop?' // no count, since global
    });
  } else if(minTS < 0.2 || maxTS > 5){
    console.warn(
      'Unusual time stretch peaks (min=' + minTS
    + ', max=' + maxTS + ', mean=' + meanTS.value
    + '). Possibly local time extrema in the interior.'
    );
    mesh.warnings.push({
      message: 'Time stretch peaks. Interior time extrema?' // no count, global
    });
  } else if(verbose)
    console.log('Average time stretch', meanTS.value, ' | min', minTS, ' | max', maxTS);
}

function checkRegions(mesh){
  // clear region lists
  mesh.regionErrors = [];
  mesh.regionWarnings = [];

  // create error map
  const errorMap = new Map();
  const error = (r, msg, err = true) => {
    if(err)
      r.setError(msg);
    else
      r.setWarning(msg);
    if(errorMap.has(msg))
      errorMap.get(msg).regions.push(r);
    else
      errorMap.set(msg, { error: err, regions: [r] });
  };
  // const warn = (r, msg) => error(r, msg, false);

  // check regions
  for(const region of mesh.regions){
    region.clearStatus();
    // only worry about simple regions
    if(region.isArea()) {
      // - should be internal (prev + next)
      if(region.isBoundary()){
        error(region, 'Region without a boundary isoline');

        // - should have exactly one previous and one next nodes
      } else if(region.next.size > 1 || region.prev.size > 1){
        error(region, 'Region with many prev/next isolines');

      } else {
        // check type of neighbors: should all be isolines
        for(const r of region.neighbors()){
          if(r.isArea()){
            error(region, 'Two regions without isoline in between');
            break;
          }
        }
      }
    } // endif region is simple
  } // endfor region of mesh.regions

  // generate error summaries
  if(errorMap.size > 0){
    // create list of errors
    for(const [message, { error, regions }] of errorMap.entries()){
      const errorList = error ? mesh.regionErrors : mesh.regionWarnings;
      errorList.push({ message, count: regions.length /*, regions */ });
    }
  }
  return mesh.regionErrors.length === 0; // valid if no error
}

function checkRegionGraph(mesh){
  // create error map
  const errorMap = new Map();
  const raise = (r, msg, err = true) => {
    if(r.index >= 0 && r.index < mesh.reducedRegions.length){
      // replace with original region
      r = mesh.reducedRegions[r.index];
    }
    if(err)
      r.setError(msg);
    else
      r.setWarning(msg);
    if(errorMap.has(msg))
      errorMap.get(msg).regions.push(r);
    else
      errorMap.set(msg, { error: err, regions: [r] });
  };
  // const warn = (r, msg) => error(r, msg, false);

  // compute region graph
  const graph = mesh.getRegionGraph();

  // check edges onto which we would compute stitch variables
  for(const edge of graph.edges){
    // edges must correspond to instantiable stitch loops
    const error = msg => {
      raise(edge.source, msg);
      raise(edge.target, msg);
    };

    // *) edges must be between area and interface nodes
    // we do not accept interface-interface or area-area
    const [area, itf] = edge.area(true);
    if(!area || !itf
    || !area.isArea() || !itf.isInterface()){
      error('Region graph is not bipartite');
      continue;
    }
    
    // we must check that we can form a valid stitch layout
    // that allows balancing across its two sides
    const crsPath = edge.getCoursePath();
    if(!crsPath){
      error('No valid course layout for region edge');
    }
  } // endfor edge of graph.edges

  // generate error summaries
  if(errorMap.size > 0){
    // create list of errors
    for(const [message, { error, regions }] of errorMap.entries()){
      const errorList = error ? mesh.regionErrors : mesh.regionWarnings;
      errorList.push({ message, count: regions.length /*, regions */ });
    }
  }
  return mesh.regionErrors.length === 0; // valid if no error
}

module.exports = {
  checkFlowAndTime,
  checkRegions,
  checkRegionGraph
};