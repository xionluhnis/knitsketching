// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../../assert.js');
const LinkedList = require('../../ds/linkedlist.js');

// constants
const FRONT = 'f';
const BACK  = 'b';
const EmptySet = Object.freeze(new Set());

/**
 * Sort an array topologically.
 * Requires nodes to have two iterable properties:
 * - node.prevNodes, iterating over past dependencies
 * - node.nextNodes, iterating over future dependencies
 * 
 * @param {array} nodes list of nodes to be sorted
 * @param {array?} srcNodes list of source nodes
 */
function topoSort(nodes, srcNodes){
  if(!srcNodes){
    srcNodes = nodes.filter(n => {
      return Array.from(n.prevNodes).length === 0;
    });
  }
  assert(srcNodes.length, 'No source node available');
  const order = new Map();
  const isReady = node => {
    for(const prevNode of node.prevNodes){
      if(!order.has(prevNode))
        return false;
    }
    return true;
  };
  const plan = new LinkedList(srcNodes);
  let lastOrder = 0;
  while(plan.length){
    const node = plan.popFront();

    // check that we haven't gone over that node already
    if(order.has(node))
      continue;

    // check that we can go over node already
    if(!isReady(node)){
      // queue for later
      assert(plan.length, 'Unsatisfiable dependencies');
      plan.pushBack(node);

    } else {
      // go over node
      order.set(node, lastOrder++);

      // go over next nodes first if possible
      // XXX or go over them later?
      for(const nextNode of node.nextNodes){
        if(isReady(nextNode))
          plan.pushFront(nextNode);
        else
          plan.pushBack(nextNode);
      } // endfor nextNode of next.node
    }
    // end of node processing
  }

  // each node should have an order by now,
  // and the order should match the dependency directions:
  // - prev nodes have lower order
  // - next nodes have higher order
  for(const node of nodes){
    assert(order.has(node), 'There is a node without order');
    const ord = order.get(node);
    assert(Array.from(node.prevNodes, n => order.get(n)).every(o => o < ord),
      'Some previous node has non smaller order number', node, node.prev, order);
    assert(Array.from(node.nextNodes, n => order.get(n)).every(o => o > ord),
      'Some ulterior node has non larger order number', node, node.next, order);
  }

  // actual sort based on topological order
  nodes.sort((n1, n2) => order.get(n1) - order.get(n2));
}

/**
 * Checks whether two ranges overlap.
 * Simple case:
 * - overlap
 * <=>
 * - not (one to the left, or to the right)
 * 
 * This assumes arguments {min, max} with min <= max.
 * 
 * @param {{min:number, max:number}} r1 first range
 * @param {{min:number, max:number}} r2 second range
 * @return {boolean} whether r1 overlaps with r2
 */
function rangesOverlap(r1, r2){
  // return !(r1.min > r2.max || r2.min > r1.max);
  return r1.min <= r2.max && r2.min <= r1.max;
}

function getReachableSubGraph(srcNode, neighborsOf){
  const nodes = new Set();
  const stack = [ srcNode ];
  while(stack.length){
    const node = stack.pop();
    if(nodes.has(node))
      continue; // skip
    // add to set of reachable nodes
    nodes.add(node);
    // go over its neighbors
    for(const nn of neighborsOf(node))
      stack.push(nn);
  }
  return nodes;
}

