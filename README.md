# SquidBot

SquidBot is a local-first desktop shell and minimal agent runtime. This phase proves the trusted foundation: local SQLite persistence, safe tool execution, provider-routed model calls, trace inspection, structured reflection, affordance gap detection, sandboxed staging, semantic memory graph retrieval, fixture-first connectors, and a React/Electron UI.

## Requirements

- Node.js 20.19 or newer
- npm or pnpm
- No API key, paid account, hosted database, or cloud service is required

## Install

```bash
npm install
```

or:

```bash
pnpm install
```

## Run The Desktop App

```bash
npm run dev
```

The app opens an Electron window. Choose a workspace folder in Settings, then use Chat to ask the active model provider to list files. The default provider is local-first and falls back to the deterministic mock provider when no local runtime is available.

## CLI Fallback

Initialize the local database and config:

```bash
npm run init
```

Start an interactive local chat:

```bash
npm run chat -- --workspace ./examples/buggy-python
```

Run one message without entering the prompt loop:

```bash
npm run chat -- --workspace ./examples/buggy-python "list files"
```

Print the latest trace:

```bash
npm run traces
```

Run a repo-aware task against the fixture workspace:

```bash
npm run run -- --workspace ./examples/buggy-python "Fix the failing test" --test-command "pytest"
```

The task runner inspects the workspace, routes planning through the configured model provider, reads/searches files, creates a draft patch, applies it in a sandboxed staging copy, and runs verification there. It does not modify the original workspace until a staged sandbox is explicitly approved.

List recent reflections:

```bash
npm run reflections
```

Show one reflection:

```bash
npm run reflections -- show <reflection-id>
```

List gaps linked to one reflection:

```bash
npm run reflections -- gaps <reflection-id>
```

List unresolved affordance gaps:

```bash
npm run gaps -- list
```

Inspect or resolve one gap:

```bash
npm run gaps -- show <gap-id>
npm run gaps -- resolve <gap-id>
```

Approve a memory candidate from a reflection. Candidate indexes are zero-based and shown in reflection details:

```bash
npm run memory -- approve <reflection-id> <candidate-index>
```

List approved memories:

```bash
npm run memory -- list
```

Approved memories are loaded into later repo-aware runs as a deterministic "Memory Bulletin" and recorded with a `memory.retrieved` trace event.

## Sandboxed Staging

Patch tasks now create a local staging sandbox by default. The sandbox is a copied workspace with `.git`, `node_modules`, build outputs, and coverage directories excluded. Network access defaults to `deny`, common network commands are blocked under that policy, and direct absolute path arguments outside the sandbox are rejected.

List, inspect, approve, or reject staged work:

```bash
npm run sandbox -- list
npm run sandbox -- status <sandbox-id>
npm run sandbox -- approve <sandbox-id>
npm run sandbox -- reject <sandbox-id>
```

You can also create and operate a sandbox manually:

```bash
npm run sandbox -- create ./examples/buggy-python
npm run sandbox -- apply-patch <sandbox-id> ./fix.diff
npm run sandbox -- run <sandbox-id> pytest
npm run sandbox -- diff <sandbox-id>
```

Sandbox creation, commands, diffs, approval requests, promotion, destruction, and resource limit events are recorded in SQLite. Runtime-created sandbox diffs are also indexed into the memory graph as fact nodes linked to the source run. The desktop Sandboxes page shows active and closed staging worlds, diffs, test results, and approve/reject controls.

Sandbox defaults can be changed locally:

```bash
npm run settings -- set sandbox.limits.cpu 1
npm run settings -- set sandbox.limits.memory 512
npm run settings -- set sandbox.limits.disk 512
npm run settings -- set sandbox.network.policy deny
```

## Structured Memory Graph

SquidBot stores new reflection memories in a local SQLite graph. Nodes represent typed memory such as `fact`, `task`, `decision`, `preference`, `risk`, and `reflection`. Edges represent relationships such as `depends_on`, `confirms`, `updates`, `caused_by`, and `part_of`. The graph is local-only and uses SQLite FTS5 plus deterministic local pseudo-embeddings, so memory retrieval does not call external embedding APIs or hosted vector databases.

List graph nodes:

```bash
npm run memory -- graph list
```

Create and link nodes:

```bash
npm run memory -- graph create fact --title "Calculator bug" --body "The add function subtracts instead of adding."
npm run memory -- graph create decision --title "Fix add" --body "Change add to return a plus b."
npm run memory -- graph link <decision-node-id> <fact-node-id> depends_on
```

Search memory with text, vector, or hybrid retrieval:

```bash
npm run memory -- graph search --fts "calculator" --top 5
npm run memory -- graph search --vector "addition defect" --top 5
npm run memory -- graph search --hybrid "calculator add bug" --top 5
```

Inspect, merge, archive, or soft-delete nodes:

```bash
npm run memory -- graph show <node-id>
npm run memory -- graph merge <target-node-id> <source-node-id>
npm run memory -- graph archive <node-id>
npm run memory -- graph delete <node-id>
```

Graph commands print JSON so they are easy to script. Deleted and archived nodes stay in SQLite for audit history but are excluded from active retrieval.

The desktop Memory page is the Memory Inspector. It supports graph search, node detail browsing, confidence and importance edits, sensitivity edits, merge, archive, delete, and an adjacency-list graph view. Reflection candidates can still be approved from the same page, and approval also records `memory.graph` events in traces.

## Affordance Gaps

