import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentStateAnnotation, InvestigationState } from "./state.js";
import { LLMAdapter } from "./llm/index.js";
import { ToolRegistry, ToolContext } from "./tools/index.js";
import { 
  createPlannerNode, 
  createInvestigatorNode, 
  createReflectionNode, 
  createReporterNode,
  ReflectionSafetyLimits
} from "./nodes/index.js";

export interface AgentLLMs {
  planner: LLMAdapter;
  investigator: LLMAdapter;
  reflection: LLMAdapter;
  reporter: LLMAdapter;
}

export interface InvestigationPolicy {
  maxInvestigationRounds: number;
  deadlineMs: number;
  maxLlmCalls: number;
}

export const FAST_SLA_POLICY: InvestigationPolicy = {
  maxInvestigationRounds: 1,
  deadlineMs: 25000,
  maxLlmCalls: 4
};

export function createInvestigationGraph(
  llms: AgentLLMs,
  registry: ToolRegistry,
  context: ToolContext,
  policy: InvestigationPolicy = FAST_SLA_POLICY
) {
  // 1. Initialize Nodes
  const planner = createPlannerNode(llms.planner);
  const investigator = createInvestigatorNode(llms.investigator, registry, context);
  const reflectionLimits: ReflectionSafetyLimits = {
    maxToolCalls: 15,
    maxRepeatedCalls: 2
  };
  const reflection = createReflectionNode(llms.reflection, reflectionLimits);
  const reporter = createReporterNode(llms.reporter);

  // 2. Define the Graph
  const graphBuilder = new StateGraph(AgentStateAnnotation)
    .addNode("planner", planner)
    .addNode("investigator", investigator)
    .addNode("reflectionNode", reflection)
    .addNode("reporter", reporter);

  // 3. Define the routing functions
  const routeAfterPlanner = (state: InvestigationState) => {
    if (state.error || !state.tasks || state.tasks.length === 0) {
      return "reporter";
    }
    return "investigator";
  };

  const routeAfterReflection = (state: InvestigationState) => {
    if (state.error) {
      return "reporter";
    }
    
    // Enforcement of the wall-clock deadline
    if (Date.now() - state.startTime > policy.deadlineMs) {
      console.warn(`⚠️ Investigation reached ${policy.deadlineMs}ms deadline. Forcing STOP.`);
      return "reporter";
    }

    // Enforcement of investigation rounds (fast SLA policy)
    if (state.investigationRounds >= policy.maxInvestigationRounds) {
      console.warn(`⚠️ Maximum investigation rounds (${policy.maxInvestigationRounds}) reached. Forcing STOP.`);
      return "reporter";
    }

    if (state.reflection?.decision === "CONTINUE") {
      return "investigator";
    }
    
    return "reporter";
  };

  // 4. Wire the edges
  graphBuilder
    .addEdge(START, "planner")
    .addConditionalEdges("planner", routeAfterPlanner, {
      investigator: "investigator",
      reporter: "reporter"
    })
    .addEdge("investigator", "reflectionNode")
    .addConditionalEdges("reflectionNode", routeAfterReflection, {
      investigator: "investigator",
      reporter: "reporter"
    })
    .addEdge("reporter", END);

  return graphBuilder.compile();
}
