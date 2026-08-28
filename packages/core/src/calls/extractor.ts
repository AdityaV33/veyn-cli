import { SourceFile, Node, SyntaxKind, CallExpression } from "ts-morph";
import { CallRecord } from "./types.js";
import { CallExtractionError } from "./errors.js";

export class CallExtractor {
  public extract(sourceFile: SourceFile): CallRecord[] {
    try {
      const calls: CallRecord[] = [];
      const sourcePath = sourceFile.getFilePath();

      const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
      
      for (const callExpr of callExpressions) {
        const containingFunc = callExpr.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) || 
                               callExpr.getFirstAncestorByKind(SyntaxKind.MethodDeclaration) ||
                               callExpr.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
        
        if (!containingFunc) continue;

        const sourceSymbolName = this.getSymbolName(containingFunc);
        if (!sourceSymbolName) continue; // Anonymous/unresolvable source

        const targetSymbolName = this.resolveTargetSymbolName(callExpr);
        if (!targetSymbolName) continue; // Anonymous/unresolvable target

        const targetFile = this.resolveTargetFile(callExpr);

        calls.push({
          sourceFile: sourcePath,
          sourceSymbol: sourceSymbolName,
          targetFile,
          targetSymbol: targetSymbolName,
          kind: "direct",
          line: callExpr.getStartLineNumber()
        });
      }

      return calls.sort((a, b) => {
        if (a.sourceFile !== b.sourceFile) return a.sourceFile.localeCompare(b.sourceFile);
        if (a.sourceSymbol !== b.sourceSymbol) return a.sourceSymbol.localeCompare(b.sourceSymbol);
        if (a.targetSymbol !== b.targetSymbol) return a.targetSymbol.localeCompare(b.targetSymbol);
        if (a.line !== b.line) return a.line - b.line;
        return (a.targetFile || "").localeCompare(b.targetFile || "");
      });
    } catch (error: any) {
      throw new CallExtractionError(`Failed to extract calls from ${sourceFile.getFilePath()}: ${error.message}`);
    }
  }

  private getSymbolName(node: Node): string | null {
    if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
      return node.getName() || null;
    }
    if (Node.isArrowFunction(node)) {
      const varDec = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (varDec) return varDec.getName();
    }
    return null;
  }

  private resolveTargetSymbolName(callExpr: CallExpression): string | null {
    const decl = this.resolveTargetDeclaration(callExpr);
    if (decl) {
      if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl) || Node.isVariableDeclaration(decl) || Node.isClassDeclaration(decl)) {
        return (decl as any).getName() || null;
      }
    }
    
    // Fallback logic for unresolvable alias or just plain identifier
    // But if we want strictly determinable targets, maybe we shouldn't fallback to the raw identifier
    // Since the rule is "skip unresolvable/external", returning null here is correct when decl isn't a proper target.
    return null;
  }

  private resolveTargetFile(callExpr: CallExpression): string | null {
    const decl = this.resolveTargetDeclaration(callExpr);
    if (decl) {
      if (Node.isFunctionDeclaration(decl) || Node.isMethodDeclaration(decl) || Node.isVariableDeclaration(decl) || Node.isClassDeclaration(decl)) {
        return decl.getSourceFile().getFilePath();
      }
    }
    return null;
  }

  private resolveTargetDeclaration(callExpr: CallExpression): Node | null {
    let symbol = callExpr.getExpression().getSymbol();
    if (symbol) {
      if (symbol.isAlias()) {
        const aliased = symbol.getAliasedSymbol();
        if (aliased) symbol = aliased;
      }
      const decls = symbol.getDeclarations();
      if (decls.length > 0) {
        return decls[0];
      }
    }
    return null;
  }
}
