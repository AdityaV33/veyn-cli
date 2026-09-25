import express, { Express } from "express";
import cors from "cors";
import { z } from "zod";
import { RepositoryIdentityResolver, MongoIndexStorage, HealthAnalyzer, LocalEmbeddingProvider, SearchEngine, loadDependencyGraph, Indexer } from "@veyn/core";

export interface ServerConfig {
  port: number;
  mongoUri: string;
  repositoryPath: string;
  groqApiKey?: string;
}

export async function createServer(config: ServerConfig): Promise<Express> {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const storage = new MongoIndexStorage({ uri: config.mongoUri });
  await storage.connect();

  const resolver = new RepositoryIdentityResolver();
  const identity = resolver.resolve(config.repositoryPath);

  app.get("/health", async (req, res) => {
    try {
      const analyzer = new HealthAnalyzer(storage, identity.id, config.repositoryPath);
      const report = await analyzer.analyze();
      res.json({ status: "success", data: report });
    } catch (error: any) {
      console.error("[Health] Error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/search", async (req, res) => {
    try {
      const query = typeof req.query.query === "string" ? req.query.query : "";
      if (!query) {
        return res.status(400).json({ status: "error", message: "Query parameter is required" });
      }

      const provider = new LocalEmbeddingProvider();
      const engine = new SearchEngine(storage, provider);

      const response = await engine.search({
        repositoryId: identity.id,
        repositoryPath: config.repositoryPath,
        text: query,
        limit: 10
      });

      res.json({ status: "success", data: response.results });
    } catch (error: any) {
      console.error("[Search] Error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.get("/architecture", async (req, res) => {
    try {
      const moduleStr = typeof req.query.module === "string" ? req.query.module : "";
      if (!moduleStr) {
        return res.status(400).json({ status: "error", message: "Module parameter is required" });
      }
      const depth = parseInt(typeof req.query.depth === "string" ? req.query.depth : "5", 10);

      const traversal = await loadDependencyGraph(storage, identity.id);

      const targets = traversal.resolveTarget(moduleStr);
      if (targets.length === 0) {
        return res.status(404).json({ status: "error", message: `Could not resolve target module '${moduleStr}'` });
      }

      if (targets.length > 1) {
        return res.status(400).json({ 
          status: "error", 
          message: `Ambiguous target module '${moduleStr}'. Multiple occurrences found.`,
          candidates: targets.map(t => t.id)
        });
      }

      const targetId = targets[0].id;
      const result = traversal.analyze(targetId, { maxDepth: depth });

      res.json({ status: "success", data: result });
    } catch (error: any) {
      console.error("[Architecture] Error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.post("/index", async (req, res) => {
    try {
      const provider = new LocalEmbeddingProvider();
      const indexer = new Indexer(storage, provider);
      
      const result = await indexer.index(config.repositoryPath, identity.id, identity.name);
      
      res.json({ status: "success", data: result });
    } catch (error: any) {
      console.error("[Index] Error:", error);
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.post("/investigate", async (req, res) => {
    try {
      const question = req.body.question;
      if (!question) {
        return res.status(400).json({ status: "error", message: "Question is required" });
      }

      if (!config.groqApiKey) {
        return res.status(500).json({ status: "error", message: "GROQ_API_KEY is not configured" });
      }

      // We dynamically import agent dependencies since @veyn/server shouldn't strictly depend on agent for health, etc.
      // Actually we should just import them at the top.
      const { createLLMAdapter, loadLLMConfig, ToolRegistry, registerCoreTools, createInvestigationGraph } = await import("@veyn/agent");

      let adapter;
      try {
        adapter = createLLMAdapter(loadLLMConfig());
      } catch (e: any) {
        throw new Error(e.message);
      }
      
      const llms = {
        planner: adapter,
        investigator: adapter,
        reflection: adapter,
        reporter: adapter
      };
      
      const registry = new ToolRegistry();
      registerCoreTools(registry);
      const context = { storage, repositoryId: identity.id };

      const graph = createInvestigationGraph(llms, registry, context);

      const initialState = {
        question,
        repositoryId: identity.id,
        tasks: [],
        currentTask: null,
        evidence: [],
        toolHistory: [],
        reflection: null,
        response: null,
        error: null,
      };

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = await graph.stream(initialState);

      for await (const update of stream) {
        const nodeName = Object.keys(update)[0];
        const state = update[nodeName];

        const payload = JSON.stringify({ node: nodeName, state });
        res.write(`data: ${payload}\n\n`);
      }
      
      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (error: any) {
      console.error("[Investigate] Error:", error);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  return app;
}

export async function startServer(config: ServerConfig) {
  const app = await createServer(config);
  return app.listen(config.port, () => {
    console.log(`Veyn Server listening on port ${config.port}`);
  });
}
