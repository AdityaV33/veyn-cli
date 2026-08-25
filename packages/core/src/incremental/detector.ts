import { ScannedFile } from "../scanner/index.js";
import { FileChangeSet } from "./types.js";

export class ChangeDetector {
  public detect(previousFiles: ScannedFile[], currentFiles: ScannedFile[]): FileChangeSet {
    const prevMap = new Map<string, string | undefined>(previousFiles.map(f => [f.relativePath, f.hash]));
    const currMap = new Map<string, string | undefined>(currentFiles.map(f => [f.relativePath, f.hash]));
    
    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const unchanged: string[] = [];

    // Check for added, modified, unchanged
    for (const [path, hash] of currMap.entries()) {
      const prevHash = prevMap.get(path);
      if (!prevMap.has(path)) {
        added.push(path);
      } else if (prevHash !== hash) {
        modified.push(path);
      } else {
        unchanged.push(path);
      }
    }

    // Check for deleted
    for (const path of prevMap.keys()) {
      if (!currMap.has(path)) {
        deleted.push(path);
      }
    }

    // Deterministic sorting
    return {
      added: added.sort(),
      modified: modified.sort(),
      deleted: deleted.sort(),
      unchanged: unchanged.sort()
    };
  }
}
