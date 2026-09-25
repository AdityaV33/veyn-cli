import { GroqAdapter } from "./groq.js";
import { ResilientLLMAdapter } from "./resilient.js";
import { LLMAdapter } from "./index.js";

export interface LLMConfig {
  provider: "groq";
  apiKey: string;
  primaryModel: string;
  fallbackModel: string;
}

const DEFAULT_PRIMARY_MODEL = "llama-3.1-70b-versatile";
const DEFAULT_FALLBACK_MODEL = "llama-3.1-8b-instant";

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
  return new ResilientLLMAdapter(primary, fallback);
}
