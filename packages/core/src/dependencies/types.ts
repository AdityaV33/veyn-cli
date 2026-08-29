export type ImportKind = "static" | "type" | "side-effect" | "export";

export interface ImportRecord {
  sourceFile: string;
  moduleSpecifier: string;
  resolvedPath: string | null;
  kind: ImportKind;
}
