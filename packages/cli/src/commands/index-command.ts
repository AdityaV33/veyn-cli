import { Command } from "commander";
import { scanRepository, ScannerError } from "@veyn/core";

export function registerIndexCommand(program: Command) {
  program
    .command("index <path>")
    .description("Index a path")
    .action((path) => {
      try {
        const result = scanRepository(path);
        console.log(`Scanner discovered ${result.files.length} TypeScript files.`);
        console.log("Note: This is Phase 0.3. Full indexing (parsing, graphs, embeddings) is not yet implemented.");
      } catch (error) {
        if (error instanceof ScannerError) {
          console.error(error.message);
          process.exit(1);
        }
        throw error;
      }
    });
}
