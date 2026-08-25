import path from "path";
import { ImportRecord } from "../dependencies/index.js";
import { DependencyGraph } from "./graph.js";

export interface GraphBuildContext {
  repositoryRoot: string;
}

export function normalizePath(absolutePath: string, rootPath: string): string {
  const rel = path.relative(rootPath, absolutePath);
  return rel.replace(/\\/g, "/");
}

export function buildDependencyGraph(
  imports: ImportRecord[],
  context: GraphBuildContext
): DependencyGraph {
  const graph = new DependencyGraph();

  const isLocal = (p: string | null) => {
    if (!p) return false;
    const rel = path.relative(context.repositoryRoot, p);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  };

  // Sort imports to guarantee deterministic graph building (even though toJSON handles final output)
  const sortedImports = [...imports].sort((a, b) => {
    if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
    if (a.moduleSpecifier !== b.moduleSpecifier) return a.moduleSpecifier.localeCompare(b.moduleSpecifier);
    const aPath = a.resolvedPath || "";
    const bPath = b.resolvedPath || "";
    return aPath.localeCompare(bPath);
  });

  // First pass: add nodes
  for (const record of sortedImports) {
    const sourceId = normalizePath(record.sourceFile, context.repositoryRoot);
    graph.addNode({ id: sourceId, type: "file", path: sourceId });

    if (isLocal(record.resolvedPath)) {
      const targetId = normalizePath(record.resolvedPath as string, context.repositoryRoot);
      graph.addNode({ id: targetId, type: "file", path: targetId });
    }
  }

  // Second pass: add edges
  for (const record of sortedImports) {
    if (isLocal(record.resolvedPath)) {
      const sourceId = normalizePath(record.sourceFile, context.repositoryRoot);
      const targetId = normalizePath(record.resolvedPath as string, context.repositoryRoot);
      graph.addEdge({
        source: sourceId,
        target: targetId,
        type: "imports",
      });
    }
  }

  return graph;
}
