import { BaseMessage } from "@langchain/core/messages";
import Groq from "groq-sdk";
import { LLMAdapter } from "./index.js";

export class GroqAdapter implements LLMAdapter {
  private client: Groq;
  private model: string;

  constructor(apiKey: string | undefined, model: string = "llama-3.1-70b-versatile") {
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  public async invoke(messages: BaseMessage[]): Promise<string> {
    const formattedMessages = messages.map(m => {
       const type = m._getType();
       let role: "user" | "assistant" | "system" | "tool" = "user";
       if (type === "ai") role = "assistant";
       else if (type === "system") role = "system";
       else if (type === "tool") role = "tool";
       
       return {
          role,
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content)
       };
    });

    const completion = await this.client.chat.completions.create({
      messages: formattedMessages as any,
      model: this.model,
    });

    return completion.choices[0]?.message?.content || "";
  }
}