function findIndependentSubGraphs(baseNodes, returnBridges = false){
  // if 2 or less, then there's only one independent subgraph
  if(baseNodes.length < 3)
    return returnBridges ? [ [baseNodes.slice()], new Set() ] : [baseNodes.slice()];

  // else we need the bridge nodes to compute the independent subgraphs
  
  // 1) Expand graph into actual dependency graph
  //    where each base node has a front + a back
  //    The front and back are independent (free rotation).
  const nodeIndex = new Map(baseNodes.flatMap((node, idx) => {
    return [
      [ node,         idx ], // default index: node => index
      [ idx + FRONT,  idx ], // expanded index: str => index
      [ idx + BACK,   idx ]
    ];
  }));
  const nodes = baseNodes.flatMap((node, idx) => {
    const hasNext = node.next.size > 0;
    const hasPrev = node.prev.size > 0;
    if(hasNext && hasPrev){
      return [ idx + FRONT, idx + BACK ]; // both sides
    } else if(hasNext){
      return [ idx + BACK ]; // only back side
    } else {
      assert(hasPrev, 'Neither front nor back, thus disconnected');
      return [ idx + FRONT ]; // only front side
    }
  });
  const neighborsOf = function*(node, bridges = EmptySet) {
    const baseNodeIdx = nodeIndex.get(node);
    const baseNode = baseNodes[baseNodeIdx];
    assert(baseNode, 'Invalid node input', node);
    const isBridge = bridges.has(node);
    if(node.endsWith(FRONT)){
      for(const n of baseNode.prevNodes){
        yield nodeIndex.get(n) + BACK;
      }
      if(baseNode.next.size > 0 && !isBridge)
        yield baseNodeIdx + BACK;
    } else {
      assert(node.endsWith(BACK), 'Invalid node', node);
      for(const n of baseNode.nextNodes){
        yield nodeIndex.get(n) + FRONT;
      }
      if(baseNode.prev.size > 0 && !isBridge)
        yield baseNodeIdx + FRONT;
    }
  };

  // 2) Find bridge nodes that encapsulate bridge edges after expansion
  // This is implemented slightly brute-force O(n^2), when O(V+E) is possible.
  // But it's not like it matters given the space expansion we use this for.
  // For the linear implementation, look at Tarjan's algorithm.
  // @see https://en.wikipedia.org/wiki/Bridge_(graph_theory)
  const bridges   = new Set();
  for(const baseNode of baseNodes){
    const hasNext = baseNode.next.size > 0;
    const hasPrev = baseNode.prev.size > 0;
    assert(hasNext || hasPrev, 'Disconnected graph');
    const nodeIdx = nodeIndex.get(baseNode);
    // /!\ we disallow traversal from either side
    //     though we should technically only have to worry about one side
    //     since if the other side is reached, then this is not a bridge
    const singleBridge = new Set([nodeIdx + FRONT, nodeIdx + BACK]);
    const subGraph = getReachableSubGraph(
      nodeIdx + (hasNext ? BACK : FRONT),
      n => neighborsOf(n, singleBridge)
    );
    // if a bridge node, then removing the node's edge disconnects the graph
    // => the reachable graph becomes smaller
    // /!\ this is only true because the node list does NOT include
    //     sides that are only connected through the node edges,
    //     otherwise those would ALWAYS be disconnected at boundaries
    if(subGraph.size < nodes.length){
      bridges.add(nodeIdx + FRONT); // mark both sides as bridges
      bridges.add(nodeIdx + BACK);
    }
  }

  // 3) Compute independent subgraphs
  const inSubGraph = new Set();
  const subGraphs = [];
  for(const node of nodes){
    if(inSubGraph.has(node))
      continue;
    const subGraph = getReachableSubGraph(
      node,
      n => neighborsOf(n, bridges) // disallow traversing any bridge node
    );
    // mark all as visited, and extract base nodes
    const baseIndices = new Set();
    for(const n of subGraph){
      inSubGraph.add(n);
      const baseIdx = nodeIndex.get(n);
      baseIndices.add(baseIdx);
    }
    // remap as ordered subgraph of base nodes and add to return list
    const baseSubGraph = Array.from(baseIndices).sort((i1, i2) => {
      return i1 - i2; // natural order instead of lexicographic
    }).map(idx => baseNodes[idx]);
    subGraphs.push(baseSubGraph);
  }
  return returnBridges ? [subGraphs, bridges] : subGraphs;
}

module.exports = {
  topoSort,
  rangesOverlap,
  findIndependentSubGraphs
};