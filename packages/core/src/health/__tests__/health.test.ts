import { describe, it, expect } from "vitest";
import { HealthAnalyzer } from "../health.js";
import { MongoIndexStorage } from "../../persistence/index.js";
import { GraphNode, GraphEdge } from "../../graph/index.js";
import { CallGraphEdge } from "../../calls/index.js";
import { SymbolRecord } from "../../symbols/index.js";
import { ScannedFile } from "../../scanner/index.js";

describe("HealthAnalyzer", () => {
  it("detects circular dependencies", async () => {
    const mockStorage = {
      getFiles: async () => [] as ScannedFile[],
      getSymbols: async () => [] as SymbolRecord[],
      getCallNodes: async () => [],
      getCallEdges: async () => [] as CallGraphEdge[],
      getDependencyNodes: async () => [
        { id: "a.ts", type: "file", path: "a.ts" },
        { id: "b.ts", type: "file", path: "b.ts" },
        { id: "c.ts", type: "file", path: "c.ts" }
      ] as GraphNode[],
      getDependencyEdges: async () => [
        { source: "a.ts", target: "b.ts", type: "imports" },
        { source: "b.ts", target: "c.ts", type: "imports" },
        { source: "c.ts", target: "a.ts", type: "imports" }
      ] as GraphEdge[]
    } as unknown as MongoIndexStorage;

    const analyzer = new HealthAnalyzer(mockStorage, "repo-id", "/absolute/repo");
    const report = await analyzer.analyze();

    expect(report.circularDependencies.length).toBeGreaterThan(0);
    expect(report.circularDependencies[0]).toContain("a.ts");
    expect(report.circularDependencies[0]).toContain("b.ts");
    expect(report.circularDependencies[0]).toContain("c.ts");
  });

  it("detects dead code signals", async () => {
    const mockStorage = {
      getFiles: async () => [] as ScannedFile[],
      getCallNodes: async () => [],
      getDependencyNodes: async () => [],
      getDependencyEdges: async () => [],
      getSymbols: async () => [
        { name: "usedFunc", kind: "function", filePath: "/absolute/repo/src/used.ts", startLine: 1, endLine: 2 },
        { name: "deadFunc", kind: "function", filePath: "/absolute/repo/src/dead.ts", startLine: 1, endLine: 2 }
      ] as SymbolRecord[],
      getCallEdges: async () => [
        { sourceId: "src/other.ts:main", targetId: "src/used.ts:usedFunc", line: 1 }
      ] as CallGraphEdge[]
    } as unknown as MongoIndexStorage;

    const analyzer = new HealthAnalyzer(mockStorage, "repo-id", "/absolute/repo");
    const report = await analyzer.analyze();

    expect(report.deadCodeSignals).toHaveLength(1);
    expect(report.deadCodeSignals[0]).toContain("deadFunc");
    expect(report.deadCodeSignals[0]).not.toContain("usedFunc");
  });
  
  it("detects structural issues (isolated modules)", async () => {
    const mockStorage = {
      getFiles: async () => [] as ScannedFile[],
      getSymbols: async () => [] as SymbolRecord[],
      getCallNodes: async () => [],
      getCallEdges: async () => [],
      getDependencyNodes: async () => [
        { id: "isolated.ts", type: "file", path: "isolated.ts" }
      ] as GraphNode[],
      getDependencyEdges: async () => []
    } as unknown as MongoIndexStorage;

    const analyzer = new HealthAnalyzer(mockStorage, "repo-id", "/absolute/repo");
    const report = await analyzer.analyze();

    expect(report.structuralIssues).toHaveLength(1);
    expect(report.structuralIssues[0]).toContain("isolated.ts");
  });
});
