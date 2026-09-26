import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CallExtractor } from "../extractor.js";
import { VeynParser } from "../../parser/parser.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("CallExtractor", () => {
  let parser: VeynParser;
  let extractor: CallExtractor;
  let tempDir: string;

  beforeEach(() => {
    parser = new VeynParser();
    extractor = new CallExtractor();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veyn-calls-extractor-test-"));
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

  it("extracts direct function calls", () => {
    const ast = parseCode("direct.ts", `
      export function foo() {}
      export function bar() { foo(); }
    `);
    const calls = extractor.extract(ast);
    expect(calls).toHaveLength(1);
    expect(calls[0].sourceSymbol).toBe("bar");
    expect(calls[0].targetSymbol).toBe("foo");
    expect(calls[0].targetFile).toContain("direct.ts");
    expect(calls[0].kind).toBe("direct");
    expect(calls[0].line).toBe(3); // Line where foo() is called inside bar
  });

  it("extracts multiple calls", () => {
    const ast = parseCode("multi.ts", `
      function a() {}
      function b() {}
      function c() { a(); b(); }
    `);
    const calls = extractor.extract(ast);
    expect(calls).toHaveLength(2);
    expect(calls[0].sourceSymbol).toBe("c");
    expect(calls[0].targetSymbol).toBe("a");
    expect(calls[1].sourceSymbol).toBe("c");
    expect(calls[1].targetSymbol).toBe("b");
  });

  it("extracts method calls", () => {
    const ast = parseCode("method.ts", `
      class Service {
        run() { this.validate(); }
        validate() {}
      }
    `);
    const calls = extractor.extract(ast);
    expect(calls).toHaveLength(1);
    expect(calls[0].sourceSymbol).toBe("run");
    expect(calls[0].targetSymbol).toBe("validate");
  });

  it("extracts cross-file calls", () => {
    setupFile("helper.ts", "export function helper() {}");
    const ast = parseCode("main.ts", `
      import { helper } from "./helper";
      export function main() { helper(); }
    `);
    
    // Note: Since 'helper.ts' wasn't parsed in the project, 'ts-morph' might not resolve it perfectly
    // unless it's added. Let's add it to the parser.
    parser.parseFile(path.join(tempDir, "helper.ts"));
    
    const calls = extractor.extract(ast);
    expect(calls).toHaveLength(1);
    expect(calls[0].sourceSymbol).toBe("main");
    expect(calls[0].targetSymbol).toBe("helper");
    expect(calls[0].targetFile).toContain("helper.ts");
  });

  it("skips unresolved/external calls", () => {
    const ast = parseCode("external.ts", `
      import express from "express";
      function createApp() { express(); }
    `);
    const calls = extractor.extract(ast);
    expect(calls).toHaveLength(0); // Cannot resolve target
  });

  it("extracts duplicate calls", () => {
    const ast = parseCode("dup.ts", `
      function foo() {}
      function bar() { foo(); foo(); }
    `);
    const calls = extractor.extract(ast);
    expect(calls).toHaveLength(2); // Extractor returns both; graph deduplicates
  });

  it("skips anonymous sources", () => {
    const ast = parseCode("anon.ts", `
      function foo() {}
      setInterval(() => { foo(); }, 1000);
    `);
    const calls = extractor.extract(ast);
    expect(calls).toHaveLength(0); // Anonymous arrow function
  });
});
