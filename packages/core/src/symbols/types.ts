export type SymbolKind =
  | "function"
  | "class"
  | "method"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "property";

export interface SymbolRecord {
  name: string;
  kind: SymbolKind;
  filePath: string;
  startLine: number;
  endLine: number;
}

export interface ReferenceRecord {
  sourceFile: string;
  sourceLine: number;
  targetId: string;
}
