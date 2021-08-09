// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

module.exports = function defaults(){
  return {
    // verbosity and expert mode
    verbose:          false,
    expertMode:       false,
    debugWasm:        false,
    loadGlobals:      false,

    // algorithm options
    // - meshing
    meshLevels:       3,
    levelFactor:      2,
    minResolution:    8,
    robustMeshing:    true,
    geodesicMode:     'heat',
    refineGeodesics:  true,
    refineThreshold:  3,
    // - flow + time
    flowAccuracy:     0.001,
    timeAccuracy:     0.005,
    timeStretchRange: 0,
    timeMoment:       0.1,
    maxTimeIter:      200,
    constraintSupport: 1,
    nhPower:          1,
    nhThreshold:      0,
    dtimeEquation:    2, // -1=src-only, 1=trg-only, 2=bidirectional
    invertTime:       false,
    // - region graph
    minRegionDT:      0.25,
    maxRegionDT:      10,
    uniformRegionSplit: false,
    exportCW:         true,
    // - sampling parameters
    shapingFactor:    2,
    globalShaping:    false,
    globalAliasing:   2,
    globalBudget:     1,
    localBudget:      1,
    shortRowMode:     'qip', // none | max | qip
    srAlignment:      'bottom', // bottom | middle | top
    ssAlignment:      'all', // none | min | all
    ssThreshold:      0.5,
    ssDepth:          5,
    uniformBranching: false,
    evenInterfaces:   false,
    mixedShaping:     false,
    localScaling:     false,
    minWaleDiff:      false,
    seamSupport:      1.5,
    seamByDefault:    false,
    seamStop:         'nodes', // none | sampling | tracing | nodes
    subdivSeam:       'rdiag', // rdiag | ldiag | rcol | lcol | rand
    subdivSR:         'even', // even | first | last
    // - sampling weights
    waleAccWeight:    1,
    courseAccWeight:  1,
    globalSimpWeight: 0,
    localSimpWeight:  0,
    srSimpWeight:     0.3,
    srSimpPower:      2,
    distWeight:       1,
    seamWeight:       1,
    flowWeight:       0,
    // - scheduling
    useSubGraphs:     false,
    filterInsert:     false,
    scheduleType:     'greedy', // forward | greedy | optimal
    bindingBranches:  1,
    flatLayouts:      'all',
    useFlatFlipping:  false,
    useGreedyTension: false,
    offsetError:      'l2', // l0 | l1 | l2
    simpleOffsets:    false,
    maxStepDecrease:  2, // gets multiplied by 2 for circular cases
    maxStepIncrease:  2,
    maxShift:         2,
    useLegacySlicing: false,
    // - knitting
    shapingAlgorithm: 'cse', // cse | rs
    multiTransfer:    false,
    reduceTransfers:  false,
    increaseType:     'kickback',
    borderType:       'out',
    insertDepth:      3,
    castOnType:       'interlock',
    castOffType:      'pickup',
    usePickUpStitch:  true,
    useIncreaseStitchNumber: true,
    useSRTucks:       false,
    useSVS:           false,
    maxPendingYarns:  9,
    intarsiaTucks:    'both', // both | ccw | cw | none
    intarsiaSide:     'after', // after | before
    intarsiaPasses:   0, // 0=inf, >0 are integer thresholds
    safeTucks:        true,
    intarsiaSwitch:   true,
    // - programs
    gauge:            'half',
    subdiv:           1,

    // stitch program
    stitchProgram:    '',

    // rendering
    labelStyle:       '16px Arial',

    // sizing information
    sizing: {
      "default": {
        wale: "135 mm / 100 stitches",  // 18 mm / 20 stitches
        course: "300 mm / 100 stitches" // 30 mm / 20 stitches
      },
      "sketch": {
        type: "sketch", // sketch | border
        /* sketch: id, border: id, */
        scale: "1 mm / 10 px"
      }
    },
    carriers: {
      "1": {
        type: "knit",
        DSCS: false,
        carriers: ["1"] //,
        // color: "#9999FF"
      },
      "2": {
        carriers: ["2"] //,
        // color: "#33FF66"
      },
      "3": {
        carriers: ["3"] //,
        // color: "#FF9999"
      },
      "4": {
        carriers: ["4"]
      },
      "5": {
        carriers: ["5"]
      },
      "6": {
        carriers: ["6"]
      },
      "7": {
        type: "elastic",
        carriers: ["7"] //,
        // color: "#FFFFFF"
      },
      "8": {
        carriers: ["8"]
      },
      "9": {
        carriers: ["9"]
      },
      "10": {
        carriers: ["10"]
      },
      /* "32": {
        type: "inlay",
        carriers: ["3", "2"]
      },
      "13": {
        type: "plating",
        carriers: ["1", "3"]
      }, */
      "default": "1"
    }
  };
};