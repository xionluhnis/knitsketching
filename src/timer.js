// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

/**
 * Create a basic timer with string prefix
 *
 * @param prefix the timer's name prefix
 */
function Timer(prefix, entries = []){
  this.prefix = prefix;
  this.initial = +new Date();
  this.entries = entries;
}
/**
 * Restart the timer without removing previous entries.
 * This is useful if you need to measure from a new base time.
 */
Timer.prototype.restart = function(){
  this.initial = +new Date();
  return this;
};
/**
 * Restart the timer while removing previous entries.
 * This is useful if you need to discard the timer past.
 */
Timer.prototype.clear = function(){
  this.entries = [];
  return this.restart();
};
/**
 * Create a parallel timer based that adds tick entries
 * to this timer (but uses a different initial time value).
 * 
 * @param prefix the subtimer prefix
 * @return {Timer} the subtimer based on this timer
 */
Timer.prototype.subtimer = function(prefix){
  return new Timer(prefix, this.entries);
};
/**
 * Take a time measure and restart the timer.
 * This allows taking multiple measures relative to each other consecutively.
 *
 * @param name the measure name
 * @see Timer::tick
 * @see Timer::restart
 */
Timer.prototype.measure = function(name){
  return this.tick(name).restart();
};
/**
 * Take a time measure without restarting the timer.
 * This allows taking multiple measures relative to the same initial time.
 *
 * @param name the measure name
 * @see Timer::tick
 */
Timer.prototype.tick = function(name){
  if(this.prefix)
    this.entries.push({ name: this.prefix + '.' + name, time: new Date() - this.initial });
  else
    this.entries.push({ name, time: new Date() - this.initial });
  return this;
};
/**
 * Return a description of the times
 *
 * @param del1 the delimiter between name and time (: )
 * @param del2 the delimiter between different entries (, )
 * @return the entries summary
 */
Timer.prototype.toString = function(del1, del2, timeUnit){
  if(del1 === undefined)
    del1 = ': ';
  if(del2 === undefined)
    del2 = ', ';
  return this.entries.map(({ name, time }) => {
    return name + del1 + time + (timeUnit || 'ms');
  }).join(del2);
};
/**
 * Output the timing information to the debug console
 * 
 * @param prefix the initial text in the debug output 
 */
Timer.prototype.debug = function(prefix){
  const dbg = console.debug || console.log;
  dbg(prefix + ':', this.toString());
};
/**
 * Factory
 *
 * @param prefix
 */
Timer.create = function(prefix){
  return new Timer(prefix);
};

module.exports = Timer;
