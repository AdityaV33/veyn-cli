import { Command } from "commander";
import {
  RepositoryIdentityResolver,
  MongoIndexStorage,
  DependencyGraphTraversal,
  PersistenceError,
  ArchitecturePathNode,
  loadDependencyGraph
} from "@veyn/core";
import { Presenter, colors } from "../ui/presenter.js";

export function registerArchitectureCommand(program: Command) {
  program
    .command("architecture <module>")
    .description("Show architecture and dependencies for a module")
    .option("-d, --depth <number>", "Maximum depth of the traversal", "5")
    .action(async (targetModule: string, options: { depth: string }) => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Configuration Error: MONGODB_URI environment variable is missing.");
          Presenter.text("Veyn architecture requires a configured MongoDB connection for the index.");
          Presenter.text("Please configure MONGODB_URI and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const traversal = await loadDependencyGraph(storage, identity.id);

          const targets = traversal.resolveTarget(targetModule);
          if (targets.length === 0) {
            Presenter.error(`Could not resolve target module '${targetModule}' in the repository.`);
            process.exit(1);
          }

          if (targets.length > 1) {
            Presenter.error(`Ambiguous target module '${targetModule}'. Multiple occurrences found:`);
            targets.forEach(t => Presenter.item("-", t.id));
            Presenter.text("Please specify the exact ID using the format 'filepath'.");
            process.exit(1);
          }

          const targetId = targets[0].id;
          const maxDepth = parseInt(options.depth, 10);

          Presenter.title("Architecture Map");
          Presenter.item("Target", targetId);
          Presenter.item("Max Depth", maxDepth);

          Presenter.section("Status");
          Presenter.step("Analyzing module dependencies...");

          const result = traversal.analyze(targetId, { maxDepth });
          Presenter.endStep();
          Presenter.success("Analysis complete");

          const printPath = (pathNodes: ArchitecturePathNode[], isDependents: boolean) => {
            pathNodes.forEach((p, idx) => {
              const indent = "  ".repeat(idx + 1);
              if (idx === 0) {
                console.log(`${indent}${colors.cyan}${p.node.id}${colors.reset}`);
              } else {
                const arrow = isDependents ? "<- imported by <-" : "-> imports ->";
                console.log(`${indent}${colors.dim}${arrow}${colors.reset} ${p.node.id}`);
              }
            });
            console.log("");
          };

          Presenter.section("Dependents (What imports this module)");
          if (result.dependents.length > 0) {
            result.dependents.forEach(p => printPath(p, true));
          } else {
            Presenter.dimText("No dependents found");
            console.log("");
          }

          Presenter.section("Dependencies (What this module imports)");
          if (result.dependencies.length > 0) {
            result.dependencies.forEach(p => printPath(p, false));
          } else {
            Presenter.dimText("No dependencies found");
            console.log("");
          }

          Presenter.section("Why it matters");
          Presenter.text(`Modifying ${targetModule} may break ${result.dependents.length} importing modules.`);
          console.log("");

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.error(`Architecture Error: ${error.message}`);
          process.exit(1);
        }

        Presenter.error(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
