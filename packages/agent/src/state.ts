import { BaseMessage } from "@langchain/core/messages";
import { Annotation } from "@langchain/langgraph";

export interface InvestigationTask {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
}

export interface ToolCallHistoryItem {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: string;
}

export interface ReflectionResult {
  decision: "CONTINUE" | "STOP";
  reason: string;
  isSafetyStop?: boolean;
}

export const AgentStateAnnotation = Annotation.Root({
  // The original user question
  question: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  // Repository ID being investigated
  repositoryId: Annotation<string>({
    reducer: (x, y) => y ?? x,
    default: () => "",
  }),
  // Structured task list for investigation
  tasks: Annotation<InvestigationTask[]>({
    reducer: (x, y) => y ?? x,
    default: () => [],
  }),
  // ID of the currently executing task
  currentTask: Annotation<string | null>({
    reducer: (x, y) => y !== undefined ? y : x,
    default: () => null,
  }),
  // Gathered evidence (snippets, descriptions)
  evidence: Annotation<string[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  // Tool call history
  toolHistory: Annotation<ToolCallHistoryItem[]>({
    reducer: (x, y) => x.concat(y),
    default: () => [],
  }),
  // Final reflection reason/result
  reflection: Annotation<ReflectionResult | null>({
    reducer: (x, y) => y !== undefined ? y : x,
    default: () => null,
  }),
  // Final response text
  response: Annotation<string | null>({
    reducer: (x, y) => y !== undefined ? y : x,
    default: () => null,
  }),
  // Error state
  error: Annotation<string | null>({
    reducer: (x, y) => y !== undefined ? y : x,
    default: () => null,
  }),
  // Timestamp when investigation started
  startTime: Annotation<number>({
    reducer: (x, y) => y ?? x,
    default: () => Date.now(),
  }),
  // Number of times Investigator node ran
  investigationRounds: Annotation<number>({
    reducer: (x, y) => x + y,
    default: () => 0,
  })
});

export type InvestigationState = typeof AgentStateAnnotation.State;
