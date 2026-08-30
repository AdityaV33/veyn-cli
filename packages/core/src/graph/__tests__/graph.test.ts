import { describe, it, expect } from "vitest";
import { buildDependencyGraph } from "../builder.js";
import { ImportRecord } from "../../dependencies/index.js";
import path from "path";

describe("DependencyGraph", () => {
  const repoRoot = "/mock/repo";

  const createImport = (source: string, target: string | null, specifier: string = target || "external"): ImportRecord => ({
    sourceFile: path.join(repoRoot, source),
    moduleSpecifier: specifier,
    resolvedPath: target ? path.join(repoRoot, target) : null,
    kind: "static",
  });

  it("Test 1 & 2 - node creation and dependency edge", () => {
    const imports = [createImport("src/index.ts", "src/auth.ts")];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    
    expect(graph.hasNode("src/index.ts")).toBe(true);
    expect(graph.hasNode("src/auth.ts")).toBe(true);
    
    const edges = graph.getEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ source: "src/index.ts", target: "src/auth.ts", type: "imports" });
  });

  it("Test 3 - multiple dependencies", () => {
    const imports = [
      createImport("src/index.ts", "src/auth.ts"),
      createImport("src/index.ts", "src/utils.ts")
    ];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    expect(graph.getEdges()).toHaveLength(2);
  });

  it("Test 4 - reverse dependencies", () => {
    const imports = [createImport("src/index.ts", "src/auth.ts")];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    const dependents = graph.getDependents("src/auth.ts");
    
    expect(dependents).toHaveLength(1);
    expect(dependents[0].id).toBe("src/index.ts");
  });

  it("Test 5 - direct dependencies", () => {
    const imports = [
      createImport("src/index.ts", "src/auth.ts"),
      createImport("src/auth.ts", "src/db.ts")
    ];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    
    const deps = graph.getDependencies("src/index.ts");
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe("src/auth.ts");
  });

  it("Test 6 - duplicate imports", () => {
    const imports = [
      createImport("src/index.ts", "src/auth.ts", "./auth"),
      createImport("src/index.ts", "src/auth.ts", "./auth/index")
    ];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    expect(graph.getEdges()).toHaveLength(1); // Deduplicated edge
  });

  it("Test 7 - unresolved/external imports", () => {
    const imports = [createImport("src/index.ts", null, "express")];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    
    expect(graph.getNodes()).toHaveLength(1); // Only index.ts exists
    expect(graph.getEdges()).toHaveLength(0);
  });

  it("Test 8 - deterministic ordering", () => {
    const imports1 = [
      createImport("src/a.ts", "src/b.ts"),
      createImport("src/c.ts", "src/d.ts"),
    ];
    const imports2 = [
      createImport("src/c.ts", "src/d.ts"),
      createImport("src/a.ts", "src/b.ts"),
    ];
    
    const graph1 = buildDependencyGraph([], imports1, { repositoryRoot: repoRoot });
    const graph2 = buildDependencyGraph([], imports2, { repositoryRoot: repoRoot });
    
    expect(JSON.stringify(graph1.toJSON())).toEqual(JSON.stringify(graph2.toJSON()));
  });

  it("Test 9 - deterministic IDs", () => {
    const imports = [createImport("src/index.ts", "src/auth.ts")];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    
    expect(graph.getNode("src/index.ts")).toBeDefined();
    expect(graph.getNode("src/index.ts")!.path).toBe("src/index.ts");
  });

  it("Test 10 - serialization", () => {
    const imports = [createImport("src/index.ts", "src/auth.ts")];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    
    const snapshot = graph.toJSON();
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.nodes[0].id).toBe("src/auth.ts"); // alphabetically sorted by path
    expect(snapshot.nodes[1].id).toBe("src/index.ts");
    expect(snapshot.edges[0]).toEqual({ source: "src/index.ts", target: "src/auth.ts", type: "imports" });
  });

  it("Test 11 - no recursive traversal", () => {
    const imports = [
      createImport("src/index.ts", "src/auth.ts"),
      createImport("src/auth.ts", "src/db.ts")
    ];
    const graph = buildDependencyGraph([], imports, { repositoryRoot: repoRoot });
    
    const deps = graph.getDependencies("src/index.ts");
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe("src/auth.ts"); // Ensure 'db.ts' is NOT returned
  });
});
