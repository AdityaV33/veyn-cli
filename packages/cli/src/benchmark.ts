import { RepositoryIdentityResolver, MongoIndexStorage } from "@veyn/core";
import { createLLMAdapter, loadLLMConfig, ToolRegistry, registerCoreTools, createInvestigationGraph, LLMAdapter } from "@veyn/agent";
import { BaseMessage } from "@langchain/core/messages";
import { performance } from "perf_hooks";

// A wrapper to collect LLM metrics
class TelemetryLLMAdapter implements LLMAdapter {
  constructor(private inner: LLMAdapter, private metrics: any) {}
  
  async invoke(messages: BaseMessage[]): Promise<string> {
    const start = performance.now();
    let tokensIn = messages.reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length) / 3.5, 0);
    let attempt = 1;
    let rateLimitTime = 0;
    
    // We can intercept the actual request if we proxy the groq client, but for simplicity
    // we just measure the total `invoke` time. Any time over a reasonable baseline (e.g. 5s) 
    // is likely due to backoff/rate limiting, though we'll just track total LLM time.
    const res = await this.inner.invoke(messages);
    const end = performance.now();
    
    let tokensOut = res.length / 3.5;
    
    const duration = end - start;
    if (duration > 8000) {
       rateLimitTime = duration - 8000; // rough estimate of backoff delay
    }

    this.metrics.llmCalls++;
    this.metrics.llmTotalMs += duration;
    this.metrics.rateLimitMs += rateLimitTime;
    this.metrics.tokensIn += Math.ceil(tokensIn);
    this.metrics.tokensOut += Math.ceil(tokensOut);
    
    return res;
  }
}

async function runBenchmark(question: string) {
  const metrics = {
    totalDurationMs: 0,
    llmCalls: 0,
    llmTotalMs: 0,
    rateLimitMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    investigatorCalls: 0,
    reflectionCalls: 0,
    toolTotalMs: 0,
    toolCalls: 0,
    outcome: ""
  };

  const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI! });
  await storage.connect();
  const identity = new RepositoryIdentityResolver().resolve(process.cwd());

  const adapter = createLLMAdapter(loadLLMConfig());
  const fastModel = new TelemetryLLMAdapter(adapter, metrics);
  const strongModel = new TelemetryLLMAdapter(adapter, metrics);
  const llms = {
    planner: fastModel,
    investigator: fastModel,
    reflection: fastModel,
    reporter: strongModel
  };
  
  const registry = new ToolRegistry();
  registerCoreTools(registry);
  
  // Wrap tools
  const tools = registry.getAvailableTools();
  for (const t of tools) {
    const original = registry.getTool(t.name)!;
    const origExecute = original.execute.bind(original);
    original.execute = async (args: any, ctx: any) => {
      const start = performance.now();
      const res = await origExecute(args, ctx);
      const end = performance.now();
      metrics.toolCalls++;
      metrics.toolTotalMs += (end - start);
      return res;
    };
  }

  const context = { storage, repositoryId: identity.id };
  const graph = createInvestigationGraph(llms, registry, context);

  const startTotal = performance.now();
  let finalState: any = null;
  try {
    const stream = await graph.stream({
      question,
      repositoryId: identity.id,
      tasks: [],
      currentTask: null,
      evidence: [],
      toolHistory: [],
      reflection: null,
      response: null,
      error: null,
    });

    for await (const update of stream) {
      const nodeName = Object.keys(update)[0];
      if (nodeName === "investigator") metrics.investigatorCalls++;
      if (nodeName === "reflectionNode") metrics.reflectionCalls++;
      finalState = update[nodeName];
    }
    
    metrics.outcome = finalState.error ? "ERROR" : "SUCCESS";
  } catch (e: any) {
    metrics.outcome = "CRASH: " + e.message;
  }
  
  const endTotal = performance.now();
  metrics.totalDurationMs = endTotal - startTotal;
  
  await storage.disconnect();
  return metrics;
}

const QUESTIONS = [
  "How does repository indexing work?",
  "Where are dependencies extracted?",
  "How does incremental reindexing detect changes?",
  "Explain how the AST parsing works for symbols.",
  "What is the schema for the MongoDB index?"
];

async function main() {
  console.log("Starting Benchmark...");
  
  const allMetrics: any[] = [];
  
  const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    console.log(`\nRunning: "${q}"...`);
    const m = await runBenchmark(q);
    console.log(JSON.stringify(m, null, 2));
    allMetrics.push(m);
    
    if (i < QUESTIONS.length - 1) {
      console.log("Sleeping 35s to respect rate limits...");
      await delay(35000);
    }
  }
  
  console.log("\n\n--- SUMMARY ---");
  const avg = (key: keyof typeof allMetrics[0]) => allMetrics.reduce((sum, m) => sum + (m[key] as number), 0) / allMetrics.length;
  
  console.log(`Avg Duration: ${(avg("totalDurationMs")/1000).toFixed(2)}s`);
  console.log(`Avg LLM Time: ${(avg("llmTotalMs")/1000).toFixed(2)}s`);
  console.log(`Avg Tool Time: ${(avg("toolTotalMs")/1000).toFixed(2)}s`);
  console.log(`Avg Rate Limit (est): ${(avg("rateLimitMs")/1000).toFixed(2)}s`);
  console.log(`Avg Investigator Calls: ${avg("investigatorCalls")}`);
  console.log(`Avg Reflection Iterations: ${avg("reflectionCalls")}`);
  console.log(`Avg Tokens (In+Out): ${Math.round(avg("tokensIn"))} + ${Math.round(avg("tokensOut"))}`);
}

main().catch(console.error);
