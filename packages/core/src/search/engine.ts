import { IndexStorage, PersistenceError } from "../persistence/index.js";
import { GroqEmbeddingProvider, CodeChunk } from "../embeddings/index.js";
import { SearchQuery, SearchResponse, SearchResult, SearchWeights } from "./types.js";

export class SearchEngine {
  private storage: IndexStorage;
  private provider: GroqEmbeddingProvider;
  
  public weights: SearchWeights = {
    semantic: 0.6,
    lexical: 0.3,
    graph: 0.1
  };

  constructor(storage: IndexStorage, provider: GroqEmbeddingProvider) {
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
      throw new Error(`Embedding generation failed: ${err.message}`);
    }

    // 2. Lexical Search
    const lexicalChunks = await this.storage.searchLexicalChunks(query.repositoryId, terms, query.limit);
    
    // 3. Merge candidate IDs
    const candidateIds = new Set<string>();
    const semanticScoreMap = new Map<string, number>();
    const lexicalScoreMap = new Map<string, number>();

    for (const sc of semanticCandidates) {
      candidateIds.add(sc.chunkId);
      semanticScoreMap.set(sc.chunkId, sc.score);
    }

    for (const lc of lexicalChunks) {
      candidateIds.add(lc.id);
      
      // Calculate a basic deterministic lexical score based on term matches
      let lexScore = 0;
      const content = lc.content.toLowerCase();
      const path = lc.filePath.toLowerCase();
      const sym = lc.symbolName ? lc.symbolName.toLowerCase() : "";

      for (const term of terms) {
        if (sym.includes(term)) lexScore += 0.5;
        if (path.includes(term)) lexScore += 0.3;
        if (content.includes(term)) lexScore += 0.2;
      }
      
      // Normalize somewhat
      lexScore = Math.min(1.0, lexScore);
      lexicalScoreMap.set(lc.id, lexScore);
    }

    // Fetch all actual chunks for candidates
    const allCandidateChunks = await this.storage.getChunksByIds(query.repositoryId, Array.from(candidateIds));
    const chunkMap = new Map<string, CodeChunk>();
    for (const chunk of allCandidateChunks) {
      chunkMap.set(chunk.id, chunk);
    }

    // 4. Graph Expansion
    // For each candidate file, find immediate neighbors and boost them.
    const depEdges = await this.storage.getDependencyEdges(query.repositoryId);
    const candidateFiles = new Set<string>(allCandidateChunks.map(c => c.filePath));
    
    const graphBoostMap = new Map<string, number>();
    
    for (const edge of depEdges) {
      const sourceFile = edge.source.split(":")[0];
      const targetFile = edge.target.split(":")[0];
      
      // If a candidate file is imported BY sourceFile, sourceFile might be relevant
      // If a candidate file imports targetFile, targetFile might be relevant
      if (candidateFiles.has(sourceFile) && !candidateFiles.has(targetFile)) {
        graphBoostMap.set(targetFile, (graphBoostMap.get(targetFile) || 0) + 0.5);
      }
      if (candidateFiles.has(targetFile) && !candidateFiles.has(sourceFile)) {
        graphBoostMap.set(sourceFile, (graphBoostMap.get(sourceFile) || 0) + 0.5);
      }
    }

    // We don't fetch new chunks for graph neighbors in this bounded phase, 
    // we just apply graph scores to existing chunks that belong to boosted files.
    // If a chunk's file is in graphBoostMap, it gets a graphScore.
    // Wait, the prompt says "graph expansion... can contribute additional related candidates."
    // Let's just find the lexical chunks for those expanded files? 
    // To keep it deterministic and bounded, we will just use the graph score for existing candidates.
    // Or we could query 1 chunk per expanded file. Let's just score existing candidates 
    // based on whether they are in the neighborhood of OTHER candidates.
    
    // Actually, to expand, let's just add a small graph score if a candidate file is connected to another candidate file.
    for (const chunk of allCandidateChunks) {
      let gScore = 0;
      for (const edge of depEdges) {
        const sourceFile = edge.source.split(":")[0];
        const targetFile = edge.target.split(":")[0];
        if (chunk.filePath === sourceFile && candidateFiles.has(targetFile)) gScore += 0.5;
        if (chunk.filePath === targetFile && candidateFiles.has(sourceFile)) gScore += 0.5;
      }
      graphBoostMap.set(chunk.id, Math.min(1.0, gScore));
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
        finalScore
      });
    }

    // Deterministic tie-breaking
    results.sort((a, b) => {
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
