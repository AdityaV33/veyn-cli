import { CallGraph, CallGraphNode, CallGraphEdge } from "./index.js";

export interface TraceOptions {
  maxDepth?: number;
}

export interface TracePathNode {
  node: CallGraphNode;
  edge?: CallGraphEdge; // The edge that led to this node (undefined for the root target)
  depth: number;
}

export interface TraceResult {
  targetNode: CallGraphNode;
  downstream: TracePathNode[][]; // What the target calls
  upstream: TracePathNode[][]; // What calls the target
}

import { SymbolRecord } from "../symbols/index.js";

export class CallGraphTraversal {
  constructor(private graph: CallGraph) {}

  public resolveTarget(query: string, allSymbols: SymbolRecord[]): SymbolRecord[] {
    if (query.includes(":")) {
      const exact = allSymbols.find(s => `${s.filePath}:${s.name}` === query);
      return exact ? [exact] : [];
    }
    return allSymbols.filter(s => s.name === query);
  }

  public trace(targetSymbol: SymbolRecord, options: TraceOptions = {}): TraceResult {
    const nodeId = `${targetSymbol.filePath}:${targetSymbol.name}`;
    let targetNode = this.graph.getNodes().find(n => n.id === nodeId);

    if (!targetNode) {
      targetNode = {
        id: nodeId,
        filePath: targetSymbol.filePath,
        symbolName: targetSymbol.name,
        kind: targetSymbol.kind
      };
    }

    const maxDepth = options.maxDepth ?? 5; // Default bound to prevent infinite output on large graphs

    const downstream = this.traverse(targetNode, maxDepth, "downstream");
    const upstream = this.traverse(targetNode, maxDepth, "upstream");

    return {
      targetNode,
      downstream,
      upstream
    };
  }

  private traverse(
    startNode: CallGraphNode,
    maxDepth: number,
    direction: "upstream" | "downstream"
  ): TracePathNode[][] {
    const paths: TracePathNode[][] = [];
    const queue: { currentPath: TracePathNode[], visitedIds: Set<string> }[] = [];

    queue.push({
      currentPath: [{ node: startNode, depth: 0 }],
      visitedIds: new Set([startNode.id])
    });

    while (queue.length > 0) {
      // Deterministic processing using shift
      const { currentPath, visitedIds } = queue.shift()!;
      const head = currentPath[currentPath.length - 1];

      // If we reached max depth, save the path and stop exploring this branch
      if (head.depth >= maxDepth) {
        if (currentPath.length > 1) paths.push(currentPath);
        continue;
      }

      const edges = direction === "downstream"
        ? this.graph.getOutboundEdges(head.node.id)
        : this.graph.getInboundEdges(head.node.id);

      // Deterministic sorting of edges to ensure stable paths
      const sortedEdges = [...edges].sort((a, b) => {
        if (a.sourceId !== b.sourceId) return a.sourceId.localeCompare(b.sourceId);
        if (a.targetId !== b.targetId) return a.targetId.localeCompare(b.targetId);
        return a.line - b.line;
      });

      let reachedEnd = true;

      for (const edge of sortedEdges) {
        const nextId = direction === "downstream" ? edge.targetId : edge.sourceId;

        // Cycle detection / Bounding
        if (visitedIds.has(nextId)) {
          // Add cycle terminator to path
          const nextNode = this.graph.getNodes().find(n => n.id === nextId)!;
          paths.push([...currentPath, { node: nextNode, edge, depth: head.depth + 1 }]);
          reachedEnd = false; // We appended a path, so we don't treat this parent as a leaf below
          continue;
        }

        const nextNode = this.graph.getNodes().find(n => n.id === nextId);
        if (nextNode) {
          reachedEnd = false;
          const nextVisited = new Set(visitedIds);
          nextVisited.add(nextId);
          queue.push({
            currentPath: [...currentPath, { node: nextNode, edge, depth: head.depth + 1 }],
            visitedIds: nextVisited
          });
        }
      }

      // If no outgoing/incoming edges, it's a leaf path
      if (reachedEnd && currentPath.length > 1) {
        paths.push(currentPath);
      }
    }

    return paths;
  }
}
