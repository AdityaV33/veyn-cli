import { describe, it, expect } from "vitest";
import { createPlannerNode } from "../src/nodes/planner.js";
import { MockLLMAdapter } from "../src/llm/mock.js";
import { InvestigationState } from "../src/state.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

describe("Planner Node", () => {
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

  it("1 & 5 & 7. returns valid structured output and updates state, using MockLLMAdapter", async () => {
    const validJson = JSON.stringify([
      { id: "task-1", description: "Search for auth logic", status: "pending" }
    ]);
    const mock = new MockLLMAdapter([validJson]);
    const planner = createPlannerNode(mock);
    
    const state = getEmptyState("Where is auth?");
    const update = await planner(state);

    expect(update.error).toBeUndefined();
    expect(update.tasks).toBeDefined();
    expect(update.tasks).toHaveLength(1);
    expect(update.tasks![0].description).toBe("Search for auth logic");
    
    // Ensure System/Human messages were sent properly
    expect(mock.invokedMessages.length).toBe(1);
    expect(mock.invokedMessages[0][0]).toBeInstanceOf(SystemMessage);
    expect(mock.invokedMessages[0][1]).toBeInstanceOf(HumanMessage);
    expect(mock.invokedMessages[0][1].content).toContain("Where is auth?");
    
    // Ensure SystemMessage has tools
    const sysContent = mock.invokedMessages[0][0].content as string;
    expect(sysContent).toContain("search_code");
    expect(sysContent).toContain("get_architecture");
  });

  it("2. returns multiple investigation tasks and handles markdown backticks", async () => {
    const multipleTasksJson = `\`\`\`json
    [
      { "id": "t1", "description": "Find express setup", "status": "pending" },
      { "id": "t2", "description": "Find user routes", "status": "pending" }
    ]
    \`\`\``;
    const mock = new MockLLMAdapter([multipleTasksJson]);
    const planner = createPlannerNode(mock);
    
    const update = await planner(getEmptyState("How does routing work?"));

    expect(update.error).toBeUndefined();
    expect(update.tasks).toHaveLength(2);
    expect(update.tasks![1].id).toBe("t2");
  });

  it("3. handles empty/invalid model output gracefully", async () => {
    const mock = new MockLLMAdapter(["This is just conversational text, no JSON."]);
    const planner = createPlannerNode(mock);
    
    const update = await planner(getEmptyState("Investigate stuff"));

    expect(update.tasks).toBeUndefined();
    expect(update.error).toBeDefined();
    expect(update.error).toContain("Planner failed to generate valid structured tasks");
    expect(update.error).toContain("Unexpected token");
  });

  it("4. handles malformed task structure (Zod validation)", async () => {
    const malformedJson = JSON.stringify([
      { id: "t1", wrongField: "no description", status: "not_a_valid_status" }
    ]);
    const mock = new MockLLMAdapter([malformedJson]);
    const planner = createPlannerNode(mock);
    
    const update = await planner(getEmptyState("Do something"));

    expect(update.tasks).toBeUndefined();
    expect(update.error).toBeDefined();
    expect(update.error).toContain("Planner failed to generate valid structured tasks");
  });

  it("6. Planner does not access Core/repository facts directly", async () => {
    // The planner only takes InvestigationState and returns Partial<InvestigationState>
    // It doesn't receive a MongoDB or Core instance, enforcing architectural isolation.
    const mock = new MockLLMAdapter(["[]"]);
    const planner = createPlannerNode(mock);
    const update = await planner(getEmptyState("Hello"));
    expect(update.tasks).toEqual([]);
    // The type signature itself `(state: InvestigationState) => Partial<InvestigationState>`
    // prevents it from accessing anything besides the state and the injected LLMAdapter.
  });

  it("returns error if question is missing", async () => {
    const mock = new MockLLMAdapter(["[]"]);
    const planner = createPlannerNode(mock);
    const update = await planner(getEmptyState(""));
    expect(update.error).toBe("No question provided to Planner");
  });
});
