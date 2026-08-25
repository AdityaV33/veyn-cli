import { CodeChunk, EmbeddingResult } from "./types.js";

export interface EmbeddingProvider {
  embed(chunks: CodeChunk[]): Promise<EmbeddingResult[]>;
}
