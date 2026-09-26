import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Chunker } from "../chunker.js";
import { VeynParser } from "../../parser/parser.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("Chunker", () => {
  let parser: VeynParser;
  let chunker: Chunker;
  let tempDir: string;

  beforeEach(() => {
    parser = new VeynParser();
    chunker = new Chunker();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veyn-chunker-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function parseCode(filename: string, code: string) {
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, code);
    return parser.parseFile(filePath);
  }

  it("extracts a single function into a deterministic chunk", () => {
    const ast = parseCode("single.ts", "export function foo() {\n  return 1;\n}");
    const chunks = chunker.chunk(ast, { repositoryRoot: tempDir });
    
    expect(chunks).toHaveLength(1);
    expect(chunks[0].symbolName).toBe("foo");
    expect(chunks[0].symbolKind).toBe("function");
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(3);
    expect(chunks[0].filePath).toBe("single.ts");
    expect(chunks[0].id).toBeDefined();
    expect(chunks[0].content).toContain("return 1");
  });

  it("handles multiple symbols and orders them deterministically", () => {
    const ast = parseCode("multi.ts", "export class A {}\nexport function b() {}");
    const chunks = chunker.chunk(ast, { repositoryRoot: tempDir });
    
    expect(chunks).toHaveLength(2);
    expect(chunks[0].symbolName).toBe("A");
    expect(chunks[0].startLine).toBe(1);
    
    expect(chunks[1].symbolName).toBe("b");
    expect(chunks[1].startLine).toBe(2);
  });

  it("captures loose code into a remainder chunk", () => {
    const ast = parseCode("remainder.ts", "import { x } from 'y';\n\nexport function foo() {}\n\nconsole.log(x);");
    const chunks = chunker.chunk(ast, { repositoryRoot: tempDir });
    
    expect(chunks).toHaveLength(2); // 1 for foo(), 1 for remainder
    
    const remainder = chunks.find(c => c.symbolKind === "file-remainder");
    expect(remainder).toBeDefined();
    expect(remainder?.content).toContain("import { x }");
    expect(remainder?.content).toContain("console.log(x)");
    expect(remainder?.content).not.toContain("function foo");
    expect(remainder?.symbolName).toBeNull();
  });

  it("produces deterministic IDs", () => {
    const ast1 = parseCode("a.ts", "export function foo() {}");
    const chunks1 = chunker.chunk(ast1, { repositoryRoot: tempDir });

    const ast2 = parseCode("a.ts", "export function foo() {}");
    const chunks2 = chunker.chunk(ast2, { repositoryRoot: tempDir });

    expect(chunks1[0].id).toBe(chunks2[0].id);
  });

  it("never outputs absolute paths", () => {
    const ast = parseCode("abs.ts", "export function abs() {}");
    const chunks = chunker.chunk(ast, { repositoryRoot: tempDir });
    expect(chunks[0].filePath).toBe("abs.ts");
    expect(chunks[0].filePath).not.toContain(tempDir);
  });
});
