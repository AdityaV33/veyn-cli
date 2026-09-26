import { InvestigationState, InvestigationTask } from "../state.js";
import { LLMAdapter, extractJSON } from "../llm/index.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

const taskSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "failed"])
});

const plannerOutputSchema = z.object({
  tasks: z.array(taskSchema)
});

export function createPlannerNode(llm: LLMAdapter) {
  return async (state: InvestigationState): Promise<Partial<InvestigationState>> => {
    if (!state.question) {
      return { error: "No question provided to Planner" };
    }

    const systemPrompt = `You are the Planner for an AI code investigation agent.
Your job is to analyze the user's question and break it down into a highly targeted list of 2-3 investigation tasks.
Do NOT output a granular checklist. Prioritize evidence that directly answers the question.

The agent has the following actions available:
- search_code: Search for code snippets matching a lexical query
- find_references: Find exact references to a symbol by its canonical targetId (e.g. filePath:symbolName)
- trace_function: Get functions that call this function, or functions called by it
- find_dependencies: Find file-level dependencies (imports/exports)
- get_symbol_context: Get the metadata and chunk content for a specific symbol
- get_architecture: Get high level file/module counts and graph metrics
- get_health: Get index health metadata

You MUST produce at least one task, but aim for no more than 3 high-value independent tasks.
Output ONLY a JSON object matching this schema:
{
  "tasks": [
    {
      "id": "string",
      "description": "string",
      "status": "pending"
    }
  ]
}
Do not include markdown code blocks or conversational text.`;

    const userPrompt = `Question: ${state.question}`;

    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt)
    ]);

    try {
      const cleanResponse = extractJSON(response);
      
      const parsed = JSON.parse(cleanResponse);
      const validatedPayload = plannerOutputSchema.parse(parsed);
      
      return { tasks: validatedPayload.tasks };
    } catch (e: any) {
      return { error: `Planner failed to generate valid structured tasks: ${e.message}` };
    }
  };
}
