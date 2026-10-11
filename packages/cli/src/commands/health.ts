import { Command } from "commander";
import path from "node:path";
import { RepositoryIdentityResolver, MongoIndexStorage, HealthAnalyzer, PersistenceError } from "@veyn/core";
import { Presenter, colors } from "../ui/presenter.js";

export function registerHealthCommand(program: Command) {
  program
    .command("health")
    .description("Check for structural warnings")
    .action(async () => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.title("Health");
          console.log("");
          console.log("Error");
          Presenter.text("Could not connect to the index database.");
          console.log("\nNext step");
          Presenter.text("Check MONGODB_URI and ensure MongoDB is reachable.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const analyzer = new HealthAnalyzer(storage, identity.id, absoluteRepoPath);

          Presenter.title("Health");
          
          console.log("\nRepository");
          Presenter.text(identity.name);
          console.log("");

          const report = await analyzer.analyze();
          
          let totalSignals = 0;
          if (report.circularDependencies.length > 0) totalSignals++;
          if (report.highCoupling.length > 0) totalSignals++;
          if (report.structuralIssues.length > 0) totalSignals++;
          if (report.largeFiles.length > 0) totalSignals++;
          if (report.deadCodeSignals.length > 0) totalSignals++;

          console.log("Health summary");
          if (totalSignals > 0) {
            Presenter.warning(`${totalSignals} categor${totalSignals === 1 ? 'y needs' : 'ies need'} review`);
          } else {
            Presenter.success("No structural signals found");
          }
          Presenter.success("Health analysis completed successfully");
          console.log("");

          console.log("Note");
          Presenter.text("These findings are advisory. They do not mean the project is broken.");
          Presenter.section("Findings");

          // Circular Dependencies
          console.log("Structural dependency cycles");
          if (report.circularDependencies.length > 0) {
            // Deduplicate and sort cycles deterministically
            const uniqueCycles = new Map<string, string[]>();
            for (const cycle of report.circularDependencies) {
              // Normalize cycle to start with the lexicographically smallest node
              const cycleNodes = cycle.slice(0, -1);
              let minIdx = 0;
              for (let i = 1; i < cycleNodes.length; i++) {
                if (cycleNodes[i] < cycleNodes[minIdx]) minIdx = i;
              }
              const normalizedCycle = [...cycleNodes.slice(minIdx), ...cycleNodes.slice(0, minIdx), cycleNodes[minIdx]];
              const key = normalizedCycle.join("->");
              if (!uniqueCycles.has(key)) {
                uniqueCycles.set(key, normalizedCycle);
              }
            }
            
            const sortedCycles = Array.from(uniqueCycles.values()).sort((a, b) => a.join("->").localeCompare(b.join("->")));

            Presenter.warning(`${sortedCycles.length} dependency cycle${sortedCycles.length === 1 ? '' : 's'} detected`);
            console.log("");
            
            sortedCycles.forEach((cycle, idx) => {
              const startNode = cycle[0];
              Presenter.text(`${idx + 1}. ${startNode}`);
              
              for (let i = 1; i < cycle.length - 1; i++) {
                if (i === 1) {
                  Presenter.text(`   imports ${cycle[i]}`);
                } else {
                  Presenter.text(`   which imports ${cycle[i]}`);
                }
              }
              const lastNode = cycle[cycle.length - 1];
              if (lastNode === startNode) {
                Presenter.text(`   which returns to ${path.basename(startNode)}`);
              } else {
                Presenter.text(`   which imports ${lastNode}`);
              }
              console.log("");
            });
          } else {
            Presenter.success("No dependency cycles detected");
          }
          console.log("");

          // High Coupling
          console.log("Highly connected modules");
          if (report.highCoupling.length > 0) {
            Presenter.warning(`${report.highCoupling.length} module${report.highCoupling.length === 1 ? ' has' : 's have'} many relationships`);
            console.log("");

            report.highCoupling.forEach(hc => {
              const parts = hc.split('::');
              if (parts.length === 3) {
                Presenter.text(`${parts[0]}`);
                Presenter.text(`  ${parts[1]} modules depend on it`);
                Presenter.text(`  ${parts[2]} modules it depends on`);
                console.log("");
              }
            });
          } else {
            Presenter.success("No highly connected modules");
          }
          console.log("");

          // Isolated Modules
          console.log("Possible isolated files");
          if (report.structuralIssues.length > 0) {
            Presenter.warning(`${report.structuralIssues.length} file${report.structuralIssues.length === 1 ? ' has' : 's have'} no recorded relationships`);
            console.log("");

            report.structuralIssues.forEach(si => {
              Presenter.text(`${si}`);
            });
            console.log("");
          } else {
            Presenter.success("No isolated files");
          }
          console.log("");

          // Unused Code Signals
          console.log("Functions with no recorded internal callers");
          if (report.deadCodeSignals.length > 0) {
            Presenter.warning("Some functions have no recorded callers");
            console.log("");

            report.deadCodeSignals.forEach(dc => {
              Presenter.text(`${dc}`);
            });

            if (report.deadCodeSignals.length === 50) {
              Presenter.text(`${colors.dim}... (capped at 50)${colors.reset}`);
            }
            console.log("");
            Presenter.text("This is only a signal. Exported functions, public APIs,");
            Presenter.text("entry points, and dynamically used functions may still be valid.");
          } else {
            Presenter.success("No unused code signals");
          }
          console.log("");

          // Large Files
          console.log("Large files");
          if (report.largeFiles.length > 0) {
            Presenter.warning(`${report.largeFiles.length} unusually large file${report.largeFiles.length === 1 ? '' : 's'} (>50KB)`);
            console.log("");
            report.largeFiles.forEach(lf => {
              const parts = lf.split('::');
              if (parts.length === 2) {
                const kb = (parseInt(parts[1], 10) / 1024).toFixed(1);
                Presenter.text(`${parts[0]}`);
                Presenter.text(`  ${kb} KB`);
                console.log("");
              }
            });
          } else {
            Presenter.success("No unusually large files");
          }
          console.log("");

          if (totalSignals > 0) {
            console.log("Next step");
            Presenter.text("Review these findings before making changes.");
          }

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        Presenter.title("Health");
        console.log("");
        console.log("Error");
        Presenter.text("Could not connect to the index database.");
        console.log("\nNext step");
        Presenter.text("Check MONGODB_URI and ensure MongoDB is reachable.");
        process.exit(1);
      }
    });
}
