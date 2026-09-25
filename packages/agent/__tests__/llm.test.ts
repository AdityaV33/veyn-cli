import { describe, it, expect } from "vitest";
import { extractJSON, estimateTokens, truncateSingleEvidence, truncateEvidence } from "../src/llm/normalize.js";

describe("LLM Utilities", () => {

  describe("extractJSON", () => {
    it("passes clean JSON through unchanged", () => {
      const input = '{"status":"ok"}';
      expect(extractJSON(input)).toBe(input);
    });

    it("strips markdown fences", () => {
      const input = '```json\n{"status":"ok"}\n```';
      expect(extractJSON(input)).toBe('{"status":"ok"}');
    });

    it("strips <think> blocks", () => {
      const input = '<think>\nI am thinking...\n</think>\n{"status":"ok"}';
      expect(extractJSON(input)).toBe('{"status":"ok"}');
    });

    it("strips both <think> blocks and markdown fences", () => {
      const input = '<think>\nI am thinking...\n</think>\n```json\n{"status":"ok"}\n```';
      expect(extractJSON(input)).toBe('{"status":"ok"}');
    });
  });

  describe("estimateTokens", () => {
    it("returns a positive number for non-empty strings", () => {
      expect(estimateTokens("hello world")).toBeGreaterThan(0);
    });

    it("returns 0 for empty strings", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("scales roughly with string length", () => {
      const short = estimateTokens("hello");
      const long = estimateTokens("hello".repeat(100));
      expect(long).toBeGreaterThan(short);
    });
  });

  describe("truncateSingleEvidence", () => {
    it("returns short items unchanged", () => {
      const item = "Result of search_code: found foo";
      expect(truncateSingleEvidence(item, 500)).toBe(item);
    });

    it("truncates items longer than maxChars", () => {
      const item = "x".repeat(2000);
      const result = truncateSingleEvidence(item, 500);
      expect(result.length).toBeLessThan(2000);
      expect(result).toContain("... [truncated]");
    });
  });

  describe("truncateEvidence", () => {
    it("returns empty array for empty evidence", () => {
      expect(truncateEvidence([])).toEqual([]);
    });

    it("returns all items when within budget", () => {
      const evidence = ["short item 1", "short item 2"];
      expect(truncateEvidence(evidence)).toEqual(evidence);
    });

    it("drops oldest evidence when total exceeds budget", () => {
      // Each item ~1500 chars → ~428 tokens at 3.5 chars/token
      // With default budget of 2000 tokens, only ~4 items fit
      const largeItem = "x".repeat(1500);
      const evidence = Array.from({ length: 10 }, (_, i) => `item-${i}: ${largeItem}`);
      
      const budgeted = truncateEvidence(evidence, {
        maxEvidenceTokens: 2000,
        maxSingleEvidenceChars: 5000, // don't truncate individual items for this test
      });
      
      expect(budgeted.length).toBeLessThan(evidence.length);
      // Should keep the most recent items
      expect(budgeted[budgeted.length - 1]).toContain("item-9");
    });

    it("truncates individual items before windowing", () => {
      const hugeItem = "x".repeat(5000);
      const evidence = [hugeItem];
      
      const budgeted = truncateEvidence(evidence, {
        maxEvidenceTokens: 2000,
        maxSingleEvidenceChars: 500,
      });
      
      expect(budgeted.length).toBe(1);
      expect(budgeted[0].length).toBeLessThan(5000);
      expect(budgeted[0]).toContain("... [truncated]");
    });

    it("preserves chronological order of kept items", () => {
      const evidence = ["first", "second", "third", "fourth"];
      const budgeted = truncateEvidence(evidence);
      // All small items should be kept in order
      expect(budgeted).toEqual(evidence);
    });
  });
});

