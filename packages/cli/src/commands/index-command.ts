import { Command } from "commander";

export function registerIndexCommand(program: Command) {
  program
    .command("index <path>")
    .description("Index a path")
    .action((path) => {
      console.log("Not implemented yet");
    });
}
