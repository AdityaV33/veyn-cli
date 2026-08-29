import type { SourceFile } from "ts-morph";
import { ImportRecord, ImportKind } from "./types.js";
import { DependencyError } from "./errors.js";

export class DependencyExtractor {
  public extract(sourceFile: SourceFile): ImportRecord[] {
    try {
      const imports: ImportRecord[] = [];
      const sourcePath = sourceFile.getFilePath();

      for (const importDecl of sourceFile.getImportDeclarations()) {
        const moduleSpecifier = importDecl.getModuleSpecifierValue();
        const isTypeOnly = importDecl.isTypeOnly();
        
        // A side-effect import has no default import, no named imports, and no namespace import.
        const isSideEffect = !importDecl.getDefaultImport() && 
                             importDecl.getNamedImports().length === 0 && 
                             !importDecl.getNamespaceImport();
        
        let kind: ImportKind = "static";
        if (isTypeOnly) kind = "type";
        else if (isSideEffect) kind = "side-effect";

        // Try to resolve the module source file within the ts-morph Project context
        const moduleSourceFile = importDecl.getModuleSpecifierSourceFile();
        const resolvedPath = moduleSourceFile ? moduleSourceFile.getFilePath() : null;

        imports.push({
          sourceFile: sourcePath,
          moduleSpecifier,
          resolvedPath,
          kind
        });
      }

      for (const exportDecl of sourceFile.getExportDeclarations()) {
        if (!exportDecl.hasModuleSpecifier()) continue;
        
        const moduleSpecifier = exportDecl.getModuleSpecifierValue()!;
        const isTypeOnly = exportDecl.isTypeOnly();
        
        const moduleSourceFile = exportDecl.getModuleSpecifierSourceFile();
        const resolvedPath = moduleSourceFile ? moduleSourceFile.getFilePath() : null;

        imports.push({
          sourceFile: sourcePath,
          moduleSpecifier,
          resolvedPath,
          kind: isTypeOnly ? "type" : "export"
        });
      }

      // Deterministic sort: sourceFile -> moduleSpecifier -> kind -> resolvedPath
      return imports.sort((a, b) => {
        if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
        if (a.moduleSpecifier !== b.moduleSpecifier) return a.moduleSpecifier.localeCompare(b.moduleSpecifier);
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        const aPath = a.resolvedPath || "";
        const bPath = b.resolvedPath || "";
        return aPath.localeCompare(bPath);
      });

    } catch (error: any) {
      throw new DependencyError(`Failed to extract dependencies from ${sourceFile.getFilePath()}: ${error.message}`);
    }
  }
}
