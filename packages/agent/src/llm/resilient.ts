import { LLMAdapter } from "./index.js";

/**
 * Errors that indicate model-level availability failures
 * and should trigger a fallback retry.
 */
const MODEL_AVAILABILITY_PATTERNS = [
  "model not found",
  "model is not available",
  "model is not supported",
  "decommissioned",
  "does not exist",
  "not available in your region",
  "model has been deprecated",
  "tool_use_failed",
];

/**
 * HTTP status codes that indicate model unavailability
 * (as opposed to client errors or rate limits).
 */
const RETRYABLE_STATUS_CODES = [404, 429, 503];

function isModelAvailabilityError(error: any): boolean {
  const message = (error?.message ?? String(error)).toLowerCase();
  const status = error?.status ?? error?.statusCode ?? error?.code;

  if (typeof status === "number" && RETRYABLE_STATUS_CODES.includes(status)) {
    return true;
  }

  return MODEL_AVAILABILITY_PATTERNS.some(pattern => message.includes(pattern));
}

/**
 * Wraps a primary and fallback LLMAdapter, retrying on
 * model-availability errors only.
 *
 * Does NOT retry on: validation errors, auth errors,
 * rate limits, context overflow, or application-level failures.
 */
export class ResilientLLMAdapter implements LLMAdapter {
  constructor(
    private primary: LLMAdapter,
    private fallback: LLMAdapter,
    private dynamicFallbackBuilder?: () => Promise<LLMAdapter>
  ) {}

  public async invoke(messages: import("@langchain/core/messages").BaseMessage[]): Promise<string> {
    try {
      return await this.primary.invoke(messages);
    } catch (primaryError: any) {
      if (!isModelAvailabilityError(primaryError)) {
        throw primaryError;
      }

      try {
        return await this.fallback.invoke(messages);
      } catch (fallbackError: any) {
        if (!isModelAvailabilityError(fallbackError) || !this.dynamicFallbackBuilder) {
          throw new Error("Groq reasoning models are currently unavailable.");
        }

        try {
          const dynamicAdapter = await this.dynamicFallbackBuilder();
          return await dynamicAdapter.invoke(messages);
        } catch (dynamicError: any) {
          throw new Error("Groq reasoning models are currently unavailable.");
        }
      }
    }
  }
}
