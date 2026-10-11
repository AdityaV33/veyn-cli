import { describe, it, expect, vi, beforeEach, Mocked } from "vitest";
import { SearchEngine } from "../engine.js";
import { IndexStorage } from "../../persistence/index.js";
import { EmbeddingProvider } from "../../embeddings/index.js";
import { SearchQuery } from "../types.js";

describe("SearchEngine", () => {
  let storageMock: Mocked<IndexStorage>;
  let providerMock: Mocked<EmbeddingProvider>;
  let engine: SearchEngine;

  beforeEach(() => {
    storageMock = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      clearRepository: vi.fn(),
      removeStaleFacts: vi.fn(),
      getFiles: vi.fn(),
      getDependencyEdges: vi.fn().mockResolvedValue([]),
      getCallEdges: vi.fn().mockResolvedValue([]),
      getMetadata: vi.fn(),
      recalculateMetadata: vi.fn(),
      saveMetadata: vi.fn(),
      saveFiles: vi.fn(),
      saveSymbols: vi.fn(),
      saveDependencies: vi.fn(),
      saveDependencyGraph: vi.fn(),
      saveCallGraph: vi.fn(),
      saveChunks: vi.fn(),
      saveEmbeddings: vi.fn(),
      vectorSearch: vi.fn().mockResolvedValue([]),
      searchLexicalChunks: vi.fn().mockResolvedValue([]),
      getChunksByIds: vi.fn().mockResolvedValue([]),
      getChunksByFilePaths: vi.fn().mockResolvedValue([])
    } as any;

    providerMock = {
      embed: vi.fn().mockResolvedValue([{ vector: [0.1, 0.2] }])
    } as any;

    engine = new SearchEngine(storageMock, providerMock);
  });

  it("throws error for empty queries", async () => {
    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "   ", limit: 10 };
    await expect(engine.search(query)).rejects.toThrow("Search query cannot be empty.");
  });

  it("throws error for invalid limits", async () => {
    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "test", limit: -5 };
    await expect(engine.search(query)).rejects.toThrow("Search limit must be greater than 0.");
  });

  it("performs hybrid ranking and deterministic tie-breaking", async () => {
    // Two chunks with identical scores must be tie-broken by filePath, then startLine, then symbolName
    const chunkA = { id: "c1", filePath: "b.ts", startLine: 10, endLine: 20, content: "test auth", symbolName: "auth", symbolKind: "function" };
    const chunkB = { id: "c2", filePath: "a.ts", startLine: 10, endLine: 20, content: "test auth", symbolName: "auth", symbolKind: "function" };
    
    storageMock.vectorSearch.mockResolvedValue([
      { chunkId: "c1", score: 0.8 },
      { chunkId: "c2", score: 0.8 }
    ]);
    
    storageMock.searchLexicalChunks.mockResolvedValue([chunkA, chunkB]);
    storageMock.getChunksByIds.mockResolvedValue([chunkA, chunkB]);
    
    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "test auth", limit: 10 };
    const response = await engine.search(query);
    
    expect(response.results).toHaveLength(2);
    // Tie-break: a.ts comes before b.ts
    expect(response.results[0].filePath).toBe("a.ts");
    expect(response.results[1].filePath).toBe("b.ts");
  });

  it("performs true 1-hop graph expansion for downstream dependencies", async () => {
    const chunkBase = { id: "c1", filePath: "src/auth/login.ts", startLine: 1, endLine: 5, content: "login", symbolName: "login", symbolKind: "function" };
    const chunkNeighbor = { id: "c2", filePath: "src/auth/token.ts", startLine: 1, endLine: 5, content: "token logic", symbolName: "token", symbolKind: "function" };

    // Base candidate matches lexically
    storageMock.searchLexicalChunks.mockResolvedValue([chunkBase]);
    storageMock.getChunksByIds.mockResolvedValue([chunkBase]);

    // Graph indicates login.ts imports token.ts
    storageMock.getDependencyEdges.mockResolvedValue([
      { source: "src/auth/login.ts:imports", target: "src/auth/token.ts:export", type: "imports" }
    ]);

    // Storage mock to return the neighbor chunk when requested by path
    storageMock.getChunksByFilePaths.mockImplementation(async (repoId, paths) => {
      if (paths.includes("src/auth/token.ts")) {
        return [chunkNeighbor];
      }
      return [];
    });

    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "login", limit: 10 };
    const response = await engine.search(query);

    expect(response.results).toHaveLength(2);
    const resultFiles = response.results.map(r => r.filePath);
    
    // The base candidate must appear
    expect(resultFiles).toContain("src/auth/login.ts");
    
    // The graph-expanded neighbor must appear
    expect(resultFiles).toContain("src/auth/token.ts");

    // The neighbor should have a non-zero graph score and 0 semantic/lexical scores
    const neighborResult = response.results.find(r => r.filePath === "src/auth/token.ts");
    expect(neighborResult).toBeDefined();
    expect(neighborResult?.graphScore).toBe(1.0);
    expect(neighborResult?.lexicalScore).toBe(0);
    expect(neighborResult?.semanticScore).toBe(0);
  });

  it("performs true 1-hop graph expansion for upstream dependencies", async () => {
    const chunkBase = { id: "c1", filePath: "src/auth/login.ts", startLine: 1, endLine: 5, content: "login", symbolName: "login", symbolKind: "function" };
    const chunkNeighbor = { id: "c2", filePath: "src/auth/controller.ts", startLine: 1, endLine: 5, content: "controller", symbolName: "controller", symbolKind: "class" };

    storageMock.searchLexicalChunks.mockResolvedValue([chunkBase]);
    storageMock.getChunksByIds.mockResolvedValue([chunkBase]);

    // Graph indicates controller.ts imports login.ts (upstream)
    storageMock.getDependencyEdges.mockResolvedValue([
      { source: "src/auth/controller.ts:imports", target: "src/auth/login.ts:export", type: "imports" }
    ]);

    storageMock.getChunksByFilePaths.mockImplementation(async (repoId, paths) => {
      if (paths.includes("src/auth/controller.ts")) return [chunkNeighbor];
      return [];
    });

    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "login", limit: 10 };
    const response = await engine.search(query);

    const resultFiles = response.results.map(r => r.filePath);
    expect(resultFiles).toContain("src/auth/login.ts");
    expect(resultFiles).toContain("src/auth/controller.ts");

    const neighborResult = response.results.find(r => r.filePath === "src/auth/controller.ts");
    expect(neighborResult?.graphScore).toBe(1.0);
  });

  it("enforces a strict one-hop boundary and prevents recursive expansion", async () => {
    const chunkBase = { id: "c1", filePath: "src/auth/login.ts", startLine: 1, endLine: 5, content: "login", symbolName: "login", symbolKind: "function" };
    const chunkToken = { id: "c2", filePath: "src/auth/token.ts", startLine: 1, endLine: 5, content: "token", symbolName: "token", symbolKind: "function" };
    const chunkSession = { id: "c3", filePath: "src/auth/session.ts", startLine: 1, endLine: 5, content: "session", symbolName: "session", symbolKind: "function" };

    storageMock.searchLexicalChunks.mockResolvedValue([chunkBase]);
    storageMock.getChunksByIds.mockResolvedValue([chunkBase]);

    storageMock.getDependencyEdges.mockResolvedValue([
      { source: "src/auth/login.ts:imports", target: "src/auth/token.ts:export", type: "imports" },
      { source: "src/auth/token.ts:imports", target: "src/auth/session.ts:export", type: "imports" }
    ]);

    storageMock.getChunksByFilePaths.mockImplementation(async (repoId, paths) => {
      const results = [];
      if (paths.includes("src/auth/token.ts")) results.push(chunkToken);
      if (paths.includes("src/auth/session.ts")) results.push(chunkSession);
      return results;
    });

    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "login", limit: 10 };
    const response = await engine.search(query);

    const resultFiles = response.results.map(r => r.filePath);
    expect(resultFiles).toContain("src/auth/login.ts");
    expect(resultFiles).toContain("src/auth/token.ts");
    expect(resultFiles).not.toContain("src/auth/session.ts"); // Boundary respected
  });

  it("respects the MAX_EXPANSION_FILES limit", async () => {
    const chunkBase = { id: "c0", filePath: "src/base.ts", startLine: 1, endLine: 5, content: "base", symbolName: "base", symbolKind: "function" };
    
    storageMock.searchLexicalChunks.mockResolvedValue([chunkBase]);
    storageMock.getChunksByIds.mockResolvedValue([chunkBase]);

    const edges: any[] = [];
    for (let i = 1; i <= 15; i++) {
      edges.push({ source: "src/base.ts:imports", target: `src/neighbor_${i}.ts:export`, type: "imports" });
    }
    storageMock.getDependencyEdges.mockResolvedValue(edges);

    storageMock.getChunksByFilePaths.mockResolvedValue([]);

    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "base", limit: 20 };
    await engine.search(query);

    // Verify getChunksByFilePaths was called with max 10 paths
    expect(storageMock.getChunksByFilePaths).toHaveBeenCalled();
    const calledPaths = storageMock.getChunksByFilePaths.mock.calls[0][1];
    expect(calledPaths.length).toBeLessThanOrEqual(10);
  });

  it("deduplicates multiple dependency edges pointing to the same neighbor", async () => {
    const chunkBase1 = { id: "c1", filePath: "src/base1.ts", startLine: 1, endLine: 5, content: "b1", symbolName: "b1", symbolKind: "function" };
    const chunkBase2 = { id: "c2", filePath: "src/base2.ts", startLine: 1, endLine: 5, content: "b2", symbolName: "b2", symbolKind: "function" };
    
    storageMock.searchLexicalChunks.mockResolvedValue([chunkBase1, chunkBase2]);
    storageMock.getChunksByIds.mockResolvedValue([chunkBase1, chunkBase2]);

    storageMock.getDependencyEdges.mockResolvedValue([
      { source: "src/base1.ts:imports", target: "src/shared.ts:export", type: "imports" },
      { source: "src/base2.ts:imports", target: "src/shared.ts:export", type: "imports" },
      { source: "src/shared.ts:imports", target: "src/base1.ts:export", type: "imports" }
    ]);

    storageMock.getChunksByFilePaths.mockResolvedValue([]);

    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "b1", limit: 10 };
    await engine.search(query);

    expect(storageMock.getChunksByFilePaths).toHaveBeenCalled();
    const calledPaths = storageMock.getChunksByFilePaths.mock.calls[0][1];
    // shared.ts should only be requested once
    expect(calledPaths).toEqual(["src/shared.ts"]);
  });

  // --- P2.2 Lexical Search Tests ---

  it("rewards chunks matching multiple terms higher than single term matches", async () => {
    // "refresh token"
    const chunkMulti = { id: "c1", filePath: "src/refresh.ts", startLine: 1, endLine: 5, content: "function refreshToken", symbolName: "refreshToken", symbolKind: "function" };
    const chunkSingle = { id: "c2", filePath: "src/other.ts", startLine: 1, endLine: 5, content: "function refreshSomething", symbolName: "refreshSomething", symbolKind: "function" };

    storageMock.searchLexicalChunks.mockResolvedValue([chunkMulti, chunkSingle]);
    storageMock.getChunksByIds.mockResolvedValue([chunkMulti, chunkSingle]);
    storageMock.getDependencyEdges.mockResolvedValue([]);
    
    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "refresh token", limit: 10 };
    const response = await engine.search(query);

    const rMulti = response.results.find(r => r.chunkId === "c1")!;
    const rSingle = response.results.find(r => r.chunkId === "c2")!;

    expect(rMulti.lexicalScore).toBeGreaterThan(rSingle.lexicalScore);
  });

  it("gives exact symbol match an explicit advantage over partial content matches", async () => {
    // Query "token"
    const chunkExact = { id: "c1", filePath: "src/types.ts", startLine: 1, endLine: 5, content: "type Token = string", symbolName: "token", symbolKind: "type" };
    const chunkPartial = { id: "c2", filePath: "src/parser.ts", startLine: 1, endLine: 5, content: "function parseTokenString", symbolName: "parseTokenString", symbolKind: "function" };

    storageMock.searchLexicalChunks.mockResolvedValue([chunkExact, chunkPartial]);
    storageMock.getChunksByIds.mockResolvedValue([chunkExact, chunkPartial]);
    storageMock.getDependencyEdges.mockResolvedValue([]);
    
    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "token", limit: 10 };
    const response = await engine.search(query);

    const rExact = response.results.find(r => r.chunkId === "c1")!;
    const rPartial = response.results.find(r => r.chunkId === "c2")!;

    expect(rExact.lexicalScore).toBeGreaterThan(rPartial.lexicalScore);
    expect(rExact.lexicalScore).toBe(1.0);
    expect(rPartial.lexicalScore).toBeLessThanOrEqual(0.9);
  });

  it("requests a wider lexical candidate pool but strictly enforces final query limit", async () => {
    const chunkDummy = { id: "c1", filePath: "src/dummy.ts", startLine: 1, endLine: 5, content: "dummy", symbolName: "dummy", symbolKind: "function" };
    
    const chunks = Array.from({ length: 15 }, (_, i) => ({ ...chunkDummy, id: `c${i}` }));
    
    storageMock.searchLexicalChunks.mockResolvedValue(chunks);
    storageMock.getChunksByIds.mockResolvedValue(chunks);
    storageMock.getDependencyEdges.mockResolvedValue([]);

    const limit = 5;
    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "dummy search term", limit };
    const response = await engine.search(query);

    expect(storageMock.searchLexicalChunks).toHaveBeenCalledWith(
      "r1",
      expect.any(Array),
      expect.any(Number)
    );

    const calledLimit = storageMock.searchLexicalChunks.mock.calls[0][2];
    expect(calledLimit).toBeGreaterThan(limit);
    expect(calledLimit).toBe(50);

    expect(response.results.length).toBeLessThanOrEqual(limit);
  });

  // --- P2.3 Hybrid Ranking Tests ---

  it("ensures exact symbol beats a strong semantic-only candidate", async () => {
    const chunkExact = { id: "c1", filePath: "src/auth.ts", startLine: 1, endLine: 5, content: "class AuthService {}", symbolName: "AuthService", symbolKind: "class" };
    const chunkSemantic = { id: "c2", filePath: "src/other.ts", startLine: 1, endLine: 5, content: "class SomethingElse {}", symbolName: "SomethingElse", symbolKind: "class" };

    storageMock.vectorSearch.mockResolvedValue([{ chunkId: "c2", score: 0.9 }]);
    storageMock.searchLexicalChunks.mockResolvedValue([chunkExact]);
    storageMock.getChunksByIds.mockResolvedValue([chunkExact, chunkSemantic]);
    storageMock.getDependencyEdges.mockResolvedValue([]);

    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "AuthService", limit: 10 };
    const response = await engine.search(query);

    expect(response.results.length).toBe(2);
    expect(response.results[0].chunkId).toBe("c1");
    expect(response.results[0].exactMatch).toBe(true);
    expect(response.results[1].chunkId).toBe("c2");
  });

  it("gives existing candidate graph credit when structurally connected", async () => {
    const chunkA = { id: "cA", filePath: "src/a.ts", startLine: 1, endLine: 5, content: "A", symbolName: "A", symbolKind: "class" };
    const chunkB = { id: "cB", filePath: "src/b.ts", startLine: 1, endLine: 5, content: "B", symbolName: "B", symbolKind: "class" };

    storageMock.vectorSearch.mockResolvedValue([{ chunkId: "cA", score: 0.8 }]);
    storageMock.searchLexicalChunks.mockResolvedValue([chunkB]);
    storageMock.getChunksByIds.mockResolvedValue([chunkA, chunkB]);
    
    storageMock.getDependencyEdges.mockResolvedValue([
      { source: "src/a.ts:imports", target: "src/b.ts:export", type: "imports" }
    ]);
    storageMock.getChunksByFilePaths.mockResolvedValue([]);

    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "test", limit: 10 };
    const response = await engine.search(query);

    const rA = response.results.find(r => r.chunkId === "cA")!;
    const rB = response.results.find(r => r.chunkId === "cB")!;

    expect(rA.graphScore).toBe(1.0);
    expect(rB.graphScore).toBe(1.0);
  });

  it("keeps pure graph-only candidate with meaningful but bounded influence", async () => {
    const chunkSem = { id: "c1", filePath: "src/sem.ts", startLine: 1, endLine: 5, content: "sem", symbolName: "sem", symbolKind: "class" };
    const chunkGraph = { id: "c2", filePath: "src/graph.ts", startLine: 1, endLine: 5, content: "graph", symbolName: "graph", symbolKind: "class" };

    storageMock.vectorSearch.mockResolvedValue([{ chunkId: "c1", score: 0.1 }]); 
    storageMock.searchLexicalChunks.mockResolvedValue([]);
    storageMock.getChunksByIds.mockResolvedValue([chunkSem]);
    
    storageMock.getDependencyEdges.mockResolvedValue([
      { source: "src/sem.ts:imports", target: "src/graph.ts:export", type: "imports" }
    ]);
    storageMock.getChunksByFilePaths.mockResolvedValue([chunkGraph]);

    const query: SearchQuery = { repositoryId: "r1", repositoryPath: "/", text: "test", limit: 10 };
    const response = await engine.search(query);

    const rSem = response.results.find(r => r.chunkId === "c1")!;
    const rGraph = response.results.find(r => r.chunkId === "c2")!;

    expect(rGraph.graphScore).toBe(1.0);
    expect(rGraph.finalScore).toBeGreaterThan(rSem.finalScore);
  });
});
