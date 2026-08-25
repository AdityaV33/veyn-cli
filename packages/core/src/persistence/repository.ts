import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { RepositoryIdentity } from "./types.js";
import { PersistenceError } from "./errors.js";

export class RepositoryIdentityResolver {
  public resolve(absoluteRepoPath: string): RepositoryIdentity {
    try {
      if (!fs.existsSync(absoluteRepoPath)) {
        throw new PersistenceError(`Repository path does not exist: ${absoluteRepoPath}`);
      }

      let name = "";
      const pkgPath = path.join(absoluteRepoPath, "package.json");
      
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (pkg.name) {
            name = pkg.name;
          }
        } catch (e) {
          // Ignore parsing errors, fallback to basename
        }
      }

      if (!name) {
        name = path.basename(absoluteRepoPath);
      }

      if (!name) {
        name = "unknown-repository";
      }

      // Create a deterministic hash of the name to use as a stable internal ID
      // Do not use the absolute path in the hash to keep it machine-independent
      const hash = createHash("sha256").update(name).digest("hex");

      return {
        id: hash,
        name
      };
    } catch (e: any) {
      if (e instanceof PersistenceError) throw e;
      throw new PersistenceError(`Failed to resolve repository identity: ${e.message}`);
    }
  }
}
