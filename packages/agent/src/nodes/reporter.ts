import { InvestigationState } from "../state.js";
import { LLMAdapter } from "../llm/index.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export function createReporterNode(llm: LLMAdapter) {
  return async (state: InvestigationState): Promise<Partial<InvestigationState>> => {
    const systemPrompt = `You are the Reporter node in an AI code investigation agent.
Your objective is to synthesize a final, clear, and comprehensive answer to the user's original question, based strictly on the evidence collected during the investigation.

CRITICAL RULES:
1. You may explain and synthesize the evidence, but you MUST NOT create, invent, or guess any new repository facts.
2. Only reference code, files, or symbols that appear in the gathered evidence.
3. If the evidence is insufficient to fully answer the question (or if the investigation stopped due to safety limits), clearly state what is known and what remains unknown.
4. Format your answer in clear GitHub-flavored markdown. Do not wrap the entire response in a JSON block; output raw markdown text.`;

    const userPrompt = `Question: ${state.question}

Tasks:
${JSON.stringify(state.tasks, null, 2)}

Evidence Collected:
${state.evidence.join("\n---\n")}

Reflection Reason for Stopping:
${state.reflection ? state.reflection.reason : "N/A"}
`;

    try {
      const response = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt)
      ]);

      return {
        response: response.trim()
      };
    } catch (e: any) {
      return { error: `Reporter failed to generate response: ${e.message}` };
    }
  };
}
