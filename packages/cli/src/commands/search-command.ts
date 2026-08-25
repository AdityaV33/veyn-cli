import { Command } from "commander";
import { 
  RepositoryIdentityResolver, 
  MongoIndexStorage, 
  GroqEmbeddingProvider, 
  SearchEngine,
  PersistenceError
} from "@veyn/core";
import path from "path";

export function registerSearchCommand(program: Command) {
  program
    .command("search <query>")
    .description("Search the codebase using hybrid semantic and lexical retrieval")
    .action(async (query: string) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\nConfiguration Error: MONGODB_URI environment variable is missing.");
          console.error("Veyn search requires a configured MongoDB connection for the index.");
          console.error("Please configure MONGODB_URI and try again.\n");
          process.exit(1);
        }
        
        if (!process.env.GROQ_API_KEY) {
          console.error("\nConfiguration Error: GROQ_API_KEY environment variable is missing.");
          console.error("Veyn search requires a Groq API key to generate query embeddings.");
          console.error("Please configure GROQ_API_KEY and try again.\n");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();
        
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const provider = new GroqEmbeddingProvider({ apiKey: process.env.GROQ_API_KEY });
          const engine = new SearchEngine(storage, provider);

          console.log(`\nSearch: ${query}\n`);
          
          const response = await engine.search({
            repositoryId: identity.id,
            repositoryPath: absoluteRepoPath,
            text: query,
            limit: 10
          });

          if (response.results.length === 0) {
            console.log("No results found.\n");
            return;
          }

          console.log("Results:\n");
          response.results.forEach((result, index) => {
            const sym = result.symbolName ? `   symbol: ${result.symbolName}\n` : "";
            console.log(`${index + 1}. ${result.filePath}:${result.startLine}-${result.endLine}`);
            if (sym) {
              process.stdout.write(sym);
            }
            console.log(`   score: ${result.finalScore.toFixed(4)} (sem: ${result.semanticScore.toFixed(2)}, lex: ${result.lexicalScore.toFixed(2)}, grp: ${result.graphScore.toFixed(2)})`);
            console.log(`\n   ${result.content.split('\\n').slice(0, 5).join('\\n   ')}...`);
            console.log("\n");
          });

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          console.error(`\nSearch Error: ${error.message}\n`);
          process.exit(1);
        }
        
        console.error(`\nUnexpected Error: ${error.message}\n`);
        process.exit(1);
      }
    });
}
