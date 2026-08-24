import { Command } from "commander";

export function registerSearchCommand(program: Command) {
  program
    .command("search <query>")
    .description("Search the index")
    .action((query) => {
      console.log("Not implemented yet");
    });
}
