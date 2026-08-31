import { z } from "zod";
import { IndexStorage } from "@veyn/core";

export interface ToolContext {
  storage: IndexStorage;
  repositoryId: string;
}

export interface VeynTool<TArgs = any> {
  name: string;
  description: string;
  schema: z.ZodType<TArgs>;
  execute(args: TArgs, context: ToolContext): Promise<any>;
}

export class ToolRegistry {
  private tools = new Map<string, VeynTool>();

  register(tool: VeynTool) {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): VeynTool | undefined {
    return this.tools.get(name);
  }

  getAvailableTools(): { name: string, description: string, schema: any }[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      schema: t.schema
    }));
  }
}
export * from "./core-tools.js";
