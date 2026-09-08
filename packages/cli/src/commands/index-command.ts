import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, PersistenceError, LocalEmbeddingProvider, Indexer, ScannerError, ParserError } from "@veyn/core";
import path from "path";

export function registerIndexCommand(program: Command) {
  program
    .command("index <path>")
    .description("Index a path")
    .action(async (repoPath: string) => {
      try {
        const absoluteRepoPath = path.resolve(repoPath);

        if (!process.env.MONGODB_URI) {
          console.error("\nPersistence Error: MONGODB_URI environment variable is missing.");
          console.error("Index was generated in memory but could not be persisted to MongoDB Atlas.");
          console.error("Please configure MONGODB_URI and try again.\n");
          process.exit(1);
        }

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const provider = new LocalEmbeddingProvider();
          const indexer = new Indexer(storage, provider);
          
          await indexer.index(absoluteRepoPath, identity.id, identity.name, (msg) => {
            console.log(msg);
          });
          
        } finally {
          await storage.disconnect();
        }

        console.log(`Index persisted successfully to MongoDB for repository: ${identity.name} (${identity.id})`);

      } catch (error: any) {
        if (error instanceof ScannerError) {
          console.error(`Scanner Error: ${error.message}`);
          process.exit(1);
        } else if (error instanceof ParserError) {
          console.error(`Parser Error: ${error.message}`);
          process.exit(1);
        } else if (error instanceof PersistenceError) {
          console.error(`Persistence Error: ${error.message}`);
          process.exit(1);
        }
        
        throw error;
      }
    });
}