Reflection now classifies missing capabilities into deterministic local failure categories such as `missingTool`, `missingPermission`, `missingConnector`, `environmentError`, and `missingContext`. Gaps are stored in SQLite, linked back to the source run and reflection, and emitted as `affordance.gap` trace events. The memory graph also records gap-linked risk nodes with `affordanceId` metadata, but active memory retrieval excludes those gap nodes from normal memory bulletins.

The desktop Gaps page lists open, resolved, and won't-fix gaps. It shows gap context JSON, run and reflection references, and lets you resolve or mark a gap as won't-fix. Trace details show the number of gap events in a run.

## Connectors

Install the fixture demo connector:

```bash
npm run connectors -- install ./connectors/demo/salesConnector.json
```

List installed connectors:

```bash
npm run connectors -- list
```

Call the demo connector through the mock chat path:

```bash
npm run connectors -- call demoSales readSales
```

Generate a connector from an OpenAPI or Swagger file:

```bash
npm run connectors -- import-openapi ./specs/petstore.yaml --name petstore
```

Then call it from a repo-aware run:

```bash
npm run run -- --workspace ./examples/buggy-python "Call the petstore connector to list pets"
```

Connector calls are policy checked and traced. Fixture connectors emit `connector.call` and `connector.fixture` events. Approval-gated or write operations emit `connector.denied` until an approval flow is added.

Store optional BYOK connector settings locally:

```bash
npm run settings -- set petstore.baseUrl http://localhost:3000
npm run settings -- set petstore.apiKey your-key-here
```

Credential values live in the local SQLite settings table and are redacted by `npm run settings`. SquidBot ships with no paid API credentials and fixture mode remains the default for generated connectors.

## Model Providers And BYOK

SquidBot routes model calls through a provider-agnostic model router. The zero-spend default is `local`, which checks for a local runtime and falls back to `mock` if one is not available. The hosted API provider is BYOK-only and stays disabled until you explicitly configure a key.

View model settings:

```bash
npm run settings
```

Select a provider:

```bash
npm run settings -- set model.provider local
npm run settings -- set model.provider mock
npm run settings -- set model.provider api
```

Configure BYOK API settings:

```bash
npm run settings -- set model.apiKey your-key-here
npm run settings -- set model.apiUrl https://api.example.com/v1/chat/completions
npm run settings -- set model.apiModel your-model-name
npm run settings -- set model.budget.api 1000
```

Clear a BYOK key or budget:

```bash
npm run settings -- unset model.apiKey
npm run settings -- unset model.budget.api
```

Check the daily BYOK token budget:

```bash
npm run model -- budget
```

Model calls emit `model.call` and `model.result` trace events with provider, model name, mode, token counts, cost estimate, tool count, context size, and cost owner. Budget pressure emits `model.budgetWarning`; exhausted budgets emit `model.budgetExceeded` and trigger `model.fallback` to the next available local/free provider.

The API provider uses cost owner `user-paid` and records token usage in SQLite. API keys are redacted in CLI and UI settings output. SquidBot does not ship with project-owned paid credentials, and tests never require network access or paid services.

## Custom Connector Manifests

Connector manifests describe the external system, protocol, auth type, permission risk, endpoints, data classifications, rate limits, cost owner, fixture data, and read/write operation split. Keep writes approval-gated by default and include fixture data so the connector can be tested offline.

The minimal workflow for a custom connector is:

```bash
npm run connectors -- install ./connectors/myConnector.json
npm run connectors -- list
npm run connectors -- call myConnector readSomething
```

## Tests

```bash
npm test
```

Tests use deterministic providers, fixture connectors, and temporary local SQLite databases. They do not touch the network or require paid services.

## Architecture

- `apps/desktop`: Electron main process, secure preload API, React renderer
- `apps/cli`: command-line init, chat, repo task, traces, reflection, affordance gaps, sandbox approval, and memory fallback
- `packages/core`: headless agent runtime, policy engine, safe tools, sandbox staging, connector event handling, reflection, affordance gap integration, memory approval, and trace builder
- `packages/models`: provider interfaces, local/mock/BYOK adapters, routing, fallback, token accounting, and budget enforcement
- `packages/memory`: structured memory graph store, validation, FTS5 search, deterministic local embeddings, graph traversal, and hybrid retrieval
- `packages/reflection`: deterministic failure taxonomy and affordance gap detection
- `packages/sandbox`: local sandbox manager, patch staging, command execution, diffing, promotion, and cleanup
- `packages/connectors`: manifest validation, registry, fixture responses, OpenAPI import, and connector tool registration
- `packages/db`: SQLite connection, migrations, events, traces, reflections, affordance gaps, sandboxes, legacy memories, memory graph tables, connector registry, and settings access layer
- `examples/buggy-python`: fixture workspace for demos and tests
- `connectors/demo`: local demo connector manifest
- `specs`: small OpenAPI fixture specs

The renderer never reads the filesystem or runs commands directly. It calls a typed preload API, and all filesystem/tool behavior runs in Electron main or the CLI runtime.

## Zero-Spend Posture

The default provider setting is `local`, with automatic fallback to `mock` when a local model runtime is unavailable. Connectors run in fixture mode until a user configures their own endpoints or keys. Hosted model APIs are BYOK-only, budgeted, cost-owner labeled, and disabled unless a user configures credentials. Sandboxing uses local workspace copies and local processes; no hosted sandbox service is required. No project-owned paid model APIs, hosted sandboxes, managed databases, telemetry vendors, paid APIs, or paid credentials are integrated.
