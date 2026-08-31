import { BaseMessage } from "@langchain/core/messages";

export interface LLMAdapter {
  invoke(messages: BaseMessage[]): Promise<string>;
}

export * from "./groq.js";
export * from "./mock.js";
