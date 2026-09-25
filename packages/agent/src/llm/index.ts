import { BaseMessage } from "@langchain/core/messages";

export interface LLMAdapter {
  invoke(messages: BaseMessage[]): Promise<string>;
}

export * from "./mock.js";
export * from "./normalize.js";
export * from "./gemini.js";
export * from "./factory.js";
export * from "./resilient.js";
