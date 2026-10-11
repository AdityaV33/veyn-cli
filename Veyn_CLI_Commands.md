# Veyn CLI — Command Reference

Veyn CLI is an AI-powered repository investigation engine for TypeScript codebases. It combines deterministic static analysis with agentic reasoning to answer questions about a codebase using evidence, not guesses.

**Core principle:** Algorithms discover facts. Agents reason about facts. LLMs never invent facts.

There are two categories of commands:
- **Deterministic commands** — 100% offline from the LLM's perspective. No API calls, no reasoning, just static analysis and stored data.
- **Agentic commands** — invoke the LLM (via Groq) through a LangGraph-orchestrated reasoning loop.

---

## Deterministic Commands

### `veyn index <path>`

Performs a full analysis of a repository and builds Veyn's internal knowledge of it.

**What it does:**
1. Scans the repository for TypeScript files
2. Parses each file into an AST using `ts-morph`
3. Extracts symbols (functions, classes, types, exports)
4. Resolves imports and builds a dependency graph
5. Builds a call graph (which functions call which)
6. Generates embeddings for code chunks (via BAAI/bge-small-en-v1.5 embedding model)
7. Writes everything to MongoDB Atlas

**When to use it:** Once, when you first point Veyn at a repository. Required before any other command works.

---

### `veyn reindex <path>`

Updates Veyn's knowledge of a repository after code has changed, without redoing the full `index` process.

**What it does:**
1. Uses `git diff` to find which files changed since the last index
2. Walks the dependency/call graph to find other files or symbols affected by those changes (not just the files that literally changed)
3. Re-parses and re-embeds only the changed + affected portion
4. Updates MongoDB Atlas incrementally

**When to use it:** After pulling new commits or making local changes, instead of re-running `index` from scratch.

---

### `veyn search <query>`

Finds code relevant to a plain-English or keyword query.

**What it does:**
1. Embeds the query
2. Runs semantic similarity search against stored code embeddings (MongoDB Atlas Vector Search)
3. Combines this with lexical/symbol name matching
4. Expands results using the dependency graph (e.g., pulling in closely related files)
5. Returns a ranked list of evidence (file, line, relevance)

**When to use it:** "Where is X handled?" / "Find code related to Y" — quick lookups, not full investigations.

---

### `veyn trace <function>`

Traces the call/execution flow of a specific function.

**What it does:** Walks the call graph to show what calls this function, and what this function calls — the full upstream and downstream chain.

**When to use it:** Understanding how a function fits into the broader execution flow, e.g., "what happens when `refreshToken()` is called, and who calls it?"

---

### `veyn architecture`

Produces a high-level view of how the repository's modules relate to each other.

**What it does:** Analyzes the dependency graph at the module/folder level rather than the individual function level, surfacing structural relationships (e.g., which modules depend on which).

**When to use it:** Getting oriented in an unfamiliar codebase, or checking whether the actual module structure matches the intended architecture.

---

### `veyn health`

Runs deterministic code health checks — no LLM involved.

**What it checks:**
- Circular dependencies
- Dead/unused code signals
- Unusually large files
- High coupling between modules
- Other structural issues
- Missing documentation signals

**When to use it:** A quick, objective health check of a codebase's structure before or after making changes.

---

### `veyn stats`

Reports metrics about the current index.

**What it reports:**
- File count
- Symbol count
- Graph size (nodes/edges)
- Current index state (up to date / stale)
- Time taken for the last indexing run
- Embedding count

**When to use it:** Sanity-checking that indexing worked, or getting a quick sense of a repository's scale.

---

### `veyn graph export [--format=json|dot]`

Exports the dependency/call graph to a file.

**What it does:** Serializes the internal graph to either JSON (for programmatic use) or DOT (for visualization with tools like Graphviz).

**When to use it:** Visualizing the codebase structure, or feeding the graph into another tool for further analysis.

---

## Agentic Commands

These two commands are the only ones that involve the LLM. Both use Groq for reasoning, with tool calls routed exclusively through the deterministic core above — the LLM never has raw, unrestricted access to the codebase.

### `veyn investigate "<question>" [--stream]`

The flagship command. Answers open-ended, multi-step questions about the codebase with evidence-backed reasoning.

**What it does, internally (a LangGraph state graph):**
1. **Planner** — breaks the question down into what needs to be investigated
2. **Investigator** — chooses and calls tools (`search_code`, `trace_function`, `find_references`, `find_dependencies`, `get_architecture`, `get_health`, `get_symbol_context`) to gather evidence from the deterministic core
3. **Reflection** — evaluates whether the evidence gathered so far is sufficient. If not, it loops back to the Investigator with a reason for continuing. If sufficient, it proceeds to the Reporter.
4. **Reporter** — produces the final answer, with every claim traceable back to specific evidence (file + line number) and a stated confidence level

**Example:**
```
pnpm veyn investigate "Why does authentication fail after token refresh?"
```

**When to use it:** Any question that requires connecting multiple pieces of the codebase together, not just a single lookup — root-cause analysis, "how does X actually work end-to-end," comparisons between components, etc. Comparisons and reviews are handled as investigations rather than separate commands (e.g., `pnpm veyn investigate "Compare AuthService and UserService"`).

**Note:** This can take anywhere from several seconds to tens of seconds, since it involves multiple sequential LLM calls (Planner → Investigator → Reflection, possibly looped) plus tool execution. Use `--stream` to see reasoning steps as they happen rather than waiting silently.

---

### `veyn explain <function|file>`

A lighter-weight command for a single, focused explanation — not a full investigation.

**What it does:**
1. Gathers hard facts about the target: its definition, dependencies, callers, callees, references, and related code
2. Sends those facts to Groq in a single call to produce a readable, grounded explanation

**Example:**
```
pnpm veyn explain AuthService
```

**When to use it:** "What does this do?" — a quick, one-shot explanation, as opposed to `investigate`'s open-ended multi-step reasoning.



## What Veyn Doesn't Do

By design, there is no `compare`, `review`, `chat`, or `fix` command:
- **Compare** is just an investigation with a comparison question.
- **Review** — Veyn isn't a PR review bot.
- **Chat** — interactive back-and-forth belongs inside `investigate`, not a separate conversational mode.
- **Fix** — code generation and repair is [RendrAI](https://github.com/AdityaV33/rendr-ai)'s job, not Veyn's. Veyn investigates software; RendrAI builds it.
