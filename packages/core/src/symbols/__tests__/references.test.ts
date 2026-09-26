import { describe, it, expect, beforeEach } from "vitest";
import { Project } from "ts-morph";
import { ReferenceExtractor } from "../references.js";
import { ReferenceRecord } from "../types.js";
import path from "path";

describe("ReferenceExtractor", () => {
  let project: Project;
  let extractor: ReferenceExtractor;

  beforeEach(() => {
    project = new Project({ useInMemoryFileSystem: true });
    extractor = new ReferenceExtractor();
  });

  const runExtractor = (
    fileSource: { path: string; content: string }[],
    trackedIds: string[],
    targetFile = "test.ts"
  ) => {
    const root = "/root";
    for (const f of fileSource) {
      project.createSourceFile(path.join(root, f.path), f.content);
    }
    const sf = project.getSourceFileOrThrow(path.join(root, targetFile));
    return extractor.extract(sf, { repositoryRoot: root, trackedSymbols: new Set(trackedIds) });
  };

  it("should extract cross-file class references", () => {
    const refs = runExtractor(
      [
        { path: "auth.ts", content: "export class AuthService { refreshToken() {} }" },
        { path: "test.ts", content: 'import { AuthService } from "./auth";\nconst a = new AuthService();\na.refreshToken();' }
      ],
      ["auth.ts:AuthService"]
    );

    expect(refs).toHaveLength(2); // One in import, one in 'new AuthService'
    expect(refs).toContainEqual({
      sourceFile: "test.ts",
      sourceLine: 1,
      targetId: "auth.ts:AuthService"
    });
    expect(refs).toContainEqual({
      sourceFile: "test.ts",
      sourceLine: 2,
      targetId: "auth.ts:AuthService"
    });
  });

  it("should extract cross-file function references", () => {
    const refs = runExtractor(
      [
        { path: "util.ts", content: "export function doThing() {}" },
        { path: "test.ts", content: 'import { doThing } from "./util";\ndoThing();' }
      ],
      ["util.ts:doThing"]
    );

    expect(refs).toHaveLength(2); // One in import, one in call
    expect(refs).toContainEqual({
      sourceFile: "test.ts",
      sourceLine: 1,
      targetId: "util.ts:doThing"
    });
    expect(refs).toContainEqual({
      sourceFile: "test.ts",
      sourceLine: 2,
      targetId: "util.ts:doThing"
    });
  });

  it("should preserve valid same-file references", () => {
    const refs = runExtractor(
      [
        { path: "test.ts", content: 'export class LocalService {}\nconst x = new LocalService();' }
      ],
      ["test.ts:LocalService"]
    );

    expect(refs).toHaveLength(1);
    expect(refs).toContainEqual({
      sourceFile: "test.ts",
      sourceLine: 2, 
      targetId: "test.ts:LocalService"
    });
  });

  it("should ignore built-in/external symbols", () => {
    const refs = runExtractor(
      [
        { path: "test.ts", content: 'const arr = new Array();\nconsole.log("hello");' }
      ],
      ["test.ts:Array", "test.ts:console"] 
    );

    expect(refs).toHaveLength(0);
  });

  it("should handle same-name symbols correctly", () => {
    const refs = runExtractor(
      [
        { path: "a.ts", content: "export class User {}" },
        { path: "b.ts", content: "export class User {}" },
        { path: "test.ts", content: 'import { User } from "./b";\nconst u = new User();' }
      ],
      ["a.ts:User", "b.ts:User"]
    );

    expect(refs).toHaveLength(2); // Import and usage
    expect(refs).toContainEqual({
      sourceFile: "test.ts",
      sourceLine: 1,
      targetId: "b.ts:User" 
    });
    expect(refs).toContainEqual({
      sourceFile: "test.ts",
      sourceLine: 2,
      targetId: "b.ts:User" 
    });
  });
});
