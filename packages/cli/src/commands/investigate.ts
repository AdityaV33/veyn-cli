import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, PersistenceError } from "@veyn/core";
import { createLLMAdapter, loadLLMConfig, ToolRegistry, registerCoreTools, createInvestigationGraph, FAST_SLA_POLICY } from "@veyn/agent";
import { Presenter } from "../ui/presenter.js";

export function registerInvestigateCommand(program: Command) {
  program
    .command("investigate <question>")
    .description("Investigate a question using the AI agent")
    .option("--stream", "Stream the response")
    .action(async (question: string, options: { stream?: boolean }) => {
      if (!question || question.trim() === "") {
        Presenter.title("Investigation");
        Presenter.section("Error");
        Presenter.text("Investigation question cannot be empty.");
        Presenter.section("Next step");
        Presenter.text("Provide a question and try again.");
        process.exit(1);
      }

      try {
        if (!process.env.MONGODB_URI) {
          Presenter.title("Investigation");
          Presenter.section("Error");
          Presenter.text("MongoDB connection string is not configured.");
          Presenter.section("Next step");
          Presenter.text("Set MONGODB_URI and try again.");
          process.exit(1);
        }

        let llmConfig;
        try {
          llmConfig = loadLLMConfig();
        } catch (e: any) {
          Presenter.title("Investigation");
          Presenter.section("Error");
          Presenter.text("Groq API access is not configured.");
          Presenter.section("Next step");
          Presenter.text("Set GROQ_API_KEY and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });

        let isCancelled = false;

        const cleanup = async () => {
          if (!isCancelled) {
            isCancelled = true;
            Presenter.endStep();
            await storage.disconnect();
            process.exit(130);
          }
        };

        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

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

          Presenter.title("Investigation");
          Presenter.section("Question");
          Presenter.text(question);

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

          let finalState: any = null;

          if (options.stream) {
            const stream = await graph.stream(initialState);
            Presenter.section("Progress");

            for await (const update of stream) {
              const nodeName = Object.keys(update)[0];
              const state = update[nodeName];

              if (nodeName === "planner") {
                Presenter.success(`Planning investigation (${state.tasks?.length || 0} tasks)`);
              } else if (nodeName === "investigator") {
                const latestTool = state.toolHistory?.[state.toolHistory.length - 1];
                if (latestTool) {
                  Presenter.success(`Gathering repository evidence using ${latestTool.tool}`);
                }
              } else if (nodeName === "reflectionNode") {
                Presenter.success(`Evaluating evidence`);
              } else if (nodeName === "reporter") {
                Presenter.success(`Preparing answer`);
              }
              finalState = state;
            }
          } else {
            Presenter.section("Progress");
            Presenter.step("Running investigation...");
            finalState = await graph.invoke(initialState);
            Presenter.endStep();
          }

          if (finalState.error) {
            const errorMsg = typeof finalState.error === "string" ? finalState.error : (finalState.error.message || String(finalState.error));
            if (errorMsg.includes("Groq reasoning models are currently unavailable")) {
              Presenter.section("Error");
              Presenter.text("Groq reasoning models are currently unavailable.");
              Presenter.section("Next step");
              Presenter.text("Check the model configuration and try again.");
            } else {
              Presenter.error(finalState.error);
            }
            process.exit(1);
          }

          Presenter.section("Finding");
          const lines = (finalState.response || "No response generated.").split('\n');
          for (const line of lines) {
            Presenter.text(line);
          }

          Presenter.section("Evidence");
          if (finalState.toolHistory && finalState.toolHistory.length > 0) {
            const toolsUsed = Array.from(new Set(finalState.toolHistory.map((h: any) => h.tool))).join(", ");
            Presenter.text(`Gathered via: ${toolsUsed}`);
            Presenter.text(`Total tool calls: ${finalState.toolHistory.length}`);
          } else {
            Presenter.text("No evidence was gathered.");
          }

          const forcedStop = finalState.reflection?.decision === "CONTINUE" || finalState.tasks?.some((t: any) => t.status !== "completed");

          if (forcedStop) {
            Presenter.section("Limitations");
            Presenter.warning("Investigation stopped before all evidence could be collected.");
            Presenter.text("The answer below is based on the evidence gathered so far.");
          }

          Presenter.section("Next step");
          Presenter.text("Use `veyn explain` to dive deep into a specific file mentioned in the findings.");

        } finally {
          process.removeListener("SIGINT", cleanup);
          process.removeListener("SIGTERM", cleanup);
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.section("Error");
          Presenter.text(`Storage Error: ${error.message}`);
          process.exit(1);
        }

        if (error.message && error.message.includes("Groq reasoning models are currently unavailable")) {
          Presenter.section("Error");
          Presenter.text("Groq reasoning models are currently unavailable.");
          Presenter.section("Next step");
          Presenter.text("Check the model configuration and try again.");
          process.exit(1);
        }

        Presenter.section("Error");
        Presenter.text(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
