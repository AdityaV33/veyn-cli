import { MongoIndexStorage } from "../persistence/index.js";
import { DependencyGraph } from "../graph/index.js";

export interface HealthReport {
  circularDependencies: string[][];
  deadCodeSignals: string[];
  largeFiles: string[];
  highCoupling: string[];
  structuralIssues: string[];
}

export class HealthAnalyzer {
  constructor(private storage: MongoIndexStorage, private repositoryId: string) {}

  public async analyze(): Promise<HealthReport> {
    const files = await this.storage.getFiles(this.repositoryId);
    const symbols = await this.storage.getSymbols(this.repositoryId);

    const depNodes = await this.storage.getDependencyNodes(this.repositoryId);
    const depEdges = await this.storage.getDependencyEdges(this.repositoryId);

    const callEdges = await this.storage.getCallEdges(this.repositoryId);

    // 1. Circular Dependencies
    const circularDependencies: string[][] = [];
    const depGraph = new DependencyGraph();
    depNodes.forEach(n => depGraph.addNode(n));
    depEdges.forEach(e => depGraph.addEdge(e));

    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const detectCycle = (nodeId: string) => {
      visited.add(nodeId);
      recStack.add(nodeId);
      path.push(nodeId);

      const deps = depGraph.getDependencies(nodeId);
      // Deterministic order
      const sortedDeps = [...deps].sort((a, b) => a.id.localeCompare(b.id));

      for (const dep of sortedDeps) {
        if (!visited.has(dep.id)) {
          detectCycle(dep.id);
        } else if (recStack.has(dep.id)) {
          const cycleStartIdx = path.indexOf(dep.id);
          const cycle = [...path.slice(cycleStartIdx), dep.id];
          circularDependencies.push(cycle);
        }
      }

      recStack.delete(nodeId);
      path.pop();
    };

    const sortedNodes = [...depNodes].sort((a, b) => a.id.localeCompare(b.id));
    for (const node of sortedNodes) {
      if (!visited.has(node.id)) {
        detectCycle(node.id);
      }
    }

    const uniqueCycles = new Map<string, string[]>();
    for (const cycle of circularDependencies) {
      const key = [...cycle].sort().join("->");
      if (!uniqueCycles.has(key)) {
        uniqueCycles.set(key, cycle);
      }
    }

    // 2. Dead Code Signals (Functions with no incoming calls)
    const deadCodeSignals: string[] = [];

    // Normalizing file paths to match call graph semantics
    const calledTargets = new Set(callEdges.map(e => e.targetId));

    for (const sym of symbols) {
      if (sym.kind === "function") {
        // Just extract the basename for a robust check
        const basename = sym.filePath.split(/[\\/]/).pop() || sym.filePath;
        const id = `${basename}:${sym.name}`;
        if (!calledTargets.has(id)) {
          deadCodeSignals.push(`${sym.filePath}:${sym.name}`);
        }
      }
    }

    // 3. Large files (> 50KB)
    const largeFiles = files
      .filter(f => f.sizeBytes > 50000)
      .map(f => `${f.relativePath} (${(f.sizeBytes / 1024).toFixed(1)} KB)`);

    // 4. High coupling
    const highCoupling: string[] = [];
    for (const node of sortedNodes) {
      const deps = depGraph.getDependencies(node.id).length;
      const dependents = depGraph.getDependents(node.id).length;
      if (deps + dependents > 20) {
        highCoupling.push(`${node.id} (fan-in: ${dependents}, fan-out: ${deps})`);
      }
    }

    // 5. Structural issues
    const structuralIssues: string[] = [];
    for (const node of sortedNodes) {
      const deps = depGraph.getDependencies(node.id).length;
      const dependents = depGraph.getDependents(node.id).length;
      if (deps === 0 && dependents === 0) {
        structuralIssues.push(`Isolated module: ${node.id}`);
      }
    }

    return {
      circularDependencies: Array.from(uniqueCycles.values()),
      deadCodeSignals: deadCodeSignals.sort().slice(0, 50),
      largeFiles: largeFiles.sort(),
      highCoupling: highCoupling.sort(),
      structuralIssues: structuralIssues.sort()
    };
  }
}
