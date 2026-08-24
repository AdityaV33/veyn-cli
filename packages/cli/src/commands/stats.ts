import { Command } from "commander";

export function registerStatsCommand(program: Command) {
  program
    .command("stats")
    .description("Show stats")
    .action(() => {
      console.log("Not implemented yet");
    });
}
