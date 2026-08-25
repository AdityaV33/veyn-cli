export interface CodeChunk {
  id: string; // Deterministic hash
  filePath: string;
  startLine: number;
  endLine: number;
  symbolName: string | null;
  symbolKind: string | null;
  content: string;
}

export interface EmbeddingResult {
  chunkId: string;
  vector: number[];
  dimensions?: number;
}

export interface EmbeddingProviderConfig {
  apiKey: string;
  model?: string;
  batchSize?: number;
}
