// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');
const { open: openPanel } = require('./panel.js');
const sk = require('../sketch.js');
const util = require('./util.js');
const {
  refreshLayout, setLayoutAction, resetLayoutAction
} = require('./sketch.js');

function editPCurve(target = -2){
  // show panel
  openPanel('parametric');

  // options
  const targets = document.getElementById('curve-target');
  while(targets.firstChild)
    targets.removeChild(targets.firstChild);

  // add all existing pcurves
  for(const pcurve of sk.allPCurves()){
    targets.appendChild(util.createOption(
      pcurve.id, pcurve.name + ' #' + pcurve.id
    ));
  }
  if(!targets.firstChild)
    targets.appendChild(util.createOption('-2', ' ')); // empty for keeping new special
  else if(target === -2)
    target = parseInt(targets.firstChild.value);
  targets.appendChild(util.createOption('-1', '-- new --'));
  targets.value = target;
  // selection change
  targets.onchange = function(){
    const targetIdx = parseInt(targets.value);
    if(targetIdx === -1){
      const pcurve = sk.newPCurve();
      editPCurve(pcurve.id);
    } else if(targetIdx !== -2) {
      editPCurve(targetIdx);
    }
  };

  // get pcurve
  const pcurve = Array.from(sk.allPCurves()).find(p => p.id === target);

  // param list
  const params = document.getElementById('params');

  // if no pcurve, disable all inputs except for the target selection
  for(const input of params.querySelectorAll('input, select')){
    if(input !== targets)
      input.disabled = !pcurve;
  }

  // simple inputs
  for(const input of params.querySelectorAll('input[data-name], select[data-name')){
    const varName = input.dataset.name;
    assert(varName, 'Missing variable name');

    if(!pcurve)
      continue;
    
    // set value
    assert(varName in pcurve, 'Invalid variable field');
    if(input.type === 'checkbox')
      input.checked = pcurve[varName];
    else
      input.value = pcurve[varName];
    const updateValue = newValue => {
      pcurve[varName] = newValue;
      pcurve.clearCache();
      if(varName === 'cubicType')
        pcurve.updateSampleList();
      refreshLayout();
    };
    
    // set handler
    const tag = input.tagName.toLowerCase();
    if(tag === 'input'){
      if(input.type === 'range')
        input.onchange = () => updateValue(parseFloat(input.value));
      else if(input.type === 'checkbox')
        input.onclick = () => updateValue(!!input.checked);
      else
        assert('Unsupported input type', input.type);

    } else if(tag === 'select'){
      input.onchange = () => updateValue(input.value);
    }
  }

  //
  // --- parent --------------------------------------------------------------
  //
  const parent = document.getElementById('curve-parent');
  const setParent = (sketch, fromInput) => {
    if(!sketch)
      parent.value = ''; // no parent
    else {
      parent.value = '@' + (sketch.name || 'sketch') + '#' + sketch.id;
    }
    params.classList.toggle('child', !!sketch);
    if(fromInput && pcurve){
      pcurve.setParent(sketch);
      refreshLayout();
    }
  };
  parent.onclick = () => {
    setLayoutAction('pcurve-parent', sketch => {
      setParent(sketch, true);
      // XXX switch to sample selection instead of select
      setLayoutAction('select');
    });
  };
  setParent(pcurve ? pcurve.parent : null);

  //
  // --- constraint ----------------------------------------------------------
  //
  const constr = document.getElementById('curve-constraint');
  constr.onclick = () => {
    if(!pcurve || !pcurve.parent)
      return; // need a pcurve that has a parent
    if(constr.checked){
      pcurve.parent.setConstraint(pcurve);
    } else {
      pcurve.parent.setConstraint(pcurve, null);
    }
    refreshLayout();
  };
  constr.checked = pcurve && pcurve.parent && pcurve.parent.getConstraint(pcurve);

  //
  // --- seam ----------------------------------------------------------------
  //
  const seam = document.getElementById('curve-seam');
  seam.onchange = () => {
    if(!pcurve)
      return; // need a pcurve
    pcurve.seamMode = parseInt(seam.value);
    refreshLayout();
  };
  seam.value = pcurve && pcurve.seamMode;

  //
  // --- subCurve ------------------------------------------------------------
  //
  const subCurve = document.getElementById('curve-subcurve');
  const updateSubCurve = subCurve.onclick;
  const updateSubCurveClass = () => {
    params.classList.toggle('subcurve', subCurve.checked);
  };
  subCurve.onclick = () => {
    // updateSubCurveClass();
    updateSubCurve();
    if(pcurve)
      editPCurve(pcurve.id);
    else
      updateSubCurveClass();
  };
  updateSubCurveClass();

  //
  // --- degree --------------------------------------------------------------
  //
  const deg = document.getElementById('curve-degree');
  const setDegree = (degree, fromInput) => {
    for(const d of [1, 2, 3]){
      params.classList.toggle('deg' + d, d === degree);
    }
    if(fromInput){
      if(pcurve){
        pcurve.setDegree(degree);
        // reset current action, since it should not keep
        // the current target if it's this curve!
        resetLayoutAction();
        refreshLayout();
      }
    } else {
      deg.value = degree;
    }
  };
  deg.onchange = () => {
    const newDegree = parseInt(deg.value);
    setDegree(newDegree, true);
  };
  setDegree(pcurve ? pcurve.degree : parseInt(deg.value));

  //
  // --- cubicType -----------------------------------------------------------
  //
  const cubicType = document.getElementById('curve-type');
  const setCubicType = cubicType.onchange;
  const setCubicTypeClass = () => {
    for(const type of ['ss', 'cr', 'ns', 'ts']){
      params.classList.toggle(type, cubicType.value === type);
    }
  };
  cubicType.onchange = () => {
    setCubicTypeClass();
    setCubicType();
  };
  setCubicTypeClass();

  //
  // --- startCtrl/endCtrl ---------------------------------------------------
  //
  for(const id of ['curve-start-ctrl', 'curve-end-ctrl']){
    const input = document.getElementById(id);
    assert(input, 'Missing select input', id);
    const update = input.onchange;
    const updateClass = () => {
      // set control classes
      for(const type of ['linear', 'normal', 'tangent', 'angle']){
        input.parentNode.parentNode.classList.toggle(type, input.value === type);
      }
    };
    input.onchange = () => {
      updateClass();
      update();
    };
    updateClass();
  }

  //
  // --- samples -------------------------------------------------------------
  //
  const ends = ['s', 'c0', 'c1', 'e'];
  const validSamples = [
    [0, 3],
    [0, 1, 3],
    [0, 1, 2, 3]
  ];
  const samples = [];
  const updateSamplesClasses = () => {
    for(let i = 0; i < samples.length; ++i){
      const sample = samples[i];
      let curve, sampleIndex;
      if(pcurve){
        sampleIndex = validSamples[pcurve.numSamples - 2].indexOf(i);
        if(sampleIndex !== -1 && pcurve.samples[sampleIndex])
          curve = pcurve.samples[sampleIndex].curve;
      }
      sample.classList.toggle('incomplete', !curve);
      sample.classList.toggle('invalid',
        !!curve && !!pcurve && !pcurve.isSampleValid(
          sampleIndex
        )
      );
    }
  };
  for(let i = 0; i < 4; ++i){
    const sampleIndex = pc => {
      const d = pc.numSamples - 1;
      assert([1, 2, 3].includes(d), 'Invalid degree', d);
      return validSamples[d - 1].indexOf(i);
    };
    const sample = document.getElementById('sample-' + ends[i]);
    samples.push(sample);
    const setSample = (curve, segIdx, t, fromInput) => {
      if(!curve){
        sample.value = '';
      } else {
        sample.value = '@' + (curve.name || curve.type)
                     + '#' + curve.id + '/' + segIdx + '/' + t;
      }
      if(fromInput && pcurve){
        pcurve.setSample(sampleIndex(pcurve), curve, segIdx, t);
        refreshLayout();
      }
      updateSamplesClasses();
    };
    sample.onclick = () => {
      setLayoutAction('pcurve-sample', curve => {
        // either no pcurve => always ok
        // or we need to make sure the curve does not reference the pcurve
        return !pcurve || !pcurve.isReferencingSelf(curve);

      }, (curve, segIdx, t) => {
        setSample(curve, segIdx, t, true);
        // switch to next undefined sample
        if(pcurve){
          const nextIdx = pcurve.samples.findIndex(samp => !samp);
          if(nextIdx !== -1){
            const d = pcurve.numSamples - 2;
            const nextSample = samples[validSamples[d][nextIdx]];
            assert(nextSample, 'Missing next sample');
            nextSample.click();
          }
        } else {
          setLayoutAction('select');
        }
      });
    };
    // init given curve samples
    if(pcurve){
      const sample = pcurve.samples[sampleIndex(pcurve)];
      if(sample){
        setSample(sample.curve, sample.segIdx, sample.sampT);
      } else {
        setSample();
      }
    }
  } // endfor i < 4
}

module.exports = {
  editPCurve
};