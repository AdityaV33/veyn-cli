import { describe, it, expect } from 'vitest';
import { createCli } from '../index.js';

describe('Veyn CLI Foundation', () => {
  it('should bootstrap without throwing', () => {
    const cli = createCli();
    expect(cli).toBeDefined();
    expect(cli.name()).toBe('veyn');
  });

  it('should register required commands', () => {
    const cli = createCli();
    const commands = cli.commands.map(cmd => cmd.name());
    
    expect(commands).toContain('index');
    expect(commands).toContain('reindex');
    expect(commands).toContain('search');
    expect(commands).toContain('trace');
    expect(commands).toContain('architecture');
    expect(commands).toContain('health');
    expect(commands).toContain('stats');
    expect(commands).toContain('graph');
    expect(commands).toContain('investigate');
    expect(commands).toContain('explain');
    expect(commands).toContain('serve');
  });

  it('should register correct arguments for commands', () => {
    const cli = createCli();
    
    const indexCmd = cli.commands.find(c => c.name() === 'index');
    expect(indexCmd?.registeredArguments[0].name()).toBe('path');
    
    const investigateCmd = cli.commands.find(c => c.name() === 'investigate');
    expect(investigateCmd?.registeredArguments[0].name()).toBe('question');
    expect(investigateCmd?.options.find(o => o.long === '--stream')).toBeDefined();
    
    const graphCmd = cli.commands.find(c => c.name() === 'graph');
    const graphExportCmd = graphCmd?.commands.find(c => c.name() === 'export');
    expect(graphExportCmd).toBeDefined();
    expect(graphExportCmd?.options.find(o => o.long === '--format')).toBeDefined();
  });
});
