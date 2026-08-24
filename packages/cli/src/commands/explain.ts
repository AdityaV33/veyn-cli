import { Command } from "commander";

export function registerExplainCommand(program: Command) {
  program
    .command("explain <function_or_file>")
    .description("Explain a function or file")
    .action((funcOrFile) => {
      console.log("Not implemented yet");
    });
}
