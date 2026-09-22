import { DependencyGraph } from "./graph.js";
import { GraphNode, GraphEdge } from "./types.js";
import * as path from "node:path";
import * as fs from "node:fs";

export interface ArchitectureOptions {
  maxDepth?: number;
}

export interface ArchitecturePathNode {
  node: GraphNode;
  edge?: GraphEdge;
  depth: number;
  isCyclic?: boolean;
}

export interface ArchitectureResult {
  targetNode: GraphNode;
  dependencies: ArchitecturePathNode[][]; // What this module imports
  dependents: ArchitecturePathNode[][];   // What imports this module
  uniqueDependents: number;               // Count of unique modules that depend on this target
}

export interface PackageDependency {
  source: string;
  target: string;
}

export interface RepositoryArchitecture {
  packages: string[];
  edges: PackageDependency[];
  usedBy: Record<string, string[]>; // target -> source[]
  dependsOn: Record<string, string[]>; // source -> target[]
  cycles: PackageDependency[][];
  totals: {
    packages: number;
    modules: number;
    relationships: number;
  };
}

export class DependencyGraphTraversal {
  constructor(private graph: DependencyGraph) {}

  public resolveTarget(query: string): GraphNode[] {
    const nodes = this.graph.getNodes();
    // Match exact ID or path suffix
    const matches = nodes.filter(n => n.id === query || n.path.endsWith(query));
    return matches;
  }

  public analyze(targetId: string, options: ArchitectureOptions = {}): ArchitectureResult {
    const targetNode = this.graph.getNode(targetId);
    if (!targetNode) {
      throw new Error(`Module not found: ${targetId}`);
    }

    const maxDepth = options.maxDepth ?? 5;

    const dependencies = this.traverse(targetNode, maxDepth, "dependencies");
    const dependents = this.traverse(targetNode, maxDepth, "dependents");

    const uniqueDependentsSet = new Set<string>();
    for (const p of dependents) {
      uniqueDependentsSet.add(p[p.length - 1].node.id);
    }

    return {
      targetNode,
      dependencies,
      dependents,
      uniqueDependents: uniqueDependentsSet.size
    };
  }

