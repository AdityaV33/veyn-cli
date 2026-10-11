import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerGraphCommand } from "../commands/graph.js";

// Mock the console and process
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalProcessExit = process.exit;
const originalProcessCwd = process.cwd;

let currentRepoId = "mock-repo-id";

// Mock dependencies
vi.mock("@veyn/core", async () => {
  const actual = await vi.importActual("@veyn/core");

  let _isConnected = false;

  class MockMongoIndexStorage {
    async connect() {
      if (process.env.MONGODB_URI === "mongodb://localhost:27017/fail") {
        throw new Error("Failed to connect to MongoDB: connect ECONNREFUSED 127.0.0.1:27017");
      }
      _isConnected = true;
    }
    async disconnect() {
      _isConnected = false;
    }
    async getDependencyNodes(repoId: string) {
      if (repoId === "mock-repo-id-empty") return [];
      return [
        { id: "b.ts", path: "b.ts", type: "file" },
        { id: "a.ts", path: "a.ts", type: "file" }
      ];
    }
    async getDependencyEdges(repoId: string) {
      if (repoId === "mock-repo-id-empty") return [];
      return [
        { source: "b.ts", target: "a.ts" },
        { source: "a.ts", target: "c.ts" },
        { source: "a.ts", target: "b.ts" }
      ];
    }
  }

  class MockRepositoryIdentityResolver {
    resolve() {
      return { id: currentRepoId, rootPath: "/mock/repo" };
    }
  }

  return {
    ...actual as any,
    RepositoryIdentityResolver: MockRepositoryIdentityResolver,
    MongoIndexStorage: MockMongoIndexStorage
  };
});

describe("veyn graph export", () => {
  let logMock: any;
  let errorMock: any;
  let exitMock: any;
  let program: Command;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    currentRepoId = "mock-repo-id";
    logMock = vi.fn();
    errorMock = vi.fn();
    exitMock = vi.fn((code) => { throw new Error(`process.exit: ${code}`); });

    console.log = logMock;
    console.error = errorMock;
    process.exit = exitMock as any;
    process.cwd = () => "/mock/repo";

    originalEnv = { ...process.env };
    process.env.MONGODB_URI = "mongodb://mock";

    program = new Command();
    registerGraphCommand(program);
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalProcessExit;
    process.cwd = originalProcessCwd;
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("should export deterministic JSON by default", async () => {
    await program.parseAsync(["node", "test", "graph", "export"]);

    expect(logMock).toHaveBeenCalledTimes(1);
    const output = logMock.mock.calls[0][0];
    const parsed = JSON.parse(output);

    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(3);

    // Check deterministic sorting
    expect(parsed.nodes[0].id).toBe("a.ts");
    expect(parsed.nodes[1].id).toBe("b.ts");

    expect(parsed.edges[0].source).toBe("a.ts");
    expect(parsed.edges[0].target).toBe("b.ts");
    expect(parsed.edges[1].source).toBe("a.ts");
    expect(parsed.edges[1].target).toBe("c.ts");
    expect(parsed.edges[2].source).toBe("b.ts");
    expect(parsed.edges[2].target).toBe("a.ts");

    expect(errorMock).not.toHaveBeenCalled();
  });

  it("should export deterministic DOT format", async () => {
    await program.parseAsync(["node", "test", "graph", "export", "--format", "dot"]);

    // Multiple console.log calls for DOT output
    expect(logMock).toHaveBeenCalled();
    const calls = logMock.mock.calls.map((c: any) => c[0]);

    expect(calls[0]).toBe("digraph G {");
    expect(calls).toContain('  "a.ts" [label="a.ts"];');
    expect(calls).toContain('  "b.ts" [label="b.ts"];');
    expect(calls).toContain('  "a.ts" -> "b.ts";');
    expect(calls).toContain('  "a.ts" -> "c.ts";');
    expect(calls).toContain('  "b.ts" -> "a.ts";');
    expect(calls[calls.length - 1]).toBe("}");

    expect(errorMock).not.toHaveBeenCalled();
  });

  it("should error on invalid format", async () => {
    await expect(program.parseAsync(["node", "test", "graph", "export", "--format", "xml"])).rejects.toThrow("process.exit: 1");

    expect(errorMock).toHaveBeenCalledWith("Error: Unsupported format 'xml'. Use 'json' or 'dot'.");
    expect(logMock).not.toHaveBeenCalled();
  });

  it("should error if MONGODB_URI is missing", async () => {
    delete process.env.MONGODB_URI;

    await expect(program.parseAsync(["node", "test", "graph", "export"])).rejects.toThrow("process.exit: 1");

    expect(errorMock).toHaveBeenCalledWith("Configuration Error: MONGODB_URI environment variable is missing.");
    expect(logMock).not.toHaveBeenCalled();
  });

  it("should output an empty graph if repository is empty", async () => {
    currentRepoId = "mock-repo-id-empty";

    await program.parseAsync(["node", "test", "graph", "export", "--format", "json"]);

    expect(logMock).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logMock.mock.calls[0][0]);
    expect(parsed.nodes).toHaveLength(0);
    expect(parsed.edges).toHaveLength(0);
  });

  it("should handle database connection failures gracefully", async () => {
    process.env.MONGODB_URI = "mongodb://localhost:27017/fail";

    await expect(program.parseAsync(["node", "test", "graph", "export"])).rejects.toThrow("process.exit: 1");

    expect(errorMock).toHaveBeenCalledWith("Error: Failed to connect to MongoDB: connect ECONNREFUSED 127.0.0.1:27017");
    expect(logMock).not.toHaveBeenCalled();
  });
});
