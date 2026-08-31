import { InvestigationState, InvestigationTask } from "../state.js";
import { LLMAdapter } from "../llm/index.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

const taskSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "failed"])
});

const plannerOutputSchema = z.array(taskSchema);

export function createPlannerNode(llm: LLMAdapter) {
  return async (state: InvestigationState): Promise<Partial<InvestigationState>> => {
    if (!state.question) {
      return { error: "No question provided to Planner" };
    }

    const systemPrompt = `You are the Planner for an AI code investigation agent.
Your job is to analyze the user's question and break it down into a structured list of investigation tasks.
The agent has tools to search code, trace functions, find dependencies, etc.
Output ONLY a JSON array of tasks. Do not include markdown code blocks or conversational text.
Each task must have an 'id', a 'description', and a 'status' (which should initially be 'pending').`;

    const userPrompt = `Question: ${state.question}`;

    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt)
    ]);

    try {
      // Remove any potential markdown formatting the LLM might have included despite instructions
      const cleanResponse = response.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
      
      const parsed = JSON.parse(cleanResponse);
      const validatedTasks = plannerOutputSchema.parse(parsed);
      
      return { tasks: validatedTasks };
    } catch (e: any) {
      return { error: `Planner failed to generate valid structured tasks: ${e.message}` };
    }
  };
}
