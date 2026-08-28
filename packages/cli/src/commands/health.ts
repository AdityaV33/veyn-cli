import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, HealthAnalyzer, PersistenceError } from "@veyn/core";

export function registerHealthCommand(program: Command) {
  program
    .command("health")
    .description("Check repository health")
    .action(async () => {
      try {
        if (!process.env.MONGODB_URI) {
          console.error("\\nConfiguration Error: MONGODB_URI environment variable is missing.");
          console.error("Veyn health requires a configured MongoDB connection for the index.");
          console.error("Please configure MONGODB_URI and try again.\\n");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const analyzer = new HealthAnalyzer(storage, identity.id);
          const report = await analyzer.analyze();

          console.log(`\\n--- Veyn Health Report for '${identity.name}' ---\\n`);

          if (report.circularDependencies.length > 0) {
            console.log("🔴 Circular Dependencies Detected:");
            report.circularDependencies.forEach(cycle => {
              console.log(`   - ${cycle.join(" -> ")}`);
            });
            console.log("");
          } else {
            console.log("🟢 Circular Dependencies: None\\n");
          }

          if (report.highCoupling.length > 0) {
            console.log("🟡 High Coupling Modules (>20 edges):");
            report.highCoupling.forEach(hc => console.log(`   - ${hc}`));
            console.log("");
          } else {
            console.log("🟢 High Coupling Modules: None\\n");
          }

          if (report.structuralIssues.length > 0) {
            console.log("🟡 Structural Issues (Isolated Modules):");
            report.structuralIssues.forEach(si => console.log(`   - ${si}`));
            console.log("");
          } else {
            console.log("🟢 Structural Issues: None\\n");
          }

          if (report.largeFiles.length > 0) {
            console.log("🟡 Unusually Large Files (>50KB):");
            report.largeFiles.forEach(lf => console.log(`   - ${lf}`));
            console.log("");
          } else {
            console.log("🟢 Unusually Large Files: None\\n");
          }

          if (report.deadCodeSignals.length > 0) {
            console.log("🟡 Dead/Unused Code Signals (Uncalled Functions):");
            report.deadCodeSignals.forEach(dc => console.log(`   - ${dc}`));
            if (report.deadCodeSignals.length === 50) {
              console.log("   - ... (capped at 50)");
            }
            console.log("");
          } else {
            console.log("🟢 Dead/Unused Code Signals: None\\n");
          }

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          console.error(`\\nHealth Error: ${error.message}\\n`);
          process.exit(1);
        }

        console.error(`\\nUnexpected Error: ${error.message}\\n`);
        process.exit(1);
      }
    });
}
