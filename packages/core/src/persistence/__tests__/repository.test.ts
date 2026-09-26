import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RepositoryIdentityResolver } from "../repository.js";
import { PersistenceError } from "../errors.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("RepositoryIdentityResolver", () => {
  let resolver: RepositoryIdentityResolver;
  let tempDir: string;

  beforeEach(() => {
    resolver = new RepositoryIdentityResolver();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veyn-repo-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("throws if repository path does not exist", () => {
    expect(() => resolver.resolve("/path/does/not/exist/1234")).toThrow(PersistenceError);
  });

  it("resolves name from package.json if present", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test-repo" }));
    const identity = resolver.resolve(tempDir);
    expect(identity.name).toBe("test-repo");
    expect(identity.id).toBeDefined(); // Hash of "test-repo"
  });

  it("falls back to directory basename if package.json has no name", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({}));
    const identity = resolver.resolve(tempDir);
    expect(identity.name).toBe(path.basename(tempDir));
    expect(identity.id).toBeDefined();
  });

  it("falls back to directory basename if package.json is missing", () => {
    const identity = resolver.resolve(tempDir);
    expect(identity.name).toBe(path.basename(tempDir));
    expect(identity.id).toBeDefined();
  });

  it("generates a deterministic ID for the same name", () => {
    fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "my-app" }));
    const id1 = resolver.resolve(tempDir).id;
    
    // Create another dir with the same package.json name
    const tempDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "veyn-repo-test-"));
    fs.writeFileSync(path.join(tempDir2, "package.json"), JSON.stringify({ name: "my-app" }));
    const id2 = resolver.resolve(tempDir2).id;
    
    expect(id1).toBe(id2);
    
    fs.rmSync(tempDir2, { recursive: true, force: true });
  });
});
