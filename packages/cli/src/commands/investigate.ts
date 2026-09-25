import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, PersistenceError } from "@veyn/core";
import { createLLMAdapter, loadLLMConfig, ToolRegistry, registerCoreTools, createInvestigationGraph } from "@veyn/agent";

export function registerInvestigateCommand(program: Command) {
  program
    .command("investigate <question>")
    .description("Investigate a question using the AI agent")
    .option("--stream", "Stream the response")
    .action(async (question: string, options: { stream?: boolean }) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\nConfiguration Error: MONGODB_URI environment variable is missing.");
          console.error("Veyn investigate requires a configured MongoDB connection.");
          console.error("Please configure MONGODB_URI and try again.\n");
          process.exit(1);
        }

        let llmConfig;
        try {
          llmConfig = loadLLMConfig();
        } catch (e: any) {
          console.error(`\n${e.message}\n`);
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });

        try {
          await storage.connect();
          const adapter = createLLMAdapter(llmConfig);
          const llms = {
            planner: adapter,
            investigator: adapter,
            reflection: adapter,
            reporter: adapter
          };
          const registry = new ToolRegistry();
          registerCoreTools(registry);
          const context = { storage, repositoryId: identity.id };

          const graph = createInvestigationGraph(llms, registry, context);

          console.log(`\nInvestigating: "${question}"`);
          console.log(`Repository: ${identity.id}\n`);

          const initialState = {
            question,
            repositoryId: identity.id,
            tasks: [],
            currentTask: null,
            evidence: [],
            toolHistory: [],
            reflection: null,
            response: null,
            error: null,
          };

          if (options.stream) {
            const stream = await graph.stream(initialState);

            for await (const update of stream) {
              const nodeName = Object.keys(update)[0];
              const state = update[nodeName];

              if (nodeName === "planner") {
                console.log(`[Planner] Created ${state.tasks?.length || 0} tasks.`);
              } else if (nodeName === "investigator") {
                const latestTool = state.toolHistory?.[state.toolHistory.length - 1];
                if (latestTool) {
                  console.log(`[Investigator] Executed tool: ${latestTool.tool}`);
                }
              } else if (nodeName === "reflectionNode") {
                const reflection = state.reflection;
                if (reflection) {
                  if (reflection.isSafetyStop) {
                    console.log(`[Reflection] Safety Stop Triggered: ${reflection.reason}`);
                  } else {
                    console.log(`[Reflection] Decision: ${reflection.decision} - ${reflection.reason}`);
                  }
                }
              } else if (nodeName === "reporter") {
                if (state.error) {
                  console.log(`\n[Reporter Error]\n${state.error}`);
                } else {
                  console.log(`\n[Final Answer]\n\n${state.response}\n`);
                }
              }
            }
          } else {
            console.log("Running investigation... (this may take a few seconds)\n");
            const finalState = await graph.invoke(initialState);

            if (finalState.error) {
              console.error(`\nError: ${finalState.error}\n`);
              process.exit(1);
            }

            console.log(`[Final Answer]\n\n${finalState.response}\n`);
          }

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          console.error(`\nStorage Error: ${error.message}\n`);
          process.exit(1);
        }

        console.error(`\nUnexpected Error: ${error.message}\n`);
        process.exit(1);
      }
    });
}
