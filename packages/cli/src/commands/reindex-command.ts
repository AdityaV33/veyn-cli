import { Command } from "commander";
import {
  scanRepository, ScannerError, VeynParser, ParserError, SymbolExtractor,
  DependencyExtractor, buildDependencyGraph, ImportRecord, CallExtractor,
  CallRecord, CallGraph, Chunker, CodeChunk, RepositoryIdentityResolver,
  MongoIndexStorage, PersistenceError, LocalEmbeddingProvider, EmbeddingResult,
  SymbolRecord, ChangeDetector, AffectedResolver, ReferenceExtractor, ReferenceRecord, Indexer
} from "@veyn/core";
import path from "path";
import fs from "fs";
import { Presenter, colors } from "../ui/presenter.js";

export function registerReindexCommand(program: Command) {
  program
    .command("reindex [path]")
    .description("Incrementally reindex a repository.\nDefaults to the current directory.")
    .action(async (repoPath: string = ".") => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("MONGODB_URI environment variable is missing.");
          Presenter.text("Incremental reindexing requires a configured MongoDB connection.");
          Presenter.text("Please configure MONGODB_URI and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = path.resolve(repoPath);

        if (fs.existsSync(absoluteRepoPath) && !fs.statSync(absoluteRepoPath).isDirectory()) {
          Presenter.error(`Repository path is not a directory: ${absoluteRepoPath}`);
          Presenter.section("Next step");
          Presenter.text("Please provide a path to a repository directory.");
          process.exit(1);
        }
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        const sigintHandler = async () => {
          Presenter.endStep();
          Presenter.error("Indexing cancelled by user.");
          Presenter.section("Next step");
          Presenter.text("Run `veyn reindex .` again to resume incremental indexing.");
          try {
            await storage.disconnect();
          } catch (e) {}
          process.exit(2);
        };
        process.on("SIGINT", sigintHandler);

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
          
          Presenter.section("Index mode");
          Presenter.text("Incremental repository update");

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
            
            Presenter.section("Files processed");
            Presenter.text(`${colors.bold}${result.parsedCount}${colors.reset} file${result.parsedCount === 1 ? '' : 's'} reindexed`);

            if (result.addedCount) Presenter.text(`${colors.bold}${result.addedCount}${colors.reset} file${result.addedCount === 1 ? '' : 's'} added`);
            if (result.modifiedCount) Presenter.text(`${colors.bold}${result.modifiedCount}${colors.reset} file${result.modifiedCount === 1 ? '' : 's'} modified`);
            if (result.deletedCount) Presenter.text(`${colors.bold}${result.deletedCount}${colors.reset} file${result.deletedCount === 1 ? '' : 's'} deleted`);
            
            Presenter.text(`${colors.bold}${result.extractedSymbolCount}${colors.reset} code element${result.extractedSymbolCount === 1 ? '' : 's'} updated`);
            Presenter.text(`${colors.bold}${result.chunkCount}${colors.reset} searchable representation${result.chunkCount === 1 ? '' : 's'} updated`);

            Presenter.section("Last indexing run");
            Presenter.text(`Duration: ${Presenter.formatDuration(result.durationMs)}`);
            console.log("");
          } else {
            Presenter.success("Index is already up to date");
            Presenter.text("No files added, modified, or deleted since the last index.");
            console.log("");
          }

        } finally {
          process.off("SIGINT", sigintHandler);
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof ScannerError || error instanceof ParserError || error instanceof PersistenceError) {
          Presenter.error(error.message);
          Presenter.section("Next step");
          Presenter.text("Fix the issue and run `veyn reindex .` again.");
          process.exit(1);
        }
        throw error;
      }
    });
}
