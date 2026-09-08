import { SourceFile, SyntaxKind, Project } from "ts-morph";
import path from "path";
import { ReferenceRecord, SymbolRecord } from "./types.js";

export interface ReferenceExtractorContext {
  repositoryRoot: string;
  trackedSymbols: Set<string>; // Set of targetIds (canonical ids)
}

function normalizePath(absolutePath: string, rootPath: string): string {
  const rel = path.relative(rootPath, absolutePath);
  return rel.replace(/\\/g, "/");
}

export class ReferenceExtractor {
  public extract(sourceFile: SourceFile, context: ReferenceExtractorContext): ReferenceRecord[] {
    const references: ReferenceRecord[] = [];
    const filePath = normalizePath(sourceFile.getFilePath(), context.repositoryRoot);

    const typeChecker = sourceFile.getProject().getTypeChecker();

    for (const identifier of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
      try {
        let symbol = identifier.getSymbol() || typeChecker.getSymbolAtLocation(identifier);
        
        if (!symbol) continue;

        let decls = symbol.getDeclarations();
        
        // Handle aliased symbols (e.g., imports)
        if (!decls || decls.length === 0) {
          const aliased = typeChecker.getAliasedSymbol(symbol);
          if (aliased) {
            decls = aliased.getDeclarations();
            if (decls && decls.length > 0) {
                symbol = aliased;
            }
          }
        }
        
        // Sometimes typeChecker.getSymbolAtLocation returns the alias, and we need to resolve it
        if (decls && decls.length > 0 && decls[0].getKind() === SyntaxKind.ImportSpecifier) {
           const aliased = typeChecker.getAliasedSymbol(symbol);
           if (aliased) {
             decls = aliased.getDeclarations();
             symbol = aliased;
           }
        }

        if (decls && decls.length > 0) {
          const decl = decls[0];
          const declPath = decl.getSourceFile().getFilePath();
          
          // Fast filter: Ignore external files
          if (declPath.includes("node_modules") || !declPath.startsWith(context.repositoryRoot)) {
            continue;
          }

          const targetFilePath = normalizePath(declPath, context.repositoryRoot);
          const targetName = symbol.getName();
          const targetId = `${targetFilePath}:${targetName}`;

          // Check if this resolved declaration is a tracked repository symbol
          if (context.trackedSymbols.has(targetId)) {
            // Ignore self-references (the declaration itself)
            // If the identifier is part of the declaration's name node, it's not a usage
            const declNameNode = (decl as any).getNameNode?.();
            if (declNameNode && declNameNode === identifier) {
                continue;
            }

            references.push({
              sourceFile: filePath,
              sourceLine: identifier.getStartLineNumber(),
              targetId: targetId
            });
          }
        }
      } catch (e) {
        // Safely skip any resolution failures
      }
    }

    return references;
  }
}
