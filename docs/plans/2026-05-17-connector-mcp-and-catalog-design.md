# Connector MCP support + model catalog freshness + demo cleanup — design

**Date:** 2026-05-17
**Status:** Design approved; awaiting writing-plans handoff.
**Scope:** Three related but independent pieces of work that surface from the same operator complaint: "I want to be able to select any model… the connector page also has the demo connectors like the petstore one… make it just like openclaw and hermes agent."

**Related:**
- `docs/plans/2026-05-17-connector-real-transport-design.md` — the real-HTTP transport work that landed earlier today and which this design builds on.
- `docs/plans/2026-05-17-security-roadmap.md` — broader security agenda (S1–S4) deferred to other sessions.

---

## 1. Problem

Three concrete complaints from the operator, all pointing at the connector / integration surface:

1. **Stale model catalog.** Anthropic's dropdown shows three models (Haiku 4.5, Sonnet 5.5, Opus 4.5) when current models include Opus 4.7 and several Sonnet variants the operator can't see. DeepSeek shows three when there are visibly more. The catalog feels frozen-in-time and doesn't reflect what each provider actually ships.

2. **Demo content in a production product.** The connector list ships with `demoSales` (a CRM fixture for "reading demo sales records") and references a `petstore` fixture. Both are useful for tests and demos but confusing in the actual app — operators can't tell which connectors are real vs. throwaway.

3. **Limited connector ecosystem.** Today operators can only configure the four manifest-defined connectors (github / gitlab / jira / jenkins) or hand-write a custom JSON manifest. Reference projects (OpenClaw, 247k ⭐ — Hermes Agent from Nous Research, 106k ⭐) take a more open approach: **Hermes uses MCP (Model Context Protocol) for tool integrations**, which lets operators plug in any of hundreds of existing community MCP servers without us writing a manifest for each one.

This design ships fixes for all three.

## 2. Decisions

Captured via brainstorming on 2026-05-17:

| Decision | Choice |
|---|---|
| Connector architecture | **Hybrid — keep manifest connectors AND add MCP server support.** Manifest connectors stay for first-party integrations; MCP servers become the universal extensibility surface. |
| Model catalog refresh strategy | **Both — refresh the static catalog from current docs AND auto-refresh on form open.** The static list provides offline / first-open UX; auto-refresh keeps the dropdown current when an API key is present. |
| Demo connectors + real-mode defaults | **Delete demos; ship real-mode defaults.** `demoSales` removed, `petstore` moved to test-fixture territory, four real connectors flip to `fixtureMode: false`. |
| MCP transport scope (v1) | **stdio only.** HTTP / SSE / WebSocket MCP defer to v2 — stdio is the dominant transport and covers every server in the ecosystem. |

## 3. MCP integration (Section 1 of the design)

### 3.1 What MCP is

The Model Context Protocol is Anthropic's open standard for AI agents talking to external tools. An MCP server is a small program — usually launched as `npx @modelcontextprotocol/server-X` — that publishes a list of tools the AI can call, plus a JSON-RPC contract for invoking them over stdio. The official `@modelcontextprotocol/sdk` npm package provides the client side. Hundreds of MCP servers already exist (filesystem, postgres, github, slack, puppeteer, google-drive, etc.) — speaking MCP grants SquidBot that entire catalog without us writing manifests.

### 3.2 Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       AgentRuntime                          │
│                                                              │
│  ┌────────────────┐                                          │
│  │ ToolRegistry   │  ← github.*, jenkins.*  (manifest-based) │
│  │                │  ← workspace.*, terminal.*               │
│  │                │  ← mcp.<server>.<tool>  (NEW)            │
│  └────────────────┘                                          │
└─────────────────────────────────────────────────────────────┘
                  ▲
                  │  registers tools from
                  │
┌─────────────────────────────────────────────────────────────┐
│                    McpClientManager (NEW)                   │
│                                                              │
│  • Reads mcp_servers table on startup                       │
│  • Spawns child processes (stdio MCP)                       │
│  • Maintains persistent JSON-RPC connections                │
│  • Discovers tools via tools/list RPC                       │
│  • Registers them as `mcp.<serverName>.<toolName>`          │
│  • Routes tool.handler(args) → MCP server                   │
│  • Re-emits HTTP-call-style telemetry events                │
│  • Restarts crashed servers (with backoff)                  │
└─────────────────────────────────────────────────────────────┘
                  ▲
                  │
┌─────────────────────────────────────────────────────────────┐
│             Integrations → Connectors → MCP servers (NEW)   │
│                                                              │
│  ┌────────────────────────────────────────────────┐         │
│  │ Server                          Tools   Status │         │
│  ├────────────────────────────────────────────────┤         │
│  │ ✓ filesystem-home               8       healthy│         │
│  │ ✓ postgres-prod                 6       healthy│         │
│  │ ⚠ slack                         12      auth   │         │
│  │ ✗ puppeteer                     —       crashed│         │
│  │                                                │         │
│  │ [+ Add MCP server]                             │         │
│  └────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Components

