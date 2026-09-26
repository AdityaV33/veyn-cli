import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DependencyExtractor } from "../extractor.js";
import { VeynParser } from "../../parser/parser.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("DependencyExtractor", () => {
  let parser: VeynParser;
  let extractor: DependencyExtractor;
  let tempDir: string;

  beforeEach(() => {
    parser = new VeynParser();
    extractor = new DependencyExtractor();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veyn-deps-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function setupFile(filename: string, code: string) {
    const filePath = path.join(tempDir, filename);
    fs.writeFileSync(filePath, code);
    return filePath;
  }

  function parseCode(filename: string, code: string) {
    const file = setupFile(filename, code);
    return parser.parseFile(file);
  }

  it("extracts basic named imports", () => {
    const ast = parseCode("named.ts", 'import { foo } from "./foo";');
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleSpecifier).toBe("./foo");
    expect(imports[0].kind).toBe("static");
    expect(imports[0].resolvedPath).toBeNull(); // foo.ts does not exist
  });

  it("extracts default imports", () => {
    const ast = parseCode("default.ts", 'import foo from "./foo";');
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleSpecifier).toBe("./foo");
    expect(imports[0].kind).toBe("static");
  });

  it("extracts namespace imports", () => {
    const ast = parseCode("namespace.ts", 'import * as foo from "./foo";');
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleSpecifier).toBe("./foo");
    expect(imports[0].kind).toBe("static");
  });

  it("extracts side-effect imports", () => {
    const ast = parseCode("sideEffect.ts", 'import "./setup";');
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleSpecifier).toBe("./setup");
    expect(imports[0].kind).toBe("side-effect");
  });

  it("extracts type imports", () => {
    const ast = parseCode("type.ts", 'import type { User } from "./types";');
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleSpecifier).toBe("./types");
    expect(imports[0].kind).toBe("type");
  });

  it("resolves relative files when they exist", () => {
    setupFile("foo.ts", "export const foo = 1;");
    const ast = parseCode("index.ts", 'import { foo } from "./foo";');
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleSpecifier).toBe("./foo");
    expect(imports[0].resolvedPath).toContain("foo.ts"); // should resolve
  });

  it("handles unresolved external imports", () => {
    const ast = parseCode("external.ts", 'import express from "express";');
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(1);
    expect(imports[0].moduleSpecifier).toBe("express");
    expect(imports[0].resolvedPath).toBeNull(); // express is not in temp dir
  });

  it("maintains deterministic ordering", () => {
    const ast = parseCode("order.ts", `
      import "./setup";
      import type { User } from "./types";
      import { foo } from "./foo";
    `);
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(3);
    
    // Ordered by moduleSpecifier: "./foo" (static), "./setup" (side-effect), "./types" (type)
    expect(imports[0].moduleSpecifier).toBe("./foo");
    expect(imports[1].moduleSpecifier).toBe("./setup");
    expect(imports[2].moduleSpecifier).toBe("./types");
  });

  it("operates only on the supplied SourceFile without filesystem leakage", () => {
    const ast = parseCode("single.ts", 'import { a } from "./a";');
    const imports = extractor.extract(ast);
    expect(imports).toHaveLength(1);
    expect(imports[0].sourceFile).toBe(ast.getFilePath());
  });
});
