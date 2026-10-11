import { describe, it, expect, vi } from "vitest";
import { ToolRegistry } from "../src/tools/index.js";
import { registerCoreTools, findReferencesTool, getHealthTool } from "../src/tools/core-tools.js";

describe("Core Tools", () => {
  it("can register all core tools", () => {
    const registry = new ToolRegistry();
    registerCoreTools(registry);
    
    expect(registry.getTool("search_code")).toBeDefined();
    expect(registry.getTool("trace_function")).toBeDefined();
    expect(registry.getTool("find_references")).toBeDefined();
    expect(registry.getTool("find_dependencies")).toBeDefined();
    expect(registry.getTool("get_architecture")).toBeDefined();
    expect(registry.getTool("get_health")).toBeDefined();
    expect(registry.getTool("get_symbol_context")).toBeDefined();
  });

  it("find_references calls getReferences and handles canonical targetId", async () => {
    const mockStorage = {
      getReferences: vi.fn().mockResolvedValue([{ sourceFile: "a.ts", sourceLine: 10, targetId: "target.ts:Auth" }])
    };
    const context = { storage: mockStorage as any, repositoryId: "repo1" };
    
    // Zod validation test
    const validArgs = findReferencesTool.schema.parse({ targetId: "target.ts:Auth" });
    
    const result = await findReferencesTool.execute(validArgs, context);
    
    expect(mockStorage.getReferences).toHaveBeenCalledWith("repo1", "target.ts:Auth");
    expect(result).toHaveLength(1);
    expect(result[0].sourceFile).toBe("a.ts");
  });

  it("getHealthTool calls getMetadata", async () => {
    const mockStorage = {
      getMetadata: vi.fn().mockResolvedValue({ indexedAt: new Date(), fileCount: 10, indexDurationMs: 100 })
    };
    const context = { storage: mockStorage as any, repositoryId: "repo1" };
    
    const result = await getHealthTool.execute({}, context);
    expect(mockStorage.getMetadata).toHaveBeenCalledWith("repo1");
    expect(result.fileCount).toBe(10);
  });
});
