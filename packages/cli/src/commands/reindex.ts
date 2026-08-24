import { Command } from "commander";

export function registerReindexCommand(program: Command) {
  program
    .command("reindex <path>")
    .description("Reindex a path")
    .action((path) => {
      console.log("Not implemented yet");
    });
}
