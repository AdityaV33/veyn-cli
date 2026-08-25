export interface GraphNode {
  id: string;
  type: "file";
  path: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: "imports";
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
