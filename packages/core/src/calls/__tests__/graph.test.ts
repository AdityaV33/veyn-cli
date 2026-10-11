import { describe, it, expect } from "vitest";
import { CallGraph } from "../graph.js";
import { CallRecord } from "../types.js";
import path from "path";

describe("CallGraph", () => {
  const repoRoot = "/mock/repo";

  const createCall = (sourcePath: string, sourceSym: string, targetPath: string, targetSym: string, line: number = 10): CallRecord => ({
    sourceFile: path.join(repoRoot, sourcePath),
    sourceSymbol: sourceSym,
    targetFile: path.join(repoRoot, targetPath),
    targetSymbol: targetSym,
    kind: "direct",
    line
  });

  it("builds nodes and edges deduplicated", () => {
    const graph = new CallGraph();
    const calls = [
      createCall("src/index.ts", "main", "src/auth.ts", "login", 12),
      createCall("src/index.ts", "main", "src/auth.ts", "login", 15) // duplicate source/target but different line
    ];
    graph.build(calls, { repositoryRoot: repoRoot });

    const nodes = graph.getNodes();
    expect(nodes).toHaveLength(2);
    
    // As per intentional behavior, deduplication does NOT include line number, so we expect 1 edge
    const edges = graph.getEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0].sourceId).toBe("src/index.ts:main");
    expect(edges[0].targetId).toBe("src/auth.ts:login");
    expect(edges[0].line).toBe(12); // keeps the line from the first encountered call
  });

  it("determines callees and callers", () => {
    const graph = new CallGraph();
    const calls = [
      createCall("src/index.ts", "main", "src/auth.ts", "login"),
      createCall("src/auth.ts", "login", "src/db.ts", "query")
    ];
    graph.build(calls, { repositoryRoot: repoRoot });

    const callers = graph.getCallers("src/auth.ts:login");
    expect(callers).toHaveLength(1);
    expect(callers[0].id).toBe("src/index.ts:main");

    const callees = graph.getCallees("src/auth.ts:login");
    expect(callees).toHaveLength(1);
    expect(callees[0].id).toBe("src/db.ts:query");
  });

  it("skips external/unresolved calls", () => {
    const graph = new CallGraph();
    const call: CallRecord = {
      sourceFile: path.join(repoRoot, "src/index.ts"),
      sourceSymbol: "main",
      targetFile: null,
      targetSymbol: "express",
      kind: "direct",
      line: 42
    };
    graph.build([call], { repositoryRoot: repoRoot });

    expect(graph.getNodes()).toHaveLength(0);
    expect(graph.getEdges()).toHaveLength(0);
  });

  it("normalizes repository-relative paths", () => {
    const graph = new CallGraph();
    const call = createCall("src/dir/a.ts", "foo", "src/dir/b.ts", "bar");
    graph.build([call], { repositoryRoot: repoRoot });

    const nodes = graph.getNodes();
    expect(nodes[0].filePath).toBe("src/dir/a.ts");
    expect(nodes[1].filePath).toBe("src/dir/b.ts");
  });

  it("serializes deterministically", () => {
    const graph1 = new CallGraph();
    graph1.build([
      createCall("src/a.ts", "foo", "src/b.ts", "bar"),
      createCall("src/c.ts", "baz", "src/d.ts", "qux"),
    ], { repositoryRoot: repoRoot });

    const graph2 = new CallGraph();
    graph2.build([
      createCall("src/c.ts", "baz", "src/d.ts", "qux"),
      createCall("src/a.ts", "foo", "src/b.ts", "bar"),
    ], { repositoryRoot: repoRoot });

    expect(JSON.stringify(graph1.toJSON())).toEqual(JSON.stringify(graph2.toJSON()));
  });
});
