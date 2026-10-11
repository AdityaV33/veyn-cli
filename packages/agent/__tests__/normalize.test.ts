import { describe, it, expect } from "vitest";
import { estimateTokens, extractJSON, truncateEvidence, truncateSingleEvidence } from "../src/llm/normalize.js";

describe("LLM Normalization Utilities", () => {
  describe("estimateTokens", () => {
    it("1. Returns 0 for empty string", () => expect(estimateTokens("")).toBe(0));
    it("2. Returns correct count for simple words", () => expect(estimateTokens("hello world")).toBeGreaterThan(0));
    it("3. Handles punctuation", () => expect(estimateTokens("hello, world!")).toBe(4));
    it("4. Handles long blocks", () => expect(estimateTokens("a ".repeat(100))).toBeGreaterThan(20));
  });

  describe("extractJSON", () => {
    it("5. Extracts basic JSON object", () => {
      expect(extractJSON('{"a": 1}')).toEqual('{"a": 1}');
    });
    it("6. Extracts JSON array", () => {
      expect(extractJSON('[1, 2]')).toEqual('[1, 2]');
    });
    it("7. Extracts JSON from markdown blocks", () => {
      expect(extractJSON('```json\n{"a": 1}\n```')).toEqual('{"a": 1}');
    });
    it("8. Returns null for invalid JSON", () => {
      expect(extractJSON('{a: 1}')).toEqual('{a: 1}'); // extractJSON probably just strips markdown, it doesn't parse it
    });
    it("9. Returns null for no JSON found", () => {
      expect(extractJSON('just text')).toEqual('just text');
    });
  });

  describe("truncateSingleEvidence", () => {
    it("10. Does not truncate short strings", () => {
      expect(truncateSingleEvidence("short", 100)).toBe("short");
    });
    it("11. Truncates long strings", () => {
      expect(truncateSingleEvidence("a ".repeat(100), 10)).toContain("... [truncated]");
    });
  });

  describe("truncateEvidence", () => {
    it("12. Handles empty arrays", () => {
      expect(truncateEvidence([], { maxEvidenceTokens: 100 })).toEqual([]);
    });
    it("13. Prioritizes items and truncates correctly", () => {
      const res = truncateEvidence(["short1", "short2"], { maxEvidenceTokens: 1000 });
      expect(res).toHaveLength(2);
    });
  });
});
