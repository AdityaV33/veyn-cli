import { SourceFile, Node, SyntaxKind } from "ts-morph";
import { CodeChunk } from "./types.js";
import { createHash } from "crypto";
import path from "path";

export interface ChunkerContext {
  repositoryRoot: string;
}

export class Chunker {
  public chunk(sourceFile: SourceFile, context: ChunkerContext): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const absolutePath = sourceFile.getFilePath();
    const repositoryRelativePath = this.normalizePath(absolutePath, context.repositoryRoot);

    // Track which lines have been covered by named symbols
    const coveredLines = new Set<number>();

    // 1. Extract chunks for supported named symbols
    const statements = sourceFile.getStatements();
    for (const statement of statements) {
      if (
        Node.isFunctionDeclaration(statement) ||
        Node.isClassDeclaration(statement) ||
        Node.isInterfaceDeclaration(statement) ||
        Node.isTypeAliasDeclaration(statement) ||
        Node.isVariableStatement(statement)
      ) {
        const startLine = statement.getStartLineNumber();
        const endLine = statement.getEndLineNumber();
        const content = statement.getText();
        
        let symbolName = null;
        let symbolKind = null;

        if (Node.isFunctionDeclaration(statement)) {
          symbolName = statement.getName() || null;
          symbolKind = "function";
        } else if (Node.isClassDeclaration(statement)) {
          symbolName = statement.getName() || null;
          symbolKind = "class";
        } else if (Node.isInterfaceDeclaration(statement)) {
          symbolName = statement.getName() || null;
          symbolKind = "interface";
        } else if (Node.isTypeAliasDeclaration(statement)) {
          symbolName = statement.getName() || null;
          symbolKind = "type";
        } else if (Node.isVariableStatement(statement)) {
          const decls = statement.getDeclarations();
          if (decls.length > 0) {
            symbolName = decls[0].getName();
            symbolKind = "variable";
          }
        }

        if (symbolName) {
          const chunkId = this.generateId(repositoryRelativePath, startLine, endLine, symbolName);
          chunks.push({
            id: chunkId,
            filePath: repositoryRelativePath,
            startLine,
            endLine,
            symbolName,
            symbolKind,
            content
          });

          for (let i = startLine; i <= endLine; i++) {
            coveredLines.add(i);
          }
        }
      }
    }

    // 2. Identify remainder (code outside named symbols)
    // For simplicity, we just collect all lines not covered and group them into a single file-level chunk
    const allLines = sourceFile.getFullText().split(/\r?\n/);
    const remainderLines: string[] = [];
    
    // We only collect lines that have non-whitespace content to avoid empty padding chunks
    for (let i = 0; i < allLines.length; i++) {
      const lineNum = i + 1; // 1-based
      if (!coveredLines.has(lineNum) && allLines[i].trim().length > 0) {
        remainderLines.push(allLines[i]);
      }
    }

    if (remainderLines.length > 0) {
      const remainderContent = remainderLines.join("\n");
      const startLine = 1;
      const endLine = allLines.length;
      
      const chunkId = this.generateId(repositoryRelativePath, startLine, endLine, "remainder");
      chunks.push({
        id: chunkId,
        filePath: repositoryRelativePath,
        startLine,
        endLine,
        symbolName: null,
        symbolKind: "file-remainder",
        content: remainderContent
      });
    }

    // Return deterministic ordering
    return chunks.sort((a, b) => {
      if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
      return a.startLine - b.startLine;
    });
  }

  private normalizePath(absolutePath: string, rootPath: string): string {
    const rel = path.relative(rootPath, absolutePath);
    return rel.replace(/\\/g, "/");
  }

  private generateId(filePath: string, startLine: number, endLine: number, identifier: string): string {
    const hash = createHash("sha256");
    hash.update(`${filePath}:${startLine}:${endLine}:${identifier}`);
    return hash.digest("hex");
  }
}
