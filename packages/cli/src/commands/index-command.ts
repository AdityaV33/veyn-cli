import { Command } from "commander";
import { scanRepository, ScannerError, VeynParser, ParserError, SymbolExtractor, DependencyExtractor, buildDependencyGraph, ImportRecord, CallExtractor, CallRecord, CallGraph, Chunker, CodeChunk, RepositoryIdentityResolver, MongoIndexStorage, PersistenceError, LocalEmbeddingProvider, EmbeddingResult, SymbolRecord } from "@veyn/core";
import path from "path";

export function registerIndexCommand(program: Command) {
  program
    .command("index <path>")
    .description("Index a path")
    .action(async (repoPath: string) => {
      try {
        const startTime = Date.now();
        const absoluteRepoPath = path.resolve(repoPath);
        const result = scanRepository(absoluteRepoPath);
        
        const parser = new VeynParser();
        const symbolExtractor = new SymbolExtractor();
        const dependencyExtractor = new DependencyExtractor();
        const callExtractor = new CallExtractor();
        const chunker = new Chunker();
        
        let parsedCount = 0;
        let extractedSymbolCount = 0;
        let extractedImportCount = 0;
        const allSymbols: SymbolRecord[] = [];
        const allImports: ImportRecord[] = [];
        const allCalls: CallRecord[] = [];
        const allChunks: CodeChunk[] = [];

        // Parsing files first is important so that cross-file call resolution works properly
        const asts = result.files.map(file => {
          const absoluteFilePath = path.join(result.repositoryPath, file.relativePath);
          return parser.parseFile(absoluteFilePath);
        });

        for (const ast of asts) {
          parsedCount++;

          const symbols = symbolExtractor.extract(ast);
          extractedSymbolCount += symbols.length;
          allSymbols.push(...symbols);
          
          const imports = dependencyExtractor.extract(ast);
          extractedImportCount += imports.length;
          allImports.push(...imports);

          const calls = callExtractor.extract(ast);
          allCalls.push(...calls);

          const chunks = chunker.chunk(ast, { repositoryRoot: absoluteRepoPath });
          allChunks.push(...chunks);
        }

        const dependencyGraph = buildDependencyGraph(allImports, { repositoryRoot: absoluteRepoPath });
        const callGraph = new CallGraph();
        callGraph.build(allCalls, { repositoryRoot: absoluteRepoPath });

        const depSnapshot = dependencyGraph.toJSON();
        const callSnapshot = callGraph.toJSON();

        console.log(`Scanner discovered ${result.files.length} TypeScript files.`);
        console.log(`Parsed ${parsedCount} files successfully.`);
        console.log(`Extracted ${extractedSymbolCount} symbols.`);
        console.log(`Extracted ${extractedImportCount} imports.`);
        console.log(`Built dependency graph: ${depSnapshot.nodes.length} nodes, ${depSnapshot.edges.length} edges.`);
        console.log(`Built call graph: ${callSnapshot.nodes.length} nodes, ${callSnapshot.edges.length} edges.`);
        console.log(`Prepared ${allChunks.length} deterministic code chunks.`);

        let embeddings: EmbeddingResult[] = [];
        const provider = new LocalEmbeddingProvider();
        embeddings = await provider.embed(allChunks);
        if (embeddings.length > 0) {
          console.log(`Generated ${embeddings.length} embeddings via local BGE provider.`);
        }

        // --- Phase 0.10 Persistence ---
        if (!process.env.MONGODB_URI) {
          console.error("\nPersistence Error: MONGODB_URI environment variable is missing.");
          console.error("Index was generated in memory but could not be persisted to MongoDB Atlas.");
          console.error("Please configure MONGODB_URI and try again.\n");
          process.exit(1);
        }

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          await storage.clearRepository(identity.id);

          await storage.saveFiles(identity.id, result.files);
          await storage.saveSymbols(identity.id, allSymbols);
          await storage.saveDependencies(identity.id, allImports);
          await storage.saveDependencyGraph(identity.id, depSnapshot.nodes, depSnapshot.edges);
          await storage.saveCallGraph(identity.id, callSnapshot.nodes, callSnapshot.edges);
          await storage.saveChunks(identity.id, allChunks);
          await storage.saveEmbeddings(identity.id, embeddings);

          const endTime = Date.now();
          await storage.saveMetadata({
            repositoryId: identity.id,
            repositoryName: identity.name,
            indexedAt: new Date(),
            fileCount: result.files.length,
            symbolCount: allSymbols.length,
            importCount: allImports.length,
            dependencyNodeCount: depSnapshot.nodes.length,
            dependencyEdgeCount: depSnapshot.edges.length,
            callNodeCount: callSnapshot.nodes.length,
            callEdgeCount: callSnapshot.edges.length,
            chunkCount: allChunks.length,
            embeddingCount: embeddings.length,
            indexDurationMs: endTime - startTime
          });

        } finally {
          await storage.disconnect();
        }

        console.log(`Index persisted successfully to MongoDB for repository: ${identity.name} (${identity.id})`);

      } catch (error: any) {
        if (error instanceof ScannerError) {
          console.error(`Scanner Error: ${error.message}`);
          process.exit(1);
        } else if (error instanceof ParserError) {
          console.error(`Parser Error: ${error.message}`);
          process.exit(1);
        } else if (error instanceof PersistenceError) {
          console.error(`Persistence Error: ${error.message}`);
          process.exit(1);
        }
        
        throw error;
      }
    });
}
