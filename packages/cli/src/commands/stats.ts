import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, StatsAnalyzer, PersistenceError } from "@veyn/core";

export function registerStatsCommand(program: Command) {
  program
    .command("stats")
    .description("Show repository index stats")
    .action(async () => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\\nConfiguration Error: MONGODB_URI environment variable is missing.");
          console.error("Please configure MONGODB_URI and try again.\\n");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const analyzer = new StatsAnalyzer(storage, identity.id, absoluteRepoPath);
          const stats = await analyzer.analyze();

          if (stats.state === "Not Indexed" || !stats.metadata) {
            console.log(`\\nRepository '${identity.name}' has not been indexed yet.`);
            console.log("Run 'veyn index .' first.\\n");
            return;
          }

          const meta = stats.metadata;
          const graphNodes = meta.dependencyNodeCount + meta.callNodeCount;
          const graphEdges = meta.dependencyEdgeCount + meta.callEdgeCount;
          const indexDuration = meta.indexDurationMs !== undefined ? `${meta.indexDurationMs}ms` : "Unknown";

          console.log(`\\n--- Veyn Index Stats for '${identity.name}' ---\\n`);
          console.log(`State: ${stats.state}`);
          if (stats.state === "Stale" && stats.staleDetails) {
            console.log(`       (${stats.staleDetails.added} added, ${stats.staleDetails.modified} modified, ${stats.staleDetails.deleted} deleted files)`);
          }
          console.log(`Last Indexed: ${new Date(meta.indexedAt).toLocaleString()}`);
          console.log(`Index Duration: ${indexDuration}\\n`);
          console.log(`Files: ${meta.fileCount}`);
          console.log(`Symbols: ${meta.symbolCount}`);
          console.log(`Embeddings: ${meta.embeddingCount}`);
          console.log(`Graph Size: ${graphNodes} nodes / ${graphEdges} edges\\n`);

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          console.error(`\\nStats Error: ${error.message}\\n`);
          process.exit(1);
        }
        console.error(`\\nUnexpected Error: ${error.message}\\n`);
        process.exit(1);
      }
    });
}
