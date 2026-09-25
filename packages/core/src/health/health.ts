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
  constructor(private storage: MongoIndexStorage, private repositoryId: string, private repositoryPath: string) {}

  public async analyze(): Promise<HealthReport> {
    const isTestOrConfig = (p: string) => p.includes('.test.') || p.includes('__tests__') || p.includes('.config.');

    let files = await this.storage.getFiles(this.repositoryId);
    let symbols = await this.storage.getSymbols(this.repositoryId);
    let depNodes = await this.storage.getDependencyNodes(this.repositoryId);
    let depEdges = await this.storage.getDependencyEdges(this.repositoryId);
    let callEdges = await this.storage.getCallEdges(this.repositoryId);

    // Completely exclude test and config artifacts from production health analysis
    files = files.filter(f => !isTestOrConfig(f.relativePath));
    symbols = symbols.filter(s => !isTestOrConfig(s.filePath));
    depNodes = depNodes.filter(n => !isTestOrConfig(n.id));
    depEdges = depEdges.filter(e => !isTestOrConfig(e.source) && !isTestOrConfig(e.target));
    callEdges = callEdges.filter(e => !isTestOrConfig(e.sourceId) && !isTestOrConfig(e.targetId));

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
        const isEntryPoint = 
          sym.name.startsWith("register") || 
          sym.name === "createCli" || 
          sym.name === "createServer" || 
          sym.name === "runBenchmark";

        if (isEntryPoint) {
          continue;
        }

        // Normalize symbol's absolute filePath to a repository-relative path
        let relativePath = sym.filePath;
        if (relativePath.startsWith(this.repositoryPath)) {
          relativePath = relativePath.slice(this.repositoryPath.length);
          if (relativePath.startsWith("/") || relativePath.startsWith("\\")) {
            relativePath = relativePath.slice(1);
          }
        }
        // Ensure consistent forward slashes
        relativePath = relativePath.replace(/\\/g, "/");

        const id = `${relativePath}:${sym.name}`;
        if (!calledTargets.has(id)) {
          deadCodeSignals.push(`${relativePath}:${sym.name}`);
        }
      }
    }

    // 3. Large files (> 50KB)
    const largeFiles = files
      .filter(f => f.sizeBytes > 50000)
      .map(f => `${f.relativePath}::${f.sizeBytes}`);

    // 4. High coupling
    const highCoupling: string[] = [];
    for (const node of sortedNodes) {
      const deps = depGraph.getDependencies(node.id).length;
      const dependents = depGraph.getDependents(node.id).length;
      if (deps + dependents > 20) {
        highCoupling.push(`${node.id}::${dependents}::${deps}`);
      }
    }

    // 5. Structural issues
    const structuralIssues: string[] = [];
    for (const node of sortedNodes) {
      const deps = depGraph.getDependencies(node.id).length;
      const dependents = depGraph.getDependents(node.id).length;
      if (deps === 0 && dependents === 0) {
        structuralIssues.push(`${node.id}`);
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
