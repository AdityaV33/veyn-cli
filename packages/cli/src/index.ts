import { Command } from 'commander';
import {
  registerIndexCommand,
  registerReindexCommand,
  registerSearchCommand,
  registerTraceCommand,
  registerArchitectureCommand,
  registerHealthCommand,
  registerStatsCommand,
  registerGraphCommand,
  registerInvestigateCommand,
  registerExplainCommand
} from './commands/index.js';

export function createCli() {
  const program = new Command();
  
  program
    .name('veyn')
    .description('Understand and explore your codebase.')
    .version('1.0.0')
    .configureHelp({
      subcommandTerm: (cmd) => {
        if (cmd.name() === 'graph') {
          return 'graph export';
        }
        const args = cmd.registeredArguments
          .map(arg => arg.required ? `<${arg.name()}>` : `[${arg.name()}]`)
          .join(' ');
        return args ? `${cmd.name()} ${args}` : cmd.name();
      }
    })
    .addHelpText('after', '\nRun `veyn <command> --help` for command-specific help.');

  registerIndexCommand(program);
  registerReindexCommand(program);
  registerSearchCommand(program);
  registerTraceCommand(program);
  registerArchitectureCommand(program);
  registerHealthCommand(program);
  registerStatsCommand(program);
  registerGraphCommand(program);
  registerInvestigateCommand(program);
  registerExplainCommand(program);

  return program;
}
