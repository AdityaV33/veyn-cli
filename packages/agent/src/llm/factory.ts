import { GeminiAdapter } from "./gemini.js";
import { ResilientLLMAdapter } from "./resilient.js";
import { LLMAdapter } from "./index.js";

export interface LLMConfig {
  provider: "gemini";
  apiKey: string;
  primaryModel: string;
  fallbackModel: string;
}

const DEFAULT_PRIMARY_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_FALLBACK_MODEL = "gemini-3.8-flash";

/**
 * Load LLM configuration from environment variables.
 * Throws if required variables are missing.
 */
export function loadLLMConfig(): LLMConfig {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Configuration Error: GEMINI_API_KEY environment variable is missing.\n" +
      "Veyn requires Gemini API access for reasoning.\n" +
      "Please configure GEMINI_API_KEY and try again."
    );
  }

  return {
    provider: "gemini",
    apiKey,
    primaryModel: process.env.GEMINI_PRIMARY_MODEL || DEFAULT_PRIMARY_MODEL,
    fallbackModel: process.env.GEMINI_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL,
  };
}

/**
 * Create a resilient LLM adapter with primary + fallback.
 * The returned adapter automatically retries on model-availability
 * errors using the fallback model.
 */
export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  const primary = new GeminiAdapter(config.apiKey, config.primaryModel);
  const fallback = new GeminiAdapter(config.apiKey, config.fallbackModel);
  return new ResilientLLMAdapter(primary, fallback);
}
