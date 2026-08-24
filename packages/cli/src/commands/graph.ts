import { Command } from "commander";

export function registerGraphCommand(program: Command) {
  const graphCmd = program.command("graph").description("Graph operations");
  graphCmd
    .command("export")
    .description("Export the graph")
    .option("--format <type>", "Format to export (json|dot)", "json")
    .action((options) => {
      console.log("Not implemented yet");
    });
}
