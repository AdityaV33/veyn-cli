import { GraphNode, GraphEdge, GraphSnapshot } from "./types.js";

export class DependencyGraph {
  private nodes = new Map<string, GraphNode>();
  private edges = new Set<string>(); // Used to prevent duplicates "source->target"
  private edgeObjects: GraphEdge[] = [];
  private outEdges = new Map<string, Set<string>>(); // source -> target[]
  private inEdges = new Map<string, Set<string>>(); // target -> source[]

  public addNode(node: GraphNode): void {
    if (!this.nodes.has(node.id)) {
      this.nodes.set(node.id, { ...node });
      this.outEdges.set(node.id, new Set());
      this.inEdges.set(node.id, new Set());
    }
  }

  public addEdge(edge: GraphEdge): void {
    const key = `${edge.source}->${edge.target}`;
    if (!this.edges.has(key)) {
      if (this.nodes.has(edge.source) && this.nodes.has(edge.target)) {
        this.edges.add(key);
        this.edgeObjects.push({ ...edge });
        this.outEdges.get(edge.source)!.add(edge.target);
        this.inEdges.get(edge.target)!.add(edge.source);
      }
    }
  }

  public getNode(id: string): GraphNode | undefined {
    const node = this.nodes.get(id);
    return node ? { ...node } : undefined;
  }

  public getNodes(): GraphNode[] {
    return Array.from(this.nodes.values()).map((n) => ({ ...n }));
  }

  public getEdges(): GraphEdge[] {
    return this.edgeObjects.map((e) => ({ ...e }));
  }

  public getDependencies(nodeId: string): GraphNode[] {
    const deps = this.outEdges.get(nodeId);
    if (!deps) return [];
    return Array.from(deps)
      .map((id) => this.getNode(id)!)
      .filter(Boolean);
  }

  public getDependents(nodeId: string): GraphNode[] {
    const deps = this.inEdges.get(nodeId);
    if (!deps) return [];
    return Array.from(deps)
      .map((id) => this.getNode(id)!)
      .filter(Boolean);
  }

  public hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  public toJSON(): GraphSnapshot {
    const nodes = this.getNodes().sort((a, b) => a.path.localeCompare(b.path));
    const edges = this.getEdges().sort((a, b) => {
      if (a.source !== b.source) return a.source.localeCompare(b.source);
      if (a.target !== b.target) return a.target.localeCompare(b.target);
      return a.type.localeCompare(b.type);
    });
    return { nodes, edges };
  }
}
