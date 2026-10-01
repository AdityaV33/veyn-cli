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

          Presenter.title("Semantic Search");
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
            Presenter.warning("No relevant results found for your query.");
            return;
          }

          Presenter.success("Search complete");

          Presenter.section("Results found");

          response.results.forEach((result, index) => {
            const sym = result.symbolName ? ` (Symbol: ${result.symbolName})` : "";
            Presenter.text(`${colors.bold}${index + 1}. ${result.filePath}:${result.startLine}-${result.endLine}${colors.reset}${sym}`);

            // Format content preview nicely
            const contentLines = result.content.split('\n');
            const preview = contentLines.slice(0, 3).join('\n').trim();
            Presenter.dimText(`${preview}${contentLines.length > 3 ? '...' : ''}`, 2);
            console.log("");
          });

          Presenter.section("Technical details");
          Presenter.text(`Found ${response.results.length} matches using hybrid semantic+lexical search (BAAI/bge-small-en-v1.5)`);

          // Show top score details
          if (response.results.length > 0) {
            const best = response.results[0];
            Presenter.text(`Top match score: ${best.finalScore.toFixed(4)} (sem: ${best.semanticScore.toFixed(2)}, lex: ${best.lexicalScore.toFixed(2)}, grp: ${best.graphScore.toFixed(2)})`);
          }
          console.log("");

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
