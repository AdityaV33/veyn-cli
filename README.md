# Veyn CLI

Veyn CLI is an AI-powered repository investigation engine for TypeScript codebases. It combines deterministic static analysis with agentic reasoning to answer questions about a codebase using evidence, not guesses.

## Getting Started (Phase 4 Source-based Workflow)

Veyn is currently in active development (Phase 4) and is designed to be run directly from source.

**Note:** The `veyn` command is not globally available in this phase. npm installation and global command usage are deferred to Phase 5. No TUI or `serve` command is included.

### 1. Installation

Clone the repository and build the project:

```bash
git clone https://github.com/AdityaV33/veyn-cli.git Veyncli
cd Veyncli
pnpm install
pnpm build
```

### 2. Configuration

Create your environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your MongoDB Atlas connection string and Groq API keys:

```env
MONGODB_URI=<your-mongodb-uri>
GROQ_API_KEY=<your-groq-api-key>
GROQ_PRIMARY_MODEL=<verified-model>
GROQ_FALLBACK_MODEL=<verified-model>
```

**Never include real credentials in committed files.** The `.env` file is ignored by Git.

### 3. Indexing an External Project

You must index an external repository before you can run analysis commands on it. The `index` command accepts the target repository path as an argument.

From the Veyn repository root:

```bash
pnpm veyn index /absolute/path/to/your-project
```

- `index` rebuilds the repository index.
- `reindex` updates only detected additions, modifications, and deletions.

### 4. Analyzing the External Project

Once indexed, you must run analysis commands with the external project as your **current working directory**.

Because `veyn` is not yet installed globally (Phase 5), you must use an absolute Node invocation that points back to the Veyn source directory and the `.env` file you configured.

**First, navigate to your external project:**
```bash
cd /absolute/path/to/your-project
```

**Then, run the absolute command:**
```bash
node --env-file=/absolute/path/to/Veyncli/.env \
  /absolute/path/to/Veyncli/packages/cli/bin/veyn.js <command>
```

*(Note: Running `pnpm veyn <command>` from the Veyn root will only analyze Veyn itself!)*

---

## Command Reference

### `index` / `reindex`
- **Purpose**: Scans your codebase, parses the AST, and generates vector embeddings to store in MongoDB.
- **Syntax**: `index [path]` or `reindex [path]`
- **External Project Example**:
  *(From Veyn root)* `pnpm veyn index /absolute/path/to/your-project`
- **Output**: Progress indicators for scanning, parsing, graph generation, and embedding.
- **Errors**: `Failed to connect to MongoDB` if your URI is incorrect.

### `stats`
- **Purpose**: Displays the exact number of files, symbols, relationships, and embeddings stored in the database for the current repository.
- **Syntax**: `stats`
- **External Project Example**:
  `node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js stats`
- **Output**: Structured summary of database records.

### `search`
- **Purpose**: Performs a hybrid semantic + lexical search across the codebase.
- **Syntax**: `search <query>`
- **External Project Example**:
  `node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js search "User authentication"`
- **Output**: Returns "Exact matches" (where the symbol name exactly matches the query) and "Related code" based on semantic relevance.
- **Errors**: Requires MongoDB Vector Search. Fails if embeddings cannot be generated or matched.

### `trace`
- **Purpose**: Maps the execution path and call stack of a specific function.
- **Syntax**: `trace <function>`
- **External Project Example**:
  `node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js trace login --depth 2`
- **Important Options**: `--depth <number>` controls how many layers deep the call stack expands (default: 1).
- **Output**: A tree-like graph showing what the target function calls and what calls it.
- **Errors**: "Target not found" if the function doesn't exist. "Ambiguous function" if multiple functions share the name (prompts you to use `file:symbol` syntax).

### `architecture`
- **Purpose**: Maps how different folders/packages depend on each other.
- **Syntax**: `architecture [module]`
- **External Project Example**:
  `node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js architecture`
- **Output**: A dependency map showing internal package relationships and warnings.

### `health`
- **Purpose**: Audits the codebase for architectural flaws, such as circular dependencies.
- **Syntax**: `health`
- **External Project Example**:
  `node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js health`
- **Output**: A list of detected structural issues, like `Circular dependency detected: A -> B -> A`.

### `graph export`
- **Purpose**: Exports the raw knowledge graph into visualizable formats.
- **Syntax**: `graph export`
- **External Project Example**:
  `node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js graph export > graph.json`
- **Important Options**: `--format=json` or `--format=dot`. You can redirect the output to save the file.
- **Output**: Raw JSON or DOT syntax dumped to stdout. DOT format can be rendered visually using Graphviz.

### `explain`
- **Purpose**: Uses AI to read a specific file or symbol, explain what it does, and detail how it connects to the rest of the application.
- **Syntax**: `explain <target>`
- **External Project Example**:
  `node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js explain "AuthStore"`
- **Output**: A detailed AI summary followed by lists of Upstream dependencies, Downstream calls, and References.
- **Errors**: Requires Groq configuration. Fails if target is completely missing from the graph.

### `investigate`
- **Purpose**: The flagship multi-step AI agent that formulates a plan, crawls through the repository graph via tools, and answers complex architectural questions.
- **Syntax**: `investigate <question>`
- **External Project Example**:
  `node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js investigate "How does the token refresh flow work?" --stream`
- **Important Options**: `--stream` prints the agent's progress and tool status in real-time before presenting the final answer.
- **Output**: A comprehensive Markdown-formatted report answering your question using exact evidence from the codebase.
- **Errors**: Fails if the agent hits the maximum iteration limit or if Groq limits are exceeded.

---

## Known Limitations & Phase 4 Constraints

Veyn is an active project. Please be aware of the following:

- **Source-based Workflow**: Global installation via `npm install -g veyn` is explicitly deferred to Phase 5. You must run Veyn from source using the absolute-path workaround for external projects.
- **TypeScript/TSX Only**: Veyn currently only parses and understands `.ts` and `.tsx` files. Python, Go, and other languages are not supported.
- **MongoDB Atlas Required**: You *must* have a MongoDB Atlas cluster with Vector Search configured. Local MongoDB instances do not support the vector search capabilities required for AI commands.
- **Groq Required**: The AI agent reasoning (`explain` and `investigate`) is tightly bound to Groq's high-speed inference.
- **Local Embeddings**: Embeddings are generated locally using ONNX and Xenova Transformers (bge-small-en). During embedding generation and search, you may see occasional `VIPS-WARNING` native C-library errors printed to the console on Linux systems missing `libopenslide`. These warnings are harmless but currently remain visible; they do not impact functionality.
- **No Zero-Config**: You must manually set up your `.env` file. A `veyn configure` wizard is planned for Phase 5.
- **Not for Production-Scale Indexing**: Veyn is designed for small-to-medium codebases. Massive monorepos may exceed local memory or Atlas vector limits during Phase 4.
