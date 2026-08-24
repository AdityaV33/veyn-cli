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
  registerExplainCommand,
  registerServeCommand
} from './commands/index.js';

export function createCli() {
  const program = new Command();
  
  program
    .name('veyn')
    .description('Veyn CLI Phase 0.2 Foundation')
    .version('1.0.0');

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
  registerServeCommand(program);

  return program;
}
