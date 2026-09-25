import { BaseMessage } from "@langchain/core/messages";
import { GoogleGenAI } from "@google/genai";
import { LLMAdapter } from "./index.js";

export class GeminiAdapter implements LLMAdapter {
  private client: GoogleGenAI;
  private model: string;

  constructor(apiKey: string, model: string = "gemini-3.1-flash-lite") {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  public async invoke(messages: BaseMessage[]): Promise<string> {
    let systemInstruction: string | undefined;
    const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

    for (const msg of messages) {
      const type = msg._getType();
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

      if (type === "system") {
        systemInstruction = text;
      } else if (type === "ai") {
        contents.push({ role: "model", parts: [{ text }] });
      } else {
        contents.push({ role: "user", parts: [{ text }] });
      }
    }

    try {
      const config: Record<string, unknown> = {};
      if (systemInstruction) {
        config.systemInstruction = systemInstruction;
      }

      const response = await this.client.models.generateContent({
        model: this.model,
        contents,
        config,
      });

      return response.text ?? "";
    } catch (error: any) {
      const message = error?.message ?? String(error);

      // Strip any potential credential leaks from error messages
      const sanitized = message
        .replace(/key[=:]\s*\S+/gi, "key=[REDACTED]")
        .replace(/AIza[A-Za-z0-9_-]{30,}/g, "[REDACTED]");

      throw new Error(`Gemini API error: ${sanitized}`);
    }
  }
}
