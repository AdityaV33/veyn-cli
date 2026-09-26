import { describe, it, expect } from "vitest";
import { AffectedResolver } from "../resolver.js";
import { GraphEdge } from "../../graph/index.js";

describe("AffectedResolver", () => {
  const resolver = new AffectedResolver();

  it("includes all explicitly changed files", () => {
    const affected = resolver.resolve({
      added: ["a.ts"],
      modified: ["b.ts"],
      deleted: ["c.ts"],
      unchanged: []
    }, []);
    expect(affected).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("resolves transitively affected dependents (A -> B -> C)", () => {
    // C changes. B depends on C. A depends on B.
    // Edge source -> target
    const edges: GraphEdge[] = [
      { source: "b.ts:import", target: "c.ts:export", type: "imports" },
      { source: "a.ts:import", target: "b.ts:export", type: "imports" }
    ];

    const affected = resolver.resolve({
      added: [],
      modified: ["c.ts"],
      deleted: [],
      unchanged: ["a.ts", "b.ts", "unrelated.ts"]
    }, edges);

    expect(affected).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("keeps unrelated files unaffected", () => {
    const edges: GraphEdge[] = [
      { source: "a.ts:1", target: "b.ts:1", type: "imports" },
      { source: "c.ts:1", target: "d.ts:1", type: "imports" } // disjoint
    ];

    const affected = resolver.resolve({
      added: [],
      modified: ["d.ts"],
      deleted: [],
      unchanged: ["a.ts", "b.ts", "c.ts"]
    }, edges);

    // d is modified, c depends on d => c, d affected.
    expect(affected).toEqual(["c.ts", "d.ts"]);
  });

  it("resolves transitively affected callers when a callee changes", () => {
    // b.ts changes. a.ts calls b.ts.
    // CallGraphEdge sourceId = caller (a.ts), targetId = callee (b.ts)
    const callEdges = [
      { sourceId: "a.ts:callerFunc", targetId: "b.ts:calleeFunc", kind: "direct" as const, line: 1 }
    ];

    const affected = resolver.resolve({
      added: [],
      modified: ["b.ts"],
      deleted: [],
      unchanged: ["a.ts"]
    }, [], callEdges);

    // a.ts is affected because it calls b.ts, and b.ts changed
    expect(affected).toEqual(["a.ts", "b.ts"]);
  });

  it("does not incorrectly propagate callee to caller (caller change does not invalidate callee)", () => {
    // a.ts changes. a.ts calls b.ts.
    const callEdges = [
      { sourceId: "a.ts:callerFunc", targetId: "b.ts:calleeFunc", kind: "direct" as const, line: 1 }
    ];

    const affected = resolver.resolve({
      added: [],
      modified: ["a.ts"],
      deleted: [],
      unchanged: ["b.ts"]
    }, [], callEdges);

    // b.ts is NOT affected. Changing caller doesn't break callee.
    expect(affected).toEqual(["a.ts"]);
  });
});
