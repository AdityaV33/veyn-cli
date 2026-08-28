import { DependencyGraph } from "./graph.js";
import { GraphNode, GraphEdge } from "./types.js";

export interface ArchitectureOptions {
  maxDepth?: number;
}

export interface ArchitecturePathNode {
  node: GraphNode;
  edge?: GraphEdge;
  depth: number;
}

export interface ArchitectureResult {
  targetNode: GraphNode;
  dependencies: ArchitecturePathNode[][]; // What this module imports
  dependents: ArchitecturePathNode[][];   // What imports this module
}

export class DependencyGraphTraversal {
  constructor(private graph: DependencyGraph) {}

  public resolveTarget(query: string): GraphNode[] {
    const nodes = this.graph.getNodes();
    // Match exact ID or path suffix
    const matches = nodes.filter(n => n.id === query || n.path.endsWith(query));
    return matches;
  }

  public analyze(targetId: string, options: ArchitectureOptions = {}): ArchitectureResult {
    const targetNode = this.graph.getNode(targetId);
    if (!targetNode) {
      throw new Error(`Module not found: ${targetId}`);
    }

    const maxDepth = options.maxDepth ?? 5;

    const dependencies = this.traverse(targetNode, maxDepth, "dependencies");
    const dependents = this.traverse(targetNode, maxDepth, "dependents");

    return {
      targetNode,
      dependencies,
      dependents
    };
  }

  private traverse(
    startNode: GraphNode,
    maxDepth: number,
    direction: "dependencies" | "dependents"
  ): ArchitecturePathNode[][] {
    const paths: ArchitecturePathNode[][] = [];
    const queue: { currentPath: ArchitecturePathNode[], visitedIds: Set<string> }[] = [];

    queue.push({
      currentPath: [{ node: startNode, depth: 0 }],
      visitedIds: new Set([startNode.id])
    });

    while (queue.length > 0) {
      const { currentPath, visitedIds } = queue.shift()!;
      const head = currentPath[currentPath.length - 1];

      if (head.depth >= maxDepth) {
        if (currentPath.length > 1) paths.push(currentPath);
        continue;
      }

      const connectedNodes = direction === "dependencies"
        ? this.graph.getDependencies(head.node.id)
        : this.graph.getDependents(head.node.id);

      // Deterministic sort
      connectedNodes.sort((a, b) => a.id.localeCompare(b.id));

      let reachedEnd = true;

      for (const nextNode of connectedNodes) {
        const edge: GraphEdge = direction === "dependencies"
          ? { source: head.node.id, target: nextNode.id, type: "imports" }
          : { source: nextNode.id, target: head.node.id, type: "imports" };

        if (visitedIds.has(nextNode.id)) {
          paths.push([...currentPath, { node: nextNode, edge, depth: head.depth + 1 }]);
          reachedEnd = false;
          continue;
        }

        reachedEnd = false;
        const nextVisited = new Set(visitedIds);
        nextVisited.add(nextNode.id);
        queue.push({
          currentPath: [...currentPath, { node: nextNode, edge, depth: head.depth + 1 }],
          visitedIds: nextVisited
        });
      }

      if (reachedEnd && currentPath.length > 1) {
        paths.push(currentPath);
      }
    }

    return paths;
  }
}
