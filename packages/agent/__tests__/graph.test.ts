import { describe, it, expect, vi } from "vitest";
import { createInvestigationGraph } from "../src/graph.js";
import { MockLLMAdapter } from "../src/llm/mock.js";
import { ToolRegistry } from "../src/tools/index.js";
import { registerCoreTools } from "../src/tools/core-tools.js";
import { InvestigationState } from "../src/state.js";

describe("LangGraph Investigation Engine", () => {
  const getRegistry = () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);
    return registry;
  };

  const getMockContext = () => ({
    storage: {
      getMetadata: vi.fn().mockResolvedValue({ indexedAt: new Date(), fileCount: 5 }),
      searchLexicalChunks: vi.fn().mockResolvedValue([{ id: "1", filePath: "user.ts", startLine: 1, endLine: 10, content: "class User {}" }]),
      getReferences: vi.fn().mockResolvedValue([]),
    } as any,
    repositoryId: "repo1"
  });

  const getInitialState = (question: string): InvestigationState => ({
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

  it("1-7. Full successful investigation loop (CONTINUE then STOP)", async () => {
    // We expect the following sequence of node invocations:
    // 1. Planner
    // 2. Investigator
    // 3. Reflection (CONTINUE)
    // 4. Investigator
    // 5. Reflection (STOP)
    // 6. Reporter
    const responses = [
      // 1. Planner
      JSON.stringify([{ id: "t1", description: "find user schema", status: "pending" }]),
      // 2. Investigator
      JSON.stringify({
        taskExecutions: [{
          taskId: "t1",
          toolName: "get_architecture",
          arguments: {},
          taskStatus: "in_progress"
        }]
      }),
      // 3. Reflection
      JSON.stringify({ decision: "CONTINUE", reason: "Need exact code" }),
      // 4. Investigator
      JSON.stringify({
        taskExecutions: [{
          taskId: "t1",
          toolName: "search_code",
          arguments: { query: "User" },
          taskStatus: "completed"
        }]
      }),
      // 5. Reflection
      JSON.stringify({ decision: "STOP", reason: "Found User class" }),
      // 6. Reporter
      "The User schema is defined as a class."
    ];

    const mockLLM = new MockLLMAdapter(responses);
    const registry = getRegistry();
    const context = getMockContext();
    
    const llms = { planner: mockLLM, investigator: mockLLM, reflection: mockLLM, reporter: mockLLM };
    const policy = { maxInvestigationRounds: 2, deadlineMs: 45000, maxLlmCalls: 10 };
    const graph = createInvestigationGraph(llms, registry, context, policy);
    
    const finalState = await graph.invoke(getInitialState("Where is User defined?"));
    
    // Planner check
    expect(finalState.tasks).toHaveLength(1);
    
    // Investigator check
    expect(finalState.toolHistory).toHaveLength(2);
    expect(finalState.toolHistory[0].tool).toBe("get_architecture");
    expect(finalState.toolHistory[1].tool).toBe("search_code");
    
    expect(finalState.evidence).toHaveLength(2);
    expect(finalState.evidence[1]).toContain("class User {}");
    
    // Reflection check
    expect(finalState.reflection.decision).toBe("STOP");
    
    // Reporter check
    expect(finalState.response).toBe("The User schema is defined as a class.");
    
    // No errors
    expect(finalState.error).toBeNull();
  });

  it("5, 6. Safety STOP reaches Reporter and terminates", async () => {
    const responses = [
      // 1. Planner
      JSON.stringify([{ id: "t1", description: "run", status: "pending" }]),
      // 2. Investigator (Repeated calls triggering safety limit)
      JSON.stringify({ taskExecutions: [{ taskId: "t1", toolName: "get_health", arguments: {}, taskStatus: "in_progress" }] }), // Investigator 1
      JSON.stringify({ decision: "CONTINUE", reason: "more" }), // Reflection 1
      JSON.stringify({ taskExecutions: [{ taskId: "t1", toolName: "get_health", arguments: {}, taskStatus: "in_progress" }] }), // Investigator 2
      // At Reflection 2, safety limit (maxRepeatedCalls: 2) kicks in and forces STOP
      // We don't provide a mock response for Reflection 2 because the node handles it natively without LLM
      // 3. Reporter (Final summary)
      "Aborted due to safety limit."
    ];

    const mockLLM = new MockLLMAdapter(responses);
    const registry = getRegistry();
    const context = getMockContext();
    
    const limits = { maxInvestigationRounds: 10, deadlineMs: 45000, maxLlmCalls: 10 };
    const llms = { planner: mockLLM, investigator: mockLLM, reflection: mockLLM, reporter: mockLLM };
    const graph = createInvestigationGraph(llms, registry, context, limits);
    
    const finalState = await graph.invoke(getInitialState("Test safety limit"));
    
    expect(finalState.toolHistory).toHaveLength(2);
    expect(finalState.reflection.decision).toBe("STOP");
    expect(finalState.reflection.isSafetyStop).toBe(true);
    expect(finalState.reflection.reason).toContain("Repeated identical tool calls detected");
    
    expect(finalState.response).toBe("Aborted due to safety limit.");
  });

  it("Planner error routes directly to reporter", async () => {
    // Planner returns invalid json, causing an error, skips investigator
    const responses = [
      "invalid json",
      "Summary: planner failed" // Reporter response
    ];
    const mockLLM = new MockLLMAdapter(responses);
    const registry = getRegistry();
    const context = getMockContext();
    const llms = { planner: mockLLM, investigator: mockLLM, reflection: mockLLM, reporter: mockLLM };
    const graph = createInvestigationGraph(llms, registry, context);
    
    const finalState = await graph.invoke(getInitialState("Test routing"));
    
    expect(finalState.error).toContain("Planner failed");
    expect(finalState.tasks).toHaveLength(0); // Didn't generate tasks
    expect(finalState.toolHistory).toHaveLength(0); // Didn't hit investigator
    expect(finalState.response).toBe("Summary: planner failed"); // Hit reporter
  });

  it("Planner returning zero tasks routes directly to reporter", async () => {
    const responses = [
      "[]", // Planner creates 0 tasks
      "Summary: 0 tasks" // Reporter response
    ];
    const mockLLM = new MockLLMAdapter(responses);
    const registry = getRegistry();
    const context = getMockContext();
    const llms = { planner: mockLLM, investigator: mockLLM, reflection: mockLLM, reporter: mockLLM };
    const graph = createInvestigationGraph(llms, registry, context);
    
    const finalState = await graph.invoke(getInitialState("Test routing 0 tasks"));
    
    expect(finalState.tasks).toHaveLength(0);
    expect(finalState.toolHistory).toHaveLength(0); // Didn't hit investigator
    expect(finalState.response).toBe("Summary: 0 tasks");
  });
});
