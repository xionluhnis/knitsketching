// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

const assert = require('../assert.js');
const ContextMenu = require('./contextmenu.js');
const env = require('../env.js');
const sk = require('../sketch.js');
const util = require('./util.js');
const { editPattern } = require('./pattern.js');
const { triggerUpdate } = require('./program.js');
const CarrierConfig = require('../carriers.js');

module.exports = {

  // ###########################################################################
  // ##### Context Menu ########################################################
  // ###########################################################################

  getMenu(){
    // aggregate context from highlight and selection
    const context = [... new Set(this.highlight.concat(this.selection))];
    switch(context.length){
      case 0:   return this.globalActions();
      case 1:   return this.singleActions(context[0]);
      default:  return this.multipleActions(context);
    }
  },

  /**
   * Menu with global actions:
   * XXX define list
   */
  globalActions(){
    const menu = [];
    const sketches = Array.from(sk.allCurves());
    if(sketches.length){
      // if(this.editMode == 'flow' || this.showFlow){
      flow: {
        const flowUpdate = document.getElementById('flow-update');
        menu.push({
          text: 'Update Flow<span class="value">' + (flowUpdate.checked ? 'on' : 'off') + '</span>', event: event => {
            flowUpdate.click(event);
          }
        });
      }
      //}
      schedule: {
        const schedUpdate = document.getElementById('schedule-update');
        menu.push({
          text: 'Update Schedule<span class="value">' + (schedUpdate.checked ? 'on' : 'off') + '</span>', event: event => {
            schedUpdate.click(event);
          }
        }, ContextMenu.DIVIDER);
      }
      menu.push({
        text: 'Clear Sketches',
        event: () => {
          while(sketches.length){
            const c = sketches.pop();
            sk.deleteCurve(c);
            if(this.updatingFlow)
              sk.updateFlow();
            this.removeFromHighlight(c);
          }
          this.updateFromContent();
        }
      }, {
        text: 'Clear incomplete PCurves',
        event: () => {
          const pcurves = Array.from(sk.allPCurves());
          for(const pcurve of pcurves){
            if(!pcurve.isComplete())
              sk.deletePCurve(pcurve, true);
          }
          this.updateFromContent();
        }
      });
    }
    const images = Array.from(sk.allImages());
    if(sketches.length || images.length){
      menu.push({
        text: 'Clear All',
        event: () => {
          sk.clearAll();
          this.clearHighlight(false);
          this.clearSelection(false);
          this.updateFromContent();
        }
      });
    }
    if(menu.length)
      menu.push(ContextMenu.DIVIDER);
    menu.push(
      { text: 'Load Sketch', event: event => {
        document.getElementById('load').click(event);
      } },
      { text: 'Add Sketch', event: event => {
        document.getElementById('file-add').click(event);
      } },
      { text: 'Save Sketch', disabled: !sketches.length, event: event => {
        document.getElementById('save').click(event);
      } },
      { text: 'Save SVG', disabled: !sketches.length, event: () => {
        util.exportFile('sketch.svg',
          sk.getSketchesAsSVG(),
          { type: 'image/svg+xml' }
        );
      } },
      { text: 'Load Image', event: event => {
        const file = document.createElement('input');
        file.type = 'file';
        file.accept = '.png,.jpg';
        file.onchange = () => {
          if(file.files.length){
            const fname = file.files[0];
            const reader = new FileReader();
            reader.onload = event => {
              const data = event.target.result;
              if(!data){
                return;
              }
              sk.newImage(data).then((/* img */) => {
                this.updateFromContent(); // update view to show image
              }).catch(util.noop);
            };
            reader.readAsDataURL(fname);
          }
        };
        file.click(event);
      } }
      /*,
      { text: 'Generate DAT', disabled: !sketches.length, event: (event) => {
        document.getElementById('output_save').click(event);
      } } */
    );
    if(env.global.expertMode){
      const meshes = sk.Flow.getMeshes();
      menu.push(ContextMenu.DIVIDER, {
        text: 'Expert Mode', menu: [
          ...['region', 'reduced'].map((which, idx) => {
            return {
              text: 'Export ' + which + ' graph',
              disabled: !meshes || !meshes.length,
              event: () => {
                // export graph when available
                let graphStr;
                const timeString = t => util.toDecimalString(t, 2);
                if(meshes.length > 1){
                  graphStr = '';
                  for(let i = 0; i < meshes.length; ++i){
                    graphStr += meshes[i].toRegionGraphString({
                      graphName: 'regions_' + i,
                      reduced: !!idx,
                      exportCW: env.global.exportCW,
                      timeString
                    }) + '\n\n';
                  }

                } else if (meshes.length === 1) {
                  graphStr = meshes[0].toRegionGraphString({
                    reduced: !!idx,
                    exportCW: env.global.exportCW,
                    timeString
                  });

                } else {
                  return; // nothing to do
                }
                util.exportFile('region_graph.dot', graphStr);
              }
            };
          }) // end menu map
        ] // expert mode, menu [{ ... }]
      }); // end push({ ... })
    }
    return menu;
  },

  singleActions(target){
    const sections = [];
    if(target instanceof sk.Sketch){
      // sketch
      sections.push({
        text: 'Sketch', menu: this.sketchActions(target)
      });
      // segment
      const [curve, segIdx] = this.getHITTarget(this.mouseX, this.mouseY, true);
      if(curve == target && segIdx >= 0){
        sections.push({
          text: 'Segment', menu: this.segmentActions(curve, segIdx)
        });

        // link
        const link = target.getLink(segIdx);
        if(link){
          sections.push({
            text: 'Linking', menu: this.linkingActions(link)
          });
        }
      }
      // check possible border constraint target
      const constr = this.getHITConstraint(this.mouseX, this.mouseY);
      if(constr && constr.isBorder()){
        sections.push({
          text: 'Constraint', menu: this.constraintActions(constr)
        });
      }

    } else if(target instanceof sk.Curve
           && target.parent
           && target.parent instanceof sk.Sketch){
      // segment
      const [curve, segIdx] = this.getHITTarget(this.mouseX, this.mouseY, true);
      if(curve === target && segIdx >= 0){
        sections.push({
          text: 'Segment', menu: this.segmentActions(curve, segIdx)
        });
      }
      // curve constraint
      const constr = target.parent.getConstraint(target);
      if(constr){
        sections.push({
          text: 'Constraint', menu: this.constraintActions(constr)
        });
      }

    } else if(target instanceof sk.PCurve
           && target.parent
           && target.parent instanceof sk.Sketch){
      // edit pcurve
      sections.push({
        text: 'Edit PCurve', event: () => {
          const { editPCurve } = require('./parametric.js');
          editPCurve(target.id);
        }
      });
      // underlying segment
      if(target.subCurve){
        const { curve, segIdx } = (target.firstSample || target.lastSample || {});
        if(curve && segIdx !== -1){
          sections.push({
            text: 'Segment', menu: this.segmentActions(curve, segIdx)
          });
        }

        // link
        const link = curve.getLink(segIdx);
        if(link){
          sections.push({
            text: 'Linking', menu: this.linkingActions(link)
          });
        }
      }
      // curve constraint
      const constr = target.parent.getConstraint(target);
      if(constr){
        sections.push({
          text: 'Constraint', menu: this.constraintActions(constr)
        });
      }

    } else if(target instanceof sk.SketchImage){
      // two different cases:
      // - root image => just for background
      // - child image => pattern or other semantical element
      sections.push({
        text: 'Image', menu: this.imageActions(target)
      });
      
    } else if(target instanceof sk.SketchAnchor){
      sections.push({
        text: 'Anchor', menu: this.anchorActions(target)
      });

    } else if(target instanceof sk.SketchRectangle){
      sections.push({
        text: 'Rectangle', menu: this.rectActions(target)
      });
    }

    // add sections to menu
    // - none => text about it
    // - single => add content directly
    // - multiple => add sections as items
    if(sections.length)
      return sections.length === 1 ? sections[0].menu : sections;
    else
      return [ 'No available action' ];
  },

  sketchActions(curve) {
    const menu = [
      'Sketch ' + curve.label,
      ContextMenu.DIVIDER,
      { text: 'Edit Name', event: () => {
        util.askForString('New name', curve.name).then(name => {
          curve.name = name;
          this.update();
        }).catch(util.noop);
      }}
      // ContextMenu.DIVIDER
    ];
    const parents = sk.availableParentsFor(curve);
    if(curve.parent){
      menu.push({
        text: 'Free from Parent',
        event: () => {
          curve.setParent(null);
        }
      });
    }
    menu.push({
      text: 'Set Parent',
      disabled: !parents.length,
      menu: parents.map(parent => {
        return {
          text: parent.label,
          disabled: parent == curve.parent,
          event: () => {
            curve.setParent(parent);
            this.update();
          }
        };
      })
    });

    // shape actions
    menu.push({
      text: 'Shape', menu: [
        {
          text: 'Apply scale',
          disabled: curve.transform.k === 1,
          event: () => {
            curve.applyScale(true);
            this.updateFromContent();
          }
        }, {
          text: 'Mirror along &hellip;',
          menu: [
            {
              text: '&hellip; X', event: () => {
                sk.mirrorCurve(curve, sk.X);
                this.updateFromContent();
              }
            }, {
              text: '&hellip; Y', event: () => {
                sk.mirrorCurve(curve, sk.Y);
                this.updateFromContent();
              }
            }
          ]
        }, {
          text: 'Duplicate Curve',
          event: () => {
            sk.copyCurve(curve);
            this.updateFromContent();
          }
        }, {
          text: 'Create Back',
          disabled: curve.hasBack(), // check that there's not already one
          event: () => {
            sk.createBack(curve);
            // update flow
            if(this.updatingFlow)
              sk.updateFlow();
            // update scene
            this.updateFromContent();
          }
        }
      ]
    });

    // delete action
    // separate from the rest for safety
    menu.push(ContextMenu.DIVIDER, {
      text: 'Delete Curve',
      event: () => {
        sk.deleteCurve(curve);
        // update flow
        if(this.updatingFlow)
          sk.updateFlow();
        // ensure we don't keep dangling pointer
        this.removeFromHighlight(curve);
        // update scene
        this.updateFromContent();
      }
    });
    return menu;
  },

  segmentActions(curve, segIdx){
    const segNIdx = (segIdx + 1) % curve.length;
    const types = ['linear', 'quadratic', 'cubic'];
    const currDegree = curve.getDegree(segIdx);
    const currSeam = curve.getSeamMode(segIdx) || sk.Seam.SEAM_AUTO;
    const menu = [
      'Curve Segment',
      ContextMenu.DIVIDER,
      { text: 'type<span class="value">' + types[currDegree - 1] + '</span>', menu: types.map((type, idx) => {
        return {
          text: util.capitalize(type),
          disabled: currDegree == idx + 1,
          event: () => {
            curve.setSegmentMode(segIdx, segNIdx, idx + 1);
            // update flow
            if(this.updatingFlow)
              sk.updateFlow();
            this.update();
          }
        };
      })},
      { text: 'seam<span class="value">' + sk.Seam.SEAM_MODE_NAME[currSeam] + '</span>', menu: sk.Seam.SEAM_MODES.map(sm => {
        return {
          text: util.capitalize(sk.Seam.SEAM_MODE_NAME[sm]),
          disabled: currSeam === sm,
          event: () => {
            curve.setSeamMode(segIdx, sm);
            // XXX if updating wales (shortcut), update those
            // update sketch
            this.update();
          }
        };
      })}
    ];
    // sketch => allow setting constraint if not already
    if(curve instanceof sk.Sketch && !curve.parent){
      const constr = curve.getConstraint(segIdx);
      if(!constr){
        menu.push({
          text: 'Set Constraint', menu: sk.Sketch.FLOW_TYPES.map(type => {
            return {
              text: util.capitalize(type),
              event: () => {
                const pcurve = sk.newSegmentPCurve(curve, segIdx);
                curve.setConstraint(pcurve, type);
                // update flow
                if(this.updatingFlow)
                  sk.updateFlow();
                this.update();
              }
            };
          })
        });
      }
    }
    menu.push(ContextMenu.DIVIDER, {
      text: 'Subdivide', event: () => {
        curve.divideSegment(segIdx);
        // update flow
        if(this.updatingFlow)
          sk.updateFlow();
        this.update();
      }
    });
    return menu;
  },

  constraintActions(constr){
    const menu = [
      'Flow Constraint',
      ContextMenu.DIVIDER,
      { text: 'type<span class="value">' + constr.type + '</span>', menu: sk.Sketch.FLOW_TYPES.map(type => {
        return {
          text: util.capitalize(type),
          disabled: constr.type == type,
          event: () => {
            // constr.parent.setConstraint(constr.target, type);
            constr.setType(type);
            // update flow
            if(this.updatingFlow)
              sk.updateFlow();
            this.update();
          }
        };
      })}, {
        text: 'dir<span class="value">' + constr.dirName + '</span>',
        menu: sk.Sketch.DIR_TYPES.map(dir => {
        const dirName = sk.Sketch.DIR_NAME_OF[dir];
        return {
          text: util.capitalize(dirName),
          disabled: constr.dir == dir,
          event: () => {
            constr.dir = dir;
            // update flow
            if(this.updatingFlow)
              sk.updateFlow();
            this.update();
          }
        };
      })}, {
        text: 'weight<span class="value">' + (constr.hasAutoWeight() ?  'auto ~ ' : '') + constr.weight + '</span>',
        event: () => {
          util.askForNumber('Constraint weight in [0;1], 0=auto',
          constr.weight, { min: 0, max: 1 }).then(weight => {
            constr.weight = weight;
            // update flow
            if(this.updatingFlow)
              sk.updateFlow();
          }).catch(util.noop);
        }
      }
    ];
    menu.push(ContextMenu.DIVIDER, {
      text: 'Delete Constraint', event: () => {
        constr.parent.setConstraint(constr.target, null);
        // update flow
        if(this.updatingFlow)
          sk.updateFlow();
        if(constr.target instanceof sk.Curve)
          this.removeFromHighlight(constr.target);
        this.update();
      }
    });
    return menu;
  },

  imageActions(image){
    const opacity = Math.floor(100 * image.opacity);
    const menu = [
      'Image',
      ContextMenu.DIVIDER,
      {
        text: 'Remove', event: () => {
          sk.deleteImage(image);
          this.removeFromHighlight(image);
          this.updateFromContent();
        }
      },
      {
        text: 'Opacity<span class="value">' + opacity + '</span>', event: () => {
          util.askForNumber('Opacity', opacity, { integer: true, min: 1, max: 100 }).then(newOpacity => {
            image.opacity = newOpacity / 100;
            this.update();
          }).catch(util.noop);
        }
      }
    ];
    return menu;
  },

  linkingActions(link){
    const menu = [
      // 'Border Linking',
      {
        text: 'Transmission<span class="value">' + link.transmission + '</span>',
        disabled: link.isParentLink(), menu: sk.Link.TRANSMISSION_TYPES.map(type => {
          return { text: util.capitalize(type), event: () => {
            link.setTransmissionType(type);
          }};
        })
      },
      ContextMenu.DIVIDER,
      {
        text: 'Transfer mirror',
        disabled: link.isMirrorLink() || !link.canMirror(),
        event: () => {
          link.setMirror();
          if(this.updatingFlow)
            sk.updateFlow();
          this.update();
        }
      },
      {
        text: 'Break mirror',
        disabled: !link.isMirrorLink(),
        event: () => {
          link.breakMirror();
          this.update();
        }
      },
      {
        text: 'Separate', event: () => {
          link.remove();
          // update flow
          if(this.updatingFlow)
            sk.updateFlow();
          this.update();
        }
      }
    ];
    return menu;
  },

  anchorActions(anchor){
    const isFree = !!anchor.isFree();
    const isConstr = !isFree;
    const menu = [
      { text: 'Anchor' },
      ContextMenu.DIVIDER,
      {
        text: 'parametric<span class="value">' + isConstr + '</span>',
        menu: [false, true].map(b => {
          return {
            text: util.capitalize(b.toString()),
            disabled: b === isConstr,
            event: () => {
              if(b)
                anchor.makeConstrained();
              else
                anchor.makeFree();
              this.update();
            }
          };
        })
      },
      ...[
        ['stitchType', sk.SketchAnchor.ANCHOR_STITCHES],
        ['passType', sk.SketchAnchor.ANCHOR_PASSES]
      ].map(([propName, options]) => {
        const value = anchor[propName];
        return {
          text: propName + '<span class="value">' + value + '</span>',
          menu: options.map(optValue => {
            return {
              text: util.capitalize(optValue),
              disabled: value === optValue,
              event: () => {
                anchor[propName] = optValue;
                this.update();
              }
            };
          })
        };
      }),
      ContextMenu.DIVIDER,
      ...anchor.grids.map((grid, i) => {
        return {
          text: 'Grid #' + i,
          menu: this.gridActions(grid)
        };
      }),
      {
        text: 'Create grid',
        event: () => {
          anchor.addGrid();
          this.update();
        }
      }
    ];

    // initial layer creation
    if(!anchor.grids.length){
      menu.push(ContextMenu.DIVIDER, {
        text: 'Create new layer',
        menu: this.layerCreateActions(() => {
          // create grid as container for layer
          return anchor.addGrid();
        }, '&hellip; as', 'anchorgrid')
      });
    }

    // layer shortcuts
    const layers = anchor.grids.flatMap(g => g.layerData);
    if(layers.length < 3){
      menu.push(ContextMenu.DIVIDER, ...layers.map((ld, i) => {
        return {
          text: 'Layer #' + i,
          menu: this.layerActions(ld)
        };
      }));
    }

    // ending for deleting the anchor
    menu.push(ContextMenu.DIVIDER, {
      text: 'Delete anchor',
      event: () => {
        anchor.setParent(null);
        this.update();
      }
    });
    return menu;
  },

  gridActions(grid){
    return [
      ...['width', 'height'].map((prop, i) => {
        const value = grid[prop];
        return {
          text: prop + '<span class="value">' + value + '</span>',
          event: () => {
            util.askForString(prop, value).then(str => {
              if(!sk.SketchAnchor.Grid.isValidInput(str, i === 0)){
                alert('Invalid input ' + str);
              } else {
                grid[prop] = str;
                if(grid.layerData.length)
                  triggerUpdate();
                this.update();
              }
            }).catch(util.noop);
          }
        };
      }),
      ...['xAlign', 'yAlign'].map(prop => {
        const value = grid[prop];
        const values = sk.SketchAnchor[
          'ALIGN_' + prop.charAt(0).toUpperCase()
        ];
        const text = (
          prop +'<span class="value">'
          + util.capitalize(value)
          + '</span>'
        );
        return {
          text, menu: values.map(val => {
            return {
              text: util.capitalize(val),
              disabled: value === val,
              event: () => {
                grid[prop] = val;
                if(grid.layerData.length)
                  triggerUpdate();
                this.update();
              }
            };
          })
        };
      }),
      {
        text: 'baseAxis<span class="value">' + grid.baseAxis + '</span>',
        menu: sk.SketchAnchor.AXES.map(baseAxis => {
          return {
            text: baseAxis,
            disabled: grid.baseAxis === baseAxis,
            event: () => {
              grid.baseAxis = baseAxis;
              if(grid.layerData.length)
                triggerUpdate();
              this.update();
            }
          };
        })
      },
      ContextMenu.DIVIDER,
      ...this.compactLayersActions(grid),
      ContextMenu.DIVIDER,
      {
        text: 'Delete grid',
        event: () => {
          grid.delete();
          this.updateFromContent();
        }
      }
    ];
  },

  rectActions(rect){
    const menu = [
      { text: 'Rectangle' },
      ContextMenu.DIVIDER,
      ...['width', 'height', 'angle'].map(propName => {
        const value = rect[propName];
        const isAngle = propName === 'angle';
        return {
          text: propName + '<span class="value">' + value.toFixed(2) + '</span>',
          event: () => {
            util.askForNumber(propName, value, {
              min: isAngle ? -Math.PI * 2 : 1,
              max: isAngle ? Math.PI * 2 : 1e6
            }).then(num => {
              rect[propName] = num;
              if(rect.layerData.length)
                  triggerUpdate();
              this.updateFromContent();

            }).catch(util.noop);
          }
        };
      }),
      ContextMenu.DIVIDER
    ];

    // layer shortcuts
    menu.push(...this.compactLayersActions(rect));

    // ending for deleting the rectangle
    menu.push(ContextMenu.DIVIDER, {
      text: 'Delete rectangle',
      event: () => {
        rect.setParent(null);
        if(rect.layerData.length)
            triggerUpdate();
        this.update();
      }
    });
    return menu;
  },

  *compactLayersActions(container){
    const layers = container.layerData;
    if(layers.length < 3){
      yield *layers.map((ld, i) => {
        return {
          text: 'Layer #' + i,
          menu: this.layerActions(ld)
        };
      });
      yield {
        text: 'Create new layer',
        menu: this.layerCreateActions(container, '&hellip; as')
      };

    } else {
      yield {
        text: 'Layers',
        menu: this.layersActions(container)
      };
    }
  },

  layersActions(container){
    if(!container.layerData || !container.layerData.length){
      return this.layerCreateActions(container);

    } else {
      const menu = [];
      for(const [i, layer] of container.layerData.entries()){
        menu.push({
          text: 'Layer #' + i,
          menu: this.layerActions(layer)
        });
      }
      menu.push({
        text: 'Create new layer',
        menu: this.layerCreateActions(container, '&hellip; as')
      });
      return menu;
    }
  },

  layerCreateActions(
    container,
    prefix = 'Create as',
    contType = container.type
  ){
    const typeName = str => util.capitalize(str.replace('-', ' '));
    return Array.from(sk.SketchLayer.descriptors()).flatMap(ld => {
      if(!ld.isValidParentType(contType))
        return [];
      return [{
        text: prefix + ' <span class="option">' + typeName(ld.type) + '</span> layer',
        event: () => {
          if(typeof container === 'function'){
            container = container(); // get container
            assert(ld.isValidParent(container),
              'Promised container type is invalid');
          }
          container.layerData.push(
            sk.SketchLayer.create(container, ld.type)
          );
          triggerUpdate();
          this.update();
        }
      }];
    });
  },

  layerActions(layer){
    const typeName = str => util.capitalize(str.replace('-', ' '));
    const ldesc = layer.descriptor;
    const menu = [
      { text: 'Sketch Layer' },
      ContextMenu.DIVIDER,
      { text: 'type<span class="value">' + typeName(ldesc.type) + '</span>',
        menu: Array.from(sk.SketchLayer.types(), ltype => {
          return {
            text: typeName(ltype),
            disabled: ltype === ldesc.type,
            event: () => {
              // update type of layer
              layer.setType(ltype);
              triggerUpdate();
              this.update();
            }
          };
        })
      },
      ContextMenu.DIVIDER
    ];
    // property modifiers
    for(const [name, param] of ldesc.params){
      const value = layer.getParam(name);
      let text = name + '<span class="value">' + value + '</span>';
      switch(param.type){

        case 'number':
          menu.push({
            text, event: () => {
              util.askForNumber(name, value).then(newValue => {
                layer.setParam(name, newValue);
                triggerUpdate();
                this.update();
              }).catch(util.noop);
            }
          });
          break;

        case 'string':
          menu.push({
            text, event: () => {
              util.askForString(name, value).then(newValue => {
                layer.setParam(name, newValue);
                triggerUpdate();
                this.update();
              }).catch(util.noop);
            }
          });
          break;

        case 'boolean':
        case 'enum':
          menu.push({
            text, menu: param.values.map(option => {
              return {
                text: util.capitalize(option.toString()),
                disabled: option === value,
                event: () => {
                  layer.setParam(name, option);
                  triggerUpdate();
                  this.update();
                }
              };
            })
          });
          break;

        case 'image':
          // special pattern editing options, depending on layer type
          menu.push({
            text: 'Edit ' + name,
            event: () => {
              editPattern(layer, name);
            }
          });
          break;

        case 'mapping':
          break;

        case 'reference':
          if(value){
            text = name + '<span class="value">' + value.label + '</span>';
          }
          menu.push({
            text, menu: [
              {
                text: value ? 'Reset' : 'Select',
                event: () => {
                  this.setActionMode('select-target', obj => {
                    // callback => select an object
                    layer.setParam(name, obj);
                    triggerUpdate();

                    // go back into default selection
                    this.setActionMode('select');
                    this.update();

                  }, obj => {
                    // filter => check that it's a valid reference
                    // given the parameter's validity (depends on the layer)
                    return obj && param.isValid(obj, layer);
                  });
                }
              },
              {
                text: 'Remove',
                disabled: !value,
                event: () => {
                  layer.setParam(name, null);
                  triggerUpdate();
                  this.update();
                }
              }
            ]
          });
          break;

        case 'yarn':
          if(!value){
            text = name + '<span class="value">unset</span>';
          } else {
            text = name + '<span class="value">'
                 + CarrierConfig.getDeviceInfo(value, 'name', '???')
                 + '</span>';
          }
          menu.push({
            text, menu: [0].concat(Array.from(CarrierConfig.devices())).map(dev => {
              const yarns = dev ? dev.bitmask : dev;
              return {
                text: dev ? dev.name : 'unset',
                disabled: value === yarns,
                event: () => {
                  layer.setParam(name, yarns);
                  triggerUpdate();
                  this.update();
                }
              };
            })
          });
          break;

        case 'yarnmask':
          if(!value || value === sk.StitchSampler.YARN_MASK_ALL){
            text = name + '<span class="value">any</span>';
          } else {
            text = name + '<span class="value">' + Array.from({
              length: 10
            }).flatMap((_, i) => {
              return ((1 << i) & value) ? [i+1] : [];
            }).join(',') + '</span>';
          }
          menu.push({
            text, menu: [
              { text: 'Include list',
                event: () => {
                  util.askForString('List of yarns', '').then(str => {
                    const list = str.split(/[^\d]+/).flatMap(c => {
                      const n = parseInt(c);
                      return 0 < n && n <= 10 ? [n] : [];
                    });
                    const mask = list.reduce((msk, y) => {
                      return msk | (1 << (y - 1)); // union
                    }, 0);
                    layer.setParam(name, mask);
                  }).catch(util.noop);
                }
              },
              { text: 'Exclude list',
                event: () => {
                  util.askForString('List of yarns', '').then(str => {
                    const list = str.split(/[^\d]+/).flatMap(c => {
                      const n = parseInt(c);
                      return 0 < n && n <= 10 ? [n] : [];
                    });
                    const mask = list.reduce((msk, y) => {
                      return msk & (~(1 << (y - 1))); // difference
                    }, sk.StitchSampler.YARN_MASK_ALL);
                    layer.setParam(name, mask);
                  }).catch(util.noop);
                }
              },
              { text: 'Set mask',
                event: () => {
                  util.askForNumber('Mask as a 10-bits number', value).then(mask => {
                    layer.setParam(name, mask);
                  }).catch(util.noop);
                }
              },
              ContextMenu.DIVIDER,
              { text: 'All',
                disabled: [0, sk.StitchSampler.YARN_MASK_ALL].includes(value),
                event: () => {
                  layer.setParam(name, sk.StitchSampler.YARN_MASK_ALL);
                }
              }
            ]
          });
          break;

        default:
          assert.error('Invalid or unsupported type', param);
      }
    }
    menu.push(ContextMenu.DIVIDER, {
      text: 'Remove layer',
      event: () => {
        const sketch = layer.parent;
        assert(sketch, 'Orphan layer data');
        assert(sketch.layerData.includes(layer),
          'Invalid layer parent does not include layer');
        sketch.layerData = sketch.layerData.filter(ld => ld !== layer);
        triggerUpdate();
        this.update();
      }
    });
    return menu;
  },

  multipleActions(targets){
    if(targets.some(t => t.parent))
      return [ 'No available action' ];

    const menu = [];
    // XXX grouped actions
    if(!menu.length)
      menu.push('Selection (' + targets.length + ')');
    return menu;
  }
};
