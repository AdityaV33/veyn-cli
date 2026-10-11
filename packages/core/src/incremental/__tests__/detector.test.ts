import { describe, it, expect } from "vitest";
import { ChangeDetector } from "../detector.js";
import { ScannedFile } from "../../scanner/index.js";

describe("ChangeDetector", () => {
  const detector = new ChangeDetector();

  const fileA: ScannedFile = { relativePath: "a.ts", extension: ".ts", sizeBytes: 10, hash: "h1" };
  const fileB: ScannedFile = { relativePath: "b.ts", extension: ".ts", sizeBytes: 10, hash: "h2" };
  const fileC: ScannedFile = { relativePath: "c.ts", extension: ".ts", sizeBytes: 10, hash: "h3" };

  it("detects no changes when files are identical", () => {
    const changes = detector.detect([fileA, fileB], [fileA, fileB]);
    expect(changes.added).toEqual([]);
    expect(changes.modified).toEqual([]);
    expect(changes.deleted).toEqual([]);
    expect(changes.unchanged).toEqual(["a.ts", "b.ts"]);
  });

  it("detects added files", () => {
    const changes = detector.detect([fileA], [fileA, fileB]);
    expect(changes.added).toEqual(["b.ts"]);
    expect(changes.unchanged).toEqual(["a.ts"]);
  });

  it("detects deleted files", () => {
    const changes = detector.detect([fileA, fileB], [fileA]);
    expect(changes.deleted).toEqual(["b.ts"]);
    expect(changes.unchanged).toEqual(["a.ts"]);
  });

  it("detects modified files based on hash", () => {
    const fileA_mod: ScannedFile = { ...fileA, hash: "h1_mod" };
    const changes = detector.detect([fileA, fileB], [fileA_mod, fileB]);
    expect(changes.modified).toEqual(["a.ts"]);
    expect(changes.unchanged).toEqual(["b.ts"]);
  });

  it("handles multiple simultaneous changes deterministically", () => {
    const fileA_mod: ScannedFile = { ...fileA, hash: "h1_mod" };
    // prev: a, b
    // curr: a(mod), c(add)
    const changes = detector.detect([fileA, fileB], [fileC, fileA_mod]);
    expect(changes.added).toEqual(["c.ts"]);
    expect(changes.modified).toEqual(["a.ts"]);
    expect(changes.deleted).toEqual(["b.ts"]);
    expect(changes.unchanged).toEqual([]);
  });
});
