#include <emscripten.h>
#include <emscripten/bind.h> 
#include "geometrycentral/surface/manifold_surface_mesh.h"
#include "geometrycentral/utilities/mesh_data.h"
#include "geometrycentral/surface/edge_length_geometry.h"
#include "geometrycentral/surface/heat_method_distance.h"
#include <Eigen/Core>
#include <stdio.h>
#include <iostream>

using namespace geometrycentral;
using namespace geometrycentral::surface;
typedef int iptr_t;
typedef int dptr_t;

// mesh data
static Eigen::MatrixX3i faces;
static Eigen::MatrixX3d edges;
static EdgeData<double> edgeLengths;

// mesh containers
static std::unique_ptr<ManifoldSurfaceMesh> mesh;
static std::unique_ptr<EdgeLengthGeometry> geometry;

// the Heat Method solver
static std::unique_ptr<HeatMethodDistanceSolver> heatSolver;

// the output vertex data
static VertexData<double> distToSource;

// parameters
static double timeStep = 1.0;
static bool robust = false;
static bool verbose = true;

std::string getExceptionMessage(intptr_t exceptionPtr) {
    return std::string(reinterpret_cast<std::exception *>(exceptionPtr)->what());
}

EMSCRIPTEN_BINDINGS(Bindings) {
  emscripten::function("getExceptionMessage", &getExceptionMessage);
};

extern "C" {

  EMSCRIPTEN_KEEPALIVE
  iptr_t allocate_faces(size_t num_faces){
    faces.resize(num_faces, 3);
    edges.resize(num_faces, 3);
    return reinterpret_cast<iptr_t>(&faces(0, 0));
  }
  EMSCRIPTEN_KEEPALIVE
  void set_face(size_t f, size_t idx0, size_t idx1, size_t idx2){
    faces(f, 0) = idx0;
    faces(f, 1) = idx1;
    faces(f, 2) = idx2;
  }
  EMSCRIPTEN_KEEPALIVE
  void set_face_edges(size_t f, double e0, double e1, double e2){
    edges(f, 0) = e0;
    edges(f, 1) = e1;
    edges(f, 2) = e2;
  }
  EMSCRIPTEN_KEEPALIVE
  void print_faces(){
    std::cout << "Faces:\n" << faces << "\n";
  }
  EMSCRIPTEN_KEEPALIVE
  dptr_t get_edge_ptr(){
    return reinterpret_cast<dptr_t>(&edges(0, 0));
  }
  EMSCRIPTEN_KEEPALIVE
  void print_edges(){
    std::cout << "Edges:\n" << edges << "\n";
  }

  EMSCRIPTEN_KEEPALIVE
  iptr_t allocate_edges(size_t num_edges){
    edges.resize(num_edges, 3);
    return reinterpret_cast<iptr_t>(&edges(0, 0));
  }

  EMSCRIPTEN_KEEPALIVE
  void set_verbose(bool v = true){
    verbose = v;
  }
  EMSCRIPTEN_KEEPALIVE
  void set_quiet(){
    set_verbose(false);
  }
  EMSCRIPTEN_KEEPALIVE
  void set_time_step(double step){
    timeStep = step;
  }
  EMSCRIPTEN_KEEPALIVE
  void set_robust(bool flag){
    robust = flag;
  }

  EMSCRIPTEN_KEEPALIVE
  void create_surface_mesh(){
    // create underlying mesh topology
    mesh.reset(new ManifoldSurfaceMesh(faces));
    mesh->compress();
    if(verbose)
      mesh->printStatistics();
  }

  EMSCRIPTEN_KEEPALIVE 
  void precompute(){

    // create implicit geometry using edge lengths and mesh
    edgeLengths = EdgeData<double>(*mesh);
    for(size_t i = 0; i < faces.rows(); ++i){
      if(verbose)
        printf("Setting lengths of face #%zu\n", i);
      Face f = mesh->face(i);
      if(!f.isTriangle()){
        printf("Face is not a triangle\n");
        return;
      }
      Halfedge he = f.halfedge(); edgeLengths[he.edge()] = edges(i, 0);
      he = he.next(); edgeLengths[he.edge()] = edges(i, 1);
      he = he.next(); edgeLengths[he.edge()] = edges(i, 2);
    }
    if(verbose){
      std::cout << "Edges:\n" << edgeLengths.raw() << "\n";
      for(Edge e : mesh->edges()){
        printf("Edge #%zu = %g\n", e.getIndex(), edgeLengths[e]);
      }
    }
    geometry.reset(new EdgeLengthGeometry(*mesh, edgeLengths));

    // create heat method distance solver (precomputation happens here)
    heatSolver.reset(new HeatMethodDistanceSolver(*geometry, timeStep, robust));
  }

  EMSCRIPTEN_KEEPALIVE
  dptr_t compute_from_source(size_t srcIndex){
    const Vertex v = mesh->vertex(srcIndex);
    distToSource = heatSolver->computeDistance(v);

    if(verbose)
      printf("Returning result pointer\n");

    Eigen::VectorXd &mat = distToSource.raw();
    double* ptr = &mat(0, 0);
    return reinterpret_cast<dptr_t>(ptr);
  }

}