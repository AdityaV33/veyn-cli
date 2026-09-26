import { describe, it, expect, vi, beforeEach } from "vitest";
import { MongoIndexStorage } from "../mongodb-storage.js";
import { PersistenceConfigurationError, PersistenceError } from "../errors.js";

// Mock MongoDB driver
vi.mock("mongodb", () => {
  const collectionMock = {
    insertOne: vi.fn(),
    insertMany: vi.fn(),
    deleteMany: vi.fn(),
    updateOne: vi.fn(),
    aggregate: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) })
  };
  
  const dbMock = {
    collection: vi.fn().mockReturnValue(collectionMock)
  };
  
  class MongoClientMock {
    constructor() {}
    connect = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
    db = vi.fn().mockReturnValue(dbMock);
  }
  
  return {
    MongoClient: MongoClientMock,
    Db: vi.fn()
  };
});

describe("MongoIndexStorage", () => {
  it("throws configuration error if URI is missing", () => {
    expect(() => new MongoIndexStorage({ uri: "" })).toThrow(PersistenceConfigurationError);
  });

  it("connects and disconnects successfully", async () => {
    const storage = new MongoIndexStorage({ uri: "mongodb://fake" });
    await expect(storage.connect()).resolves.toBeUndefined();
    await expect(storage.disconnect()).resolves.toBeUndefined();
  });

  it("throws error when performing operations before connecting", async () => {
    const storage = new MongoIndexStorage({ uri: "mongodb://fake" });
    await expect(storage.clearRepository("repo1")).rejects.toThrow(PersistenceError);
    await expect(storage.clearRepository("repo1")).rejects.toThrow(/not connected/);
  });

  describe("operations", () => {
    let storage: MongoIndexStorage;
    let mongodbMock: any;

    beforeEach(async () => {
      // Need to import dynamically or use the vi.mock hoisting to access the mock
      const { MongoClient } = await import("mongodb");
      storage = new MongoIndexStorage({ uri: "mongodb://fake" });
      await storage.connect();
      // Reset mocks on the instance
      mongodbMock = new MongoClient("").db("").collection("");
      vi.clearAllMocks();
    });

    it("clears repository collections correctly", async () => {
      await storage.clearRepository("repo1");
      expect(mongodbMock.deleteMany).toHaveBeenCalledWith({ repositoryId: "repo1" });
      expect(mongodbMock.deleteMany).toHaveBeenCalledTimes(11); // 11 collections
    });

    it("saves metadata", async () => {
      const meta = {
        repositoryId: "r1",
        repositoryName: "test",
        indexedAt: new Date(),
        fileCount: 0,
        symbolCount: 0,
        importCount: 0,
        dependencyNodeCount: 0,
        dependencyEdgeCount: 0,
        callNodeCount: 0,
        callEdgeCount: 0,
        chunkCount: 0,
        embeddingCount: 0
      };
      await storage.saveMetadata(meta);
      expect(mongodbMock.updateOne).toHaveBeenCalledWith(
        { repositoryId: "r1" },
        { $set: meta },
        { upsert: true }
      );
    });

    it("saves files efficiently", async () => {
      await storage.saveFiles("repo1", [
        { relativePath: "a.ts", size: 100 },
        { relativePath: "b.ts", size: 200 }
      ] as any);
      expect(mongodbMock.insertMany).toHaveBeenCalledWith([
        { repositoryId: "repo1", relativePath: "a.ts", size: 100 },
        { repositoryId: "repo1", relativePath: "b.ts", size: 200 }
      ]);
    });

    it("skips save calls for empty arrays", async () => {
      await storage.saveFiles("repo1", []);
      expect(mongodbMock.insertMany).not.toHaveBeenCalled();
    });

    it("performs vectorSearch with the correct contract", async () => {
      const mockAggregate = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ chunkId: "c1", score: 0.95 }]) });
      mongodbMock.aggregate = mockAggregate;
      
      const results = await storage.vectorSearch("repo1", [0.1, 0.2], 10);
      
      expect(mockAggregate).toHaveBeenCalledTimes(1);
      const pipeline = mockAggregate.mock.calls[0][0];
      const vectorSearchStage = pipeline[0].$vectorSearch;
      
      expect(vectorSearchStage.path).toBe("vector");
      expect(vectorSearchStage.index).toBe("vector_index");
      expect(vectorSearchStage.queryVector).toEqual([0.1, 0.2]);
      
      expect(results).toEqual([{ chunkId: "c1", score: 0.95 }]);
    });

    it("removes stale facts correctly, querying chunks before deletion to clean embeddings", async () => {
      // Mock find().toArray() for chunks
      const mockFind = vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([{ id: "chunk1" }, { id: "chunk2" }])
      });
      mongodbMock.find = mockFind;

      await storage.removeStaleFacts("repo1", ["src/a.ts"]);

      // Verify chunks were queried BEFORE deletion
      expect(mockFind).toHaveBeenCalledWith({ repositoryId: "repo1", filePath: { $in: ["src/a.ts"] } });
      
      // Verify embeddings are deleted using the queried chunkIds
      expect(mongodbMock.deleteMany).toHaveBeenCalledWith({ repositoryId: "repo1", chunkId: { $in: ["chunk1", "chunk2"] } });

      // Verify dependency edges deleted with source regex
      expect(mongodbMock.deleteMany).toHaveBeenCalledWith({
        repositoryId: "repo1",
        $or: [{ source: { $regex: "^src/a\\.ts:" } }]
      });

      // Verify call edges deleted with sourceId regex
      expect(mongodbMock.deleteMany).toHaveBeenCalledWith({
        repositoryId: "repo1",
        $or: [{ sourceId: { $regex: "^src/a\\.ts:" } }]
      });
    });
  });
});