| Layer | Component | Purpose |
|---|---|---|
| **DB** | New `mcp_servers` table | Persists configured servers — `id`, `name`, `transport` (`'stdio'` only for v1), `command`, `argsJson`, `envJson`, `riskLevel`, `enabled`, `lastConnectedAt`, `lastError`, `createdAt`, `updatedAt`. |
| **Domain** | `packages/connectors/src/mcpClient.ts` | One client instance per configured server. Spawns child process, maintains stdio JSON-RPC via `@modelcontextprotocol/sdk`, discovers tools, routes calls. |
| **Domain** | `packages/connectors/src/mcpManager.ts` | Pool / lifecycle. On runtime construction, spawn all enabled servers. On shutdown, terminate cleanly. Restarts crashed servers with exponential backoff (1s → 2s → 5s → 30s cap). |
| **IPC** | `listMcpServers`, `addMcpServer`, `updateMcpServer`, `removeMcpServer`, `enableMcpServer`, `testMcpServer` | Renderer ↔ main process plumbing. |
| **UI** | New "MCP servers" sub-section inside Integrations → Connectors tab | List configured servers + add / edit / remove form. |
| **Runtime hook** | `AgentRuntime` constructor wires `McpManager.registerInto(toolRegistry)` | Tools land in the same `ToolRegistry` everything else uses, with `mcp.<server>.<tool>` naming. |

### 3.4 MCP-server configuration shape

For v1 (stdio only), the form takes:

```
Name:        "filesystem-home"        (user-chosen — becomes the tool prefix)
Command:     "npx"
Arguments:   ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"]
Env vars:    [{ key: "READ_ONLY", value: "true" }]
Risk level:  ◯ low  ● medium  ◯ high   (drives the sensitivity policy)
[Enabled ✓]                                        [Test connection]
```

When saved, `McpClientManager` spawns the process, calls `tools/list`, registers each tool as `mcp.filesystem-home.read_file`, `mcp.filesystem-home.write_file`, etc. The user-chosen risk level applies uniformly to every tool the server exposes — coarser-grained than manifest connectors (which have per-permission risk), but the MCP protocol doesn't currently carry per-tool risk metadata.

### 3.5 Security boundary

MCP servers run as child processes with the same OS user privileges as SquidBot. A malicious server can read any file the user can read, hit the network, etc. v1 mitigations:

- **Warning banner** above the "Add MCP server" form: *"MCP servers are programs that run on your machine with your user's permissions. Only add servers you trust."*
- **Mandatory risk-level field** at add-time — drives the sensitivity policy. `medium` → write tools queue on Sensitive profile; `high` → all tools queue regardless of profile.
- **Future "verified by SquidBot" filter** (v2) — eventually we curate a list of trusted official MCP servers and surface them as one-click installs. Out of scope here.

### 3.6 Tools registered from MCP get everything else for free

Because they live in the same `ToolRegistry`:
- **Sensitivity policy** applies (from the connector-real-transport work) — write tools queue on Sensitive profile.
- **Approval queue** routes through `pending_approvals` using `kind: "connector-call"` — no new approval kind needed.
- **Trace events** emit as `connector.http_call` analogs (with `mode: "mcp"` to distinguish).
- **Navigation smoke test** still passes — no new page, just a sub-section on an existing one.

### 3.7 New dependency

`@modelcontextprotocol/sdk` — official client SDK. ~200KB, no heavy transitive deps. Added to `packages/connectors/package.json`.

## 4. Model catalog freshness (Section 2 of the design)

### 4.1 Part A — refresh the static catalog

For each provider in `packages/core/src/providerCatalog.ts`, fetch the official docs and update the model list + pricing:

| Provider | Doc URL | What we extract |
|---|---|---|
| Anthropic | `docs.anthropic.com/en/docs/about-claude/models` | Opus 4.7 / 4.6 / 4.5, Sonnet 4.6 / 4.5, Haiku 4.5, list pricing |
| OpenAI | `platform.openai.com/docs/models` | GPT-5 family (Pro / mini / nano), o3 family, plus pricing |
| DeepSeek | `api-docs.deepseek.com/quick_start/pricing` | V3 / V3.1 / R1 / R1-Lite / Coder, plus pricing |
| Google | `ai.google.dev/gemini-api/docs/models/gemini` | Gemini 2.5 Pro / Flash / Flash-Lite, 2.0 Flash, plus pricing |
| xAI | `docs.x.ai/docs/models` | Grok 4 / 4-fast / 3 / 3-mini, plus pricing |
| Groq | `console.groq.com/docs/models` | Current Llama / Mixtral / Qwen list |
| OpenRouter | `openrouter.ai/api/v1/models` (live, no auth) | All currently routed models |

