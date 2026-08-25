export interface SearchQuery {
  repositoryId: string;
  repositoryPath: string;
  text: string;
  limit: number;
}

export interface SearchResult {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  content: string;
  semanticScore: number;
  lexicalScore: number;
  graphScore: number;
  finalScore: number;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
}

export interface SearchWeights {
  semantic: number;
  lexical: number;
  graph: number;
}
