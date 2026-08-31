import { InvestigationState, ToolCallHistoryItem } from "../state.js";
import { LLMAdapter } from "../llm/index.js";
import { ToolRegistry, ToolContext } from "../tools/index.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

const invocationSchema = z.object({
  toolName: z.string(),
  arguments: z.record(z.string(), z.any()),
  taskStatus: z.enum(["in_progress", "completed", "failed"])
});

export function createInvestigatorNode(llm: LLMAdapter, registry: ToolRegistry, context: ToolContext) {
  return async (state: InvestigationState): Promise<Partial<InvestigationState>> => {
    // 1. Find the task to work on
    const taskIndex = state.tasks.findIndex(t => t.id === state.currentTask);
    const task = taskIndex !== -1 ? state.tasks[taskIndex] : state.tasks.find(t => t.status === "pending" || t.status === "in_progress");

    if (!task) {
      return { error: "No pending or in-progress tasks available for investigation" };
    }

    const availableTools = registry.getAvailableTools();
    const systemPrompt = `You are the Investigator for an AI code investigation agent.
Your job is to select the most appropriate tool to make progress on the current task.
Do NOT guess or invent facts. Use the provided tools.

Available tools:
${JSON.stringify(availableTools, null, 2)}

You must output ONLY a JSON object matching this schema:
{
  "toolName": "string",
  "arguments": {},
  "taskStatus": "in_progress" | "completed" | "failed"
}
`;

    const userPrompt = `Question: ${state.question}
Current Task: ${task.description}
Evidence so far: ${JSON.stringify(state.evidence)}
Tool History: ${JSON.stringify(state.toolHistory)}
`;

    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt)
    ]);

    try {
      const cleanResponse = response.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(cleanResponse);
      const invocation = invocationSchema.parse(parsed);

      const tool = registry.getTool(invocation.toolName);
      if (!tool) {
        return { error: `Investigator requested unknown tool: ${invocation.toolName}` };
      }

      // Validate arguments
      const validArgs = tool.schema.parse(invocation.arguments);

      // Execute tool
      const result = await tool.execute(validArgs, context);
      
      const newHistoryItem: ToolCallHistoryItem = {
        tool: tool.name,
        args: validArgs,
        result,
        timestamp: new Date().toISOString()
      };

      const newEvidence = `Result of ${tool.name}(${JSON.stringify(validArgs)}):\n${JSON.stringify(result)}`;
      
      // Update task status
      const updatedTasks = [...state.tasks];
      const targetIndex = taskIndex !== -1 ? taskIndex : state.tasks.findIndex(t => t.id === task.id);
      updatedTasks[targetIndex] = { ...task, status: invocation.taskStatus };

      return {
        currentTask: task.id,
        tasks: updatedTasks,
        toolHistory: [newHistoryItem],
        evidence: [newEvidence]
      };

    } catch (e: any) {
      return { error: `Investigator failed: ${e.message}` };
    }
  };
}
