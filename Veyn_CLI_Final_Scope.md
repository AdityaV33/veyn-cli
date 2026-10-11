Locked. **No more scope changes.** This is the final Veyn CLI v1 to be built over the next 45 days.

# Veyn CLI — Final Locked Scope

**Positioning:**

An AI-powered repository investigation engine that combines deterministic static code analysis, hybrid retrieval, and agentic reasoning to help developers understand and investigate large TypeScript codebases through evidence-backed answers.

**Core principle:**

**Algorithms discover facts. Agents reason about facts. LLMs never invent facts.**

---

# 1. Final Tech Stack

### Core / Backend

| Layer | Final choice |
|---|---|
| Language | **TypeScript** |
| Runtime | **Node.js** |
| Package manager | **pnpm** |
| CLI | **Commander.js** |
| AST / static analysis | **ts-morph** |
| Dependency/call graph | **Custom in-memory graph** |
| Database | **MongoDB Atlas** |
| Vector search | **MongoDB Atlas Vector Search** |
| Backend/API | **Removed for initial release** |
| Streaming | **Terminal stdout stream** |
| Concurrency | **Node `worker_threads`** |
| Git | **simple-git** |
| Logging | **Pino** |
| Validation | **Zod** |
| Testing | **Vitest** |
| CI | **GitHub Actions** |
| Load testing | **k6** |

### AI

| Component | Final choice |
|---|---|
| LLM provider | **Groq** |
| LLM | **llama-3.1-70b-versatile initially** |
| LLM SDK | **Groq TypeScript SDK** |
| Tool calling | **JSON-in-prompt with Zod validation** |
| Embeddings | **Local `BAAI/bge-small-en-v1.5`** *(changed from Groq/OpenAI)* |
| **Agent orchestration** | **LangGraph** *(changed from custom state machine)* |
| RAG | **Custom hybrid retrieval** |
| Prompt management | **Versioned TypeScript prompt modules** |

**No LangChain. No CrewAI. No Voyage. No Claude. No Neo4j. No Tree-sitter.**

> **Change from prior draft:** Agent orchestration now uses **LangGraph** instead of a hand-rolled TypeScript state machine, specifically for the Planner → Investigator → Reflection → Reporter loop (Section 5). This is a deliberate, scoped decision — not scope creep:
> - RendrAI already demonstrates the ability to build orchestration from scratch (its pipeline is mostly linear with one bounded repair loop, where a framework added little).
> - Veyn CLI's investigation loop has genuine multi-step branching (CONTINUE/STOP reflection, dynamic re-investigation) — the kind of cyclic, conditional-routing problem LangGraph is actually built for.
> - LangGraph adds **zero new external API calls or providers**. It runs locally in the Node process and only orchestrates the sequence of existing Gemini calls — it does not touch the "minimize API surface" constraint that shaped the rest of this stack.
> - This closes the gap where "LangGraph" appeared on the resume skills list without a backing project.
>
> **Change from prior draft:** Embeddings now use **local `BAAI/bge-small-en-v1.5`** via `@xenova/transformers` instead of Groq/OpenAI:
> - Provides high-quality source code retrieval entirely locally without external API dependencies.
> - Keeps the API surface minimized to exactly one provider (Groq) for LLM reasoning.
> - Fits cleanly into the `EmbeddingProvider` abstraction and MongoDB Atlas Vector Search pipeline.
> - Keeps embedding costs at exactly $0, with low local resource overhead.

---

# 2. Final Architecture

```
                        VEYN CLI
                           │
              ┌────────────┴────────────┐
              │                         │
        packages/core             packages/agent
        DETERMINISTIC               LLM-DEPENDENT
              │                         │
       ┌──────┼────────┐        ┌───────┼────────┐
       │      │        │        │       │        │
    Scanner Parser   Graph   Planner Investigator Reflection
       │      │        │        │                │
       │      │        └────────┼──── Tools ─────┘
       │      │                 │
       │      └── Search ◄──────┘
       │     MongoDB
       │   Vector Search
       │  Local Embeddings
       │                            │
       │                            ▼
       │                        Reporter
       │                            │
       │                            ▼
       └──────────────────  Evidence-backed answer
```

### Architectural rule

```
packages/core       ↑
packages/agent  agent → core
core  → NEVER agent
```

The LLM can request tools, but those tools call deterministic functionality. The agent's internal control flow (Planner → Investigator → Reflection → Reporter) is now implemented as a **LangGraph state graph**, with `packages/core` invoked exclusively through Zod-validated tool calls from graph nodes.

---

# 3. Final Command Surface — 10 Commands

## Core / deterministic

**100% offline from the LLM perspective.**

```
veyn index <path>
veyn reindex <path>
veyn search <query>
veyn trace <function>
veyn architecture
veyn health
veyn stats
veyn graph export [--format=json|dot]
```

