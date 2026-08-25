import type { SourceFile, Node } from "ts-morph";
import { SymbolRecord, SymbolKind } from "./types.js";
import { SymbolExtractionError } from "./errors.js";

export class SymbolExtractor {
  public extract(sourceFile: SourceFile): SymbolRecord[] {
    try {
      const symbols: SymbolRecord[] = [];
      const filePath = sourceFile.getFilePath();

      const addSymbol = (name: string | undefined, kind: SymbolKind, node: Node) => {
        if (!name) return; // Skip anonymous/internal symbols without a stable name
        symbols.push({
          name,
          kind,
          filePath,
          startLine: node.getStartLineNumber(),
          endLine: node.getEndLineNumber()
        });
      };

      for (const func of sourceFile.getFunctions()) {
        addSymbol(func.getName(), "function", func);
      }

      for (const cls of sourceFile.getClasses()) {
        addSymbol(cls.getName(), "class", cls);
        for (const method of cls.getMethods()) {
          addSymbol(method.getName(), "method", method);
        }
        for (const prop of cls.getProperties()) {
          addSymbol(prop.getName(), "property", prop);
        }
      }

      for (const iface of sourceFile.getInterfaces()) {
        addSymbol(iface.getName(), "interface", iface);
        for (const method of iface.getMethods()) {
          addSymbol(method.getName(), "method", method);
        }
        for (const prop of iface.getProperties()) {
          addSymbol(prop.getName(), "property", prop);
        }
      }

      for (const typeAlias of sourceFile.getTypeAliases()) {
        addSymbol(typeAlias.getName(), "type", typeAlias);
      }

      for (const enumDec of sourceFile.getEnums()) {
        addSymbol(enumDec.getName(), "enum", enumDec);
      }

      for (const varDec of sourceFile.getVariableDeclarations()) {
        addSymbol(varDec.getName(), "variable", varDec);
      }

      // Deterministic sorting strategy: filePath -> startLine -> endLine -> kind -> name
      return symbols.sort((a, b) => {
        if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
        if (a.startLine !== b.startLine) return a.startLine - b.startLine;
        if (a.endLine !== b.endLine) return a.endLine - b.endLine;
        if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
        return a.name.localeCompare(b.name);
      });
    } catch (error: any) {
      throw new SymbolExtractionError(`Extraction failed for ${sourceFile.getFilePath()}: ${error.message}`);
    }
  }
}
