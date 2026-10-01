import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, StatsAnalyzer, PersistenceError } from "@veyn/core";
import { Presenter, colors } from "../ui/presenter.js";

export function registerStatsCommand(program: Command) {
  program
    .command("stats")
    .description("Show index statistics")
    .action(async () => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Configuration Error: MONGODB_URI environment variable is missing.");
          Presenter.text("Please configure MONGODB_URI and try again.");
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

          Presenter.title("Repository Statistics");
          Presenter.item("Repository", identity.name);

          if (stats.state === "Not Indexed" || !stats.metadata) {
            Presenter.section("Index status");
            Presenter.warning("Not Indexed");
            console.log("");
            Presenter.text("Repository has not been indexed yet.");
            Presenter.section("Next step");
            Presenter.text("Run `veyn index .` to create the repository index.");
            return;
          }

          const meta = stats.metadata;

          Presenter.section("Index status");
          if (stats.state === "Stale" && stats.staleDetails) {
            Presenter.warning("Out of date");
            console.log("");
            if (stats.staleDetails.modified > 0) Presenter.text(`${stats.staleDetails.modified} files modified`);
            else Presenter.text(`No files modified since the last index`);
            if (stats.staleDetails.deleted > 0) Presenter.text(`${stats.staleDetails.deleted} files deleted`);
            else Presenter.text(`No files deleted since the last index`);
            if (stats.staleDetails.added > 0) Presenter.text(`${stats.staleDetails.added} files added`);
            else Presenter.text(`No files added since the last index`);
          } else {
            Presenter.success("Up to date");
          }

          Presenter.section("Last indexing run");
          Presenter.text(new Date(meta.indexedAt).toLocaleString("en-US", {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
          }));
          if (meta.indexDurationMs !== undefined) {
            Presenter.text(`Duration: ${Presenter.formatDuration(meta.indexDurationMs)}`);
          }

          Presenter.section("Repository understanding");
          Presenter.text(`${colors.bold}${meta.fileCount}${colors.reset} files analyzed`);

          Presenter.text(`${colors.bold}${meta.symbolCount}${colors.reset} code elements discovered`);
          Presenter.dimText("Such as functions, classes, types, and variables");

          Presenter.text(`${colors.bold}${meta.dependencyEdgeCount}${colors.reset} file imports mapped`);
          Presenter.dimText("Dependencies between files");

          Presenter.text(`${colors.bold}${meta.callEdgeCount}${colors.reset} function calls mapped`);
          Presenter.dimText("Execution paths between functions");

          Presenter.text(`${colors.bold}${meta.embeddingCount}${colors.reset} embeddings generated`);
          Presenter.dimText("Searchable representations of code sections");

          if (stats.state === "Stale") {
            Presenter.section("Next step");
            Presenter.text("Run \`veyn reindex .\` to update the repository index.");
          }
          console.log("");

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.error(`Stats Error: ${error.message}`);
          process.exit(1);
        }
        Presenter.error(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
