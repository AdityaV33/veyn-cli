import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SymbolExtractor } from "../extractor.js";
import { VeynParser } from "../../parser/parser.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("SymbolExtractor", () => {
  let parser: VeynParser;
  let extractor: SymbolExtractor;
  let tempDir: string;

  beforeEach(() => {
    parser = new VeynParser();
    extractor = new SymbolExtractor();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veyn-symbols-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function parseCode(filename: string, code: string) {
    const file = path.join(tempDir, filename);
    fs.writeFileSync(file, code);
    return parser.parseFile(file);
  }

  it("extracts a function", () => {
    const ast = parseCode("func.ts", "export function foo() {}");
    const symbols = extractor.extract(ast);
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("foo");
    expect(symbols[0].kind).toBe("function");
    expect(symbols[0].startLine).toBe(1);
    expect(symbols[0].endLine).toBe(1);
  });

  it("extracts classes, methods, and properties", () => {
    const ast = parseCode("class.ts", `
      class User {
        name: string;
        login() {}
      }
    `);
    const symbols = extractor.extract(ast);
    expect(symbols).toHaveLength(3);
    
    // Ordered by startLine: User (2), name (3), login (4)
    expect(symbols[0].name).toBe("User");
    expect(symbols[0].kind).toBe("class");
    
    expect(symbols[1].name).toBe("name");
    expect(symbols[1].kind).toBe("property");
    
    expect(symbols[2].name).toBe("login");
    expect(symbols[2].kind).toBe("method");
  });

  it("extracts interfaces, type aliases, and enums", () => {
    const ast = parseCode("types.ts", `
      export interface IDatabase { connect(): void; }
      type ID = string;
      enum Status { ACTIVE, INACTIVE }
    `);
    const symbols = extractor.extract(ast);
    expect(symbols).toHaveLength(4); // interface, method, type, enum
    
    const names = symbols.map(s => s.name);
    expect(names).toContain("IDatabase");
    expect(names).toContain("connect");
    expect(names).toContain("ID");
    expect(names).toContain("Status");
  });

  it("extracts variables", () => {
    const ast = parseCode("vars.ts", "const a = 1; let b = 2; var c = 3;");
    const symbols = extractor.extract(ast);
    expect(symbols).toHaveLength(3);
    expect(symbols[0].name).toBe("a");
    expect(symbols[1].name).toBe("b");
    expect(symbols[2].name).toBe("c");
  });

  it("ignores anonymous functions", () => {
    const ast = parseCode("anon.ts", "export default function() {}");
    const symbols = extractor.extract(ast);
    expect(symbols).toHaveLength(0);
  });

  it("returns empty array for empty file", () => {
    const ast = parseCode("empty.ts", "");
    const symbols = extractor.extract(ast);
    expect(symbols).toHaveLength(0);
  });

  it("maintains deterministic ordering", () => {
    const ast = parseCode("order.ts", `
      const b = 1;
      const a = 1;
      function z() {}
    `);
    const symbols = extractor.extract(ast);
    expect(symbols).toHaveLength(3);
    
    // Order should be by startLine: b (2), a (3), z (4)
    expect(symbols[0].name).toBe("b");
    expect(symbols[1].name).toBe("a");
    expect(symbols[2].name).toBe("z");
  });
});
