import { CodeChunk, EmbeddingResult, EmbeddingProviderConfig } from "./types.js";
import { EmbeddingProvider } from "./provider.js";
import { EmbeddingProviderError } from "./errors.js";
import { pipeline, env, FeatureExtractionPipeline } from "@xenova/transformers";

// Configure transformers to not use browser cache, use local model caching
env.useBrowserCache = false;
env.allowLocalModels = true;

export class LocalEmbeddingProvider implements EmbeddingProvider {
  private modelId: string;
  private batchSize: number;
  private extractor: FeatureExtractionPipeline | null = null;
  private loadingPromise: Promise<void> | null = null;

  constructor(config?: EmbeddingProviderConfig) {
    this.modelId = config?.model || "Xenova/bge-small-en-v1.5";
    this.batchSize = config?.batchSize || 100;
  }

  private async initializeExtractor(): Promise<void> {
    if (this.extractor) return;

    if (!this.loadingPromise) {
      this.loadingPromise = (async () => {
        try {
          this.extractor = await pipeline("feature-extraction", this.modelId, {
            quantized: true, // Use ONNX integer quantization to save RAM
          });
        } catch (error: any) {
          throw new EmbeddingProviderError(`Failed to load local embedding model ${this.modelId}: ${error.message}`);
        }
      })();
    }

    await this.loadingPromise;
  }

  public async embed(chunks: CodeChunk[]): Promise<EmbeddingResult[]> {
    if (chunks.length === 0) return [];

    await this.initializeExtractor();
    if (!this.extractor) {
      throw new EmbeddingProviderError("Feature extractor was not initialized correctly.");
    }

    const results: EmbeddingResult[] = [];

    // Process in deterministic batches
    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batch = chunks.slice(i, i + this.batchSize);
      // BGE uses special prefixes: 'search_document: ' for docs, 'search_query: ' for queries.
      // Since we are embedding the documents here, we prepend 'search_document: '
      // (Though Xenova BGE model often does this implicitly or it's standard, we explicitly prepend to be safe for BGE specifically,
      // but if the model handles it differently we can just pass the raw text.
      // Based on BGE docs: passing just the string is fine for docs, 'Represent this sentence for searching relevant passages: ' for queries for bge-large-en, etc.
      // Wait, bge-small-en-v1.5 doesn't strictly need a prefix for documents, only queries usually?
      // Actually, passing the raw string is standard for chunk embedding.

      const inputs = batch.map(c => c.content);

      try {
        const output = await this.extractor(inputs, { pooling: "mean", normalize: true });
        const vectors = output.tolist();

        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j];
          const vector = vectors[j];
          if (vector.length !== 384) {
             throw new EmbeddingProviderError(`Expected 384 dimensions from ${this.modelId}, got ${vector.length}`);
          }

          results.push({
            chunkId: chunk.id,
            vector,
            dimensions: vector.length
          });
        }
      } catch (error: any) {
        throw new EmbeddingProviderError(`Inference failed on local embedding batch: ${error.message}`);
      }
    }

    return results;
  }
}
