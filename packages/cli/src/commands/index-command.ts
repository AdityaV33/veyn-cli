import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, PersistenceError, LocalEmbeddingProvider, Indexer, ScannerError, ParserError } from "@veyn/core";
import path from "path";
import { Presenter, colors } from "../ui/presenter.js";

export function registerIndexCommand(program: Command) {
  program
    .command("index [path]")
    .description("Create a repository index")
    .action(async (repoPath: string = ".") => {
      try {
        const absoluteRepoPath = path.resolve(repoPath);

        if (!process.env.MONGODB_URI) {
          Presenter.error("MONGODB_URI environment variable is missing.");
          Presenter.text("Index was generated in memory but could not be persisted to MongoDB Atlas.");
          Presenter.text("Please configure MONGODB_URI and try again.");
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
          Presenter.text("Run `veyn index .` again to restart indexing.");
          try {
            await storage.disconnect();
          } catch (e) {}
          process.exit(2);
        };
        process.on("SIGINT", sigintHandler);

        try {
          const provider = new LocalEmbeddingProvider();
          const indexer = new Indexer(storage, provider);

          Presenter.title("Indexing Repository");
          Presenter.item("Repository", identity.name);
          
          Presenter.section("Index mode");
          Presenter.text("Full repository index");

          Presenter.section("Index status");

          const stats = await indexer.index(absoluteRepoPath, identity.id, identity.name, (msg) => {
            Presenter.step(msg);
          });
          Presenter.endStep();

          Presenter.success("Indexing complete");

          Presenter.section("Repository understanding");
          Presenter.text(`${colors.bold}${stats.fileCount}${colors.reset} files analyzed`);
          Presenter.text(`${colors.bold}${stats.extractedSymbolCount}${colors.reset} code elements discovered`);
          Presenter.dimText("Such as functions, classes, types, and variables");

          Presenter.text(`${colors.bold}${stats.dependencyEdgeCount}${colors.reset} file imports mapped`);
          Presenter.dimText("Dependencies between files");

          Presenter.text(`${colors.bold}${stats.callEdgeCount}${colors.reset} function calls mapped`);
          Presenter.dimText("Execution paths between functions");

          Presenter.text(`${colors.bold}${stats.embeddingCount}${colors.reset} embeddings generated`);
          Presenter.dimText("Searchable representations of code sections");

          Presenter.section("Last indexing run");
          Presenter.text(`Duration: ${Presenter.formatDuration(stats.durationMs)}`);
          console.log("");

        } finally {
          process.off("SIGINT", sigintHandler);
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof ScannerError || error instanceof ParserError || error instanceof PersistenceError) {
          Presenter.error(error.message);
          Presenter.section("Next step");
          Presenter.text("Fix the issue and run `veyn index .` again to restart indexing.");
          process.exit(1);
        }

        throw error;
      }
    });
}
