import { scanRepository } from "../scanner/scanner.js";
import { VeynParser } from "../parser/parser.js";
import { SymbolExtractor } from "../symbols/extractor.js";
import { DependencyExtractor } from "../dependencies/extractor.js";
import { buildDependencyGraph } from "../graph/builder.js";
import { CallExtractor } from "../calls/extractor.js";
import { CallGraph } from "../calls/graph.js";
import { Chunker } from "../embeddings/chunker.js";
import { ReferenceExtractor } from "../symbols/references.js";
import { SymbolRecord } from "../symbols/types.js";
import { ImportRecord } from "../dependencies/types.js";
import { CallRecord } from "../calls/types.js";
import { ReferenceRecord } from "../symbols/types.js";
import { CodeChunk } from "../embeddings/types.js";
import { MongoIndexStorage } from "../persistence/mongodb-storage.js";
import { EmbeddingResult } from "../embeddings/types.js";
import { EmbeddingProvider } from "../embeddings/provider.js";
import path from "path";

export interface IndexResult {
  fileCount: number;
  parsedCount: number;
  extractedSymbolCount: number;
  extractedImportCount: number;
  extractedReferenceCount: number;
  dependencyNodeCount: number;
  dependencyEdgeCount: number;
  callNodeCount: number;
  callEdgeCount: number;
  chunkCount: number;
  embeddingCount: number;
  durationMs: number;
}

export class Indexer {
  constructor(
    private storage: MongoIndexStorage,
    private provider: EmbeddingProvider
  ) {}

  async index(
    repositoryPath: string, 
    repositoryId: string, 
    repositoryName: string,
    onProgress?: (msg: string) => void
  ): Promise<IndexResult> {
    const startTime = Date.now();
    const result = scanRepository(repositoryPath);
    
    const parser = new VeynParser(repositoryPath);
    const symbolExtractor = new SymbolExtractor();
    const dependencyExtractor = new DependencyExtractor();
    const callExtractor = new CallExtractor();
    const referenceExtractor = new ReferenceExtractor();
    const chunker = new Chunker();
    
    let parsedCount = 0;
    let extractedSymbolCount = 0;
    let extractedImportCount = 0;
    const allSymbols: SymbolRecord[] = [];
    const allImports: ImportRecord[] = [];
    const allCalls: CallRecord[] = [];
    const allReferences: ReferenceRecord[] = [];
    const allChunks: CodeChunk[] = [];

    // Parsing files first is important so that cross-file call resolution works properly
    const asts = result.files.map(file => {
      const absoluteFilePath = path.join(result.repositoryPath, file.relativePath);
      return parser.parseFile(absoluteFilePath);
    });

    const trackedSymbols = new Set<string>();

    for (const ast of asts) {
      parsedCount++;

      const symbols = symbolExtractor.extract(ast);
      extractedSymbolCount += symbols.length;
      allSymbols.push(...symbols);
      
      for (const sym of symbols) {
        trackedSymbols.add(`${sym.filePath}:${sym.name}`);
      }
      
      const imports = dependencyExtractor.extract(ast);
      extractedImportCount += imports.length;
      allImports.push(...imports);

      const calls = callExtractor.extract(ast);
      allCalls.push(...calls);

      const chunks = chunker.chunk(ast, { repositoryRoot: repositoryPath });
      allChunks.push(...chunks);
    }

    let extractedReferenceCount = 0;
    for (const ast of asts) {
      const refs = referenceExtractor.extract(ast, { 
        repositoryRoot: repositoryPath,
        trackedSymbols 
      });
      extractedReferenceCount += refs.length;
      allReferences.push(...refs);
    }

    const dependencyGraph = buildDependencyGraph(result.files, allImports, { repositoryRoot: repositoryPath });
    const callGraph = new CallGraph();
    callGraph.build(allCalls, { repositoryRoot: repositoryPath });

    const depSnapshot = dependencyGraph.toJSON();
    const callSnapshot = callGraph.toJSON();

    if (onProgress) {
      onProgress(`Scanner discovered ${result.files.length} TypeScript files.`);
      onProgress(`Parsed ${parsedCount} files successfully.`);
      onProgress(`Extracted ${extractedSymbolCount} symbols.`);
      onProgress(`Extracted ${extractedImportCount} imports.`);
      onProgress(`Built dependency graph: ${depSnapshot.nodes.length} nodes, ${depSnapshot.edges.length} edges.`);
      onProgress(`Built call graph: ${callSnapshot.nodes.length} nodes, ${callSnapshot.edges.length} edges.`);
      onProgress(`Extracted ${extractedReferenceCount} references.`);
      onProgress(`Prepared ${allChunks.length} deterministic code chunks.`);
    }

    let embeddings: EmbeddingResult[] = [];
    embeddings = await this.provider.embed(allChunks);
    if (embeddings.length > 0 && onProgress) {
      onProgress(`Generated ${embeddings.length} embeddings via local BGE provider.`);
    }

    await this.storage.clearRepository(repositoryId);

    await this.storage.saveFiles(repositoryId, result.files);
    await this.storage.saveSymbols(repositoryId, allSymbols);
    await this.storage.saveDependencies(repositoryId, allImports);
    await this.storage.saveDependencyGraph(repositoryId, depSnapshot.nodes, depSnapshot.edges);
    await this.storage.saveCallGraph(repositoryId, callSnapshot.nodes, callSnapshot.edges);
    await this.storage.saveReferences(repositoryId, allReferences);
    await this.storage.saveChunks(repositoryId, allChunks);
    await this.storage.saveEmbeddings(repositoryId, embeddings);

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    await this.storage.saveMetadata({
      repositoryId: repositoryId,
      repositoryName: repositoryName,
      indexedAt: new Date(),
      fileCount: result.files.length,
      symbolCount: allSymbols.length,
      importCount: allImports.length,
      dependencyNodeCount: depSnapshot.nodes.length,
      dependencyEdgeCount: depSnapshot.edges.length,
      callNodeCount: callSnapshot.nodes.length,
      callEdgeCount: callSnapshot.edges.length,
      referenceCount: allReferences.length,
      chunkCount: allChunks.length,
      embeddingCount: embeddings.length,
      indexDurationMs: durationMs
    });

    return {
      fileCount: result.files.length,
      parsedCount,
      extractedSymbolCount,
      extractedImportCount,
      extractedReferenceCount,
      dependencyNodeCount: depSnapshot.nodes.length,
      dependencyEdgeCount: depSnapshot.edges.length,
      callNodeCount: callSnapshot.nodes.length,
      callEdgeCount: callSnapshot.edges.length,
      chunkCount: allChunks.length,
      embeddingCount: embeddings.length,
      durationMs
    };
  }
}
