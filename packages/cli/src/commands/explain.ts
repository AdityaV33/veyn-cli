import { Command } from "commander";
import path from "node:path";
import { RepositoryIdentityResolver, MongoIndexStorage, PersistenceError, SymbolRecord } from "@veyn/core";
import { GroqAdapter } from "@veyn/agent";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { Presenter } from "../ui/presenter.js";

export function registerExplainCommand(program: Command) {
  program
    .command("explain <target>")
    .description("Explain a function or file deterministically")
    .action(async (target: string) => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Configuration Error: MONGODB_URI environment variable is missing.\nVeyn explain requires a configured MongoDB connection.\nPlease configure MONGODB_URI and try again.");
          process.exit(1);
        }

        if (!process.env.GROQ_API_KEY) {
          Presenter.error("Configuration Error: GROQ_API_KEY environment variable is missing.\nVeyn explain requires Groq API access.\nPlease configure GROQ_API_KEY and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const symbols = await storage.getSymbols(identity.id);
          let matchedSymbols = symbols.filter(s => s.name === target);

          if (matchedSymbols.length > 1) {
            const seen = new Set<string>();
            matchedSymbols = matchedSymbols.filter(s => {
              const relPath = path.isAbsolute(s.filePath)
                ? path.relative(absoluteRepoPath, s.filePath).replace(/\\/g, "/")
                : s.filePath;
              const key = `${relPath}:${s.name}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          }

          if (matchedSymbols.length > 1) {
            const options = matchedSymbols.map(s => {
              const relPath = path.isAbsolute(s.filePath)
                ? path.relative(absoluteRepoPath, s.filePath).replace(/\\/g, "/")
                : s.filePath;
              return `  ${relPath}:${s.name}`;
            }).join("\n");
            Presenter.error(`Multiple symbols named "${target}" were found.\n\nSpecify one of:\n\n${options}`);
            process.exit(1);
          }

          let codeContent = "";
          let isFile = false;
          let matchedSymbol: SymbolRecord | undefined;
          let relativeSymbolPath = "";

          if (matchedSymbols.length === 1) {
            matchedSymbol = matchedSymbols[0];
            relativeSymbolPath = path.isAbsolute(matchedSymbol.filePath)
              ? path.relative(absoluteRepoPath, matchedSymbol.filePath).replace(/\\/g, "/")
              : matchedSymbol.filePath;

            const chunks = await storage.getChunksByFilePaths(identity.id, [relativeSymbolPath]);
            const relevantChunks = chunks
              .filter(c => c.startLine <= matchedSymbol!.endLine && c.endLine >= matchedSymbol!.startLine)
              .sort((a, b) => a.startLine - b.startLine);

            codeContent = relevantChunks.map(c => c.content).join("\n\n");
            if (!codeContent) {
              Presenter.error(`Symbol '${target}' found in index, but no corresponding code chunks were found.`);
              process.exit(1);
            }
          } else {
            const files = await storage.getFiles(identity.id);
            const matchedFile = files.find(f => f.relativePath === target || f.relativePath.endsWith(`/${target}`) || f.relativePath.endsWith(`\\${target}`));

            if (matchedFile) {
              isFile = true;
              relativeSymbolPath = matchedFile.relativePath;
              const chunks = await storage.getChunksByFilePaths(identity.id, [relativeSymbolPath]);
              if (chunks.length === 0) {
                Presenter.error(`File '${target}' found in index, but no corresponding code chunks were found.`);
                process.exit(1);
              }
              codeContent = chunks.sort((a, b) => a.startLine - b.startLine).map(c => c.content).join("\n\n");
            } else {
              Presenter.error(`Target '${target}' could not be found in the indexed repository.\n\nPlease check the symbol or file path and try again.`);
              process.exit(1);
            }
          }

          const [callNodes, callEdges, depNodes, depEdges, references] = await Promise.all([
            storage.getCallNodes(identity.id),
            storage.getCallEdges(identity.id),
            storage.getDependencyNodes(identity.id),
            storage.getDependencyEdges(identity.id),
            storage.getReferences(identity.id, isFile ? relativeSymbolPath : `${relativeSymbolPath}:${matchedSymbol!.name}`)
          ]);

          let targetNodeIds: string[] = [];
          if (!isFile) {
            targetNodeIds.push(`${relativeSymbolPath}:${matchedSymbol!.name}`);
            if (matchedSymbol!.kind === "class") {
              const classMethods = symbols.filter(
                s => s.filePath === matchedSymbol!.filePath &&
                     s.kind === "method" &&
                     s.startLine >= matchedSymbol!.startLine &&
                     s.endLine <= matchedSymbol!.endLine
              );
              for (const method of classMethods) {
                targetNodeIds.push(`${relativeSymbolPath}:${method.name}`);
              }
            }
          }

          const upstreamCallers: string[] = [];
          const downstreamCallees: string[] = [];
          let hasMethodLevelCalls = false;

          if (!isFile) {
            const inEdges = callEdges.filter(e => targetNodeIds.includes(e.targetId));
            for (const edge of inEdges) {
              const sourceNode = callNodes.find(n => n.id === edge.sourceId);
              if (sourceNode) {
                const lineStr = edge.line ? `:${edge.line}` : "";
                upstreamCallers.push(`${sourceNode.symbolName}()\n  ${sourceNode.filePath}${lineStr}`);
              }
            }

            const outEdges = callEdges.filter(e => targetNodeIds.includes(e.sourceId));
            if (matchedSymbol!.kind === "class" && outEdges.some(e => targetNodeIds.includes(e.sourceId) && e.sourceId !== `${relativeSymbolPath}:${matchedSymbol!.name}`)) {
              hasMethodLevelCalls = true;
            }

            for (const edge of outEdges) {
              const targetNode = callNodes.find(n => n.id === edge.targetId);
              if (targetNode) {
                downstreamCallees.push(`${targetNode.symbolName}()`);
              }
            }
          }

          const importsList: string[] = [];
          const importedByList: string[] = [];

          const targetDepNodeId = relativeSymbolPath;
          const outDeps = depEdges.filter(e => e.source === targetDepNodeId);
          for (const edge of outDeps) {
             importsList.push(edge.target);
          }
          const inDeps = depEdges.filter(e => e.target === targetDepNodeId);
          for (const edge of inDeps) {
             importedByList.push(edge.source);
          }

          const refsList = references.map(r => `${r.sourceFile}:${r.sourceLine}`);

          const targetKind = isFile ? "file" : matchedSymbol!.kind;
          const targetPathLine = isFile ? relativeSymbolPath : `${relativeSymbolPath}:${matchedSymbol!.startLine}–${matchedSymbol!.endLine}`;
          const targetName = isFile ? relativeSymbolPath : matchedSymbol!.name;

          const uniqueUpstream = [...new Set(upstreamCallers)];
          const uniqueDownstream = [...new Set(downstreamCallees)];
          const uniqueImports = [...new Set(importsList)];
          const uniqueImportedBy = [...new Set(importedByList)];
          const uniqueRefs = [...new Set(refsList)];

          const upstreamStr = isFile ? "Not available for file targets" : (uniqueUpstream.length > 0 ? uniqueUpstream.join("\n") : "No upstream callers found");
          const downstreamStr = isFile ? "Not available for file targets" : (uniqueDownstream.length > 0 ? uniqueDownstream.join("\n") : "No downstream calls found");

          const structuredEvidence = `
Evidence Context for Target: ${targetName} (${targetKind})

--- CODE DEFINITION ---
${codeContent}

--- UPSTREAM (Callers) ---
${upstreamStr}

--- DOWNSTREAM (Callees) ---
${downstreamStr}

--- IMPORTS (Files this depends on) ---
${uniqueImports.length > 0 ? uniqueImports.join("\n") : "No imports found"}

--- IMPORTED BY (Files depending on this) ---
${uniqueImportedBy.length > 0 ? uniqueImportedBy.join("\n") : "No importing files found"}

--- REFERENCES (Other usages, e.g. tests or types) ---
${uniqueRefs.length > 0 ? uniqueRefs.join("\n") : "No references found"}
`;

          Presenter.title("Explain");
          console.log("");

          Presenter.text("Target", 0);
          Presenter.text(`${targetName} (${targetKind})`);
          Presenter.text(`${targetPathLine}`);
          console.log("");

          Presenter.text("Evidence gathered", 0);
          Presenter.text(`✓ Definition retrieved`);
          if (!isFile) {
            Presenter.text(`✓ ${uniqueUpstream.length} upstream relationship${uniqueUpstream.length === 1 ? "" : "s"} found`);
            Presenter.text(`✓ ${uniqueDownstream.length} downstream relationship${uniqueDownstream.length === 1 ? "" : "s"} found`);
          }
          Presenter.text(`✓ ${uniqueImports.length} import${uniqueImports.length === 1 ? "" : "s"} mapped`);
          Presenter.text(`✓ ${uniqueRefs.length} reference${uniqueRefs.length === 1 ? "" : "s"} found`);
          console.log("");

          const llm = new GroqAdapter(process.env.GROQ_API_KEY);

          const systemPrompt = "You are an expert AI code assistant. Your job is to provide ONE cohesive explanation of the target. You are provided with the target's code and structural evidence (callers, callees, imports). Use this evidence to understand the target's purpose and context, but DO NOT list, summarize, or repeat the relationships, module dependencies, callers, or references in your response. The CLI already prints these deterministically. Return ONLY a concise, plain text explanation (a few paragraphs or short numbered description) of what the target is and how it works internally. Do not output separate sections.";
          const userPrompt = structuredEvidence;

          const response = await llm.invoke([
            new SystemMessage(systemPrompt),
            new HumanMessage(userPrompt)
          ]);

          Presenter.text("Explanation", 0);
          const formattedResponse = response.trim().split("\n");
          for (const line of formattedResponse) {
            if (line.trim() === "") console.log("");
            else Presenter.text(line);
          }
          console.log("");

          Presenter.text("Repository context", 0);
          console.log("");

          Presenter.text("Upstream (used by)", 0);
          if (isFile) {
            Presenter.text("Not available for file targets");
          } else if (uniqueUpstream.length > 0) {
            uniqueUpstream.forEach(u => {
              const parts = u.split("\n");
              Presenter.text(parts[0]);
              if (parts[1]) Presenter.text(parts[1], 2);
            });
          } else {
            Presenter.text("No upstream callers found");
          }
          console.log("");

          Presenter.text(hasMethodLevelCalls ? "Downstream (uses, from analyzed methods)" : "Downstream (uses)", 0);
          if (isFile) {
            Presenter.text("Not available for file targets");
          } else if (uniqueDownstream.length > 0) {
            uniqueDownstream.forEach(d => Presenter.text(d));
          } else {
            Presenter.text("No downstream calls found");
          }
          console.log("");

          Presenter.text("Imports", 0);
          if (uniqueImports.length > 0) {
            uniqueImports.forEach(i => Presenter.text(i));
          } else {
            Presenter.text("No imports found");
          }
          console.log("");

          Presenter.text("Imported by", 0);
          if (uniqueImportedBy.length > 0) {
            uniqueImportedBy.forEach(i => Presenter.text(i));
          } else {
            Presenter.text("No importing files found");
          }
          console.log("");

          Presenter.text("References", 0);
          if (uniqueRefs.length > 0) {
            uniqueRefs.forEach(r => Presenter.text(r));
          } else {
            Presenter.text("No references found");
          }
          console.log("");

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.error(`Storage Error: ${error.message}`);
          process.exit(1);
        }
        Presenter.error(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