### `index`

Full repository analysis:

```
scan
  ↓
parse
  ↓
symbols
  ↓
imports
  ↓
dependency graph
  ↓
call graph
  ↓
embeddings
  ↓
MongoDB
```

### `reindex`

Only changed/affected portions are reprocessed.

### `search`

Hybrid retrieval:

```
semantic similarity
        +
lexical/symbol matching
        +
graph expansion
        ↓
ranked evidence
```

### `trace`

Call/execution-flow analysis.

### `architecture`

Repository/module relationship analysis.

### `health`

Deterministic health analysis:

- circular dependencies
- dead/unused code signals
- large files
- coupling
- structural issues
- missing documentation signals

### `stats`

Metrics such as:

- file count
- symbol count
- graph size
- index state
- indexing time
- embedding count

### `graph export`

Export the graph to:

```
JSON
DOT
```

for visualization/demo purposes.

---

# 4. Agentic Commands

Only **two**.

```
veyn investigate "<question>" [--stream]
veyn explain <function|file>
```

No `compare`.

Comparison is simply an investigation:

```
veyn investigate "Compare AuthService and UserService"
```

No `review`. Veyn is **not** a code-review bot.

No `chat`. Interactive repository questions belong inside `investigate`.

No `fix`. Code generation/repair belongs to **RendrAI**.

---

# 5. `investigate` — The Flagship

Example:

```
veyn investigate "Why does authentication fail after token refresh?"
```

Internally, as a **LangGraph state graph**:

```
User question
      ↓
   [Planner Node]
      ↓
 Dynamic tasks
      ↓
 [Investigator Node]
      ↓
  Tool call (conditional edge → Tools)
      ↓
 Deterministic core
      ↓
    Evidence
      ↓
 [Reflection Node]
   ↙       ↘
CONTINUE   STOP
  │         │
  └─(loop back to Investigator)   ▼
                              [Reporter Node]
                                  ↓
                            Final answer
```

- **Planner node** — dynamically determines what needs to be investigated.
- **Investigator node** — chooses and invokes tools.
- **Reflection node** — evaluates evidence sufficiency; conditional edge routes back to Investigator (CONTINUE) or forward to Reporter (STOP).
- **Reporter node** — produces the grounded final answer.

State passed between nodes (LangGraph state object) includes: original question, task list, evidence collected so far, tool call history, and reflection reasoning.

---

# 6. Agent Tools

The LLM doesn't get arbitrary access to your codebase. It gets controlled tools such as:

```
search_code
trace_function
find_references
find_dependencies
get_architecture
get_health
get_symbol_context
```

Conceptually:

```
Gemini
  ↓
tool call
  ↓
Zod validation
  ↓
tool dispatcher
  ↓
Veyn Core
  ↓
result
  ↓
LangGraph state
```

Tools are invoked from the Investigator node; results are merged into LangGraph state and passed to Reflection.

---

# 7. Reflection

This is **not**:

```
for (i = 0; i < 5; i++)
```

Instead, the agent evaluates the evidence. This is implemented as a LangGraph node with a **conditional edge** determining the next node (Investigator or Reporter) based on the LLM's structured reflection output.

Example:

```
Evidence:
- auth.ts:42
- jwt.ts:57
- refresh.ts:83

Reflection:
CONTINUE
Reason: The refresh path is established, but the configuration
source for JWT_SECRET has not been verified.
```

Then it investigates further.

Eventually:

```
STOP
Reason: The failure is supported by multiple independent
pieces of repository evidence.
```

This is one of the major pieces evaluated during Phase 7/8.

---

# 8. Grounding

The reporter cannot simply make unsupported claims.

The final response should look conceptually like:

```
Root cause
----------
JWT_SECRET is unavailable during the refresh path.

Evidence
--------
1. src/auth/jwt.ts:57
2. src/auth/refresh.ts:83
3. src/config/env.ts:21

Confidence
----------
94%
```

Every important claim should be traceable back to retrieved evidence.

---

# 9. `explain`

The lightweight AI command.

```
veyn explain AuthService
```

Veyn gathers:

```
definition
dependencies
callers
callees
references
related code
```

Then Gemini turns those facts into a readable explanation. This is a single-pass call, not routed through the LangGraph investigation loop.

So:

```
investigate = autonomous multi-step investigation (LangGraph)
explain     = focused grounded explanation (single call)
```

---

# 10. Embeddings / RAG

We use:

**Local `BAAI/bge-small-en-v1.5`** (via `@xenova/transformers`) for code embeddings.

Pipeline:

```
Code
  ↓
chunk/represent
  ↓
local embedding
  ↓
vector
  ↓
MongoDB Atlas
```

Search becomes:

