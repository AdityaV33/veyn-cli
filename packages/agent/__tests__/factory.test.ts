import { describe, it, expect, vi } from "vitest";
import { createLLMAdapter, loadLLMConfig } from "../src/llm/factory.js";
import { GroqAdapter } from "../src/llm/groq.js";
import { ResilientLLMAdapter } from "../src/llm/resilient.js";

describe("LLM Factory", () => {
  it("9. loadLLMConfig throws if key is missing", () => {
    const old = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    expect(() => loadLLMConfig()).toThrow("Configuration Error");
    process.env.GROQ_API_KEY = old;
  });
  
  it("10. loadLLMConfig uses defaults", () => {
    const old = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = "test";
    const conf = loadLLMConfig();
    expect(conf.provider).toBe("groq");
    expect(conf.primaryModel).toBeDefined();
    process.env.GROQ_API_KEY = old;
  });
  
  it("11. loadLLMConfig reads custom models", () => {
    const oldKey = process.env.GROQ_API_KEY;
    const oldModel = process.env.GROQ_PRIMARY_MODEL;
    process.env.GROQ_API_KEY = "test";
    process.env.GROQ_PRIMARY_MODEL = "custom-primary";
    const conf = loadLLMConfig();
    expect(conf.primaryModel).toBe("custom-primary");
    process.env.GROQ_API_KEY = oldKey;
    process.env.GROQ_PRIMARY_MODEL = oldModel;
  });
  
  it("12. createLLMAdapter returns ResilientLLMAdapter", () => {
    const adapter = createLLMAdapter({ provider: "groq", apiKey: "test", primaryModel: "a", fallbackModel: "b" });
    expect(adapter).toBeInstanceOf(ResilientLLMAdapter);
  });
});
