import { describe, it, expect, vi } from "vitest";
import { createLLMAdapter, loadLLMConfig } from "../src/llm/factory.js";
import { GeminiAdapter } from "../src/llm/gemini.js";
import { ResilientLLMAdapter } from "../src/llm/resilient.js";

describe("LLM Factory", () => {
  it("9. loadLLMConfig throws if key is missing", () => {
    const old = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    expect(() => loadLLMConfig()).toThrow("Configuration Error");
    process.env.GEMINI_API_KEY = old;
  });
  
  it("10. loadLLMConfig uses defaults", () => {
    const old = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test";
    const conf = loadLLMConfig();
    expect(conf.provider).toBe("gemini");
    expect(conf.primaryModel).toContain("flash");
    process.env.GEMINI_API_KEY = old;
  });
  
  it("11. loadLLMConfig reads custom models", () => {
    const oldKey = process.env.GEMINI_API_KEY;
    const oldModel = process.env.GEMINI_PRIMARY_MODEL;
    process.env.GEMINI_API_KEY = "test";
    process.env.GEMINI_PRIMARY_MODEL = "custom-primary";
    const conf = loadLLMConfig();
    expect(conf.primaryModel).toBe("custom-primary");
    process.env.GEMINI_API_KEY = oldKey;
    process.env.GEMINI_PRIMARY_MODEL = oldModel;
  });
  
  it("12. createLLMAdapter returns ResilientLLMAdapter", () => {
    const adapter = createLLMAdapter({ provider: "gemini", apiKey: "test", primaryModel: "a", fallbackModel: "b" });
    expect(adapter).toBeInstanceOf(ResilientLLMAdapter);
  });
});
