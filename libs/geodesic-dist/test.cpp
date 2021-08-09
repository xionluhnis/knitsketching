#include "geometrycentral/surface/manifold_surface_mesh.h"
#include "geometrycentral/utilities/mesh_data.h"
#include "geometrycentral/surface/edge_length_geometry.h"
#include "geometrycentral/surface/heat_method_distance.h"
#include <Eigen/Core>
#include <stdio.h>
#include <iostream>
#include <math.h>

using namespace geometrycentral;
using namespace geometrycentral::surface;

extern "C" {

  int main(){
    // create quad with two triangles in CCW order
    //
    //   0--3
    //   | /|
    //   |/ |
    //   1--2
    //

    const size_t F = 2;
    Eigen::MatrixX3i faces(F, 3);
    faces << 0, 1, 3,
             1, 2, 3;
    
    Eigen::MatrixX3d edges(F, 3);
    edges << 1, M_SQRT2, 1,
             1, 1, M_SQRT2;

    std::cout << "Faces:\n" << faces << "\n";
    std::cout << "Edges:\n" << edges << "\n";

    // create surface mesh
    std::unique_ptr<ManifoldSurfaceMesh> mesh;
    mesh.reset(new ManifoldSurfaceMesh(faces));
    mesh->compress();
    mesh->printStatistics();

    // create geometry data
    EdgeData<double> edgeLengths(*mesh);
    for(size_t i = 0; i < faces.rows(); ++i){
      Face f = mesh->face(i);
      Halfedge he = f.halfedge(); edgeLengths[he.edge()] = edges(i, 0);
      he = he.next(); edgeLengths[he.edge()] = edges(i, 1);
      he = he.next(); edgeLengths[he.edge()] = edges(i, 2);
    }
    std::cout << "Edges:\n" << edgeLengths.raw() << "\n";
    for(Edge e : mesh->edges()){
      printf("Edge #%zu = %g\n", e.getIndex(), edgeLengths[e]);
    }
    std::unique_ptr<EdgeLengthGeometry> geometry;
    geometry.reset(new EdgeLengthGeometry(*mesh, edgeLengths));

    std::cout << "Precomputation\n";

    // create heat method distance solver (precomputation happens here)
    std::unique_ptr<HeatMethodDistanceSolver> heatSolver;
    heatSolver.reset(new HeatMethodDistanceSolver(*geometry));

    std::cout << "Solve\n";

    // solve for distance from first vertex
    const Vertex v = mesh->vertex(0);
    VertexData<double> distToSource = heatSolver->computeDistance(v);
    std::cout << "Distances:\n" << distToSource.raw() << "\n";

    return 0;
  }

}