import { Project } from "ts-morph";
import { ParserError, UnsupportedExtensionError } from "./errors.js";
import type { SourceFile } from "./types.js";
import fs from "fs";
import path from "path";

export class VeynParser {
  private project: Project;

  constructor(repositoryRoot?: string) {
    let paths: Record<string, string[]> | undefined = undefined;

    if (repositoryRoot) {
      const tsconfigPath = path.join(repositoryRoot, "tsconfig.json");
      if (fs.existsSync(tsconfigPath)) {
        try {
          const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf-8"));
          if (tsconfig.references && Array.isArray(tsconfig.references)) {
            paths = {};
            for (const ref of tsconfig.references) {
              const refPath = path.join(repositoryRoot, ref.path);
              const pkgJsonPath = path.join(refPath, "package.json");
              if (fs.existsSync(pkgJsonPath)) {
                const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8"));
                if (pkgJson.name) {
                  paths[pkgJson.name] = [path.join(ref.path, "src", "index.ts")];
                  paths[`${pkgJson.name}/*`] = [path.join(ref.path, "src", "*")];
                }
              }
            }
          }
        } catch (e) {
          // Fallback to empty paths if parsing fails
        }
      }
    }

    const compilerOptions: any = { allowJs: false };
    if (repositoryRoot && paths) {
      compilerOptions.baseUrl = repositoryRoot;
      compilerOptions.paths = paths;
    }

    this.project = new Project({
      useInMemoryFileSystem: false,
      compilerOptions
    });
  }

  /**
   * Parses an absolute TypeScript/TSX file path and returns its AST.
   */
  public parseFile(absolutePath: string): SourceFile {
    if (!absolutePath.endsWith(".ts") && !absolutePath.endsWith(".tsx")) {
      throw new UnsupportedExtensionError(absolutePath);
    }

    if (!fs.existsSync(absolutePath)) {
      throw new ParserError(absolutePath, "File does not exist.");
    }

    if (!fs.statSync(absolutePath).isFile()) {
      throw new ParserError(absolutePath, "Path is not a valid file.");
    }

    try {
      let sourceFile = this.project.getSourceFile(absolutePath);
      if (!sourceFile) {
        sourceFile = this.project.addSourceFileAtPath(absolutePath);
      }
      return sourceFile;
    } catch (e: any) {
      throw new ParserError(absolutePath, `Failed to parse file: ${e.message}`);
    }
  }
}
