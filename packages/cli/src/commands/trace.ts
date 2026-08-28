import { Command } from "commander";
import {
  RepositoryIdentityResolver,
  MongoIndexStorage,
  CallGraph,
  CallGraphTraversal,
  PersistenceError,
  TracePathNode
} from "@veyn/core";

export function registerTraceCommand(program: Command) {
  program
    .command("trace <function>")
    .description("Trace a function to see what calls it and what it calls")
    .option("-d, --depth <number>", "Maximum depth of the traversal", "5")
    .action(async (func: string, options: { depth: string }) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\\nConfiguration Error: MONGODB_URI environment variable is missing.");
          console.error("Veyn trace requires a configured MongoDB connection for the index.");
          console.error("Please configure MONGODB_URI and try again.\\n");
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
            console.error(`\\nError: Could not resolve target function '${func}' in the repository.\\n`);
            process.exit(1);
          }

          if (targets.length > 1) {
            console.error(`\\nError: Ambiguous target function '${func}'. Multiple occurrences found:\\n`);
            targets.forEach(t => console.error(`  - ${t.filePath}:${t.name}`));
            console.error("\\nPlease specify the exact ID using the format 'filepath:symbol' (e.g. src/auth.ts:validateToken).\\n");
            process.exit(1);
          }

          const targetSymbol = targets[0];
          const targetId = `${targetSymbol.filePath}:${targetSymbol.name}`;
          const maxDepth = parseInt(options.depth, 10);

          console.log(`\\nTracing function: ${targetId} (max depth: ${maxDepth})\\n`);

          const result = traversal.trace(targetSymbol, { maxDepth });

          const printPath = (pathNodes: TracePathNode[], isUpstream: boolean) => {
            pathNodes.forEach((p, idx) => {
              const indent = "  ".repeat(idx);
              const edgeInfo = p.edge ? ` (line ${p.edge.line})` : "";
              if (idx === 0) {
                console.log(`${indent}${p.node.id}`);
              } else {
                const arrow = isUpstream ? "<- calls <-" : "-> calls ->";
                console.log(`${indent}${arrow} ${p.node.id}${edgeInfo}`);
              }
            });
            console.log("");
          };

          if (result.upstream.length > 0) {
            console.log("UPSTREAM (What calls this target):\\n");
            result.upstream.forEach(p => printPath(p, true));
          } else {
            console.log("UPSTREAM (What calls this target): None found\\n");
          }

          if (result.downstream.length > 0) {
            console.log("DOWNSTREAM (What this target calls):\\n");
            result.downstream.forEach(p => printPath(p, false));
          } else {
            console.log("DOWNSTREAM (What this target calls): None found\\n");
          }

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          console.error(`\\nTrace Error: ${error.message}\\n`);
          process.exit(1);
        }

        console.error(`\\nUnexpected Error: ${error.message}\\n`);
        process.exit(1);
      }
    });
}
