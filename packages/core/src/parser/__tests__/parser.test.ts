import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { VeynParser } from "../parser.js";
import { ParserError, UnsupportedExtensionError } from "../errors.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("VeynParser", () => {
  let parser: VeynParser;
  let tempDir: string;

  beforeEach(() => {
    parser = new VeynParser();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veyn-parser-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses a valid .ts file", () => {
    const file = path.join(tempDir, "valid.ts");
    fs.writeFileSync(file, "export const x = 1;");
    const ast = parser.parseFile(file);
    expect(ast).toBeDefined();
    expect(ast.getFilePath()).toBe(file);
  });

  it("parses a valid .tsx file", () => {
    const file = path.join(tempDir, "valid.tsx");
    fs.writeFileSync(file, "export const Component = () => <div />;");
    const ast = parser.parseFile(file);
    expect(ast).toBeDefined();
  });

  it("rejects unsupported extensions (.js)", () => {
    const file = path.join(tempDir, "invalid.js");
    expect(() => parser.parseFile(file)).toThrow(UnsupportedExtensionError);
  });

  it("rejects unsupported extensions (.md)", () => {
    const file = path.join(tempDir, "README.md");
    expect(() => parser.parseFile(file)).toThrow(UnsupportedExtensionError);
  });

  it("handles missing files gracefully", () => {
    const file = path.join(tempDir, "missing.ts");
    expect(() => parser.parseFile(file)).toThrow(ParserError);
    expect(() => parser.parseFile(file)).toThrow(/File does not exist/);
  });

  it("handles paths that are directories", () => {
    const dir = path.join(tempDir, "dir.ts");
    fs.mkdirSync(dir);
    expect(() => parser.parseFile(dir)).toThrow(ParserError);
    expect(() => parser.parseFile(dir)).toThrow(/Path is not a valid file/);
  });
});
