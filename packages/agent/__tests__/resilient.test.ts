import { describe, it, expect, vi } from "vitest";
import { ResilientLLMAdapter } from "../src/llm/resilient.js";
import { LLMAdapter } from "../src/llm/index.js";
import { HumanMessage } from "@langchain/core/messages";

describe("ResilientLLMAdapter", () => {
  const messages = [new HumanMessage("hi")];

  it("13. Calls primary adapter on success", async () => {
    const primary = { invoke: vi.fn().mockResolvedValue("Primary") } as LLMAdapter;
    const fallback = { invoke: vi.fn() } as LLMAdapter;
    const res = new ResilientLLMAdapter(primary, fallback);
    expect(await res.invoke(messages)).toBe("Primary");
    expect(fallback.invoke).not.toHaveBeenCalled();
  });

  it("14. Falls back on model unavailable 404", async () => {
    const primary = { invoke: vi.fn().mockRejectedValue({ status: 404 }) } as LLMAdapter;
    const fallback = { invoke: vi.fn().mockResolvedValue("Fallback") } as LLMAdapter;
    const res = new ResilientLLMAdapter(primary, fallback);
    expect(await res.invoke(messages)).toBe("Fallback");
  });

  it("15. Falls back on model not found text", async () => {
    const primary = { invoke: vi.fn().mockRejectedValue(new Error("model is not available")) } as LLMAdapter;
    const fallback = { invoke: vi.fn().mockResolvedValue("Fallback") } as LLMAdapter;
    const res = new ResilientLLMAdapter(primary, fallback);
    expect(await res.invoke(messages)).toBe("Fallback");
  });

  it("16. Does not fallback on normal errors", async () => {
    const primary = { invoke: vi.fn().mockRejectedValue(new Error("Context overflow")) } as LLMAdapter;
    const fallback = { invoke: vi.fn() } as LLMAdapter;
    const res = new ResilientLLMAdapter(primary, fallback);
    await expect(res.invoke(messages)).rejects.toThrow("Context overflow");
  });
});
