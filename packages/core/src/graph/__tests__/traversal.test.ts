import { describe, it, expect, vi } from "vitest";
import { DependencyGraph } from "../graph.js";
import { DependencyGraphTraversal } from "../traversal.js";
import { GraphNode, GraphEdge } from "../types.js";
import * as fs from "node:fs";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn()
  };
});

describe("DependencyGraphTraversal", () => {
  it("traces dependencies and dependents cleanly without cycles", () => {
    const nodes: GraphNode[] = [
      { id: "app.ts", type: "file", path: "app.ts" },
      { id: "auth.ts", type: "file", path: "auth.ts" },
      { id: "token.ts", type: "file", path: "token.ts" },
      { id: "nested/auth.ts", type: "file", path: "nested/auth.ts" }
    ];

    const edges: GraphEdge[] = [
      { source: "app.ts", target: "auth.ts", type: "imports" },
      { source: "auth.ts", target: "token.ts", type: "imports" },
      // add a cycle
      { source: "token.ts", target: "app.ts", type: "imports" }
    ];

    const graph = new DependencyGraph();
    nodes.forEach(n => graph.addNode(n));
    edges.forEach(e => graph.addEdge(e));

    const traversal = new DependencyGraphTraversal(graph);
    
    // Test resolve
    const ambiguousTarget = traversal.resolveTarget("auth.ts");
    expect(ambiguousTarget).toHaveLength(2); // auth.ts and nested/auth.ts

    const target = traversal.resolveTarget("nested/auth.ts");
    expect(target).toHaveLength(1);
    
    // Test analyze
    const result = traversal.analyze("auth.ts", { maxDepth: 5 });

    // Dependencies: auth.ts -> token.ts -> app.ts -> auth.ts (cycle stops)
    expect(result.dependencies.length).toBeGreaterThan(0);
    const downPath = result.dependencies[0];
    expect(downPath.length).toBe(4);
    expect(downPath[0].node.id).toBe("auth.ts");
    expect(downPath[1].node.id).toBe("token.ts");
    expect(downPath[2].node.id).toBe("app.ts");
    expect(downPath[3].node.id).toBe("auth.ts"); // Cycle detected
    expect(downPath[3].isCyclic).toBe(true);

    // Dependents: auth.ts <- app.ts <- token.ts <- auth.ts (cycle stops)
    expect(result.dependents.length).toBeGreaterThan(0);
    const upPath = result.dependents[0];
    expect(upPath.length).toBe(4);
    expect(upPath[0].node.id).toBe("auth.ts");
    expect(upPath[1].node.id).toBe("app.ts");
    expect(upPath[2].node.id).toBe("token.ts");
    expect(upPath[3].node.id).toBe("auth.ts"); // Cycle detected
    expect(upPath[3].isCyclic).toBe(true);
  });

  it("handles missing targets cleanly", () => {
    const graph = new DependencyGraph();
    const traversal = new DependencyGraphTraversal(graph);
    
    expect(() => traversal.analyze("missing.ts")).toThrow("Module not found: missing.ts");
  });

  it("deduplicates identical paths and shared dependencies not falsely reported as cycles", () => {
    const nodes: GraphNode[] = [
      { id: "main.ts", type: "file", path: "main.ts" },
      { id: "a.ts", type: "file", path: "a.ts" },
      { id: "b.ts", type: "file", path: "b.ts" },
      { id: "shared.ts", type: "file", path: "shared.ts" }
    ];

    const edges: GraphEdge[] = [
      { source: "main.ts", target: "a.ts", type: "imports" },
      { source: "main.ts", target: "b.ts", type: "imports" },
      { source: "a.ts", target: "shared.ts", type: "imports" },
      { source: "b.ts", target: "shared.ts", type: "imports" }
    ];

    const graph = new DependencyGraph();
    nodes.forEach(n => graph.addNode(n));
    edges.forEach(e => graph.addEdge(e));

    const traversal = new DependencyGraphTraversal(graph);
    const result = traversal.analyze("main.ts", { maxDepth: 5 });

    // It should have two distinct paths, neither marked cyclic
    expect(result.dependencies).toHaveLength(2);
    expect(result.dependencies[0][2].node.id).toBe("shared.ts");
    expect(result.dependencies[0][2].isCyclic).toBeUndefined();
    expect(result.dependencies[1][2].node.id).toBe("shared.ts");
    expect(result.dependencies[1][2].isCyclic).toBeUndefined();
  });

  it("analyzes repository handling packages, totals, single-package, and root", () => {
    // Mock fs for package.json
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (p.toString().includes("packages/foo/package.json")) return true;
      if (p.toString().includes("packages/bar/package.json")) return true;
      return false;
    });

    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (p.toString().includes("packages/foo/package.json")) return JSON.stringify({ name: "@veyn/foo" });
      if (p.toString().includes("packages/bar/package.json")) return JSON.stringify({ name: "@veyn/bar" });
      return "";
    });

    const nodes: GraphNode[] = [
      { id: "packages/foo/src/index.ts", type: "file", path: "packages/foo/src/index.ts" },
      { id: "packages/bar/src/index.ts", type: "file", path: "packages/bar/src/index.ts" },
      { id: "src/root.ts", type: "file", path: "src/root.ts" } // Root / single-package fallback
    ];

    const edges: GraphEdge[] = [
      { source: "src/root.ts", target: "packages/foo/src/index.ts", type: "imports" },
      { source: "packages/foo/src/index.ts", target: "packages/bar/src/index.ts", type: "imports" },
      { source: "packages/bar/src/index.ts", target: "packages/foo/src/index.ts", type: "imports" } // Cycle
    ];

    const graph = new DependencyGraph();
    nodes.forEach(n => graph.addNode(n));
    edges.forEach(e => graph.addEdge(e));

    const traversal = new DependencyGraphTraversal(graph);
    // Dummy repoRoot so dir starts with it
    const repoRoot = "/mock/repo";
    // We need to modify node paths to be relative to root for the test to pass the path manipulation
    graph.getNodes().forEach(n => n.path = n.path); // keep same

    const result = traversal.analyzeRepository(repoRoot);

    expect(result.totals.packages).toBe(result.packages.length);
    // packages: "@veyn/foo", "@veyn/bar", "src" (fallback since repoRoot won't match exactly or will fallback to dirname)
    expect(result.packages.length).toBeGreaterThan(0);
    expect(result.totals.modules).toBe(3);
    
    // Cycle between foo and bar
    expect(result.cycles.length).toBeGreaterThan(0);
  });
});
