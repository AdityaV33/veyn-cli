import { Command } from "commander";
import {
  RepositoryIdentityResolver,
  MongoIndexStorage,
  DependencyGraphTraversal,
  PersistenceError,
  ArchitecturePathNode,
  loadDependencyGraph
} from "@veyn/core";
import { Presenter, colors } from "../ui/presenter.js";

export function registerArchitectureCommand(program: Command) {
  program
    .command("architecture [module]")
    .description("Show repository or module dependencies")
    .action(async (targetModule: string | undefined) => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Configuration Error: MONGODB_URI environment variable is missing.");
          Presenter.text("Veyn architecture requires a configured MongoDB connection for the index.");
          Presenter.text("Please configure MONGODB_URI and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();

        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const traversal = await loadDependencyGraph(storage, identity.id);

          Presenter.title("Architecture");

          if (!targetModule) {
            const result = traversal.analyzeRepository(absoluteRepoPath);

            Presenter.section("Dependency map");
            if (result.packages.length === 0) {
              console.log(`  ${colors.dim}No packages found.${colors.reset}`);
              console.log("");
            } else {
              result.packages.forEach(pkg => {
                console.log(`  ${colors.cyan}${pkg}${colors.reset}`);
                const deps = result.dependsOn[pkg] || [];
                if (deps.length === 0) {
                  console.log(`    ${colors.dim}No internal package dependencies${colors.reset}`);
                } else {
                  deps.forEach((dep, idx) => {
                    const prefix = idx === deps.length - 1 ? "└─ uses →" : "├─ uses →";
                    console.log(`    ${colors.dim}${prefix}${colors.reset} ${colors.cyan}${dep}${colors.reset}`);
                  });
                }
                console.log("");
              });
            }
            Presenter.section("Summary");
            const pkgText = result.totals.packages === 1 ? "package" : "packages";
            const relText = result.totals.relationships === 1 ? "internal dependency relationship" : "internal dependency relationships";
            console.log(`  ${result.totals.packages} ${pkgText}`);
            console.log(`  ${result.totals.relationships} ${relText}`);
            console.log("");
            console.log("");
            return;
          }

          const targets = traversal.resolveTarget(targetModule);
          if (targets.length === 0) {
            Presenter.error(`Could not resolve target module '${targetModule}' in the repository.`);
            process.exit(1);
          }

          if (targets.length > 1) {
            Presenter.error(`Ambiguous target module '${targetModule}'. Multiple occurrences found:`);
            targets.forEach(t => Presenter.item("-", t.id));
            Presenter.text("Please specify the exact ID using the format 'filepath'.");
            process.exit(1);
          }

          const targetId = targets[0].id;
          // Target mode only fetches direct dependencies and direct dependents
          const maxDepth = 1;

          const result = traversal.analyze(targetId, { maxDepth });

          const extractUnique = (paths: ArchitecturePathNode[][]) => {
            const set = new Set<string>();
            for (const path of paths) {
              for (const node of path) {
                if (node.node.id !== targetId) {
                  set.add(node.node.id);
                }
              }
            }
            return Array.from(set).sort();
          };

          const uniqueDeps = extractUnique(result.dependencies);
          const uniqueDependents = extractUnique(result.dependents);

          Presenter.section("Dependency map");
          console.log(`  ${colors.cyan}${targetId}${colors.reset}`);

          if (uniqueDeps.length === 0 && uniqueDependents.length === 0) {
            console.log(`    ${colors.dim}No direct dependencies found${colors.reset}`);
            console.log(`    ${colors.dim}No direct dependents found${colors.reset}`);
          } else {
            const relationships = [
              ...uniqueDeps.map(dep => ({ prefix: "uses →", module: dep })),
              ...uniqueDependents.map(dep => ({ prefix: "used by ←", module: dep }))
            ];

            relationships.forEach((rel, idx) => {
              const treeChar = idx === relationships.length - 1 ? "└─" : "├─";
              console.log(`    ${colors.dim}${treeChar} ${rel.prefix}${colors.reset} ${colors.cyan}${rel.module}${colors.reset}`);
            });
          }

          Presenter.section("Summary");
          const depText = uniqueDeps.length === 1 ? "direct dependency" : "direct dependencies";
          const dependentText = uniqueDependents.length === 1 ? "direct dependent" : "direct dependents";
          console.log(`  ${uniqueDeps.length} ${depText}`);
          console.log(`  ${uniqueDependents.length} ${dependentText}`);
          console.log("");

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.error(`Architecture Error: ${error.message}`);
          process.exit(1);
        }

        Presenter.error(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
