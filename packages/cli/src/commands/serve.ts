import { Command } from "commander";
import { startServer } from "@veyn/server";

export function registerServeCommand(program: Command) {
  program
    .command("serve")
    .description("Start the Veyn HTTP API server")
    .option("-p, --port <number>", "Port to run the server on", "3000")
    .action(async (options) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\nConfiguration Error: MONGODB_URI environment variable is missing.");
          console.error("Veyn serve requires a configured MongoDB connection for the index.");
          console.error("Please configure MONGODB_URI and try again.\n");
          process.exit(1);
        }

        const port = parseInt(options.port, 10);
        const absoluteRepoPath = process.cwd();

        await startServer({
          port,
          mongoUri: process.env.MONGODB_URI,
          repositoryPath: absoluteRepoPath,
          groqApiKey: process.env.GROQ_API_KEY
        });
      } catch (error: any) {
        console.error(`\nUnexpected Error: ${error.message}\n`);
        process.exit(1);
      }
    });
}
