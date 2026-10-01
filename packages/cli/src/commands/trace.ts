import { Command } from "commander";
import {
  RepositoryIdentityResolver,
  MongoIndexStorage,
  CallGraph,
  CallGraphTraversal,
  PersistenceError,
  TracePathNode,
  CallGraphNode
} from "@veyn/core";
import { Presenter, colors } from "../ui/presenter.js";

interface TreeNode {
  node: CallGraphNode;
  edgeLine?: number;
  children: TreeNode[];
  isDownstream?: boolean;
}

function buildDeduplicatedTree(paths: TracePathNode[][], isDownstream: boolean): TreeNode[] {
  const rootNodes: TreeNode[] = [];

  const filteredPaths = [];
  for (const path of paths) {
    const newPath = [];
    for (const step of path) {
      if (step.node.filePath.includes("node_modules") || step.node.filePath.includes(".pnpm")) {
        break;
      }
      newPath.push(step);
    }
    if (newPath.length > 1) {
      filteredPaths.push(newPath);
    }
  }

  for (const path of filteredPaths) {
    let currentLevel = rootNodes;
    for (let i = 1; i < path.length; i++) {
      const step = path[i];
      let existingNode = currentLevel.find(
        n => n.node.id === step.node.id && n.edgeLine === step.edge?.line
      );
      if (!existingNode) {
        existingNode = {
          node: step.node,
          edgeLine: step.edge?.line,
          children: [],
          isDownstream: i === 1 ? isDownstream : undefined
        };
        currentLevel.push(existingNode);
      }
      currentLevel = existingNode.children;
    }
  }

  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.node.id !== b.node.id) return a.node.id.localeCompare(b.node.id);
      return (a.edgeLine || 0) - (b.edgeLine || 0);
    });
    nodes.forEach(n => sortTree(n.children));
  };
  sortTree(rootNodes);

  return rootNodes;
}

function printTree(
  nodes: TreeNode[],
  inheritedDownstream: boolean,
  ancestors: Set<string> = new Set(),
  depth: number = 0
) {
  nodes.forEach((node) => {
    const isDown = node.isDownstream !== undefined ? node.isDownstream : inheritedDownstream;
    const arrow = isDown ? "calls →" : "called by ←";

    const indentBase = " ".repeat(4 + depth * 4);
    const prefix = `${indentBase}${arrow}`;

    const isCycle = ancestors.has(node.node.id);

    let funcName = node.node.symbolName ? `${node.node.symbolName}()` : node.node.id;
    if (funcName === "()'") funcName = node.node.id;
    if (!funcName.endsWith("()")) funcName += "()";

    if (isCycle) {
      console.log(`${prefix} ${colors.cyan}${funcName}${colors.reset} ${colors.yellow}↺ Cycle detected${colors.reset}`);
      return;
    }

    console.log(`${prefix} ${colors.cyan}${funcName}${colors.reset}`);

    if (node.node.filePath || node.edgeLine) {
      const parts = node.node.id.split(":");
      const fp = parts[0] || node.node.filePath;
      const lineText = node.edgeLine ? `:${node.edgeLine}` : "";

      const padLength = arrow.length + 1;
      const spacePad = " ".repeat(padLength);

      console.log(`${indentBase}${spacePad}${colors.dim}${fp}${lineText}${colors.reset}`);
    }

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(node.node.id);

    printTree(node.children, isDown, nextAncestors, depth + 1);
  });
}

