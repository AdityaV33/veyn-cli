import { Command } from "commander";
import { scanRepository, ScannerError, VeynParser, ParserError, SymbolExtractor } from "@veyn/core";
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
        const extractor = new SymbolExtractor();
        let parsedCount = 0;
        let extractedSymbolCount = 0;

        for (const file of result.files) {
          const absoluteFilePath = path.join(result.repositoryPath, file.relativePath);
          const ast = parser.parseFile(absoluteFilePath);
          parsedCount++;

          const symbols = extractor.extract(ast);
          extractedSymbolCount += symbols.length;
        }

        console.log(`Parsed ${parsedCount} files successfully.`);
        console.log(`Extracted ${extractedSymbolCount} symbols.`);
        console.log("Note: This is Phase 0.5. Graph construction is not yet implemented.");
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
