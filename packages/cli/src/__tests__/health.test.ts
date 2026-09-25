import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerHealthCommand } from '../commands/health.js';
import { HealthAnalyzer, MongoIndexStorage, PersistenceError, RepositoryIdentityResolver } from '@veyn/core';
import { Presenter } from '../ui/presenter.js';

vi.mock('@veyn/core', () => {
  return {
    RepositoryIdentityResolver: vi.fn().mockImplementation(function() {
      return { resolve: vi.fn().mockReturnValue({ id: 'test-repo-id', name: 'test-repo' }) };
    }),
    MongoIndexStorage: vi.fn().mockImplementation(function() {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined)
      };
    }),
    HealthAnalyzer: vi.fn(),
    PersistenceError: class PersistenceError extends Error {}
  };
});

vi.mock('../ui/presenter.js', () => {
  return {
    Presenter: {
      title: vi.fn(),
      section: vi.fn(),
      text: vi.fn(),
      item: vi.fn(),
      warning: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      dimText: vi.fn()
    },
    colors: {
      dim: '',
      reset: ''
    }
  };
});

describe('Health Command', () => {
  let program: Command;
  let exitMock: any;
  let logSpy: any;

  beforeEach(() => {
    program = new Command();
    registerHealthCommand(program);
    process.env.MONGODB_URI = 'mongodb://localhost:27017';
    
    exitMock = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.clearAllMocks();
  });

  afterEach(() => {
    exitMock.mockRestore();
    logSpy.mockRestore();
  });

  const setupAnalyzer = (reportOverrides: any = {}) => {
    const defaultReport = {
      circularDependencies: [],
      highCoupling: [],
      structuralIssues: [],
      largeFiles: [],
      deadCodeSignals: []
    };
    const finalReport = { ...defaultReport, ...reportOverrides };
    
    (HealthAnalyzer as any).mockImplementation(function() { return {
      analyze: vi.fn().mockResolvedValue(finalReport)
    };});
  };

  it('should display no findings correctly', async () => {
    setupAnalyzer();
    await program.parseAsync(['node', 'test', 'health']);
    
    expect(Presenter.success).toHaveBeenCalledWith('No structural signals found');
    expect(Presenter.success).toHaveBeenCalledWith('No dependency cycles detected');
    expect(Presenter.success).toHaveBeenCalledWith('No highly connected modules');
    expect(Presenter.success).toHaveBeenCalledWith('No isolated files');
    expect(Presenter.success).toHaveBeenCalledWith('No unused code signals');
    expect(Presenter.success).toHaveBeenCalledWith('No unusually large files');
  });

  it('should display circular dependencies and deduplicate equivalent cycles', async () => {
    setupAnalyzer({
      circularDependencies: [
        ['src/a.ts', 'src/b.ts', 'src/a.ts'],
        ['src/b.ts', 'src/a.ts', 'src/b.ts'] // duplicate equivalent cycle
      ]
    });
    
    await program.parseAsync(['node', 'test', 'health']);
    
    expect(Presenter.warning).toHaveBeenCalledWith('1 dependency cycle detected');
    expect(Presenter.text).toHaveBeenCalledWith(expect.stringContaining('imports src/b.ts'));
    expect(Presenter.text).toHaveBeenCalledWith(expect.stringContaining('which returns to a.ts'));
  });

  it('should display high coupling', async () => {
    setupAnalyzer({
      highCoupling: ['src/core.ts::23::13']
    });
    await program.parseAsync(['node', 'test', 'health']);
    
    expect(Presenter.text).toHaveBeenCalledWith('src/core.ts');
    expect(Presenter.text).toHaveBeenCalledWith('  23 modules depend on it');
    expect(Presenter.text).toHaveBeenCalledWith('  13 modules it depends on');
  });

  it('should display isolated modules', async () => {
    setupAnalyzer({
      structuralIssues: ['src/scratch.ts']
    });
    await program.parseAsync(['node', 'test', 'health']);
    
    expect(Presenter.text).toHaveBeenCalledWith('src/scratch.ts');
  });

  it('should display possible unused functions', async () => {
    setupAnalyzer({
      deadCodeSignals: [`src/unused.ts:unusedFunc`]
    });
    await program.parseAsync(['node', 'test', 'health']);
    
    expect(Presenter.text).toHaveBeenCalledWith('src/unused.ts:unusedFunc');
    expect(Presenter.text).toHaveBeenCalledWith(expect.stringContaining('This is only a signal. Exported functions'));
  });

  it('should display large files', async () => {
    setupAnalyzer({
      largeFiles: ['src/big.ts::61440']
    });
    await program.parseAsync(['node', 'test', 'health']);
    
    expect(Presenter.warning).toHaveBeenCalledWith(expect.stringContaining('unusually large file (>50KB)'));
    expect(Presenter.text).toHaveBeenCalledWith('src/big.ts');
    expect(Presenter.text).toHaveBeenCalledWith('  60.0 KB');
  });

  it('should run successfully with exit code 0 even when there are findings (advisory)', async () => {
    setupAnalyzer({
      structuralIssues: ['Isolated module: a']
    });
    await program.parseAsync(['node', 'test', 'health']);
    expect(exitMock).not.toHaveBeenCalled();
  });

  it('should exit with non-zero on persistence failure', async () => {
    (HealthAnalyzer as any).mockImplementation(function() { return {
      analyze: vi.fn().mockRejectedValue(new PersistenceError('DB down'))
    };});
    await program.parseAsync(['node', 'test', 'health']);
    expect(Presenter.text).toHaveBeenCalledWith('Could not connect to the index database.');
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should exit with non-zero if MONGODB_URI is missing', async () => {
    delete process.env.MONGODB_URI;
    await program.parseAsync(['node', 'test', 'health']);
    expect(Presenter.text).toHaveBeenCalledWith('Could not connect to the index database.');
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
