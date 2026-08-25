export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export class EmbeddingConfigurationError extends EmbeddingError {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingConfigurationError";
  }
}

export class EmbeddingProviderError extends EmbeddingError {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingProviderError";
  }
}