The shipped catalog grows from ~3-6 entries per major provider to whatever's actually current (typically 8-15). The exact list is determined at implementation time by fetching each docs page; the design commits to the *shape*, not specific model ids that will rotate.

### 4.2 Part B — auto-refresh from live `/v1/models` on form open

Inside `ModelAccountsSection.tsx`, fire `squidbotApi.discoverModels(...)` automatically when **either** condition holds:
1. The user changed the Provider dropdown selection (immediate, no debounce).
2. The user finished editing the API key field (300ms debounce on the key field to coalesce keystrokes).

```
User opens "Add account" form
         │
         ▼
[ Provider dropdown    : "anthropic"     ]
[ API URL              : ...auto-filled  ]
[ API key              : (empty)         ]
[ Model                : Claude Opus 4.7 ] ← from static catalog
                                              (6-15 models, current)

         │ user pastes API key
         ▼
[ API key              : sk-ant-...      ]
[ Model         🔄 fetching… ]              ← spinner appears
                                              auto-fires discoverModels(...)
         │
         ▼  (200ms later)
[ Model                : 47 models from API ] ← live list, dropdown swaps
```

If the live fetch errors (401 / network / etc.), keep the static catalog visible and surface the error in a small toast — the user can still pick a static model and save the account.

The existing manual **"Refresh from API"** button stays in place — useful for "I just added new models to my OpenRouter account, refresh."

### 4.3 The merge

