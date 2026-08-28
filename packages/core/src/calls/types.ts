export type CallKind = "direct";

export interface CallRecord {
  sourceFile: string;
  sourceSymbol: string;
  targetFile: string | null;
  targetSymbol: string;
  kind: CallKind;
  line: number;
}

export interface CallGraphNode {
  id: string;
  filePath: string;
  symbolName: string;
  kind: string; // e.g. "function" or "method"
}

export interface CallGraphEdge {
  sourceId: string;
  targetId: string;
  kind: CallKind;
  line: number;
}

export interface CallGraphSnapshot {
  nodes: CallGraphNode[];
  edges: CallGraphEdge[];
}
