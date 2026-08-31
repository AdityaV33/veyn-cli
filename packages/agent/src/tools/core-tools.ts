import { z } from "zod";
import { VeynTool } from "./index.js";

export const searchCodeTool: VeynTool<{ query: string }> = {
  name: "search_code",
  description: "Search for code snippets matching a lexical query",
  schema: z.object({ query: z.string().describe("Search query terms") }),
  execute: async (args, context) => {
    const terms = args.query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    if (terms.length === 0) return [];
    return await context.storage.searchLexicalChunks(context.repositoryId, terms, 10);
  }
};

export const findReferencesTool: VeynTool<{ targetId: string }> = {
  name: "find_references",
  description: "Find exact references to a symbol by its canonical targetId (e.g. filePath:symbolName)",
  schema: z.object({ targetId: z.string().describe("Canonical target ID") }),
  execute: async (args, context) => {
    return await context.storage.getReferences(context.repositoryId, args.targetId);
  }
};

export const traceFunctionTool: VeynTool<{ functionId: string }> = {
  name: "trace_function",
  description: "Get functions that call this function, or functions called by it",
  schema: z.object({ functionId: z.string().describe("Canonical function ID") }),
  execute: async (args, context) => {
    const nodes = await context.storage.getCallNodes(context.repositoryId);
    const edges = await context.storage.getCallEdges(context.repositoryId);
    
    const incoming = edges.filter(e => e.targetId === args.functionId).map(e => e.sourceId);
    const outgoing = edges.filter(e => e.sourceId === args.functionId).map(e => e.targetId);
    
    return { incoming, outgoing };
  }
};

export const findDependenciesTool: VeynTool<{ filePath: string }> = {
  name: "find_dependencies",
  description: "Find file-level dependencies (imports/exports)",
  schema: z.object({ filePath: z.string().describe("File path") }),
  execute: async (args, context) => {
    const edges = await context.storage.getDependencyEdges(context.repositoryId);
    
    const importedBy = edges.filter(e => e.target === args.filePath).map(e => e.source);
    const imports = edges.filter(e => e.source === args.filePath).map(e => e.target);
    
    return { importedBy, imports };
  }
};

export const getSymbolContextTool: VeynTool<{ targetId: string }> = {
  name: "get_symbol_context",
  description: "Get the metadata and chunk content for a specific symbol",
  schema: z.object({ targetId: z.string().describe("Canonical symbol ID") }),
  execute: async (args, context) => {
    const symbols = await context.storage.getSymbols(context.repositoryId);
    const symbol = symbols.find(s => `${s.filePath}:${s.name}` === args.targetId);
    return symbol || { error: "Symbol not found" };
  }
};

export const getArchitectureTool: VeynTool<{}> = {
  name: "get_architecture",
  description: "Get high level file/module counts and graph metrics",
  schema: z.object({}),
  execute: async (args, context) => {
    return await context.storage.getMetadata(context.repositoryId);
  }
};

export const getHealthTool: VeynTool<{}> = {
  name: "get_health",
  description: "Get index health metadata",
  schema: z.object({}),
  execute: async (args, context) => {
    const metadata = await context.storage.getMetadata(context.repositoryId);
    if (!metadata) return { error: "No metadata found" };
    
    return {
      indexedAt: metadata.indexedAt,
      fileCount: metadata.fileCount,
      indexDurationMs: metadata.indexDurationMs
    };
  }
};

export function registerCoreTools(registry: any) {
  registry.register(searchCodeTool);
  registry.register(findReferencesTool);
  registry.register(traceFunctionTool);
  registry.register(findDependenciesTool);
  registry.register(getSymbolContextTool);
  registry.register(getArchitectureTool);
  registry.register(getHealthTool);
}
