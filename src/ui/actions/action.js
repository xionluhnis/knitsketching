// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const ActionContext = require('./actioncontext.js');

// constants
const Hook = {
  // normal phases
  START:    'start',
  MOVE:     'move',
  STOP:     'stop',
  CLOSE:    'close',
  INPUT:    'input',

  // special phases
  CLICK:    'click',
  DBLCLICK: 'dblclick',
  ABORT:    'abort',

  // indirect catching
  CAUGHT:   'caught'
};

const HistoryDefault = {
  [Hook.STOP]: true,
  [Hook.CLOSE]: true
};

// registry
const actions = new Map();
const catchingActions = new Set();
const actionIds = new Map();
const actionFlags = new Map();
const shortCuts = new Map();
const actionClasses = new Set();

class SketchAction {

  get ctor(){
    return Object.getPrototypeOf(this).constructor;
  }
  get id(){
    return actionIds.get(this.ctor);
  }
  matches(action){
    return action && this.id === action.id;
  }
  static get classes(){ return []; }
  getClasses(){ return this.constructor.classes; }

  // base action hooks doing nothing
  start(){}
  move(){}
  stop(){}
  input(uictx){ uictx.reject(); /* skip by default */ }
  close(uictx){ uictx.reject(); /* skip by default */ }
  click(){}
  dblclick(uictx){ uictx.reject(); /* skip by default */ }
  abort(){}
  caught(uictx){ uictx.reject(); /* skip by default */ }

  /**
   * Registers an action class
   *
   * @param {string} id action identifier
   * @param {function} actionClass an action class
   * @return the same skaction after registration, with its id
   */
  static register(id, actionClass, flags = {}){
    assert(!actions.has(id), 'Double registration for', id, actionClass);
    actions.set(id, actionClass);
    actionIds.set(actionClass, id);
    actionFlags.set(id, flags);
    // register shortcuts
    for(const key of flags.shortcuts || []){
      shortCuts.set(key, actionClass);
    }
    // register catching actions
    if(actionClass.prototype.hasOwnProperty(Hook.CAUGHT)){
      catchingActions.add(actionClass);
    }
    // register classes
    for(const clazz of actionClass.classes){
      assert(typeof clazz === 'string', 'Invalid CSS class type');
      actionClasses.add(clazz);
    }
    return Object.assign(actionClass, { id });
  }

  /**
   * Creates an unparameterized instance of an action
   * 
   * @param {string|function} id action identifier or constructor
   * @param {array} args constructor arguments
   * @return {SketchAction} a new instance of the selected action
   */
  static create(idOrActionClass, ...args){
    let actionClass;
    if(actions.has(idOrActionClass)){
      const id = idOrActionClass;
      assert(actions.has(id), 'Action is not registered', id);
      actionClass = actions.get(id);
    } else if(actionIds.has(idOrActionClass)){
      actionClass = idOrActionClass;
    }
    if(actionClass)
      return new actionClass(...args);
  }

  /**
   * Triggers an action hook.
   * 
   * If the current action has a corresponding hook,
   * then this is called as:
   * 
   *    action[hookName](ctx, ...args)
   * 
   * where ctx is the action context for interacting with the layout.
   * If either
   *    1) The return value is true, or
   *    2) The context is rejected.
   * Then the hook is considered not taken.
   * 
   * If the corresponding hook does not exist or is not taken by the current action,
   * then the general hook `caught` is attempted for all registered actions.
   * This hook has the form:
   * 
   *    action.caught(ctx, hookName, currAction, ...args)
   * 
   * where
   *    - ctx is a new context (can be freed to reject again),
   *    - currAction is the current action,
   *    - hookName is the current hook name.
   *
   * Similarly, a catching action can reject the hook
   * by either returning true, or calling ActionContext::reject().
   *
   * @param layoutOrCtx the source layout or ui context
   * @param hookName the name of the action hook
   * @param ...args the additional arguments
   * @return whether an action accepted the triggered hook
   */
  static triggerHook(layoutOrCtx, hookName, ...args){
    let sklayout, ctx;
    if(layoutOrCtx instanceof ActionContext){
      sklayout = layoutOrCtx.parent;
      ctx = layoutOrCtx;
    } else {
      sklayout = layoutOrCtx;
      ctx = new ActionContext(sklayout, null, HistoryDefault[hookName]);
    }
    const action = sklayout.action;
    if(action){
      assert(action[hookName], 'Invalid hook name', hookName);
      action[hookName](ctx, ...args);
      if(ctx.valid)
        return true;
    }
    // use list of catching classes only
    for(const actionClass of catchingActions){
      const catchAction = new actionClass();
      const catchCtx = ctx.renew();
      catchAction[Hook.CAUGHT](
        catchCtx, hookName, action, ...args
      );
      if(catchCtx.valid)
        return true; // was caught
    }
    return false; // was not caught
  }

  static getActionId(actionOrClass){
    if(actionIds.has(actionOrClass))
      return actionIds.get(actionOrClass);
    return actionIds.get(Object.getPrototypeOf(actionOrClass));
  }

  static getActionById(id){
    return actions.get(id);
  }

  static *actionIds(){ yield *actions.keys(); }
  static *actionClasses(){ yield *actionClasses; }
  static *actionEntries(){ yield *actions.entries(); }

  static getActionFlag(id, flagName){
    return (actionFlags.get(id) || {})[flagName];
  }

  static getActionByShortcut(key){
    return shortCuts.get(key);
  }
}

module.exports = Object.assign(SketchAction, Hook, {
  // special values and keys
  IS_EDIT: 'isEdit',
  IS_CLICK: 'isClick',
  OWN_SELECTION: 'ownSelection',
  HAS_SELECTION: 'hasSelection'
});
