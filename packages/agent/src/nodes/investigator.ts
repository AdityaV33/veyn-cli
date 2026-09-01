import { InvestigationState, ToolCallHistoryItem } from "../state.js";
import { LLMAdapter, extractJSON, truncateEvidence } from "../llm/index.js";
import { ToolRegistry, ToolContext } from "../tools/index.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

const investigatorResponseSchema = z.object({
  taskExecutions: z.array(z.object({
    taskId: z.string(),
    toolName: z.string(),
    arguments: z.record(z.string(), z.any()),
    taskStatus: z.enum(["in_progress", "completed", "failed"])
  }))
});

export function createInvestigatorNode(llm: LLMAdapter, registry: ToolRegistry, context: ToolContext) {
  return async (state: InvestigationState): Promise<Partial<InvestigationState>> => {
    // 1. Find the tasks to work on (all pending or in_progress)
    const pendingTasks = state.tasks.filter(t => t.status === "pending" || t.status === "in_progress");

    if (pendingTasks.length === 0) {
      return { error: "No pending or in-progress tasks available for investigation" };
    }

    const availableTools = registry.getAvailableTools();
    const systemPrompt = `You are the Investigator for an AI code investigation agent.
Your job is to select the most appropriate tools to make progress on the current pending tasks.
Do NOT guess or invent facts. Use the provided tools.
You can execute tools for multiple tasks at the same time if they are independent.
Provide exactly ONE tool call per task you wish to make progress on.

Available tools:
${JSON.stringify(availableTools, null, 2)}

You must output ONLY a JSON object matching this schema:
{
  "taskExecutions": [
    {
      "taskId": "string",
      "toolName": "string",
      "arguments": {},
      "taskStatus": "in_progress" | "completed" | "failed"
    }
  ]
}
`;

    const minimalHistory = state.toolHistory.map(h => ({
      tool: h.tool,
      args: h.args
    }));

    const budgetedEvidence = truncateEvidence(state.evidence);

    const userPrompt = `Question: ${state.question}
Pending Tasks: ${JSON.stringify(pendingTasks)}
Evidence so far: ${JSON.stringify(budgetedEvidence)}
Tool History: ${JSON.stringify(minimalHistory)}
`;

    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt)
    ]);

    try {
      const cleanResponse = extractJSON(response);
      const parsed = JSON.parse(cleanResponse);
      const invocation = investigatorResponseSchema.parse(parsed);

      const updatedTasks = [...state.tasks];
      const newHistoryItems: ToolCallHistoryItem[] = [];
      const newEvidence: string[] = [];

      // 2. Execute tools concurrently where independent
      await Promise.all(invocation.taskExecutions.map(async (exec) => {
        const tool = registry.getTool(exec.toolName);
        if (!tool) {
           newEvidence.push(`Investigator requested unknown tool: ${exec.toolName} for task ${exec.taskId}`);
           return;
        }

        try {
          // Validate arguments
          const validArgs = tool.schema.parse(exec.arguments);

          // Execute tool
          const result = await tool.execute(validArgs, context);
          
          newHistoryItems.push({
            tool: tool.name,
            args: validArgs,
            result,
            timestamp: new Date().toISOString()
          });

          newEvidence.push(`Result of ${tool.name}(${JSON.stringify(validArgs)}) for task ${exec.taskId}:\n${JSON.stringify(result)}`);
        } catch (e: any) {
          newEvidence.push(`Error executing ${tool.name} for task ${exec.taskId}: ${e.message}`);
        }

        const targetIndex = updatedTasks.findIndex(t => t.id === exec.taskId);
        if (targetIndex !== -1) {
          updatedTasks[targetIndex] = { ...updatedTasks[targetIndex], status: exec.taskStatus };
        }
      }));

      return {
        tasks: updatedTasks,
        toolHistory: newHistoryItems,
        evidence: newEvidence,
        investigationRounds: 1
      };

    } catch (e: any) {
      return { error: `Investigator failed: ${e.message}` };
    }
  };
}
