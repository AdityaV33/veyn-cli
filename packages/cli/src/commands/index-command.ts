import { Command } from "commander";
import { scanRepository, ScannerError, VeynParser, ParserError } from "@veyn/core";
import path from "path";

export function registerIndexCommand(program: Command) {
  program
    .command("index <path>")
    .description("Index a path")
    .action((repoPath: string) => {
      try {
        const absoluteRepoPath = path.resolve(repoPath);
        const result = scanRepository(absoluteRepoPath);
        console.log(`Scanner discovered ${result.files.length} TypeScript files.`);
        
        const parser = new VeynParser();
        let parsedCount = 0;

        for (const file of result.files) {
          const absoluteFilePath = path.join(result.repositoryPath, file.relativePath);
          parser.parseFile(absoluteFilePath);
          parsedCount++;
        }

        console.log(`Parsed ${parsedCount} files successfully.`);
        console.log("Note: This is Phase 0.4. Full indexing (graphs, embeddings) is not yet implemented.");
      } catch (error: any) {
        if (error instanceof ScannerError) {
          console.error(`Scanner Error: ${error.message}`);
          process.exit(1);
        } else if (error instanceof ParserError) {
          console.error(`Parser Error: ${error.message}`);
          process.exit(1);
        }
        
        throw error;
      }
    });
}
