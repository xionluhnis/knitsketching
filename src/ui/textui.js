// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
// const assert = require('../assert.js');

let mainOutput = null;
let userOutput = null;
let textEntry  = null;
function initTextUI(){
  mainOutput = document.getElementById('output-text');
  userOutput = document.getElementById('output-user');
  textEntry  = document.getElementById('output-text-entry').content.firstElementChild;
  updateMainText();
}

/*
function counts(str, arr){
  return arr.length > 1 ? str + 's' : str;
}
*/

function updateMainText(...issueSources){

  // total count
  let numErrors = 0;

  // clear text so far
  while(mainOutput.firstChild)
    mainOutput.removeChild(mainOutput.firstChild);

  // display all issues
  for(const issueSrc of issueSources){
    for(const { message, count = 0, type } of issueSrc){
      ++numErrors;
      const entry = textEntry.cloneNode(true);
      // fill entry content
      entry.classList.toggle('warning', type === 'warning');
      entry.classList.toggle('error', type === 'error');
      const text = message.length > 50 ? message.splice(0, 49) + '...' : message;
      const countText = count > 0 ? ' (x' + count + ')' : '';
      entry.querySelector('.message').textContent = text;
      entry.querySelector('.count').textContent = countText;
      // add to output
      mainOutput.append(entry);
    }
  }
  mainOutput.dataset.issues = numErrors;
}

function clearUserText(){
  while(userOutput.firstChild)
    userOutput.removeChild(userOutput.firstChild);
}
function appendUserText(...messages){
  for(const message of messages){
    const line = document.createElement('div');
    line.textContent = message;
    userOutput.appendChild(line);
  }
}

module.exports = {
  initTextUI,
  updateMainText,
  clearUserText,
  appendUserText
};