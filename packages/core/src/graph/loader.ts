import { MongoIndexStorage } from "../persistence/mongodb-storage.js";
import { GraphNode, GraphEdge } from "./types.js";
import { DependencyGraph } from "./graph.js";
import { DependencyGraphTraversal } from "./traversal.js";

export async function loadDependencyGraph(
  storage: MongoIndexStorage,
  repositoryId: string
): Promise<DependencyGraphTraversal> {
  const nodes = await storage.getDependencyNodes(repositoryId);
  const edges = await storage.getDependencyEdges(repositoryId);

  const graph = new DependencyGraph();
  nodes.forEach((n: GraphNode) => graph.addNode(n));
  edges.forEach((e: GraphEdge) => graph.addEdge(e));

  return new DependencyGraphTraversal(graph);
}
