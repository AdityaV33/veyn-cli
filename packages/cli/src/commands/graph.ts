import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, DependencyGraph } from "@veyn/core";

export function registerGraphCommand(program: Command) {
  const graphCmd = program.command("graph").description("Graph operations");
  graphCmd
    .command("export")
    .description("Export the graph")
    .option("--format <type>", "Format to export (json|dot)", "json")
    .action(async (options) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\\nConfiguration Error: MONGODB_URI environment variable is missing.");
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

          nodes.sort((a, b) => a.id.localeCompare(b.id));
          edges.sort((a, b) => {
            if (a.source !== b.source) return a.source.localeCompare(b.source);
            return a.target.localeCompare(b.target);
          });

          if (options.format === "json") {
            console.log(JSON.stringify({ nodes, edges }, null, 2));
          } else if (options.format === "dot") {
            console.log("digraph G {");
            nodes.forEach(n => {
              console.log(`  "${n.id}" [label="${n.path}"];`);
            });
            edges.forEach(e => {
              console.log(`  "${e.source}" -> "${e.target}";`);
            });
            console.log("}");
          } else {
            console.error(`Error: Unsupported format '${options.format}'. Use 'json' or 'dot'.`);
            process.exit(1);
          }
        } finally {
          await storage.disconnect();
        }
      } catch (error: any) {
        console.error(`\\nError: ${error.message}\\n`);
        process.exit(1);
      }
    });
}
