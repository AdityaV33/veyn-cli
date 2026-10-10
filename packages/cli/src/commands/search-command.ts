import { Command } from "commander";
import {
  RepositoryIdentityResolver,
  MongoIndexStorage,
  LocalEmbeddingProvider,
  SearchEngine,
  PersistenceError
} from "@veyn/core";
import path from "path";
import { Presenter, colors } from "../ui/presenter.js";

export function registerSearchCommand(program: Command) {
  program
    .command("search <query>")
    .description("Find relevant code")
    .action(async (query: string) => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Configuration Error: MONGODB_URI environment variable is missing.");
          Presenter.text("Veyn search requires a configured MongoDB connection for the index.");
          Presenter.text("Please configure MONGODB_URI and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const provider = new LocalEmbeddingProvider();
          const engine = new SearchEngine(storage, provider);

          Presenter.title("Search");
          Presenter.item("Query", query);

          Presenter.section("Status");
          Presenter.step("Searching codebase...");

          const response = await engine.search({
            repositoryId: identity.id,
            repositoryPath: absoluteRepoPath,
            text: query,
            limit: 10
          });
          Presenter.endStep();

          if (response.results.length === 0) {
            Presenter.warning("No results found.");
            return;
          }

          Presenter.success("Search complete");

          const exactMatches = response.results.filter(r => r.symbolName?.toLowerCase() === query.toLowerCase());
          const relatedCode = response.results.filter(r => r.symbolName?.toLowerCase() !== query.toLowerCase());

          if (exactMatches.length > 0) {
            Presenter.section("Exact matches");
            exactMatches.forEach((result, index) => {
              Presenter.text(`${colors.bold}${index + 1}. ${result.filePath}:${result.startLine}-${result.endLine}${colors.reset}`);
              const contentLines = result.content.split('\n');
              const preview = contentLines.slice(0, 3).join('\n').trim();
              Presenter.dimText(`${preview}${contentLines.length > 3 ? '...' : ''}`, 2);
              console.log("");
            });
          }

          if (relatedCode.length > 0) {
            Presenter.section("Related code");
            relatedCode.forEach((result, index) => {
              Presenter.text(`${colors.bold}${index + 1 + exactMatches.length}. ${result.filePath}:${result.startLine}-${result.endLine}${colors.reset}`);
              const contentLines = result.content.split('\n');
              const preview = contentLines.slice(0, 3).join('\n').trim();
              Presenter.dimText(`${preview}${contentLines.length > 3 ? '...' : ''}`, 2);
              console.log("");
            });
          }

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.error(`Search Error: ${error.message}`);
          process.exit(1);
        }

        Presenter.error(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
