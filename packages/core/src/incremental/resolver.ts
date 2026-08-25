import { GraphEdge } from "../graph/index.js";
import { FileChangeSet } from "./types.js";

export class AffectedResolver {
  public resolve(changes: FileChangeSet, edges: GraphEdge[]): string[] {
    const affected = new Set<string>();

    // 1. All explicitly added, modified, and deleted files are affected
    for (const file of changes.added) affected.add(file);
    for (const file of changes.modified) affected.add(file);
    for (const file of changes.deleted) affected.add(file);

    // 2. Build a reverse dependency map to find dependents efficiently
    // If A imports B, we have an edge source="A:..." target="B:..."
    // We want to know: who depends on B? Map B's file -> array of A's files
    const reverseMap = new Map<string, Set<string>>();

    for (const edge of edges) {
      const sourceFile = this.extractFileFromId(edge.source);
      const targetFile = this.extractFileFromId(edge.target);

      if (sourceFile && targetFile && sourceFile !== targetFile) {
        if (!reverseMap.has(targetFile)) {
          reverseMap.set(targetFile, new Set<string>());
        }
        reverseMap.get(targetFile)!.add(sourceFile);
      }
    }

    // 3. Transitively find all files that depend on the directly affected files
    // A simple BFS
    const queue = Array.from(affected);
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      
      const dependents = reverseMap.get(current);
      if (dependents) {
        for (const dep of dependents) {
          if (!affected.has(dep)) {
            affected.add(dep);
            queue.push(dep); // Transitive: if A depends on B and B is affected, A is affected.
          }
        }
      }
    }

    return Array.from(affected).sort();
  }

  private extractFileFromId(id: string): string | null {
    const colonIndex = id.indexOf(":");
    if (colonIndex > -1) {
      return id.substring(0, colonIndex);
    }
    return null; // fallback
  }
}
