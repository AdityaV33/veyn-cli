import { describe, it, expect } from "vitest";
import { createReporterNode } from "../src/nodes/reporter.js";
import { MockLLMAdapter } from "../src/llm/mock.js";
import { InvestigationState } from "../src/state.js";

describe("Reporter Node", () => {
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

  it("1. Synthesizes response based on evidence", async () => {
    const mockOutput = "Based on the evidence, the AuthService is in src/auth.ts.";
    const mockLLM = new MockLLMAdapter([mockOutput]);
    const reporter = createReporterNode(mockLLM);

    const state = getEmptyState("Where is AuthService?");
    state.evidence = ["Result of search_code: src/auth.ts contains AuthService"];
    
    const update = await reporter(state);
    
    expect(update.error).toBeUndefined();
    expect(update.response).toBe(mockOutput);
  });

  it("2. Handles safety limits gracefully in output prompt context", async () => {
    // Tests that reflection reason is properly handled (no crashes)
    const mockOutput = "Investigation halted due to safety limits. Found X but not Y.";
    const mockLLM = new MockLLMAdapter([mockOutput]);
    const reporter = createReporterNode(mockLLM);

    const state = getEmptyState("What does everything do?");
    state.evidence = ["Found X."];
    state.reflection = {
      decision: "STOP",
      reason: "SAFETY_LIMIT: Exceeded max calls",
      isSafetyStop: true
    };
    
    const update = await reporter(state);
    
    expect(update.error).toBeUndefined();
    expect(update.response).toBe(mockOutput);
  });

  it("3. Handles LLM adapter errors safely", async () => {
    const mockLLM = {
      invoke: async () => { throw new Error("Network error"); }
    };
    
    const reporter = createReporterNode(mockLLM);
    const result = await reporter(getEmptyState("Q"));
    expect(result).toEqual({ error: "Reporter failed to generate response: Network error" });
  });
});
