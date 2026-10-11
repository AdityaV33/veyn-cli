import { BaseMessage } from "@langchain/core/messages";
import Groq from "groq-sdk";
import { LLMAdapter } from "./index.js";

export class GroqAdapter implements LLMAdapter {
  private client: Groq;
  private model: string;

  constructor(apiKey: string | undefined, model: string, maxRetries: number = 2) {
    this.client = new Groq({ apiKey, maxRetries });
    this.model = model;
  }

  public async invoke(messages: BaseMessage[]): Promise<string> {
    const expectsJson = messages.some(m => m._getType() === "system" && typeof m.content === "string" && m.content.toLowerCase().includes("output only a json object"));

    const formattedMessages = messages.map(m => {
       const type = m._getType();
       let role: "user" | "assistant" | "system" | "tool" = "user";
       if (type === "ai") role = "assistant";
       else if (type === "system") {
         role = "system";
         // Instruct models not to emit native tool call tags that crash the Groq backend, only for JSON nodes
         m.content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
         if (expectsJson) {
           m.content += "\n\nCRITICAL: DO NOT emit native function calls. Output raw JSON ONLY.";
         }
       }
       else if (type === "tool") role = "tool";
       
       return {
          role,
          content: m.content
       };
    });

    const options: any = {
      messages: formattedMessages,
      model: this.model,
    };
    if (expectsJson) {
      options.response_format = { type: "json_object" };
    }

    const completion = await this.client.chat.completions.create(options);

    return completion.choices[0]?.message?.content || "";
  }
}