```
Query
  ↓
embedding
  ↓
Vector Search
  ↓
semantic candidates
  ↓
graph/lexical expansion
  ↓
hybrid ranking
  ↓
Evidence
```

We are **not using a RAG framework**. The retrieval pipeline is ours.

---

# 11. Database

MongoDB Atlas stores:

```
repositories
files
symbols
relationships
graph/index metadata
embeddings
investigation state/logs
```

No JWT/user system. Veyn is primarily a developer CLI, not a multi-user SaaS.

Therefore, **No**:

- login
- register
- JWT
- bcrypt
- refresh tokens
- RBAC

# 12. Concurrency

After the deterministic pipeline works correctly, we use:

**Node `worker_threads`** for CPU-heavy indexing work.

```
Main process
├── Worker 1 → parsing
├── Worker 2 → parsing
├── Worker 3 → parsing
└── Worker 4 → parsing
```

We benchmark before and after. Concurrency isn't allowed to compromise correctness just to produce a fancy benchmark.

---

# 14. Final Repository Structure

```
veyn-cli/
│
├── packages/
│   │
│   ├── core/
│   │   ├── scanner/
│   │   ├── parser/
│   │   ├── graph/
│   │   ├── search/
│   │   ├── health/
│   │   └── storage/
│   │
│   ├── agent/
│   │   ├── graph/          # LangGraph state graph definition, nodes, edges
│   │   ├── planner/
│   │   ├── investigator/
│   │   ├── reflection/
│   │   ├── reporter/
│   │   ├── tools/
│   │   ├── llm/
│   │   └── loop.ts         # LangGraph graph compilation/invocation entrypoint
│   │
│   ├── cli/
│   │

│
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

---

# 15. 45-Day Execution Plan

| Days | Phase |
|---|---|
| **1–4** | Setup, CLI, scanner, indexing foundation |
| **5–13** | AST, symbols, dependency graph, call graph |
| **14–18** | Embeddings, Vector Search, hybrid retrieval |
| **19–21** | Persistence + incremental reindex |
| **22–24** | *Buffer for CLI polish* |
| **25–27** | Worker-thread concurrency |
| **28–36** | LangGraph state graph: Planner → Investigator → Reflection → Reporter |
| **37–41** | Real-repo validation + metrics |
| **42–45** | Load testing, polish, README, npm, dogfooding |

**No feature additions during these 45 days.** If something isn't necessary for the locked scope, it becomes v2.

---

# 16. 9/10 Completion Criteria

Veyn isn't "finished" merely because all commands execute. The finished project needs:

### Deterministic core

- Accurate AST extraction
- Working dependency graph
- Working call graph
- Hybrid retrieval
- Incremental reindexing
- Architecture analysis
- Health analysis

### Agent

- Real dynamic planning
- Real tool calling
- Multi-step investigation (via LangGraph state graph)
- Genuine reflection (LangGraph conditional edges, not a fixed loop counter)
- Evidence-based stopping
- Grounded reporting

### Validation

Run against **2–3 real TypeScript repositories**.

Measure:

```
call-graph accuracy
index time
reindex time
search latency
investigation duration
tool calls/investigation
reflection iterations
p95 API latency
```

### Demonstration

Show:

```
Generic LLM
    ↓
unsupported/wrong answer

Veyn
    ↓
repository evidence
    ↓
correct answer + file:line citations
```

### Final packaging

- GitHub repository
- Excellent README
- npm package
- CI
- benchmark results
- demo
- RendrAI dogfooding

---

# 17. What Veyn Is — and Isn't

### Veyn IS

**An agentic repository investigation and code intelligence system.**

It combines: **static analysis + graphs + retrieval + agentic reasoning (via LangGraph) + evidence grounding.**

### Veyn IS NOT

- A code generator
- An auto-fixer
- A PR review bot
- A generic coding assistant
- A documentation generator
- A multi-agent debate system
- A chatbot with a codebase stuffed into its context

And that distinction is important because **RendrAI already occupies the generation/repair side**.

RendrAI:
```
AI → builds software (custom TypeScript state machine)
```

Veyn:
```
AI → investigates software (LangGraph state graph)
```

Together they demonstrate two different agentic control-flow patterns, deliberately implemented with two different orchestration approaches — a hand-rolled state machine where the flow was simple enough not to need a framework, and LangGraph where the flow's genuine branching/cyclic structure justified one.

---

## Final Lock

**12 commands.** **45 days.** **TypeScript + Node + Express + MongoDB Atlas.** **ts-morph + custom graphs.** **Gemini for reasoning, local BGE for embeddings.** **Custom RAG.** **LangGraph for agent orchestration (Planner → Investigator → Reflection → Reporter).** **No LangChain.** **No JWT/auth system.** **No additional AI commands.** **No scope creep.**

This is the version to be built.
