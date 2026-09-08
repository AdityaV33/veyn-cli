import { Command } from "commander";
import {
  scanRepository, ScannerError, VeynParser, ParserError, SymbolExtractor,
  DependencyExtractor, buildDependencyGraph, ImportRecord, CallExtractor,
  CallRecord, CallGraph, Chunker, CodeChunk, RepositoryIdentityResolver,
  MongoIndexStorage, PersistenceError, LocalEmbeddingProvider, EmbeddingResult,
  SymbolRecord, ChangeDetector, AffectedResolver, ReferenceExtractor, ReferenceRecord
} from "@veyn/core";
import path from "path";

export function registerReindexCommand(program: Command) {
  program
    .command("reindex <path>")
    .description("Incrementally reindex a path based on changed files")
    .action(async (repoPath: string) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\nPersistence Error: MONGODB_URI environment variable is missing.");
          console.error("Incremental reindexing requires a configured MongoDB connection.");
          console.error("Please configure MONGODB_URI and try again.\n");
          process.exit(1);
        }

        const absoluteRepoPath = path.resolve(repoPath);
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const existingMeta = await storage.getMetadata(identity.id);
          if (!existingMeta) {
            console.error(`\nError: Repository ${identity.name} (${identity.id}) is not indexed.`);
            console.error(`Please run 'veyn index <path>' first.\n`);
            process.exit(1);
          }

          const provider = new LocalEmbeddingProvider();
          const indexer = new (require("@veyn/core").Indexer)(storage, provider);

          console.log(`\nIncrementally reindexing Repository: ${identity.name}`);
          
          const result = await indexer.reindex(
            absoluteRepoPath,
            identity.id,
            identity.name,
            (msg: string) => console.log(`  ${msg}`)
          );

          if (result) {
            console.log(`\nReindexed:`);
            console.log(`  Parsed: ${result.parsedCount}`);
            console.log(`  Symbols: ${result.extractedSymbolCount}`);
            console.log(`  Imports: ${result.extractedImportCount}`);
            console.log(`  References: ${result.extractedReferenceCount}`);
            console.log(`  Chunks: ${result.chunkCount}`);
            console.log(`\nIndex updated successfully.\n`);
          }

        } finally {
          await storage.disconnect();
        }

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
