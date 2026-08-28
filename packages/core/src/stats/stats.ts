import { MongoIndexStorage, IndexMetadata } from "../persistence/index.js";
import { scanRepository } from "../scanner/index.js";
import { ChangeDetector } from "../incremental/index.js";

export interface IndexStats {
  metadata: IndexMetadata | null;
  state: "Up to date" | "Stale" | "Not Indexed";
  staleDetails?: {
    added: number;
    modified: number;
    deleted: number;
  };
}

export class StatsAnalyzer {
  constructor(private storage: MongoIndexStorage, private repositoryId: string, private repositoryPath: string) {}

  public async analyze(): Promise<IndexStats> {
    const metadata = await this.storage.getMetadata(this.repositoryId);

    if (!metadata) {
      return { metadata: null, state: "Not Indexed" };
    }

    const previousFiles = await this.storage.getFiles(this.repositoryId);
    let state: "Up to date" | "Stale" = "Up to date";
    let staleDetails;

    try {
      const scanResult = scanRepository(this.repositoryPath);
      const detector = new ChangeDetector();
      const changes = detector.detect(previousFiles, scanResult.files);

      if (changes.added.length > 0 || changes.modified.length > 0 || changes.deleted.length > 0) {
        state = "Stale";
        staleDetails = {
          added: changes.added.length,
          modified: changes.modified.length,
          deleted: changes.deleted.length
        };
      }
    } catch (e) {
      state = "Stale";
    }

    return {
      metadata,
      state,
      staleDetails
    };
  }
}
