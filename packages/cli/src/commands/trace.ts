import { Command } from "commander";

export function registerTraceCommand(program: Command) {
  program
    .command("trace <function>")
    .description("Trace a function")
    .action((func) => {
      console.log("Not implemented yet");
    });
}
