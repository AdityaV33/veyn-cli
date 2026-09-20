import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerExplainCommand } from '../commands/explain.js';
import { RepositoryIdentityResolver, MongoIndexStorage } from '@veyn/core';
import { GroqAdapter } from '@veyn/agent';
import { Presenter } from '../ui/presenter.js';

vi.mock('@veyn/core', async () => {
  const actual = await vi.importActual('@veyn/core');
  return {
    ...actual,
    RepositoryIdentityResolver: vi.fn(),
    MongoIndexStorage: vi.fn(),
  };
});

vi.mock('@veyn/agent', async () => {
  const actual = await vi.importActual('@veyn/agent');
  return {
    ...actual,
    GroqAdapter: vi.fn(),
  };
});

describe('Explain Command', () => {
  let program: Command;
  let mockStorage: any;
  let mockLlm: any;
  let mockExit: any;
  let mockPresenterText: any;
  let mockPresenterTitle: any;
  let mockPresenterError: any;

  beforeEach(() => {
    program = new Command();
    registerExplainCommand(program);

    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    process.env.GROQ_API_KEY = 'test-key';

    mockStorage = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getSymbols: vi.fn().mockResolvedValue([]),
      getFiles: vi.fn().mockResolvedValue([]),
      getChunksByFilePaths: vi.fn().mockResolvedValue([]),
      getCallNodes: vi.fn().mockResolvedValue([]),
      getCallEdges: vi.fn().mockResolvedValue([]),
      getDependencyNodes: vi.fn().mockResolvedValue([]),
      getDependencyEdges: vi.fn().mockResolvedValue([]),
      getReferences: vi.fn().mockResolvedValue([]),
    };

    (MongoIndexStorage as any).mockImplementation(function() {
      return mockStorage;
    });

    mockLlm = {
      invoke: vi.fn().mockResolvedValue('This is an explanation.'),
    };

    (GroqAdapter as any).mockImplementation(function() {
      return mockLlm;
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.MONGODB_URI;
    delete process.env.GROQ_API_KEY;
  });

  it('should resolve symbol and gather structure evidence', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'AuthService', kind: 'class', filePath: 'src/auth.ts', startLine: 10, endLine: 20 },
      { name: 'login', kind: 'method', filePath: 'src/auth.ts', startLine: 11, endLine: 15 }
    ]);

    mockStorage.getChunksByFilePaths.mockResolvedValue([
      { id: 'c1', filePath: 'src/auth.ts', startLine: 5, endLine: 25, content: 'class AuthService {}' }
    ]);

    mockStorage.getCallNodes.mockResolvedValue([
      { id: 'src/auth.ts:login', filePath: 'src/auth.ts', symbolName: 'login', kind: 'method' },
      { id: 'src/app.ts:init', filePath: 'src/app.ts', symbolName: 'init', kind: 'function' }
    ]);

    mockStorage.getCallEdges.mockResolvedValue([
      { sourceId: 'src/app.ts:init', targetId: 'src/auth.ts:login', kind: 'direct', line: 15 }
    ]);

    mockStorage.getDependencyEdges.mockResolvedValue([
      { source: 'src/auth.ts', target: 'src/utils.ts' }
    ]);

    mockStorage.getReferences.mockResolvedValue([
      { sourceFile: 'src/main.ts', sourceLine: 42 }
    ]);

    await program.parseAsync(['node', 'test', 'explain', 'AuthService']);

    expect(mockStorage.connect).toHaveBeenCalledTimes(1);
    expect(mockStorage.getSymbols).toHaveBeenCalledWith('test-repo');

    expect(mockLlm.invoke).toHaveBeenCalledTimes(1);
    const args = mockLlm.invoke.mock.calls[0][0];
    const systemMsg = args[0].content;
    const humanMsg = args[1].content;

    expect(systemMsg).toContain('ONE cohesive explanation');
    expect(humanMsg).toContain('Evidence Context for Target: AuthService (class)');
    expect(humanMsg).toContain('--- UPSTREAM (Callers) ---');
    expect(humanMsg).toContain('init()\n  src/app.ts:15');
    expect(humanMsg).toContain('--- IMPORTS (Files this depends on) ---');
    expect(humanMsg).toContain('src/utils.ts');
    expect(humanMsg).toContain('--- REFERENCES (Other usages, e.g. tests or types) ---');
    expect(humanMsg).toContain('src/main.ts:42');

    expect(mockPresenterTitle).toHaveBeenCalledWith('Explain');
    expect(mockPresenterText).toHaveBeenCalledWith(expect.stringContaining('✓ 1 upstream relationship found'));

    expect(mockStorage.disconnect).toHaveBeenCalledTimes(1);
  });

  it('should handle ambiguous symbols', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'utilFunc', kind: 'function', filePath: 'src/a.ts', startLine: 1, endLine: 5 },
      { name: 'utilFunc', kind: 'function', filePath: 'src/b.ts', startLine: 1, endLine: 5 }
    ]);

    await expect(program.parseAsync(['node', 'test', 'explain', 'utilFunc'])).rejects.toThrow('Process exited with code 1');
    expect(mockPresenterError).toHaveBeenCalledWith(expect.stringContaining('Multiple symbols named "utilFunc" were found'));
    expect(mockPresenterError).toHaveBeenCalledWith(expect.stringContaining('src/a.ts:utilFunc'));
    expect(mockPresenterError).toHaveBeenCalledWith(expect.stringContaining('src/b.ts:utilFunc'));

    expect(mockLlm.invoke).not.toHaveBeenCalled();
  });

  it('should format empty evidence gracefully', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'Isolated', kind: 'function', filePath: 'src/iso.ts', startLine: 1, endLine: 2 }
    ]);
    mockStorage.getChunksByFilePaths.mockResolvedValue([
      { id: 'c1', filePath: 'src/iso.ts', startLine: 1, endLine: 2, content: 'function Isolated() {}' }
    ]);
    // Leave nodes and edges empty

    await program.parseAsync(['node', 'test', 'explain', 'Isolated']);

    expect(mockLlm.invoke).toHaveBeenCalledTimes(1);
    const args = mockLlm.invoke.mock.calls[0][0];
    const humanMsg = args[1].content;

    expect(humanMsg).toContain('No upstream callers found');
    expect(humanMsg).toContain('No downstream calls found');
    expect(humanMsg).toContain('No imports found');
    expect(humanMsg).toContain('No references found');

    expect(mockPresenterText).toHaveBeenCalledWith('No upstream callers found');
  });

  it('should indicate method-level downstream calls for class targets', async () => {
    mockStorage.getSymbols.mockResolvedValue([
      { name: 'Service', kind: 'class', filePath: 'src/srv.ts', startLine: 1, endLine: 10 },
      { name: 'method', kind: 'method', filePath: 'src/srv.ts', startLine: 2, endLine: 5 }
    ]);
    mockStorage.getChunksByFilePaths.mockResolvedValue([
      { id: 'c1', filePath: 'src/srv.ts', startLine: 1, endLine: 10, content: 'class Service {}' }
    ]);

    mockStorage.getCallNodes.mockResolvedValue([
      { id: 'src/srv.ts:method', filePath: 'src/srv.ts', symbolName: 'method', kind: 'method' },
      { id: 'src/helper.ts:doWork', filePath: 'src/helper.ts', symbolName: 'doWork', kind: 'function' }
    ]);
    mockStorage.getCallEdges.mockResolvedValue([
      { sourceId: 'src/srv.ts:method', targetId: 'src/helper.ts:doWork', kind: 'direct', line: 5 }
    ]);

    await program.parseAsync(['node', 'test', 'explain', 'Service']);

    expect(mockPresenterText).toHaveBeenCalledWith('Downstream (uses, from analyzed methods)', 0);
  });

  it('should resolve file and provide context', async () => {
    mockStorage.getSymbols.mockResolvedValue([]);
    mockStorage.getFiles.mockResolvedValue([
      { relativePath: 'src/index.ts', size: 100 }
    ]);
    mockStorage.getChunksByFilePaths.mockResolvedValue([
      { id: 'c1', filePath: 'src/index.ts', startLine: 1, endLine: 10, content: 'console.log("hello");' }
    ]);
    mockStorage.getDependencyEdges.mockResolvedValue([
      { source: 'src/index.ts', target: 'src/dep.ts' },
      { source: 'src/main.ts', target: 'src/index.ts' }
    ]);

    await program.parseAsync(['node', 'test', 'explain', 'src/index.ts']);

    expect(mockStorage.getFiles).toHaveBeenCalledWith('test-repo');

    const args = mockLlm.invoke.mock.calls[0][0];
    const humanMsg = args[1].content;

    expect(humanMsg).toContain('Target: src/index.ts (file)');
    expect(humanMsg).toContain('src/dep.ts');
    expect(humanMsg).toContain('src/main.ts');
  });

  it('should fail with CLI error if target cannot be resolved', async () => {
    mockStorage.getSymbols.mockResolvedValue([]);
    mockStorage.getFiles.mockResolvedValue([]);

    await expect(program.parseAsync(['node', 'test', 'explain', 'NonExistent']))
      .rejects.toThrow();

    expect(mockPresenterError).toHaveBeenCalledWith(expect.stringContaining('could not be found'));
    expect(mockLlm.invoke).not.toHaveBeenCalled();
    expect(mockStorage.disconnect).toHaveBeenCalledTimes(1);
  });
});
