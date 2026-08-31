import { InvestigationState, ReflectionResult } from "../state.js";
import { LLMAdapter } from "../llm/index.js";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";

const reflectionSchema = z.object({
  decision: z.enum(["CONTINUE", "STOP"]),
  reason: z.string()
});

export interface ReflectionSafetyLimits {
  maxToolCalls: number;
  maxRepeatedCalls: number;
}

const DEFAULT_LIMITS: ReflectionSafetyLimits = {
  maxToolCalls: 15,
  maxRepeatedCalls: 3
};

export function createReflectionNode(llm: LLMAdapter, limits: ReflectionSafetyLimits = DEFAULT_LIMITS) {
  return async (state: InvestigationState): Promise<Partial<InvestigationState>> => {
    const history = state.toolHistory || [];
    
    // 1. Check safety limits first
    if (history.length >= limits.maxToolCalls) {
      return {
        reflection: {
          decision: "STOP",
          reason: `SAFETY_LIMIT: Exceeded maximum allowed tool calls (${limits.maxToolCalls}).`,
          isSafetyStop: true
        }
      };
    }

    if (history.length >= limits.maxRepeatedCalls) {
      // Check last N calls to see if they are identical
      const lastN = history.slice(-limits.maxRepeatedCalls);
      const firstInGroup = lastN[0];
      const serializedArgs = JSON.stringify(firstInGroup.args);
      
      const allIdentical = lastN.every(call => 
        call.tool === firstInGroup.tool && JSON.stringify(call.args) === serializedArgs
      );
      
      if (allIdentical) {
        return {
          reflection: {
            decision: "STOP",
            reason: `SAFETY_LIMIT: Repeated identical tool calls detected (${limits.maxRepeatedCalls} times).`,
            isSafetyStop: true
          }
        };
      }
    }

    // 2. Perform evidence-based LLM reflection
    const systemPrompt = `You are the Reflection node in an AI code investigation agent.
Your objective is to evaluate the evidence collected so far and determine if the investigation has gathered enough information to fully satisfy the original question and the current tasks.
If there is sufficient evidence, or if it's clear the information cannot be found, you should STOP.
If more investigation is required to answer the question, CONTINUE.

Provide a concise, operational reason for your decision. Do NOT include internal chain-of-thought.

Output ONLY a JSON object matching this schema:
{
  "decision": "CONTINUE" | "STOP",
  "reason": "string"
}`;

    const userPrompt = `Question: ${state.question}
Tasks: ${JSON.stringify(state.tasks)}
Current Task ID: ${state.currentTask}
Evidence collected:
${state.evidence.join("\n---\n")}
`;

    // If there's no evidence at all, and there are pending tasks, normally we'd CONTINUE. 
    // But we let the LLM decide based on the prompt.

    const response = await llm.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt)
    ]);

    try {
      const cleanResponse = response.replace(/^```json\s*/, "").replace(/```\s*$/, "").trim();
      const parsed = JSON.parse(cleanResponse);
      const validated = reflectionSchema.parse(parsed);

      return {
        reflection: {
          decision: validated.decision,
          reason: validated.reason,
          isSafetyStop: false
        }
      };
    } catch (e: any) {
      return { error: `Reflection failed to produce a valid decision: ${e.message}` };
    }
  };
}
