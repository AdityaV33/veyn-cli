import { describe, it, expect, vi } from "vitest";
import { GroqAdapter } from "../src/llm/groq.js";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

const { mockCreate } = vi.hoisted(() => {
  return {
    mockCreate: vi.fn().mockResolvedValue({
      choices: [{ message: { content: "Mocked response" } }]
    })
  };
});

vi.mock("groq-sdk", () => {
  return {
    default: class MockGroq {
      public chat = {
        completions: {
          create: mockCreate
        }
      };
      constructor() {}
    }
  };
});

describe("GroqAdapter", () => {
  it("1. Initializes with default model", () => expect(new GroqAdapter("fake")).toBeDefined());
  it("2. Initializes with custom model", () => expect(new GroqAdapter("fake", "llama-3.1-8b-instant")).toBeDefined());
  it("3. Invokes with HumanMessage", async () => expect(await new GroqAdapter("fake").invoke([new HumanMessage("H")])).toBe("Mocked response"));
  it("4. Invokes with SystemMessage", async () => expect(await new GroqAdapter("fake").invoke([new SystemMessage("S")])).toBe("Mocked response"));
  it("5. Invokes with AIMessage", async () => expect(await new GroqAdapter("fake").invoke([new AIMessage("A")])).toBe("Mocked response"));
  it("6. Handles empty messages", async () => expect(await new GroqAdapter("fake").invoke([])).toBe("Mocked response"));
  it("7. Retains safe error messages", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Normal timeout"));
    await expect(new GroqAdapter("fake").invoke([])).rejects.toThrow("Normal timeout");
  });
});
