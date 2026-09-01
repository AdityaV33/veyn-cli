import { Command } from "commander";
import path from "node:path";
import { RepositoryIdentityResolver, MongoIndexStorage, PersistenceError } from "@veyn/core";
import { GroqAdapter } from "@veyn/agent";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";

export function registerExplainCommand(program: Command) {
  program
    .command("explain <target>")
    .description("Explain a function or file deterministically")
    .action(async (target: string) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\nConfiguration Error: MONGODB_URI environment variable is missing.");
          console.error("Veyn explain requires a configured MongoDB connection.");
          console.error("Please configure MONGODB_URI and try again.\n");
          process.exit(1);
        }

        if (!process.env.GROQ_API_KEY) {
          console.error("\nConfiguration Error: GROQ_API_KEY environment variable is missing.");
          console.error("Veyn explain requires Groq API access.");
          console.error("Please configure GROQ_API_KEY and try again.\n");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const symbols = await storage.getSymbols(identity.id);
          const matchedSymbol = symbols.find(s => s.name === target);

          let codeContent = "";

          if (matchedSymbol) {
            console.log(`\nResolving symbol: ${matchedSymbol.name} (${matchedSymbol.kind}) in ${matchedSymbol.filePath}...`);
            const relativeSymbolPath = path.isAbsolute(matchedSymbol.filePath) 
              ? path.relative(absoluteRepoPath, matchedSymbol.filePath).replace(/\\/g, "/")
              : matchedSymbol.filePath;
            const chunks = await storage.getChunksByFilePaths(identity.id, [relativeSymbolPath]);
            
            // Find chunks overlapping with the symbol's line range
            const relevantChunks = chunks
              .filter(c => c.startLine <= matchedSymbol.endLine && c.endLine >= matchedSymbol.startLine)
              .sort((a, b) => a.startLine - b.startLine);
            
            codeContent = relevantChunks.map(c => c.content).join("\n\n");
            
            if (!codeContent) {
              console.error(`\nError: Symbol '${target}' found in index, but no corresponding code chunks were found.\n`);
              process.exit(1);
            }
          } else {
            const files = await storage.getFiles(identity.id);
            const matchedFile = files.find(f => f.relativePath === target || f.relativePath.endsWith(`/${target}`) || f.relativePath.endsWith(`\\${target}`));
            
            if (matchedFile) {
              console.log(`\nResolving file: ${matchedFile.relativePath}...`);
              const chunks = await storage.getChunksByFilePaths(identity.id, [matchedFile.relativePath]);
              
              if (chunks.length === 0) {
                console.error(`\nError: File '${target}' found in index, but no corresponding code chunks were found.\n`);
                process.exit(1);
              }
              
              codeContent = chunks.sort((a, b) => a.startLine - b.startLine).map(c => c.content).join("\n\n");
            } else {
              console.error(`\nError: Target '${target}' could not be resolved as an indexed symbol or file in repository '${identity.id}'.`);
              console.error("Please ensure the target exists and the repository has been indexed.\n");
              process.exit(1);
            }
          }

          console.log("Explaining target via LLM...\n");

          const llm = new GroqAdapter(process.env.GROQ_API_KEY);
          
          const systemPrompt = "You are an expert AI code assistant. Your job is to explain the provided code clearly and concisely. Do not invent details not present in the code.";
          const userPrompt = `Explain the following code snippet for target '${target}':\n\n\`\`\`\n${codeContent}\n\`\`\``;

          const response = await llm.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt)
          ]);

          console.log(response);
          console.log("\n");

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          console.error(`\nStorage Error: ${error.message}\n`);
          process.exit(1);
        }

        console.error(`\nUnexpected Error: ${error.message}\n`);
        process.exit(1);
      }
    });
}
