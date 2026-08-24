import { Command } from "commander";

export function registerInvestigateCommand(program: Command) {
  program
    .command("investigate <question>")
    .description("Investigate a question")
    .option("--stream", "Stream the response")
    .action((question, options) => {
      console.log("Not implemented yet");
    });
}
