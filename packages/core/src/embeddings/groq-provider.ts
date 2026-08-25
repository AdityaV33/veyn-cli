import { CodeChunk, EmbeddingResult, EmbeddingProviderConfig } from "./types.js";
import { EmbeddingProvider } from "./provider.js";
import { EmbeddingConfigurationError, EmbeddingProviderError } from "./errors.js";

interface GroqEmbeddingResponse {
  data?: Array<{
    embedding: number[];
    index: number;
  }>;
  error?: {
    message: string;
    type: string;
  };
}

export class GroqEmbeddingProvider implements EmbeddingProvider {
  private apiKey: string;
  private model: string;
  private batchSize: number;

  constructor(config: EmbeddingProviderConfig) {
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new EmbeddingConfigurationError("Groq API key is required.");
    }
    this.apiKey = config.apiKey;
    this.model = config.model || "nomic-embed-text-v1_5";
    this.batchSize = config.batchSize || 100;
  }

  public async embed(chunks: CodeChunk[]): Promise<EmbeddingResult[]> {
    if (chunks.length === 0) return [];

    const results: EmbeddingResult[] = [];
    
    // Deterministic batching
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      const batchResults = await this.embedBatch(batch);
      results.push(...batchResults);
    }

    return results;
  }

  private async embedBatch(batch: CodeChunk[]): Promise<EmbeddingResult[]> {
    const inputs = batch.map(c => c.content);

    let response: Response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/embeddings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          input: inputs,
          model: this.model,
          encoding_format: "float"
        })
      });
    } catch (err: any) {
      throw new EmbeddingProviderError(`Network error communicating with Groq: ${err.message}`);
    }

    const json = (await response.json()) as GroqEmbeddingResponse;

    if (!response.ok || json.error) {
      const msg = json.error?.message || response.statusText;
      throw new EmbeddingProviderError(`Groq API returned an error: ${msg}`);
    }

    if (!json.data || !Array.isArray(json.data)) {
      throw new EmbeddingProviderError("Groq API returned an unexpected response format.");
    }

    // Preserve deterministic mapping using the API's returned index
    const results: EmbeddingResult[] = [];
    for (const item of json.data) {
      const chunk = batch[item.index];
      if (!chunk) {
        throw new EmbeddingProviderError("Groq API returned an out-of-bounds index.");
      }
      
      results.push({
        chunkId: chunk.id,
        vector: item.embedding,
        dimensions: item.embedding.length
      });
    }

    return results;
  }
}
