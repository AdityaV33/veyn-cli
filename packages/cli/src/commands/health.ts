import { Command } from "commander";

export function registerHealthCommand(program: Command) {
  program
    .command("health")
    .description("Check repository health")
    .action(() => {
      console.log("Not implemented yet");
    });
}
