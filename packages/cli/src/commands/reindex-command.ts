import { Command } from "commander";
import { 
  scanRepository, ScannerError, VeynParser, ParserError, SymbolExtractor, 
  DependencyExtractor, buildDependencyGraph, ImportRecord, CallExtractor, 
  CallRecord, CallGraph, Chunker, CodeChunk, RepositoryIdentityResolver, 
  MongoIndexStorage, PersistenceError, GroqEmbeddingProvider, EmbeddingResult, 
  SymbolRecord, ChangeDetector, AffectedResolver 
} from "@veyn/core";
import path from "path";

export function registerReindexCommand(program: Command) {
  program
    .command("reindex <path>")
    .description("Incrementally reindex a path based on changed files")
    .action(async (repoPath: string) => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\nPersistence Error: MONGODB_URI environment variable is missing.");
          console.error("Incremental reindexing requires a configured MongoDB connection.");
          console.error("Please configure MONGODB_URI and try again.\n");
          process.exit(1);
        }

        const absoluteRepoPath = path.resolve(repoPath);
        
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const existingMeta = await storage.getMetadata(identity.id);
          if (!existingMeta) {
            console.error(`\nError: Repository ${identity.name} (${identity.id}) is not indexed.`);
            console.error(`Please run 'veyn index <path>' first.\n`);
            process.exit(1);
          }

          // 4. Scan current repository
          const result = scanRepository(absoluteRepoPath);

          // 5. Determine added/modified/deleted/unchanged
          const existingFiles = await storage.getFiles(identity.id);
          const detector = new ChangeDetector();
          const changes = detector.detect(existingFiles, result.files);

          if (changes.added.length === 0 && changes.modified.length === 0 && changes.deleted.length === 0) {
            console.log("\nNo changes detected.");
            console.log("Repository index is already up to date.\n");
            return;
          }

          // 6. Determine affected files
          const existingEdges = await storage.getDependencyEdges(identity.id);
          const affectedResolver = new AffectedResolver();
          const affectedFiles = affectedResolver.resolve(changes, existingEdges);

          console.log(`\nRepository: ${identity.name}`);
          console.log(`\nChanges detected:`);
          console.log(`  Added: ${changes.added.length}`);
          console.log(`  Modified: ${changes.modified.length}`);
          console.log(`  Deleted: ${changes.deleted.length}`);
          console.log(`  Unchanged: ${changes.unchanged.length}`);
          console.log(`\nAffected files: ${affectedFiles.length}\n`);

          // Remove deleted files from affected list for parsing (we can't parse deleted files)
          const filesToParse = affectedFiles.filter(f => !changes.deleted.includes(f));
          const scannedFilesToParse = result.files.filter(f => filesToParse.includes(f.relativePath));

          // 7. Re-run analysis for affected scope
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

          const asts = scannedFilesToParse.map(file => {
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

          let embeddings: EmbeddingResult[] = [];
          if (process.env.GROQ_API_KEY && allChunks.length > 0) {
            const provider = new GroqEmbeddingProvider({ apiKey: process.env.GROQ_API_KEY });
            embeddings = await provider.embed(allChunks);
          }

          // 8. Update persistence
          await storage.removeStaleFacts(identity.id, affectedFiles);

          await storage.saveFiles(identity.id, scannedFilesToParse);
          await storage.saveSymbols(identity.id, allSymbols);
          await storage.saveDependencies(identity.id, allImports);
          await storage.saveDependencyGraph(identity.id, depSnapshot.nodes, depSnapshot.edges);
          await storage.saveCallGraph(identity.id, callSnapshot.nodes, callSnapshot.edges);
          await storage.saveChunks(identity.id, allChunks);
          if (embeddings.length > 0) {
            await storage.saveEmbeddings(identity.id, embeddings);
          }

          await storage.recalculateMetadata(identity.id);

          console.log(`Reindexed:`);
          console.log(`  Parsed: ${parsedCount}`);
          console.log(`  Symbols: ${extractedSymbolCount}`);
          console.log(`  Imports: ${extractedImportCount}`);
          console.log(`  Calls: ${allCalls.length}`);
          console.log(`  Chunks: ${allChunks.length}`);
          console.log(`\nIndex updated successfully.`);

        } finally {
          await storage.disconnect();
        }

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
