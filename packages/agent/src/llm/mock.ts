import { BaseMessage } from "@langchain/core/messages";
import { LLMAdapter } from "./index.js";

export class MockLLMAdapter implements LLMAdapter {
  private responses: string[];
  public invokedMessages: BaseMessage[][] = [];

  constructor(responses: string[]) {
    this.responses = responses;
  }

  public async invoke(messages: BaseMessage[]): Promise<string> {
    this.invokedMessages.push(messages);
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error("MockLLMAdapter exhausted available responses");
    }
    return response;
  }
}
