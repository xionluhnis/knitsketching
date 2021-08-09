// Alexandre Kaspar <akaspar@mit.edu>
"use strict";

// modules
const assert = require('../assert.js');

let UID = 0;

/**
 * Union-find data structure
 *
 * @param elem the element to represent
 */
function UnionSet(elem){
  this.parent = this;
  this.elem = elem;
  this.id = ++UID;
}
UnionSet.prototype.find = function(){
  if(this.parent != this)
    this.parent = this.parent.find();
  return this.parent;
};
UnionSet.prototype.union = function(uset){
  let troot = this.find();
  let oroot = uset.find();
  // check equality
  if(troot == oroot)
    return; // already equivalent
  else
    oroot.parent = troot; // merge trees by replacing the root of one
};
UnionSet.getClusters = function(usets, withMap){
  let clusters = [];
  let clusterMap = {};
  for(let uset of usets){
    if(uset.find().id in clusterMap){
      let clu = clusterMap[uset.find().id];
      clu.push(uset.elem);
    } else {
      let clu = [ uset.elem ];
      clusterMap[uset.find().id] = clu;
      clusters.push(clu);
    }
  }
  return withMap ? [clusters, clusterMap] : clusters;
};
UnionSet.createSetsAndMap = function(elements, idFun){
  if(!idFun){
    idFun = elem => {
      assert('id' in elem, 'Element does not have an id field');
      return elem.id;
    };
  }
  const sset = [];
  const smap  = {};
  for(let elem of elements){
    sset.push(new UnionSet(elem));
    const id = idFun(elem);
    assert(!(id in smap), 'Non-unique element id');
    smap[id] = sset[sset.length - 1];
  }
  return [sset, smap, idFun];
};

/**
 * Generic clustering algorithm
 *
 * @param elements the list of elements to get clusters from
 * @param idFun an identity function (defaults to e=>e.id)
 */
function Clustering(elements, idFun){
  this.elements = elements;
  [this.set, this.map, this.idFun] = UnionSet.createSetsAndMap(elements, idFun);
}
/**
 * Returns the union set of an element
 *
 * @param elem the element, should be in the clustering element set
 * @param unsafe whether to accept invalid element arguments
 * @return its corresponding union set (or undefined if unsafe)
 */
Clustering.prototype.setOf = function(elem, unsafe){
  const u = this.map[this.idFun(elem)];
  assert(unsafe || u, 'Element is not part of the clustering set');
  return u;
};
/**
 * Bind multiple elements as part of the same cluster
 *
 * @param e0 the first element
 * @param ...elems multiple elements all part of the same cluster as e0
 */
Clustering.prototype.cluster =
Clustering.prototype.link =
Clustering.prototype.union = function(e0, ...elems){
  assert(elems.length, 'Requires at least two arguments');
  const u0 = this.setOf(e0);
  for(let e of elems){
    const u = this.setOf(e);
    u0.union(u);
  }
};
Clustering.prototype.linkIds = function(id0, ...ids){
  assert(ids.length, 'Requires at least two arguments');
  assert(id0 in this.map, 'Id not in clustering set');
  const u0 = this.map[id0];
  for(let id of ids){
    assert(id in this.map, 'Id not in clustering set');
    const u = this.map[id];
    u0.union(u);
  }
};
/**
 * Return the current list of clusters with a potential cluster map
 *
 * @param withMap whether to also return a mapping from element to cluster
 * @return a list of element clusters (each as a list), or [clusters, (elem)=>cluster]
 */
Clustering.prototype.getClusters = function(withMap){
  const [clusters, clusterMap] = UnionSet.getClusters(this.set, true);
  if(withMap){
    return [
      clusters,
      elem => {
        const u = this.setOf(elem, true);
        return u ? clusterMap[u.find().id] : null;
      }
    ];
  } else
    return clusters;
};
UnionSet.Clustering = Clustering;

/**
 * Creates an online clustering algorithm
 * which does not require knowing all the element ahead of linking.
 *
 * @param idFun the identiy function (defaults to e => e.id)
 * @param strict whether to check for element exact identity (not by default)
 */
function OnlineClustering(idFun, strict){
  Clustering.call(this, [], idFun);
  this.strict = strict;
}
OnlineClustering.prototype = Object.create(Clustering.prototype);
OnlineClustering.constructor = OnlineClustering;
/**
 * Returns the union set of an element,
 * creating it if it did not exist yet.
 *
 * /!\ Beware that different elements with same id will not trigger
 * an error in this setup.
 *
 * @param elem the element, should be in the clustering element set
 * @return its corresponding union set
 */
OnlineClustering.prototype.setOf = function(elem){
  const id = this.idFun(elem);
  if(id in this.map){
    const u = this.map[id];
    if(this.strict){
      assert(u.elem === elem, 'Identity is broken');
    }
    return u;
  } else {
    // create union set for it
    const u = new UnionSet(elem);
    this.set.push(u);
    this.map[id] = u;
    return u;
  }
};
/**
 * Add an element to the online set
 *
 * @param elem the element to add to the clustering
 * @return whether the element was in the set already (true) or not (false)
 */
OnlineClustering.prototype.add = function(elem){
  const id = this.idFun(elem);
  if(id in this.map){
    if(this.strict)
      assert(this.map[id].elem === elem, 'Identity is broken');
    return true;
  }
  const u = new UnionSet(elem);
  this.set.push(u);
  this.map[id] = u;
  return false;
};

UnionSet.OnlineClustering = OnlineClustering;

module.exports = UnionSet;
