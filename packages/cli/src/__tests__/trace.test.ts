import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerTraceCommand } from '../commands/trace.js';
import { RepositoryIdentityResolver, MongoIndexStorage } from '@veyn/core';
import { Presenter } from '../ui/presenter.js';

vi.mock('@veyn/core', async () => {
  const actual = await vi.importActual('@veyn/core');
  return {
    ...actual,
    RepositoryIdentityResolver: vi.fn(),
    MongoIndexStorage: vi.fn(),
  };
});

describe('Trace Command', () => {
  let program: Command;
  let mockStorage: any;
  let mockExit: any;
  let mockPresenterText: any;
  let mockPresenterTitle: any;
  let mockPresenterError: any;
  let mockConsoleLog: any;

  beforeEach(() => {
    program = new Command();
    registerTraceCommand(program);

    process.env.MONGODB_URI = 'mongodb://localhost:27017';

    mockStorage = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getSymbols: vi.fn().mockResolvedValue([]),
      getCallNodes: vi.fn().mockResolvedValue([]),
      getCallEdges: vi.fn().mockResolvedValue([]),
    };

    (MongoIndexStorage as any).mockImplementation(function() {
      return mockStorage;
    });

    (RepositoryIdentityResolver as any).mockImplementation(function() {
      return {
        resolve: vi.fn().mockReturnValue({ id: 'test-repo', name: 'Test Repo' })
      };
    });

    mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`Process exited with code ${code}`);
    });
    mockPresenterText = vi.spyOn(Presenter, 'text').mockImplementation(() => {});
    mockPresenterTitle = vi.spyOn(Presenter, 'title').mockImplementation(() => {});
    mockPresenterError = vi.spyOn(Presenter, 'error').mockImplementation(() => {});
    mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.MONGODB_URI;
  });

  it('should format help text correctly', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    program.exitOverride(); // Prevent process.exit
    try {
      await program.parseAsync(['node', 'test', 'trace', '--help']);
    } catch (e: any) {
      if (e.message !== 'Process exited with code 0') throw e;
    }
    const output = writeSpy.mock.calls.map((c: any) => c[0]).join('');
    expect(output).toContain('Show callers and calls');
    expect(output).toContain('--depth <number>');
    expect(output).toContain('Examples:');
    expect(output).toContain('veyn trace refreshToken');
    writeSpy.mockRestore();
  });

  it('should handle ambiguous symbols safely', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'utilFunc', kind: 'function', filePath: 'src/a.ts' },
      { name: 'utilFunc', kind: 'function', filePath: 'src/b.ts' }
    ]);

    await expect(program.parseAsync(['node', 'test', 'trace', 'utilFunc'])).rejects.toThrow('Process exited with code 1');
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Multiple functions named `utilFunc` were found.'));
  });

  it('should handle missing symbols safely', async () => {
    mockStorage.getSymbols.mockResolvedValue([]);
    await expect(program.parseAsync(['node', 'test', 'trace', 'missingFunc'])).rejects.toThrow('Process exited with code 1');
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Could not find function `missingFunc`.'));
  });

  it('should deduplicate ambiguity correctly if identical files map', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'utilFunc', kind: 'function', filePath: 'src/a.ts' },
      { name: 'utilFunc', kind: 'function', filePath: 'src/a.ts' }
    ]);
    mockStorage.getCallNodes.mockResolvedValue([
      { id: 'src/a.ts:utilFunc', filePath: 'src/a.ts', symbolName: 'utilFunc', kind: 'function' }
    ]);
    mockStorage.getCallEdges.mockResolvedValue([]);

    await program.parseAsync(['node', 'test', 'trace', 'utilFunc']);
    expect(mockStorage.connect).toHaveBeenCalled();
  });

  it('should display isolated functions gracefully', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'utilFunc', kind: 'function', filePath: 'src/a.ts' }
    ]);
    mockStorage.getCallNodes.mockResolvedValue([
      { id: 'src/a.ts:utilFunc', filePath: 'src/a.ts', symbolName: 'utilFunc', kind: 'function' }
    ]);
    mockStorage.getCallEdges.mockResolvedValue([]);

    await program.parseAsync(['node', 'test', 'trace', 'utilFunc']);

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('No repository calls found'));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('No repository calls found'));
  });

  it('should display depth=1 properly', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'utilFunc', kind: 'function', filePath: 'src/a.ts' }
    ]);
    mockStorage.getCallNodes.mockResolvedValue([
      { id: 'src/a.ts:utilFunc', filePath: 'src/a.ts', symbolName: 'utilFunc', kind: 'function' },
      { id: 'src/b.ts:caller', filePath: 'src/b.ts', symbolName: 'caller', kind: 'function' },
      { id: 'src/c.ts:callee', filePath: 'src/c.ts', symbolName: 'callee', kind: 'function' }
    ]);
    mockStorage.getCallEdges.mockResolvedValue([
      { sourceId: 'src/b.ts:caller', targetId: 'src/a.ts:utilFunc', kind: 'direct', line: 10 },
      { sourceId: 'src/a.ts:utilFunc', targetId: 'src/c.ts:callee', kind: 'direct', line: 20 }
    ]);

    await program.parseAsync(['node', 'test', 'trace', 'utilFunc']);

    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('  1 direct call'));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('  1 direct caller'));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('Use `--depth 3`'));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('callee()'));
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('caller()'));
  });
  
  it('should output cyclic paths safely', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'utilFunc', kind: 'function', filePath: 'src/a.ts' }
    ]);
    mockStorage.getCallNodes.mockResolvedValue([
      { id: 'src/a.ts:utilFunc', filePath: 'src/a.ts', symbolName: 'utilFunc', kind: 'function' },
      { id: 'src/b.ts:caller', filePath: 'src/b.ts', symbolName: 'caller', kind: 'function' }
    ]);
    mockStorage.getCallEdges.mockResolvedValue([
      { sourceId: 'src/b.ts:caller', targetId: 'src/a.ts:utilFunc', kind: 'direct', line: 10 },
      { sourceId: 'src/a.ts:utilFunc', targetId: 'src/b.ts:caller', kind: 'direct', line: 20 }
    ]);

    await program.parseAsync(['node', 'test', 'trace', 'utilFunc', '--depth', '3']);
    
    expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('↺ Cycle detected'));
  });

  it('should disable ANSI colors if NO_COLOR is set', async () => {
    process.env.NO_COLOR = '1';
    
    // Simulate non-TTY for extra measure
    const originalIsTTY = process.stdout.isTTY;
    process.stdout.isTTY = false;

    mockStorage.getSymbols.mockResolvedValue([
      { name: 'utilFunc', kind: 'function', filePath: 'src/a.ts' }
    ]);
    mockStorage.getCallNodes.mockResolvedValue([
      { id: 'src/a.ts:utilFunc', filePath: 'src/a.ts', symbolName: 'utilFunc', kind: 'function' },
      { id: 'src/b.ts:caller', filePath: 'src/b.ts', symbolName: 'caller', kind: 'function' }
    ]);
    mockStorage.getCallEdges.mockResolvedValue([
      { sourceId: 'src/b.ts:caller', targetId: 'src/a.ts:utilFunc', kind: 'direct', line: 10 }
    ]);

    await program.parseAsync(['node', 'test', 'trace', 'utilFunc']);
    
    process.stdout.isTTY = originalIsTTY;
    delete process.env.NO_COLOR;
    
    // Assert none of the logs contain ANSI sequences
    const calls = mockConsoleLog.mock.calls.map((c: any) => c[0]).join('');
    expect(calls).not.toMatch(/\x1b\[[0-9;]*m/);
  });
});
