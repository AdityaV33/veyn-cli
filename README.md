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
GROQ_PRIMARY_MODEL=<available-primary-model>
GROQ_FALLBACK_MODEL=<available-fallback-model>
```

### 3. Usage: The Phase 4 Local Workflow

The verified Phase 4 invocation provides a developer convenience script `pnpm veyn` that must be run from within the Veyn repository. This strictly ensures environment variables are loaded securely and explicitly without global installation or publishing.

You **must** run all `pnpm veyn` commands from the Veyn repository root:

```bash
cd Veyncli
```

#### Boundary 1: Indexing an External Project
The `index` command accepts a target repository path. You can pass a valid absolute path to an external project; the CLI will accept the path and reach the MongoDB initialization stage from the Veyn root:

```bash
pnpm veyn index /absolute/path/to/my-project
```

#### Boundary 2: Analyzing Veyn Itself
Analysis commands (like `stats`, `health`, `search`, `investigate`) always operate on the **current working directory**. Because `pnpm veyn` forces you to be in the Veyn repository root, these commands will only analyze the Veyn repository itself:

```bash
pnpm veyn stats
pnpm veyn health
pnpm veyn architecture
pnpm veyn search "authentication"
pnpm veyn explain MyFunction
pnpm veyn investigate "How does authentication work?"
```

#### Boundary 3: Analyzing an External Project
You cannot use `cd /path/to/project && pnpm veyn stats` because the script is not installed in that project. A seamless global `veyn stats` command that allows analyzing arbitrary external repositories is explicitly deferred to Phase 5 packaging work.

If you absolutely must analyze an external project during Phase 4, you must use the underlying absolute Node invocation from within the external project directory:
```bash
cd /absolute/path/to/my-project
node --env-file=/absolute/path/to/Veyncli/.env /absolute/path/to/Veyncli/packages/cli/bin/veyn.js stats
```

**Note:** `search`, `explain`, and `investigate` explicitly require a properly configured MongoDB (with an Atlas vector index) and Groq credentials. Without these services fully configured in your `.env`, these commands will fail.

### 4. Graph Export

Veyn can export the dependency graph in raw JSON or DOT format:

```bash
pnpm veyn graph export --format=json
pnpm veyn graph export --format=dot
```

### 5. Incremental Updates

After making changes to the project, you can update Veyn's index without doing a full reindex:

```bash
pnpm veyn reindex
```


---

For a comprehensive breakdown of what every command does under the hood, see [Veyn CLI — Command Reference](Veyn_CLI_Commands.md).
