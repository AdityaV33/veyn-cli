import { Command } from "commander";
import {
  scanRepository, ScannerError, VeynParser, ParserError, SymbolExtractor,
  DependencyExtractor, buildDependencyGraph, ImportRecord, CallExtractor,
  CallRecord, CallGraph, Chunker, CodeChunk, RepositoryIdentityResolver,
  MongoIndexStorage, PersistenceError, LocalEmbeddingProvider, EmbeddingResult,
  SymbolRecord, ChangeDetector, AffectedResolver, ReferenceExtractor, ReferenceRecord, Indexer
} from "@veyn/core";
import path from "path";
import { Presenter, colors } from "../ui/presenter.js";

export function registerReindexCommand(program: Command) {
  program
    .command("reindex <path>")
    .description("Incrementally reindex a path based on changed files")
    .action(async (repoPath: string) => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Persistence Error: MONGODB_URI environment variable is missing.");
          Presenter.text("Incremental reindexing requires a configured MongoDB connection.");
          Presenter.text("Please configure MONGODB_URI and try again.");
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
            Presenter.error(`Repository ${identity.name} (${identity.id}) is not indexed.`);
            Presenter.text(`Please run 'veyn index <path>' first.`);
            process.exit(1);
          }

          const provider = new LocalEmbeddingProvider();
          const indexer = new Indexer(storage, provider);

          Presenter.title("Updating Index");
          Presenter.item("Repository", identity.name);
          Presenter.section("Index status");

          const result = await indexer.reindex(
            absoluteRepoPath,
            identity.id,
            identity.name,
            (msg: string) => Presenter.step(msg)
          );
          Presenter.endStep();

          if (result) {
            Presenter.success("Index updated successfully");

            Presenter.section("Repository understanding");
            Presenter.text(`${colors.bold}${result.parsedCount}${colors.reset} files modified`);
            Presenter.text(`${colors.bold}${result.extractedSymbolCount}${colors.reset} code elements updated`);
            Presenter.text(`${colors.bold}${result.chunkCount}${colors.reset} searchable representations updated`);

            Presenter.section("Last indexing run");
            Presenter.text(`Duration: ${Presenter.formatDuration(result.durationMs)}`);
            console.log("");
          } else {
            Presenter.success("Index is already up to date");
            Presenter.text("No files added, modified, or deleted since the last index.");
            console.log("");
          }

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof ScannerError) {
          Presenter.error(`Scanner Error: ${error.message}`);
          process.exit(1);
        } else if (error instanceof ParserError) {
          Presenter.error(`Parser Error: ${error.message}`);
          process.exit(1);
        } else if (error instanceof PersistenceError) {
          Presenter.error(`Persistence Error: ${error.message}`);
          process.exit(1);
        }
        throw error;
      }
    });
}