  public analyzeRepository(repoRoot: string): RepositoryArchitecture {
    const nodes = this.graph.getNodes();
    const edges = this.graph.getEdges();

    // Map each node to a package
    const packageMap = new Map<string, string>();
    const packageCache = new Map<string, string>();

    for (const node of nodes) {
      let dir = path.dirname(path.resolve(repoRoot, node.path));
      let pkgName = "No package description provided.";

      while (dir.startsWith(repoRoot) && dir.length >= repoRoot.length) {
        if (packageCache.has(dir)) {
          pkgName = packageCache.get(dir)!;
          break;
        }

        const pkgPath = path.join(dir, "package.json");
        if (fs.existsSync(pkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            if (pkg.name) {
              pkgName = pkg.name;
              packageCache.set(dir, pkgName);
              break;
            }
          } catch (e) {
            // ignore
          }
          pkgName = path.basename(dir);
          packageCache.set(dir, pkgName);
          break;
        }
        dir = path.dirname(dir);
      }

      packageMap.set(node.id, pkgName);
    }

    const uniquePackages = Array.from(new Set(packageMap.values())).sort();

    const usedBy: Record<string, Set<string>> = {};
    const dependsOn: Record<string, Set<string>> = {};
    const pkgEdgesSet = new Set<string>();
    const pkgEdges: PackageDependency[] = [];

    uniquePackages.forEach(p => {
      usedBy[p] = new Set();
      dependsOn[p] = new Set();
    });

    for (const edge of edges) {
      const sourcePkg = packageMap.get(edge.source);
      const targetPkg = packageMap.get(edge.target);

      if (sourcePkg && targetPkg && sourcePkg !== targetPkg) {
        const edgeKey = `${sourcePkg}->${targetPkg}`;
        if (!pkgEdgesSet.has(edgeKey)) {
          pkgEdgesSet.add(edgeKey);
          pkgEdges.push({ source: sourcePkg, target: targetPkg });
          dependsOn[sourcePkg].add(targetPkg);
          usedBy[targetPkg].add(sourcePkg);
        }
      }
    }

    // Detect package-level cycles (strongly connected components or simple DFS)
    const cycles: PackageDependency[][] = [];
    const visited = new Set<string>();
    const stack = new Set<string>();
    const currentPath: string[] = [];

    const detectCycles = (pkg: string) => {
      visited.add(pkg);
      stack.add(pkg);
      currentPath.push(pkg);

      for (const targetPkg of Array.from(dependsOn[pkg])) {
        if (!visited.has(targetPkg)) {
          detectCycles(targetPkg);
        } else if (stack.has(targetPkg)) {
          // Found cycle
          const cycleStartIdx = currentPath.indexOf(targetPkg);
          const cyclePkgs = currentPath.slice(cycleStartIdx);
          cyclePkgs.push(targetPkg); // Close the loop

          const cycleEdges: PackageDependency[] = [];
          for (let i = 0; i < cyclePkgs.length - 1; i++) {
            cycleEdges.push({ source: cyclePkgs[i], target: cyclePkgs[i+1] });
          }

          // Deduplicate cycles representation by sorting or checking if similar exists
          // Since it's repository level, just recording it is fine
          cycles.push(cycleEdges);
        }
      }

      stack.delete(pkg);
      currentPath.pop();
    };

    uniquePackages.forEach(pkg => {
      if (!visited.has(pkg)) detectCycles(pkg);
    });

    const usedBySorted: Record<string, string[]> = {};
    const dependsOnSorted: Record<string, string[]> = {};

    uniquePackages.forEach(p => {
      usedBySorted[p] = Array.from(usedBy[p]).sort();
      dependsOnSorted[p] = Array.from(dependsOn[p]).sort();
    });

    return {
      packages: uniquePackages,
      edges: pkgEdges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)),
      usedBy: usedBySorted,
      dependsOn: dependsOnSorted,
      cycles,
      totals: {
        packages: uniquePackages.length,
        modules: nodes.length,
        relationships: pkgEdges.length
      }
    };
  }

  private traverse(
    startNode: GraphNode,
    maxDepth: number,
    direction: "dependencies" | "dependents"
  ): ArchitecturePathNode[][] {
    const paths: ArchitecturePathNode[][] = [];
    const queue: { currentPath: ArchitecturePathNode[], visitedIds: Set<string> }[] = [];

    queue.push({
      currentPath: [{ node: startNode, depth: 0 }],
      visitedIds: new Set([startNode.id])
    });

    // Deduplication of identical branches to avoid path explosion
    // We record stringified sub-paths: "nodeId1->nodeId2->..."
    const generatedSubPaths = new Set<string>();

    while (queue.length > 0) {
      const { currentPath, visitedIds } = queue.shift()!;
      const head = currentPath[currentPath.length - 1];

      // Build path signature for deduplication
      const pathSignature = currentPath.map(p => p.node.id).join("->");
      if (generatedSubPaths.has(pathSignature)) {
        continue;
      }
      generatedSubPaths.add(pathSignature);

      if (head.depth >= maxDepth) {
        if (currentPath.length > 1) paths.push(currentPath);
        continue;
      }

      const connectedNodes = direction === "dependencies"
        ? this.graph.getDependencies(head.node.id)
        : this.graph.getDependents(head.node.id);

      connectedNodes.sort((a, b) => a.id.localeCompare(b.id));

      let reachedEnd = true;

      for (const nextNode of connectedNodes) {
        const edge: GraphEdge = direction === "dependencies"
          ? { source: head.node.id, target: nextNode.id, type: "imports" }
          : { source: nextNode.id, target: head.node.id, type: "imports" };

        if (visitedIds.has(nextNode.id)) {
          paths.push([...currentPath, { node: nextNode, edge, depth: head.depth + 1, isCyclic: true }]);
          reachedEnd = false;
          continue; // Stop expanding on a cycle
        }

        reachedEnd = false;
        const nextVisited = new Set(visitedIds);
        nextVisited.add(nextNode.id);
        queue.push({
          currentPath: [...currentPath, { node: nextNode, edge, depth: head.depth + 1 }],
          visitedIds: nextVisited
        });
      }

      if (reachedEnd && currentPath.length > 1) {
        paths.push(currentPath);
      }
    }

    return paths;
  }
}
