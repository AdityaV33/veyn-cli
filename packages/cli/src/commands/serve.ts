import { Command } from "commander";

export function registerServeCommand(program: Command) {
  program
    .command("serve")
    .description("Start the server")
    .action(() => {
      console.log("Not implemented yet");
    });
}
