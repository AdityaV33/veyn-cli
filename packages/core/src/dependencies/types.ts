export type ImportKind = "static" | "type" | "side-effect";

export interface ImportRecord {
  sourceFile: string;
  moduleSpecifier: string;
  resolvedPath: string | null;
  kind: ImportKind;
}
