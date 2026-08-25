import path from "path";
import { CallRecord, CallGraphNode, CallGraphEdge, CallGraphSnapshot } from "./types.js";

export interface CallGraphBuildContext {
  repositoryRoot: string;
}

function normalizePath(absolutePath: string, rootPath: string): string {
  const rel = path.relative(rootPath, absolutePath);
  return rel.replace(/\\/g, "/");
}

function getNodeId(filePath: string, symbol: string): string {
  return `${filePath}:${symbol}`;
}

export class CallGraph {
  private nodes = new Map<string, CallGraphNode>();
  private edges = new Set<string>(); // Used to deduplicate
  private edgeObjects: CallGraphEdge[] = [];
  private outEdges = new Map<string, Set<string>>(); // source -> target[]
  private inEdges = new Map<string, Set<string>>(); // target -> source[]

  public build(calls: CallRecord[], context: CallGraphBuildContext): void {
    const isLocal = (p: string | null) => {
      if (!p) return false;
      const rel = path.relative(context.repositoryRoot, p);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    };

    for (const call of calls) {
      if (isLocal(call.targetFile)) {
        const sourcePath = normalizePath(call.sourceFile, context.repositoryRoot);
        const targetPath = normalizePath(call.targetFile as string, context.repositoryRoot);

        const sourceId = getNodeId(sourcePath, call.sourceSymbol);
        const targetId = getNodeId(targetPath, call.targetSymbol);

        this.addNode({ id: sourceId, filePath: sourcePath, symbolName: call.sourceSymbol, kind: "function" });
        this.addNode({ id: targetId, filePath: targetPath, symbolName: call.targetSymbol, kind: "function" });

        this.addEdge({ sourceId, targetId, kind: call.kind });
      }
    }
  }

  private addNode(node: CallGraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, { ...node });
      this.outEdges.set(node.id, new Set());
      this.inEdges.set(node.id, new Set());
    }
  }

  private addEdge(edge: CallGraphEdge): void {
    const key = `${edge.sourceId}->${edge.targetId}`;
    if (!this.edges.has(key)) {
      this.edges.add(key);
      this.edgeObjects.push({ ...edge });
      this.outEdges.get(edge.sourceId)!.add(edge.targetId);
      this.inEdges.get(edge.targetId)!.add(edge.sourceId);
    }
  }

  public getNodes(): CallGraphNode[] {
    return Array.from(this.nodes.values()).map(n => ({ ...n }));
  }

  public getEdges(): CallGraphEdge[] {
    return this.edgeObjects.map(e => ({ ...e }));
  }

  public getCallees(nodeId: string): CallGraphNode[] {
    const targets = this.outEdges.get(nodeId);
    if (!targets) return [];
    return Array.from(targets).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  public getCallers(nodeId: string): CallGraphNode[] {
    const sources = this.inEdges.get(nodeId);
    if (!sources) return [];
    return Array.from(sources).map(id => this.nodes.get(id)!).filter(Boolean);
  }

  public toJSON(): CallGraphSnapshot {
    const nodes = this.getNodes().sort((a, b) => a.id.localeCompare(b.id));
    const edges = this.getEdges().sort((a, b) => {
      if (a.sourceId !== b.sourceId) return a.sourceId.localeCompare(b.sourceId);
      if (a.targetId !== b.targetId) return a.targetId.localeCompare(b.targetId);
      return a.kind.localeCompare(b.kind);
    });
    return { nodes, edges };
  }
}
