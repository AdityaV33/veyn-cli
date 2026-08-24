import { Command } from "commander";

export function registerArchitectureCommand(program: Command) {
  program
    .command("architecture")
    .description("Show architecture")
    .action(() => {
      console.log("Not implemented yet");
    });
}
