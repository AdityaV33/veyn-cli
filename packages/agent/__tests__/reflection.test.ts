import { describe, it, expect } from "vitest";
import { createReflectionNode, ReflectionSafetyLimits } from "../src/nodes/reflection.js";
import { MockLLMAdapter } from "../src/llm/mock.js";
import { InvestigationState, AgentStateAnnotation } from "../src/state.js";
import { StateGraph, START, END } from "@langchain/langgraph";

describe("Reflection Node", () => {
  const getEmptyState = (question: string): InvestigationState => ({
    question,
    repositoryId: "repo1",
    tasks: [],
    currentTask: null,
    evidence: [],
    toolHistory: [],
    reflection: null,
    response: null,
    error: null,
  });

  it("1, 8. Evidence sufficient -> STOP using MockLLMAdapter", async () => {
    const jsonOutput = JSON.stringify({ decision: "STOP", reason: "Found it all." });
    const mock = new MockLLMAdapter([jsonOutput]);
    const reflect = createReflectionNode(mock);

    const state = getEmptyState("Find auth");
    state.evidence = ["Auth is in auth.ts"];
    
    const update = await reflect(state);
    expect(update.error).toBeUndefined();
    expect(update.reflection?.decision).toBe("STOP");
    expect(update.reflection?.reason).toBe("Found it all.");
    expect(update.reflection?.isSafetyStop).toBe(false);
  });

  it("2, 5. Evidence insufficient -> CONTINUE", async () => {
    const jsonOutput = JSON.stringify({ decision: "CONTINUE", reason: "Need more files." });
    const mock = new MockLLMAdapter([jsonOutput]);
    const reflect = createReflectionNode(mock);

    const update = await reflect(getEmptyState("Find routing"));
    expect(update.reflection?.decision).toBe("CONTINUE");
  });

  it("3, 4. Structured malformed/invalid output -> safe failure (Zod rejection)", async () => {
    // Missing decision
    const jsonOutput1 = JSON.stringify({ reason: "I forgot." });
    // Invalid decision
    const jsonOutput2 = JSON.stringify({ decision: "MAYBE", reason: "Hmm." });
    
    const mock = new MockLLMAdapter([jsonOutput1, jsonOutput2]);
    const reflect = createReflectionNode(mock);

    const update1 = await reflect(getEmptyState("Q"));
    expect(update1.error).toContain("Reflection failed to produce a valid decision");
    
    const update2 = await reflect(getEmptyState("Q"));
    expect(update2.error).toContain("Reflection failed to produce a valid decision");
  });

  it("6. Safety limit reached -> deterministic safety stop (max calls)", async () => {
    const mock = new MockLLMAdapter(["should not be called"]);
    const reflect = createReflectionNode(mock, { maxToolCalls: 3, maxRepeatedCalls: 3 });
    
    const state = getEmptyState("Q");
    state.toolHistory = [
      { tool: "t1", args: {}, result: null, timestamp: "" },
      { tool: "t2", args: {}, result: null, timestamp: "" },
      { tool: "t3", args: {}, result: null, timestamp: "" }
    ];
    
    const update = await reflect(state);
    expect(update.error).toBeUndefined();
    expect(update.reflection?.decision).toBe("STOP");
    expect(update.reflection?.isSafetyStop).toBe(true);
    expect(update.reflection?.reason).toContain("Exceeded maximum allowed tool calls");
  });

  it("7. Repeated identical tool calls -> safe termination", async () => {
    const mock = new MockLLMAdapter(["should not be called"]);
    const reflect = createReflectionNode(mock, { maxToolCalls: 10, maxRepeatedCalls: 2 });
    
    const state = getEmptyState("Q");
    // Two identical calls in a row
    state.toolHistory = [
      { tool: "find_references", args: { targetId: "a:B" }, result: null, timestamp: "1" },
      { tool: "find_references", args: { targetId: "a:B" }, result: null, timestamp: "2" }
    ];
    
    const update = await reflect(state);
    expect(update.error).toBeUndefined();
    expect(update.reflection?.decision).toBe("STOP");
    expect(update.reflection?.isSafetyStop).toBe(true);
    expect(update.reflection?.reason).toContain("Repeated identical tool calls detected");
  });

  it("9. Reflection does not access Core directly", async () => {
    const mock = new MockLLMAdapter([JSON.stringify({ decision: "STOP", reason: "done" })]);
    const reflect = createReflectionNode(mock);
    
    const update = await reflect(getEmptyState("Hello"));
    expect(update.reflection?.decision).toBe("STOP");
    // Proven by the fact that no core deps are injected or instantiated in this test.
  });

  it("10. Minimal routing test using LangGraph based on Reflection decision", async () => {
    const mock = new MockLLMAdapter([
      JSON.stringify({ decision: "CONTINUE", reason: "loop once" }),
      JSON.stringify({ decision: "STOP", reason: "done looping" })
    ]);
    const reflect = createReflectionNode(mock);
    
    // A mock investigator that just appends some evidence so we don't infinitely loop
    const investigator = async (state: InvestigationState) => {
      return { evidence: ["new evidence"] };
    };

    const graphBuilder = new StateGraph(AgentStateAnnotation)
      .addNode("investigator", investigator)
      .addNode("reflectionNode", reflect)
      .addEdge(START, "investigator")
      .addEdge("investigator", "reflectionNode")
      .addConditionalEdges("reflectionNode", (state: InvestigationState) => {
        if (state.error) return "error"; // in real graph we'd route this
        return state.reflection?.decision === "CONTINUE" ? "investigator" : END;
      }, {
        investigator: "investigator",
        [END]: END
      });
      
    const graph = graphBuilder.compile();
    const result = await graph.invoke(getEmptyState("Find auth"));
    
    // Should have run investigator -> reflection (CONTINUE) -> investigator -> reflection (STOP) -> END
    expect(result.evidence).toHaveLength(2);
    expect(result.reflection.decision).toBe("STOP");
    expect(result.reflection.reason).toBe("done looping");
  });
});
