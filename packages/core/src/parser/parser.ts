import { Project } from "ts-morph";
import { ParserError, UnsupportedExtensionError } from "./errors.js";
import type { SourceFile } from "./types.js";
import fs from "fs";

export class VeynParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: false,
      compilerOptions: {
        allowJs: false
      }
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
