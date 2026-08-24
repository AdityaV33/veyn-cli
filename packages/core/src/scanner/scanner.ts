import { statSync, readdirSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";
import { PathNotFoundError, NotDirectoryError } from "./errors.js";

export interface ScannedFile {
  relativePath: string;
  extension: string;
  sizeBytes: number;
}

export interface ScanResult {
  repositoryPath: string;
  files: ScannedFile[];
}

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "out",
]);

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx"]);

export function scanRepository(repositoryPath: string): ScanResult {
  let stats;
  try {
    stats = statSync(repositoryPath);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      throw new PathNotFoundError(repositoryPath);
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    throw new NotDirectoryError(repositoryPath);
  }

  const files: ScannedFile[] = [];

  function walk(currentDir: string) {
    const entries = readdirSync(currentDir, { withFileTypes: true });

    // Sort entries lexicographically for deterministic output
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORED_DIRS.has(entry.name)) {
          walk(join(currentDir, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name);
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          const fullPath = join(currentDir, entry.name);
          // Convert OS-specific path separators to deterministic forward slashes
          const relPath = relative(repositoryPath, fullPath).split(sep).join("/");
          const fileStats = statSync(fullPath);

          files.push({
            relativePath: relPath,
            extension: ext,
            sizeBytes: fileStats.size,
          });
        }
      }
    }
  }

  walk(repositoryPath);

  return {
    repositoryPath,
    files,
  };
}
