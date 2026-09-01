export function extractJSON(raw: string): string {
  // 1. Strip <think>...</think> blocks (defense-in-depth)
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  
  // 2. Strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  
  return cleaned;
}

/**
 * Rough token estimate: ~4 characters per token for English/code mixed content.
 * This is intentionally conservative (overestimates tokens) to stay safely under limits.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Context budget configuration for investigation prompts.
 */
export interface ContextBudget {
  /** Maximum estimated tokens for evidence in a prompt. Default: 2000 */
  maxEvidenceTokens: number;
  /** Maximum characters for a single evidence item before truncation. Default: 1500 */
  maxSingleEvidenceChars: number;
}

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = {
  maxEvidenceTokens: 500,
  maxSingleEvidenceChars: 800,
};

/**
 * Truncate a single evidence string to fit within the per-item character budget.
 * Preserves the header line (tool name + args) and truncates the result body.
 */
export function truncateSingleEvidence(item: string, maxChars: number): string {
  if (item.length <= maxChars) return item;
  return item.slice(0, maxChars) + "\n... [truncated]";
}

/**
 * Apply a token budget to an evidence array.
 * 
 * Strategy:
 * 1. Truncate each individual item to maxSingleEvidenceChars.
 * 2. Take items from most-recent first until the total estimated
 *    token count would exceed maxEvidenceTokens.
 * 3. Return the budgeted items in chronological order.
 * 
 * This ensures the LLM always sees the freshest evidence, and older
 * evidence is dropped (not the investigation state — just the prompt).
 */
export function truncateEvidence(
  evidence: string[],
  budget: ContextBudget = DEFAULT_CONTEXT_BUDGET
): string[] {
  if (evidence.length === 0) return [];

  // Step 1: truncate individual items
  const truncated = evidence.map(item =>
    truncateSingleEvidence(item, budget.maxSingleEvidenceChars)
  );

  // Step 2: walk backwards (most recent first), accumulate until budget is hit
  let totalTokens = 0;
  let startIndex = truncated.length;

  for (let i = truncated.length - 1; i >= 0; i--) {
    const itemTokens = estimateTokens(truncated[i]);
    if (totalTokens + itemTokens > budget.maxEvidenceTokens) break;
    totalTokens += itemTokens;
    startIndex = i;
  }

  // Step 3: return chronological order (oldest-kept first)
  return truncated.slice(startIndex);
}