The existing `mergeWithLiveModels(providerKind, liveModelIds)` helper already does the right thing:
- **Live entries** keep their order (the provider's preferred ordering).
- **Pricing / labels** come from the static catalog for known model ids.
- **Unknown live ids** get a basic entry with just the id as the label.
- **Static-catalog-only entries** (model in our list but not in the live API response) appear at the end as fallback choices.

No changes to that function.

### 4.4 Pricing stays static

Most `/v1/models` endpoints don't return pricing — only OpenRouter does, consistently. So:
- The static catalog **owns pricing**, sourced from each provider's pricing page.
- Live refresh **adds model ids** the static catalog doesn't know about — those show without prices (`"$? / $?"` becomes "no price" — just model id + label).
- When a user picks an unknown-pricing model, the saved account uses a heuristic cost-per-token until the next static-catalog refresh adds the model.

### 4.5 Files

| File | Change |
|---|---|
| `packages/core/src/providerCatalog.ts` | Replace each per-provider array with current 2026-05 model lists. ~12-20 entries per major provider. |
| `apps/desktop/src/renderer/src/components/ModelAccountsSection.tsx` | Add `useEffect` that fires `squidbotApi.discoverModels(...)` when provider OR apiKey changes (300ms debounce on apiKey). Wire `loading` state for the spinner. |
| `packages/core/test/providerCatalog.test.ts` (new) | Pin structural invariants — each provider has ≥3 models, ≥1 flagship-tier, pricing for every entry. Doesn't pin model ids (those rotate). |
| `apps/desktop/src/renderer/src/components/ModelAccountsSection.test.tsx` | Add a test that types a key and asserts `discoverModels` was called within 500ms. |

## 5. Demo cleanup + real-mode defaults (Section 3 of the design)

### 5.1 File changes

| Action | File | Reason |
|---|---|---|
| **Delete** | `connectors/demo/salesConnector.json` | The "demoSales" CRM connector — pure fixture, no real API. Confusing in a real product. |
| **Move** | `connectors/generated/petstore.json` → `packages/connectors/test/fixtures/petstore.json` | Petstore stays useful as an OpenAPI-import test fixture; doesn't ship as a visible connector. |
| **Move** | `packages/connectors/src/generated/petstore/*` → `packages/connectors/test/fixtures/petstore-generated/*` | Same reasoning — accessible to tests, not shipped. |
| **Modify** | `connectors/demo/githubConnector.json` | Flip `fixtureMode: true` → `false`. Drop "Fixture mode is enabled by default." from `description`. |
| **Modify** | `connectors/demo/gitlabConnector.json` | Same as github. |
| **Modify** | `connectors/demo/jiraConnector.json` | Same. |
| **Modify** | `connectors/demo/jenkinsConnector.json` | Same. |
| **Modify** | `packages/connectors/src/devIntegration.ts` | Update `installDeveloperWorkflowConnectors` to refresh the cached manifest from disk on every install (drop the `if (!registry.getConnector(...))` early-return). Without this, existing installs keep their old `fixtureMode: true` cached manifest and the JSON flip is invisible. |
| **Modify** | `packages/connectors/test/connectors.test.ts` | If any tests rely on petstore's old path, update imports. If any tests depended on github starting in fixture mode, set `fixtureMode: true` explicitly in the test setup. |

### 5.2 The cache-refresh detail

Today's code in `devIntegration.ts`:

```typescript
if (!registry.getConnector(manifest.name)) {
  installed.push(registry.registerConnector(manifest));
}
```

The early-return means an existing install with the old `fixtureMode: true` row in the `connectors` table **never gets updated** when we change the JSON file. Replacement (one-line edit):

```typescript
// Shipped (developer-workflow) connectors are versioned through the JSON
// files in connectors/demo/. The DB cache exists for user-added custom
// connectors. For SHIPPED ones, the JSON file is the source of truth —
// refresh on every install so a fixtureMode flip / endpoint update lands
// for existing users automatically.
installed.push(registry.registerConnector(manifest));   // upsert
```

`registry.registerConnector` already has upsert semantics (saves the row, overwriting if it exists). Migration impact: zero. Next app boot refreshes the manifest, the UI re-reads the cached row from the DB, the status indicator updates from "Mock data — toggle off for real" (yellow dot) to "Add a key to use this" (grey dot).

### 5.3 What the user sees after this

**Before:**
```
github       [REST] [FIXTURE] [FREE]
  Mock data — toggle off for real  (yellow dot)

demoSales    [FILE] [FIXTURE] [FREE]
  Local fixture for reading demo sales records.
```

**After:**
```
github       [REST] [FREE]
  Add a key to use this  (grey dot)
```
(demoSales row gone entirely; petstore stays only as a test fixture)

## 6. Out of scope

- **MCP HTTP / SSE / WebSocket transport** — stdio only for v1. The MCP spec supports these but stdio dominates the ecosystem; HTTP MCP defers to v2.
- **"Verified by SquidBot" MCP server curation** — a future feature where we maintain a list of trusted servers operators can install with one click. Not in v1.
- **Per-tool MCP risk levels** — the protocol doesn't carry per-tool risk metadata. We treat all tools from a server as the server's risk level.
- **MCP server sandboxing** — child processes inherit the OS user's permissions. Sandboxing (containerization, syscall filtering) is a future hardening item, not v1.
- **Messaging adapter expansion** (Slack, Discord, Telegram as in OpenClaw / Hermes) — separate workstream. The Messaging tab on Integrations already exists; expanding what's connectable there is its own design.
- **S1–S4 security roadmap items** (PIN, account ownership, team sharing, DB encryption). See `2026-05-17-security-roadmap.md`.

## 7. Acceptance criteria

The work is complete when:

**MCP integration:**
- [ ] Operator can add an MCP server via Integrations → Connectors → MCP servers → + Add MCP server.
- [ ] Saved servers persist across app restarts.
- [ ] On app start, all enabled MCP servers spawn as child processes.
- [ ] Tools from each MCP server register in the `ToolRegistry` as `mcp.<serverName>.<toolName>`.
- [ ] Calling an `mcp.*` tool from the agent routes through the MCP client and returns the result.
- [ ] Crashed MCP servers auto-restart with exponential backoff.
- [ ] Test button reports server health (handshake + `tools/list` succeeds → green; otherwise red with error code).
- [ ] Removing a server terminates its process and unregisters its tools.

**Model catalog freshness:**
- [ ] Anthropic dropdown shows Opus 4.7 and Sonnet 4.6 in the static catalog.
- [ ] DeepSeek dropdown shows 5+ models (V3 / V3.1 / R1 / R1-Lite / Coder family) in the static catalog.
- [ ] Opening the "Add account" form with an API key in the field auto-fires `discoverModels` within 500ms; the dropdown swaps to the live list when it returns.
- [ ] Changing the Provider dropdown immediately fires `discoverModels` if a key is present.
- [ ] Manual "Refresh from API" button still works.
- [ ] Live API errors keep the static catalog visible and surface a toast.

**Demo cleanup:**
- [ ] `demoSales` no longer appears in the visible Connectors list.
- [ ] `petstore` artifacts moved to `packages/connectors/test/fixtures/` and not visible in the Connectors list.
- [ ] github / gitlab / jira / jenkins all show "Add a key to use this" (grey dot) when no key is configured — no "Mock data — toggle off for real" anywhere.
- [ ] Existing app installs see the flip after restart, without any data loss or migration prompt.
- [ ] Existing fixture-mode tests still pass (they explicitly set `fixtureMode: true` in test setup).

## 8. Next step

Hand off to `superpowers:writing-plans` to produce a detailed task-by-task implementation plan from this design.
