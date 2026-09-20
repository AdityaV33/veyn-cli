import { Command } from "commander";
import { RepositoryIdentityResolver, MongoIndexStorage, HealthAnalyzer, PersistenceError } from "@veyn/core";
import { Presenter, colors } from "../ui/presenter.js";

export function registerHealthCommand(program: Command) {
  program
    .command("health")
    .description("Check repository health")
    .action(async () => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Configuration Error: MONGODB_URI environment variable is missing.");
          Presenter.text("Veyn health requires a configured MongoDB connection for the index.");
          Presenter.text("Please configure MONGODB_URI and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const analyzer = new HealthAnalyzer(storage, identity.id);

          Presenter.title("Health Analysis");
          Presenter.item("Repository", identity.name);

          Presenter.section("Status");
          Presenter.step("Scanning index for architectural anomalies...");

          const report = await analyzer.analyze();
          Presenter.endStep();
          Presenter.success("Scan complete");

          Presenter.section("Findings");

          if (report.circularDependencies.length > 0) {
            Presenter.warning("Circular Dependencies Detected");
            report.circularDependencies.forEach(cycle => {
              Presenter.item("-", cycle.join(" -> "));
            });
            console.log("");
          } else {
            Presenter.success("No circular dependencies");
            console.log("");
          }

          if (report.highCoupling.length > 0) {
            Presenter.warning("High Coupling Modules (>20 edges)");
            report.highCoupling.forEach(hc => Presenter.item("-", hc));
            console.log("");
          } else {
            Presenter.success("No highly coupled modules");
            console.log("");
          }

          if (report.structuralIssues.length > 0) {
            Presenter.warning("Structural Issues (Isolated Modules)");
            report.structuralIssues.forEach(si => Presenter.item("-", si));
            console.log("");
          } else {
            Presenter.success("No isolated modules");
            console.log("");
          }

          if (report.largeFiles.length > 0) {
            Presenter.warning("Unusually Large Files (>50KB)");
            report.largeFiles.forEach(lf => Presenter.item("-", lf));
            console.log("");
          } else {
            Presenter.success("No unusually large files");
            console.log("");
          }

          if (report.deadCodeSignals.length > 0) {
            Presenter.warning("Dead/Unused Code Signals (Uncalled Functions)");
            report.deadCodeSignals.forEach(dc => Presenter.item("-", dc));
            if (report.deadCodeSignals.length === 50) {
              Presenter.dimText("- ... (capped at 50)");
            }
            console.log("");
          } else {
            Presenter.success("No dead code signals detected");
            console.log("");
          }

          Presenter.section("Technical details");
          Presenter.text(`Analyzed ${identity.name} using thresholds: >20 edges (coupling), >50KB (file size)`);
          console.log("");

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.error(`Health Error: ${error.message}`);
          process.exit(1);
        }

        Presenter.error(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
