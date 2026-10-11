import { describe, it, expect } from "vitest";
import { CallGraph } from "../graph.js";
import { CallGraphTraversal } from "../traversal.js";
import { CallRecord } from "../types.js";
import { SymbolRecord } from "../../symbols/index.js";

describe("CallGraphTraversal", () => {
  it("traces upstream and downstream cleanly without cycles", () => {
    const calls: CallRecord[] = [
      { sourceFile: "/mock/app.ts", sourceSymbol: "authenticate", targetFile: "/mock/auth.ts", targetSymbol: "validateToken", kind: "direct", line: 4 },
      { sourceFile: "/mock/app.ts", sourceSymbol: "authenticate", targetFile: "/mock/auth.ts", targetSymbol: "validateToken", kind: "direct", line: 5 }, // duplicate
      { sourceFile: "/mock/auth.ts", sourceSymbol: "validateToken", targetFile: "/mock/token.ts", targetSymbol: "decodeToken", kind: "direct", line: 4 },
      // add a cycle
      { sourceFile: "/mock/token.ts", sourceSymbol: "decodeToken", targetFile: "/mock/app.ts", targetSymbol: "authenticate", kind: "direct", line: 10 }
    ];

    const graph = new CallGraph();
    graph.build(calls, { repositoryRoot: "/mock" });

    const traversal = new CallGraphTraversal(graph);
    
    const allSymbols: SymbolRecord[] = [
      { filePath: "app.ts", name: "authenticate", kind: "function", startLine: 2, endLine: 4 },
      { filePath: "auth.ts", name: "validateToken", kind: "function", startLine: 2, endLine: 4 },
      { filePath: "token.ts", name: "decodeToken", kind: "function", startLine: 2, endLine: 4 },
      { filePath: "other.ts", name: "validateToken", kind: "function", startLine: 2, endLine: 2 }
    ];

    // Test resolve
    const ambiguousTarget = traversal.resolveTarget("validateToken", allSymbols);
    expect(ambiguousTarget).toHaveLength(2); // auth.ts and other.ts

    const target = traversal.resolveTarget("auth.ts:validateToken", allSymbols);
    expect(target).toHaveLength(1);

    // Test trace
    const result = traversal.trace(target[0], { maxDepth: 5 });

    // Downstream: validateToken -> decodeToken -> authenticate -> validateToken (cycle stops)
    expect(result.downstream.length).toBeGreaterThan(0);
    const downPath = result.downstream[0];
    expect(downPath.length).toBe(4);
    expect(downPath[0].node.id).toBe("auth.ts:validateToken");
    expect(downPath[1].node.id).toBe("token.ts:decodeToken");
    expect(downPath[1].edge?.line).toBe(4);
    expect(downPath[2].node.id).toBe("app.ts:authenticate");
    expect(downPath[2].edge?.line).toBe(10);
    expect(downPath[3].node.id).toBe("auth.ts:validateToken"); // Cycle detected

    // Upstream: validateToken <- authenticate <- decodeToken <- validateToken (cycle stops)
    expect(result.upstream.length).toBeGreaterThan(0);
    const upPath = result.upstream[0];
    expect(upPath.length).toBe(4);
    expect(upPath[0].node.id).toBe("auth.ts:validateToken");
    expect(upPath[1].node.id).toBe("app.ts:authenticate");
    expect(upPath[1].edge?.line).toBe(4); // from the first occurrence!
    expect(upPath[2].node.id).toBe("token.ts:decodeToken");
    expect(upPath[3].node.id).toBe("auth.ts:validateToken"); // Cycle detected

    // Test disconnected node trace
    const otherTarget = traversal.resolveTarget("other.ts:validateToken", allSymbols);
    const otherResult = traversal.trace(otherTarget[0], { maxDepth: 5 });
    expect(otherResult.downstream).toHaveLength(0);
    expect(otherResult.upstream).toHaveLength(0);
    expect(otherResult.targetNode.id).toBe("other.ts:validateToken");
  });
});
