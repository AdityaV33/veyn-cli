import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { scanRepository, PathNotFoundError, NotDirectoryError } from "../index.js";

describe("Scanner Foundation", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "veyn-scanner-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should throw PathNotFoundError for non-existent path", () => {
    const nonExistentPath = join(tempDir, "does-not-exist");
    expect(() => scanRepository(nonExistentPath)).toThrow(PathNotFoundError);
  });

  it("should throw NotDirectoryError for a file path", () => {
    const filePath = join(tempDir, "file.txt");
    writeFileSync(filePath, "content");
    expect(() => scanRepository(filePath)).toThrow(NotDirectoryError);
  });

  it("should discover .ts and .tsx files and ignore unsupported files", () => {
    writeFileSync(join(tempDir, "index.ts"), "content");
    writeFileSync(join(tempDir, "component.tsx"), "content");
    writeFileSync(join(tempDir, "script.js"), "content"); // Should be ignored
    writeFileSync(join(tempDir, "README.md"), "content"); // Should be ignored

    const result = scanRepository(tempDir);
    expect(result.files).toHaveLength(2);
    
    const filePaths = result.files.map((f) => f.relativePath);
    expect(filePaths).toContain("index.ts");
    expect(filePaths).toContain("component.tsx");
    expect(filePaths).not.toContain("script.js");
  });

  it("should ignore configured directories (e.g., node_modules, dist, .git)", () => {
    // Create valid files
    writeFileSync(join(tempDir, "index.ts"), "content");

    // Create ignored directories with .ts files inside
    const nodeModules = join(tempDir, "node_modules");
    mkdirSync(nodeModules);
    writeFileSync(join(nodeModules, "ignored.ts"), "content");

    const dist = join(tempDir, "dist");
    mkdirSync(dist);
    writeFileSync(join(dist, "output.ts"), "content");

    const git = join(tempDir, ".git");
    mkdirSync(git);
    writeFileSync(join(git, "config.ts"), "content");

    const result = scanRepository(tempDir);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].relativePath).toBe("index.ts");
  });

  it("should return paths that are lexicographically sorted", () => {
    // Create in a specific (non-sorted) order
    writeFileSync(join(tempDir, "z.ts"), "content");
    writeFileSync(join(tempDir, "a.ts"), "content");
    mkdirSync(join(tempDir, "dir"));
    writeFileSync(join(tempDir, "dir", "c.ts"), "content");
    writeFileSync(join(tempDir, "dir", "b.ts"), "content");

    const result = scanRepository(tempDir);
    const filePaths = result.files.map((f) => f.relativePath);

    expect(filePaths).toEqual([
      "a.ts",
      "dir/b.ts",
      "dir/c.ts",
      "z.ts",
    ]);
  });

  it("should return correct sizes and extensions", () => {
    const content = "const x = 1;";
    writeFileSync(join(tempDir, "test.ts"), content);

    const result = scanRepository(tempDir);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      relativePath: "test.ts",
      extension: ".ts",
      sizeBytes: content.length,
    });
  });
});
