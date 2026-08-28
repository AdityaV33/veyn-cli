import { Command } from "commander";
import {
  RepositoryIdentityResolver,
  MongoIndexStorage,
  DependencyGraph,
  DependencyGraphTraversal,
  PersistenceError,
  ArchitecturePathNode
} from "@veyn/core";

export function registerArchitectureCommand(program: Command) {
  program
    .command("architecture <module>")
    .description("Show architecture and dependencies for a module")
    .option("-d, --depth <number>", "Maximum depth of the traversal", "5")
    .action(async (targetModule: string, options: { depth: string }) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\\nConfiguration Error: MONGODB_URI environment variable is missing.");
          console.error("Veyn architecture requires a configured MongoDB connection for the index.");
          console.error("Please configure MONGODB_URI and try again.\\n");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const nodes = await storage.getDependencyNodes(identity.id);
          const edges = await storage.getDependencyEdges(identity.id);

          const graph = new DependencyGraph();
          nodes.forEach(n => graph.addNode(n));
          edges.forEach(e => graph.addEdge(e));

          const traversal = new DependencyGraphTraversal(graph);

          const targets = traversal.resolveTarget(targetModule);
          if (targets.length === 0) {
            console.error(`\\nError: Could not resolve target module '${targetModule}' in the repository.\\n`);
            process.exit(1);
          }

          if (targets.length > 1) {
            console.error(`\\nError: Ambiguous target module '${targetModule}'. Multiple occurrences found:\\n`);
            targets.forEach(t => console.error(`  - ${t.id}`));
            console.error("\\nPlease specify the exact ID using the format 'filepath'.\\n");
            process.exit(1);
          }

          const targetId = targets[0].id;
          const maxDepth = parseInt(options.depth, 10);

          console.log(`\\nAnalyzing architecture for: ${targetId} (max depth: ${maxDepth})\\n`);

          const result = traversal.analyze(targetId, { maxDepth });

          const printPath = (pathNodes: ArchitecturePathNode[], isDependents: boolean) => {
            pathNodes.forEach((p, idx) => {
              const indent = "  ".repeat(idx);
              if (idx === 0) {
                console.log(`${indent}${p.node.id}`);
              } else {
                const arrow = isDependents ? "<- imported by <-" : "-> imports ->";
                console.log(`${indent}${arrow} ${p.node.id}`);
              }
            });
            console.log("");
          };

          if (result.dependents.length > 0) {
            console.log("DEPENDENTS (What imports this module):\\n");
            result.dependents.forEach(p => printPath(p, true));
          } else {
            console.log("DEPENDENTS (What imports this module): None found\\n");
          }

          if (result.dependencies.length > 0) {
            console.log("DEPENDENCIES (What this module imports):\\n");
            result.dependencies.forEach(p => printPath(p, false));
          } else {
            console.log("DEPENDENCIES (What this module imports): None found\\n");
          }

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          console.error(`\\nArchitecture Error: ${error.message}\\n`);
          process.exit(1);
        }

        console.error(`\\nUnexpected Error: ${error.message}\\n`);
        process.exit(1);
      }
    });
}