export function registerTraceCommand(program: Command) {
  program
    .command("trace <function>")
    .description("Show callers and calls")
    .option("--depth <number>", "Number of call levels to follow\nDefault: 1")
    .addHelpText("after", `
Examples:
  veyn trace refreshToken
  veyn trace refreshToken --depth 3
  veyn trace src/auth/refresh.ts:refreshToken
`)
    .action(async (func: string, options: { depth: string }) => {
      try {
        if (!process.env.MONGODB_URI) {
          Presenter.error("Configuration Error: MONGODB_URI environment variable is missing.");
          Presenter.text("Veyn trace requires a configured MongoDB connection for the index.");
          Presenter.text("Please configure MONGODB_URI and try again.");
          process.exit(1);
        }

        const absoluteRepoPath = process.cwd();
        const resolver = new RepositoryIdentityResolver();
        const identity = resolver.resolve(absoluteRepoPath);

        const storage = new MongoIndexStorage({ uri: process.env.MONGODB_URI });
        await storage.connect();

        try {
          const nodes = await storage.getCallNodes(identity.id);
          const edges = await storage.getCallEdges(identity.id);

          const graph = new CallGraph();
          graph.load({ nodes, edges });

          const traversal = new CallGraphTraversal(graph);

          let symbols = await storage.getSymbols(identity.id);
          symbols = symbols.map(s => ({
            ...s,
            filePath: s.filePath.startsWith(absoluteRepoPath)
              ? s.filePath.slice(absoluteRepoPath.length + 1)
              : s.filePath
          }));

          const targets = traversal.resolveTarget(func, symbols);

          if (targets.length === 0) {
            Presenter.title("Trace");
            Presenter.section("Target not found");
            console.log(`  Could not find function \`${func}\`.\n`);
            console.log("Check the symbol name or provide a file:path:symbol identifier.\n");
            process.exit(1);
          }

          if (targets.length > 1) {
            Presenter.title("Trace");
            Presenter.section("Ambiguous function");
            console.log(`  Multiple functions named \`${func}\` were found.\n`);
            console.log("Choose one:\n");
            targets.forEach(t => console.log(`  ${t.filePath}:${t.name}`));
            console.log(`\nThen run:\n`);
            console.log(`  veyn trace ${targets[0].filePath}:${targets[0].name}\n`);
            process.exit(1);
          }

          const targetSymbol = targets[0];
          const targetId = `${targetSymbol.filePath}:${targetSymbol.name}`;
          const maxDepth = parseInt(options.depth || "1", 10);

          Presenter.title("Trace");

          const result = traversal.trace(targetSymbol, { maxDepth });

          const downTree = buildDeduplicatedTree(result.downstream, true);
          const upTree = buildDeduplicatedTree(result.upstream, false);

          const combinedRoots = [...downTree, ...upTree];

          Presenter.section("Call map");
          console.log(`  ${colors.cyan}${targetId}${colors.reset}`);

          if (combinedRoots.length === 0) {
            console.log(`  ${colors.dim}No repository calls found${colors.reset}`);
          } else {
            const rootAncestors = new Set([targetId]);
            printTree(combinedRoots, true, rootAncestors, 0);
          }
          console.log("");

          const directDown = downTree.length;
          const directUp = upTree.length;

          let reachable = 0;
          const countReachable = (nodes: TreeNode[]) => {
            reachable += nodes.length;
            nodes.forEach(n => countReachable(n.children));
          };
          countReachable(combinedRoots);

          Presenter.section("Summary");
          const downText = directDown === 1 ? "direct call" : "direct calls";
          const upText = directUp === 1 ? "direct caller" : "direct callers";
          console.log(`  ${directDown} ${downText}`);
          console.log(`  ${directUp} ${upText}`);

          if (maxDepth > 1) {
            const reachableText = reachable === 1 ? "reachable relationship" : "reachable relationships";
            console.log(`  ${reachable} ${reachableText}`);
          }
          console.log(`  Depth shown: ${maxDepth}`);
          console.log("");

          if (maxDepth === 1 && (directDown > 0 || directUp > 0)) {
            Presenter.section("Next step");
            console.log(`  Use \`--depth 3\` to follow deeper call paths.\n`);
          }

        } finally {
          await storage.disconnect();
        }

      } catch (error: any) {
        if (error instanceof PersistenceError) {
          Presenter.error(`Trace Error: ${error.message}`);
          process.exit(1);
        }
        Presenter.error(`Unexpected Error: ${error.message}`);
        process.exit(1);
      }
    });
}
