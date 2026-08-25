import { ScannedFile } from "../scanner/index.js";
import { SymbolRecord } from "../symbols/index.js";
import { ImportRecord } from "../dependencies/index.js";
import { GraphNode, GraphEdge } from "../graph/index.js";
import { CallGraphNode, CallGraphEdge } from "../calls/index.js";
import { CodeChunk, EmbeddingResult } from "../embeddings/index.js";

export interface RepositoryIdentity {
  id: string;   // Deterministic string identifier
  name: string; // Human readable name
}

export interface IndexMetadata {
  repositoryId: string;
  repositoryName: string;
  indexedAt: Date;
  fileCount: number;
  symbolCount: number;
  importCount: number;
  dependencyNodeCount: number;
  dependencyEdgeCount: number;
  callNodeCount: number;
  callEdgeCount: number;
  chunkCount: number;
  embeddingCount: number;
}

export interface IndexStorage {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // Clean prior data for this repository
  clearRepository(repositoryId: string): Promise<void>;

  // targeted removal
  removeStaleFacts(repositoryId: string, filePaths: string[]): Promise<void>;

  // Retrieval for incremental logic
  getFiles(repositoryId: string): Promise<ScannedFile[]>;
  getDependencyEdges(repositoryId: string): Promise<GraphEdge[]>;
  getCallEdges(repositoryId: string): Promise<CallGraphEdge[]>;
  getMetadata(repositoryId: string): Promise<IndexMetadata | null>;
  recalculateMetadata(repositoryId: string): Promise<IndexMetadata>;

  // Search Retrieval
  vectorSearch(repositoryId: string, embedding: number[], limit: number): Promise<{ chunkId: string, score: number }[]>;
  searchLexicalChunks(repositoryId: string, terms: string[], limit: number): Promise<CodeChunk[]>;
  getChunksByIds(repositoryId: string, chunkIds: string[]): Promise<CodeChunk[]>;

  // Storage operations
  saveMetadata(metadata: IndexMetadata): Promise<void>;
  saveFiles(repositoryId: string, files: ScannedFile[]): Promise<void>;
  saveSymbols(repositoryId: string, symbols: SymbolRecord[]): Promise<void>;
  saveDependencies(repositoryId: string, dependencies: ImportRecord[]): Promise<void>;
  saveDependencyGraph(repositoryId: string, nodes: GraphNode[], edges: GraphEdge[]): Promise<void>;
  saveCallGraph(repositoryId: string, nodes: CallGraphNode[], edges: CallGraphEdge[]): Promise<void>;
  saveChunks(repositoryId: string, chunks: CodeChunk[]): Promise<void>;
  saveEmbeddings(repositoryId: string, embeddings: EmbeddingResult[]): Promise<void>;
}
