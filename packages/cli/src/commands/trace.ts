import { Command } from "commander";
import {
  RepositoryIdentityResolver,
  MongoIndexStorage,
  CallGraph,
  CallGraphTraversal,
  PersistenceError,
  TracePathNode
} from "@veyn/core";
import { Presenter, colors } from "../ui/presenter.js";

export function registerTraceCommand(program: Command) {
  program
    .command("trace <function>")
    .description("Trace a function to see what calls it and what it calls")
    .option("-d, --depth <number>", "Maximum depth of the traversal", "5")
    .action(async (func: string, options: { depth: string }) => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Configuration Error: MONGODB_URI environment variable is missing.");
          Presenter.text("Veyn trace requires a configured MongoDB connection for the index.");
          Presenter.text("Please configure MONGODB_URI and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const nodes = await storage.getCallNodes(identity.id);
          const edges = await storage.getCallEdges(identity.id);

          const graph = new CallGraph();
          graph.load({ nodes, edges });

          const traversal = new CallGraphTraversal(graph);

          let symbols = await storage.getSymbols(identity.id);
          // Convert absolute paths in SymbolRecords to relative paths to match CallGraph semantics
          symbols = symbols.map(s => ({
            ...s,
            filePath: s.filePath.startsWith(absoluteRepoPath)
              ? s.filePath.slice(absoluteRepoPath.length + 1) // +1 to remove the leading slash
              : s.filePath
          }));

          const targets = traversal.resolveTarget(func, symbols);
          if (targets.length === 0) {
            Presenter.error(`Could not resolve target function '${func}' in the repository.`);
            process.exit(1);
          }

          if (targets.length > 1) {
            Presenter.error(`Ambiguous target function '${func}'. Multiple occurrences found:`);
            targets.forEach(t => Presenter.item("-", `${t.filePath}:${t.name}`));
            Presenter.text("Please specify the exact ID using the format 'filepath:symbol' (e.g. src/auth.ts:validateToken).");
            process.exit(1);
          }

          const targetSymbol = targets[0];
          const targetId = `${targetSymbol.filePath}:${targetSymbol.name}`;
          const maxDepth = parseInt(options.depth, 10);

          Presenter.title("Call Graph Trace");
          Presenter.item("Target", targetId);
          Presenter.item("Max Depth", maxDepth);

          Presenter.section("Status");
          Presenter.step("Tracing execution paths...");

          const result = traversal.trace(targetSymbol, { maxDepth });
          Presenter.endStep();
          Presenter.success("Trace complete");

          const printPath = (pathNodes: TracePathNode[], isUpstream: boolean) => {
            pathNodes.forEach((p, idx) => {
              const indent = "  ".repeat(idx + 1); // Indent under section
              const edgeInfo = p.edge ? ` (line ${p.edge.line})` : "";
              if (idx === 0) {
                console.log(`${indent}${colors.cyan}${p.node.id}${colors.reset}`);
              } else {
                const arrow = isUpstream ? "<- calls <-" : "-> calls ->";
                console.log(`${indent}${colors.dim}${arrow}${colors.reset} ${p.node.id}${colors.dim}${edgeInfo}${colors.reset}`);
              }
            });
            console.log("");
          };

          Presenter.section("Upstream (What calls this target)");
          if (result.upstream.length > 0) {
            result.upstream.forEach(p => printPath(p, true));
          } else {
            Presenter.dimText("No callers found");
            console.log("");
          }

          Presenter.section("Downstream (What this target calls)");
          if (result.downstream.length > 0) {
            result.downstream.forEach(p => printPath(p, false));
          } else {
            Presenter.dimText("No downstream calls found");
            console.log("");
          }

          Presenter.section("Why it matters");
          Presenter.text(`Modifying ${targetSymbol.name} may impact ${result.upstream.length} upstream paths.`);
          console.log("");

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.error(`Trace Error: ${error.message}`);
          process.exit(1);
        }

        Presenter.error(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
