import { GroqAdapter } from "./groq.js";
import { ResilientLLMAdapter } from "./resilient.js";
import { LLMAdapter } from "./index.js";

export interface LLMConfig {
  provider: "groq";
  apiKey: string;
  primaryModel: string;
  fallbackModel: string;
}

const DEFAULT_PRIMARY_MODEL = "openai/gpt-oss-20b";
const DEFAULT_FALLBACK_MODEL = "qwen/qwen3.8-27b";

/**
 * Load LLM configuration from environment variables.
 * Throws if required variables are missing.
 */
export function loadLLMConfig(): LLMConfig {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Configuration Error: GROQ_API_KEY environment variable is missing.\n" +
      "Veyn requires Groq API access for reasoning.\n" +
      "Please configure GROQ_API_KEY and try again."
    );
  }

  return {
    provider: "groq",
    apiKey,
    primaryModel: process.env.GROQ_PRIMARY_MODEL || DEFAULT_PRIMARY_MODEL,
    fallbackModel: process.env.GROQ_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
  };
}

/**
 * Create a resilient LLM adapter with primary + fallback.
 * The returned adapter automatically retries on model-availability
 * errors using the fallback model.
 */
export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  const primary = new GroqAdapter(config.apiKey, config.primaryModel);
  const fallback = new GroqAdapter(config.apiKey, config.fallbackModel);

  const dynamicFallbackBuilder = async (): Promise<LLMAdapter> => {
    const baseUrl = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
    const res = await fetch(`${baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`
      }
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch models: ${res.statusText}`);
    }

    const data = await res.json() as { data: { id: string, supported_features?: string[] }[] };

    // Filter to only models that explicitly support Structured Outputs so LangChain doesn't crash
    const capableModels = data.data.filter(m =>
      m.supported_features && m.supported_features.includes("structured_outputs")
    ).map(m => m.id);

    // Pick a fast, stable model that supports JSON if possible.
    const preferredPrefixes = ["llama-3.1", "llama3", "llama", "openai", "qwen"];
    let selectedModel = capableModels.find(m => m !== config.primaryModel && m !== config.fallbackModel && preferredPrefixes.some(p => m.toLowerCase().includes(p)));

    if (!selectedModel) {
      // Pick any capable model as a last resort
      selectedModel = capableModels.find(m => m !== config.primaryModel && m !== config.fallbackModel);
    }

    if (!selectedModel) {
      throw new Error("No other models available on the provider.");
    }

    return new GroqAdapter(config.apiKey, selectedModel);
  };

  return new ResilientLLMAdapter(primary, fallback, dynamicFallbackBuilder);
}
