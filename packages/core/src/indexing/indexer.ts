import { ChangeDetector } from "../incremental/detector.js";
import { AffectedResolver } from "../incremental/resolver.js";
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
import { Worker } from "worker_threads";
import os from "os";
import path from "path";

function normalizePath(absolutePath: string, rootPath: string): string {
  const rel = path.relative(rootPath, absolutePath);
  return rel.replace(/\\/g, "/");
}

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
    
    let parsedCount = 0;
    let extractedSymbolCount = 0;
    let extractedImportCount = 0;
    const allSymbols: SymbolRecord[] = [];
    const allImports: ImportRecord[] = [];
    const allCalls: CallRecord[] = [];
    const allReferences: ReferenceRecord[] = [];
    const allChunks: CodeChunk[] = [];

    // Worker threads logic
    const workerCount = Math.min(os.cpus().length, 4);
    const workers: Worker[] = [];
    const filesPerWorker = Math.ceil(result.files.length / workerCount);
    const workerScript = new URL("./worker.js", import.meta.url);

    // If no files, nothing to do
    if (result.files.length === 0) {
      if (onProgress) onProgress("No TypeScript files found.");
      return {
        fileCount: 0,
        parsedCount: 0,
        extractedSymbolCount: 0,
        extractedImportCount: 0,
        extractedReferenceCount: 0,
        dependencyNodeCount: 0,
        dependencyEdgeCount: 0,
        callNodeCount: 0,
        callEdgeCount: 0,
        chunkCount: 0,
        embeddingCount: 0,
        durationMs: Date.now() - startTime
      };
    }

    if (onProgress) {
      onProgress(`Scanner discovered ${result.files.length} TypeScript files.`);
      onProgress(`Spawning up to ${workerCount} worker threads...`);
    }

    const startWorker = (filesBatch: any[]) => {
      const worker = new Worker(workerScript);
      workers.push(worker);
      return new Promise<any>((resolve, reject) => {
        worker.once("message", (msg) => {
          if (msg.type === "error") reject(new Error(msg.error));
          else resolve(msg);
        });
        worker.once("error", reject);
        worker.postMessage({
          type: "parseAndExtract",
          repositoryPath,
          files: filesBatch
        });
      });
    };

    let extractedReferenceCount = 0;
    try {
      const parsePromises = [];
      for (let i = 0; i < result.files.length; i += filesPerWorker) {
        const batch = result.files.slice(i, i + filesPerWorker);
        parsePromises.push(startWorker(batch));
      }

      const parseResults = await Promise.all(parsePromises);

      const trackedSymbols = new Set<string>();

      for (const res of parseResults) {
        parsedCount += res.parsedCount;
        extractedSymbolCount += res.symbols.length;
        allSymbols.push(...res.symbols);
        
        for (const sym of res.symbols) {
          const relativePath = normalizePath(sym.filePath, repositoryPath);
          trackedSymbols.add(`${relativePath}:${sym.name}`);
        }

        extractedImportCount += res.imports.length;
        allImports.push(...res.imports);

        allCalls.push(...res.calls);
        allChunks.push(...res.chunks);
      }

      if (onProgress) {
        onProgress(`Parsed ${parsedCount} files successfully.`);
        onProgress(`Extracted ${extractedSymbolCount} symbols.`);
        onProgress(`Extracted ${extractedImportCount} imports.`);
      }

      const trackedSymbolsArray = Array.from(trackedSymbols);

      const extractRefs = (worker: Worker) => {
        return new Promise<any>((resolve, reject) => {
          worker.once("message", (msg) => {
            if (msg.type === "error") reject(new Error(msg.error));
            else resolve(msg);
          });
          worker.once("error", reject);
          worker.postMessage({
            type: "extractReferences",
            trackedSymbols: trackedSymbolsArray
          });
        });
      };

      const refPromises = workers.map(w => extractRefs(w));
      const refResults = await Promise.all(refPromises);

      for (const res of refResults) {
        extractedReferenceCount += res.references.length;
        allReferences.push(...res.references);
      }

      if (onProgress) {
        onProgress(`Extracted ${extractedReferenceCount} cross-file references.`);
      }
    } finally {
      // Terminate workers regardless of success or failure
      for (const worker of workers) {
        await worker.terminate();
      }
    }

    const dependencyGraph = buildDependencyGraph(result.files, allImports, { repositoryRoot: repositoryPath });
    const callGraph = new CallGraph();
    callGraph.build(allCalls, { repositoryRoot: repositoryPath });

    const depSnapshot = dependencyGraph.toJSON();
    const callSnapshot = callGraph.toJSON();

    if (onProgress) {
      onProgress(`Built dependency graph: ${depSnapshot.nodes.length} nodes, ${depSnapshot.edges.length} edges.`);
      onProgress(`Built call graph: ${callSnapshot.nodes.length} nodes, ${callSnapshot.edges.length} edges.`);
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

  async reindex(
    repositoryPath: string, 
    repositoryId: string, 
    repositoryName: string,
    onProgress?: (msg: string) => void
  ): Promise<IndexResult | null> {
    const startTime = Date.now();
    const result = scanRepository(repositoryPath);
    
    // Determine added/modified/deleted/unchanged
    const existingFiles = await this.storage.getFiles(repositoryId);
    const detector = new ChangeDetector();
    const changes = detector.detect(existingFiles, result.files);

    if (changes.added.length === 0 && changes.modified.length === 0 && changes.deleted.length === 0) {
      if (onProgress) onProgress("No changes detected.");
      return null;
    }

    // Determine affected files
    const existingEdges = await this.storage.getDependencyEdges(repositoryId);
    const existingCallEdges = await this.storage.getCallEdges(repositoryId);
    const affectedResolver = new AffectedResolver();
    const affectedFiles = affectedResolver.resolve(changes, existingEdges, existingCallEdges);

    if (onProgress) {
      onProgress(`Changes detected: ${changes.added.length} added, ${changes.modified.length} modified, ${changes.deleted.length} deleted.`);
      onProgress(`Affected files: ${affectedFiles.length}`);
    }

    // Remove deleted files from affected list for parsing
    const filesToParse = affectedFiles.filter(f => !changes.deleted.includes(f));
    const scannedFilesToParse = result.files.filter(f => filesToParse.includes(f.relativePath));

    let parsedCount = 0;
    let extractedSymbolCount = 0;
    let extractedImportCount = 0;
    const allSymbols: SymbolRecord[] = [];
    const allImports: ImportRecord[] = [];
    const allCalls: CallRecord[] = [];
    const allReferences: ReferenceRecord[] = [];
    const allChunks: CodeChunk[] = [];

    // Worker threads logic
    const workerCount = Math.min(os.cpus().length, 4);
    const workers: Worker[] = [];
    const filesPerWorker = Math.ceil(scannedFilesToParse.length / workerCount) || 1;
    const workerScript = new URL("./worker.js", import.meta.url);

    if (scannedFilesToParse.length > 0 && onProgress) {
      onProgress(`Spawning up to ${workerCount} worker threads for ${scannedFilesToParse.length} files...`);
    }

    const startWorker = (filesBatch: any[]) => {
      const worker = new Worker(workerScript);
      workers.push(worker);
      return new Promise<any>((resolve, reject) => {
        worker.once("message", (msg) => {
          if (msg.type === "error") reject(new Error(msg.error));
          else resolve(msg);
        });
        worker.once("error", reject);
        worker.postMessage({
          type: "parseAndExtract",
          repositoryPath,
          files: filesBatch
        });
      });
    };

    let extractedReferenceCount = 0;
    try {
      if (scannedFilesToParse.length > 0) {
        const parsePromises = [];
        for (let i = 0; i < scannedFilesToParse.length; i += filesPerWorker) {
          const batch = scannedFilesToParse.slice(i, i + filesPerWorker);
          parsePromises.push(startWorker(batch));
        }

        const parseResults = await Promise.all(parsePromises);

        for (const res of parseResults) {
          parsedCount += res.parsedCount;
          extractedSymbolCount += res.symbols.length;
          allSymbols.push(...res.symbols);
          extractedImportCount += res.imports.length;
          allImports.push(...res.imports);
          allCalls.push(...res.calls);
          allChunks.push(...res.chunks);
        }
      }

      if (onProgress) {
        onProgress(`Parsed ${parsedCount} files successfully.`);
        onProgress(`Extracted ${extractedSymbolCount} new symbols.`);
      }

      // Track ALL existing symbols (minus affected) + new symbols for reference extraction
      const existingSymbols = await this.storage.getSymbols(repositoryId);
      const trackedSymbols = new Set<string>();
      
      for (const s of existingSymbols) {
         if (!affectedFiles.includes(s.filePath)) {
             const relativePath = normalizePath(path.join(repositoryPath, s.filePath), repositoryPath);
             trackedSymbols.add(`${relativePath}:${s.name}`);
         }
      }
      for (const sym of allSymbols) {
         const relativePath = normalizePath(sym.filePath, repositoryPath);
         trackedSymbols.add(`${relativePath}:${sym.name}`);
      }

      const trackedSymbolsArray = Array.from(trackedSymbols);

      if (scannedFilesToParse.length > 0) {
        const extractRefs = (worker: Worker) => {
          return new Promise<any>((resolve, reject) => {
            worker.once("message", (msg) => {
              if (msg.type === "error") reject(new Error(msg.error));
              else resolve(msg);
            });
            worker.once("error", reject);
            worker.postMessage({
              type: "extractReferences",
              trackedSymbols: trackedSymbolsArray
            });
          });
        };

        const refPromises = workers.map(w => extractRefs(w));
        const refResults = await Promise.all(refPromises);

        for (const res of refResults) {
          extractedReferenceCount += res.references.length;
          allReferences.push(...res.references);
        }

        if (onProgress) {
          onProgress(`Extracted ${extractedReferenceCount} cross-file references.`);
        }
      }
    } finally {
      // Terminate workers regardless of success or failure
      for (const worker of workers) {
        await worker.terminate();
      }
    }

    const dependencyGraph = buildDependencyGraph(result.files, allImports, { repositoryRoot: repositoryPath });
    const callGraph = new CallGraph();
    callGraph.build(allCalls, { repositoryRoot: repositoryPath });

    const depSnapshot = dependencyGraph.toJSON();
    const callSnapshot = callGraph.toJSON();

    let embeddings: EmbeddingResult[] = [];
    if (allChunks.length > 0) {
      embeddings = await this.provider.embed(allChunks);
    }

    // Update persistence
    await this.storage.removeStaleFacts(repositoryId, affectedFiles);

    await this.storage.saveFiles(repositoryId, scannedFilesToParse);
    await this.storage.saveSymbols(repositoryId, allSymbols);
    await this.storage.saveDependencies(repositoryId, allImports);
    await this.storage.saveDependencyGraph(repositoryId, depSnapshot.nodes, depSnapshot.edges);
    await this.storage.saveCallGraph(repositoryId, callSnapshot.nodes, callSnapshot.edges);
    await this.storage.saveReferences(repositoryId, allReferences);
    await this.storage.saveChunks(repositoryId, allChunks);
    if (embeddings.length > 0) {
      await this.storage.saveEmbeddings(repositoryId, embeddings);
    }

    await this.storage.recalculateMetadata(repositoryId);

    const endTime = Date.now();
    const durationMs = endTime - startTime;

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
