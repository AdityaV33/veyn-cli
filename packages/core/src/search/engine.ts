import { IndexStorage, PersistenceError } from "../persistence/index.js";
import { EmbeddingProvider, CodeChunk } from "../embeddings/index.js";
import { SearchQuery, SearchResponse, SearchResult, SearchWeights } from "./types.js";

const MAX_EXPANSION_FILES = 10;

export class SearchEngine {
  private storage: IndexStorage;
  private provider: EmbeddingProvider;

  public weights: SearchWeights = {
    semantic: 0.6,
    lexical: 0.3,
    graph: 0.1
  };

  constructor(storage: IndexStorage, provider: EmbeddingProvider) {
    this.storage = storage;
    this.provider = provider;
  }

  public async search(query: SearchQuery): Promise<SearchResponse> {
    if (!query.text || query.text.trim().length === 0) {
      throw new Error("Search query cannot be empty.");
    }
    if (query.limit <= 0) {
      throw new Error("Search limit must be greater than 0.");
    }

    const terms = query.text.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    let semanticCandidates: { chunkId: string, score: number }[] = [];

    // 1. Semantic Search
    try {
      // Mock embedding query creation (the provider embed() requires CodeChunk, but we can bypass or mock)
      // Actually GroqEmbeddingProvider embed() expects CodeChunk[].
      // We should probably add an embedQuery() to the provider or just fake a CodeChunk.
      const queryChunk: CodeChunk = {
        id: "query",
        filePath: "query",
        startLine: 1,
        endLine: 1,
        content: query.text,
        symbolName: null,
        symbolKind: null
      };
      const queryEmbeddings = await this.provider.embed([queryChunk]);
      if (queryEmbeddings.length > 0) {
        semanticCandidates = await this.storage.vectorSearch(query.repositoryId, queryEmbeddings[0].vector, query.limit);
      }
    } catch (err: any) {
      if (err instanceof PersistenceError) {
        throw err; // Re-throw to be handled by CLI
      }
      // If Groq fails
      throw new Error(`Embedding generation failed: ${err.message}`, { cause: err });
    }

    // 2. Lexical Search
    const lexicalLimit = Math.max(query.limit * 3, 50);
    const lexicalChunks = await this.storage.searchLexicalChunks(query.repositoryId, terms, lexicalLimit);

    // 3. Merge candidate IDs
    const candidateIds = new Set<string>();
    const semanticScoreMap = new Map<string, number>();
    const lexicalScoreMap = new Map<string, number>();
    const exactMatchIds = new Set<string>();

    for (const sc of semanticCandidates) {
      candidateIds.add(sc.chunkId);
      semanticScoreMap.set(sc.chunkId, sc.score);
    }

    for (const lc of lexicalChunks) {
      candidateIds.add(lc.id);

      let termScoreSum = 0;
      const content = lc.content.toLowerCase();
      const path = lc.filePath.toLowerCase();
      const sym = lc.symbolName ? lc.symbolName.toLowerCase() : "";

      const exactSymbolMatch = sym === query.text.toLowerCase();

      for (const term of terms) {
        let termScore = 0;
        if (sym.includes(term)) termScore += 0.5;
        if (path.includes(term)) termScore += 0.3;
        if (content.includes(term)) termScore += 0.2;

        termScoreSum += Math.min(1.0, termScore);
      }

      let lexScore = 0;
      if (exactSymbolMatch) {
        lexScore = 1.0;
        exactMatchIds.add(lc.id);
      } else if (terms.length > 0) {
        const termCoverageScore = termScoreSum / terms.length;
        lexScore = Math.min(0.9, termCoverageScore);
      }

      lexicalScoreMap.set(lc.id, lexScore);
    }

    // Fetch all actual chunks for candidates
    const allCandidateChunks = await this.storage.getChunksByIds(query.repositoryId, Array.from(candidateIds));
    const chunkMap = new Map<string, CodeChunk>();
    for (const chunk of allCandidateChunks) {
      chunkMap.set(chunk.id, chunk);
    }

    // 4. Graph Expansion
    const depEdges = await this.storage.getDependencyEdges(query.repositoryId);
    const baseCandidateFiles = new Set<string>(allCandidateChunks.map(c => c.filePath));
    const neighborFiles = new Set<string>();
    const existingNeighborFiles = new Set<string>();

    for (const edge of depEdges) {
      const sourceFile = edge.source.split(":")[0];
      const targetFile = edge.target.split(":")[0];

      // 1-hop upstream/downstream:
      if (baseCandidateFiles.has(sourceFile)) {
        if (!baseCandidateFiles.has(targetFile)) neighborFiles.add(targetFile);
        else existingNeighborFiles.add(targetFile);
      }
      if (baseCandidateFiles.has(targetFile)) {
        if (!baseCandidateFiles.has(sourceFile)) neighborFiles.add(sourceFile);
        else existingNeighborFiles.add(sourceFile);
      }
    }

    // Impose bounded maximum
    const expandedFilesToFetch = Array.from(neighborFiles).slice(0, MAX_EXPANSION_FILES);
    const graphBoostMap = new Map<string, number>();

    // Credit existing candidates that are structurally connected
    for (const chunk of allCandidateChunks) {
      if (existingNeighborFiles.has(chunk.filePath)) {
        graphBoostMap.set(chunk.id, 1.0);
      }
    }

    if (expandedFilesToFetch.length > 0) {
      const expandedChunks = await this.storage.getChunksByFilePaths(query.repositoryId, expandedFilesToFetch);

      for (const chunk of expandedChunks) {
        if (!candidateIds.has(chunk.id)) {
          candidateIds.add(chunk.id);
          allCandidateChunks.push(chunk);
          // Assign non-zero graph score because it was discovered via 1-hop graph relationship
          graphBoostMap.set(chunk.id, 1.0);
        }
      }
    }

    // 5. Hybrid Ranking
    const results: SearchResult[] = [];
    for (const chunk of allCandidateChunks) {
      const semScore = semanticScoreMap.get(chunk.id) || 0;
      const lexScore = lexicalScoreMap.get(chunk.id) || 0;
      const grpScore = graphBoostMap.get(chunk.id) || 0;

      const finalScore =
        this.weights.semantic * semScore +
        this.weights.lexical * lexScore +
        this.weights.graph * grpScore;

      results.push({
        chunkId: chunk.id,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbolName: chunk.symbolName,
        content: chunk.content,
        semanticScore: semScore,
        lexicalScore: lexScore,
        graphScore: grpScore,
        finalScore,
        exactMatch: exactMatchIds.has(chunk.id)
      });
    }

    // Deterministic tie-breaking
    results.sort((a, b) => {
      // 1. Exact match absolute priority
      if (a.exactMatch && !b.exactMatch) return -1;
      if (!a.exactMatch && b.exactMatch) return 1;

      // 2. Normal hybrid score
      if (Math.abs(a.finalScore - b.finalScore) > 1e-6) return b.finalScore - a.finalScore;
      if (Math.abs(a.semanticScore - b.semanticScore) > 1e-6) return b.semanticScore - a.semanticScore;
      if (Math.abs(a.lexicalScore - b.lexicalScore) > 1e-6) return b.lexicalScore - a.lexicalScore;
      if (Math.abs(a.graphScore - b.graphScore) > 1e-6) return b.graphScore - a.graphScore;

      const fileCmp = a.filePath.localeCompare(b.filePath);
      if (fileCmp !== 0) return fileCmp;

      if (a.startLine !== b.startLine) return a.startLine - b.startLine;

      const symA = a.symbolName || "";
      const symB = b.symbolName || "";
      return symA.localeCompare(symB);
    });

    return {
      query: query.text,
      results: results.slice(0, query.limit)
    };
  }
}
