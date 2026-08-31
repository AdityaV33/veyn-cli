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

export function createInvestigationGraph(
  llm: LLMAdapter,
  registry: ToolRegistry,
  context: ToolContext,
  reflectionLimits?: ReflectionSafetyLimits
) {
  // 1. Initialize Nodes
  const planner = createPlannerNode(llm);
  const investigator = createInvestigatorNode(llm, registry, context);
  const reflection = createReflectionNode(llm, reflectionLimits);
  const reporter = createReporterNode(llm);

  // 2. Define the Graph
  const graphBuilder = new StateGraph(AgentStateAnnotation)
    .addNode("planner", planner)
    .addNode("investigator", investigator)
    .addNode("reflectionNode", reflection)
    .addNode("reporter", reporter);

  // 3. Define the routing function
  const routeAfterReflection = (state: InvestigationState) => {
    if (state.error) {
      // If there's an unrecoverable error, we still want the reporter to summarize
      // what happened, or we can just end. For now, route to reporter to show the error.
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
    .addEdge("planner", "investigator")
    .addEdge("investigator", "reflectionNode")
    .addConditionalEdges("reflectionNode", routeAfterReflection, {
      investigator: "investigator",
      reporter: "reporter"
    })
    .addEdge("reporter", END);

  return graphBuilder.compile();
}
