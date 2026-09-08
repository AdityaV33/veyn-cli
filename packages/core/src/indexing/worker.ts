import { parentPort } from "worker_threads";
import { VeynParser } from "../parser/parser.js";
import { SymbolExtractor } from "../symbols/extractor.js";
import { DependencyExtractor } from "../dependencies/extractor.js";
import { CallExtractor } from "../calls/extractor.js";
import { ReferenceExtractor } from "../symbols/references.js";
import { Chunker } from "../embeddings/chunker.js";
import { SourceFile } from "ts-morph";
import path from "path";
import { ScannedFile } from "../scanner/scanner.js";

// Cached state across the two passes
let parser: VeynParser | null = null;
let cachedAsts: SourceFile[] = [];
let repositoryRoot: string = "";

const symbolExtractor = new SymbolExtractor();
const dependencyExtractor = new DependencyExtractor();
const callExtractor = new CallExtractor();
const referenceExtractor = new ReferenceExtractor();
const chunker = new Chunker();

if (parentPort) {
  parentPort.on("message", (msg) => {
    try {
      if (msg.type === "parseAndExtract") {
        repositoryRoot = msg.repositoryPath;
        const files: ScannedFile[] = msg.files;

        // Initialize parser if not exists
        if (!parser) {
          parser = new VeynParser(repositoryRoot);
          // Pre-load all files into the project so the TypeChecker can resolve cross-file references.
          // They are parsed lazily by ts-morph.
          (parser as any).project.addSourceFilesAtPaths(path.join(repositoryRoot, "**/*.ts"));
        }

        const allSymbols = [];
        const allImports = [];
        const allCalls = [];
        const allChunks = [];
        
        cachedAsts = [];

        // Parse and extract
        for (const file of files) {
          const absoluteFilePath = path.join(repositoryRoot, file.relativePath);
          const ast = parser.parseFile(absoluteFilePath);
          cachedAsts.push(ast);

          const symbols = symbolExtractor.extract(ast);
          allSymbols.push(...symbols);

          const imports = dependencyExtractor.extract(ast);
          allImports.push(...imports);

          const calls = callExtractor.extract(ast);
          allCalls.push(...calls);

          const chunks = chunker.chunk(ast, { repositoryRoot });
          allChunks.push(...chunks);
        }

        parentPort!.postMessage({
          type: "parsed",
          symbols: allSymbols,
          imports: allImports,
          calls: allCalls,
          chunks: allChunks,
          parsedCount: cachedAsts.length
        });
      } else if (msg.type === "extractReferences") {
        const trackedSymbolsArray: string[] = msg.trackedSymbols;
        const trackedSymbols = new Set(trackedSymbolsArray);

        const allReferences = [];
        

        for (const ast of cachedAsts) {
          const refs = referenceExtractor.extract(ast, {
            repositoryRoot,
            trackedSymbols
          });
          allReferences.push(...refs);
        }

        parentPort!.postMessage({
          type: "references",
          references: allReferences
        });
      }
    } catch (err: any) {
      parentPort!.postMessage({
        type: "error",
        error: err.message || err.toString()
      });
    }
  });
}
