import { describe, it, expect, vi } from "vitest";
import { GeminiAdapter } from "../src/llm/gemini.js";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

const { mockGenerateContent } = vi.hoisted(() => {
  return {
    mockGenerateContent: vi.fn().mockResolvedValue({
      text: "Mocked response"
    })
  };
});

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class MockGenAI {
      public models = {
        generateContent: mockGenerateContent
      };
      constructor() {}
    }
  };
});

describe("GeminiAdapter", () => {
  it("1. Initializes with default model", () => expect(new GeminiAdapter("fake")).toBeDefined());
  it("2. Initializes with custom model", () => expect(new GeminiAdapter("fake", "gemini-pro")).toBeDefined());
  it("3. Invokes with HumanMessage", async () => expect(await new GeminiAdapter("fake").invoke([new HumanMessage("H")])).toBe("Mocked response"));
  it("4. Invokes with SystemMessage", async () => expect(await new GeminiAdapter("fake").invoke([new SystemMessage("S")])).toBe("Mocked response"));
  it("5. Invokes with AIMessage", async () => expect(await new GeminiAdapter("fake").invoke([new AIMessage("A")])).toBe("Mocked response"));
  it("6. Handles empty messages", async () => expect(await new GeminiAdapter("fake").invoke([])).toBe("Mocked response"));
  it("7. Sanitizes API keys in errors", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("key=AIzaSyB12345678901234567890123456789012"));
    await expect(new GeminiAdapter("fake").invoke([])).rejects.toThrow("[REDACTED]");
  });
  it("8. Retains safe error messages", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Normal timeout"));
    await expect(new GeminiAdapter("fake").invoke([])).rejects.toThrow("Normal timeout");
  });
});
