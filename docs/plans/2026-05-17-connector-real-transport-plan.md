# Connector Real-HTTP Transport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Wire the four shipped connectors (github, gitlab, jira, jenkins) to make real HTTP calls against their providers, gated by the active profile's sensitivity. Approval-required operations queue in the existing Approvals page; the user-clicks-Approve handler dispatches the deferred call.

**Architecture:** New `httpTransport.ts` replaces the dry-run stub in `tools.ts:101-111`. New `sensitivityPolicy.ts` chooses `execute | queue | deny` from `(profile.sensitivity, endpoint, manifest)`. New `pending_approvals` table promotes the Phase-2 façade into a real persistence layer; the existing `kind` discriminator gains `"connector-call"`. UI changes: Test button + status dot/chip on each connector card; Approvals page renders the new approval kind. Agent system prompt is taught the `{ pending: true, approvalId }` convention so it surfaces pending calls conversationally.

**Tech Stack:** TypeScript 5.8, Node 20+, Electron, vitest + @testing-library/react, better-sqlite3 (no new dependencies). Source-of-truth design: `docs/plans/2026-05-17-connector-real-transport-design.md`.

**Branch:** `claude/frosty-williamson-817c25`. Working directory: `~/Projects/SquidBot 2/.claude/worktrees/frosty-williamson-817c25`.

---

## How to use this plan

- Work **one task at a time** in order. Each task ends with a commit.
- Every task follows TDD: failing test → run to confirm failure → implement → run to confirm pass → commit.
- For pure refactors (mostly Task 1.5 — replacing the dry-run stub), the "test" is *the new policy/transport unit tests pass AND fixture-mode tests still pass*.
- All test commands assume `cd` to the worktree root.
- After each phase, run the **full repo test suite** as a checkpoint: `npm test --workspaces --if-present`.

---

# Phase 1 — Backend transport + sensitivity policy

## Task 1.1: Schema foundation — `pending_approvals` table + manifest `testEndpoint` field

**Why:** Two schema additions that unblock everything downstream. One table migration + one manifest-validator update. Zero behavior change on their own.

**Files:**
- Modify: `packages/db/src/migrations.ts` (add a new migration entry at the bottom)
- Modify: `packages/connectors/src/manifest.ts` (add optional `testEndpoint` field to schema)
- Test: `packages/db/test/migrations.test.ts` (verify new table exists after migration)
- Test: `packages/connectors/test/manifest.test.ts` (verify `testEndpoint` validates correctly)

### Step 1: Write the failing tests

In `packages/db/test/migrations.test.ts`, append:

```typescript
describe("pending_approvals migration", () => {
  it("creates the pending_approvals table with the expected columns", () => {
    const database = freshDatabase();
    const columns = database
      .prepare(`PRAGMA table_info(pending_approvals)`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const names = columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id", "kind", "title", "summary", "riskLevel", "payload",
        "callerSessionId", "callerRunId", "createdAt",
        "resolvedAt", "resolution", "resultJson"
      ])
    );
  });

  it("enforces the kind CHECK constraint", () => {
    const database = freshDatabase();
    expect(() =>
      database
        .prepare(`INSERT INTO pending_approvals (id, kind, title, summary, riskLevel, payload, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run("ap_test", "bogus-kind", "title", "summary", "low", "{}", "now")
    ).toThrow();
  });
});
```

In `packages/connectors/test/manifest.test.ts` (create if it doesn't exist):

```typescript
import { describe, expect, it } from "vitest";
import { validateConnectorManifest } from "../src/manifest.js";

describe("ConnectorManifest — testEndpoint field", () => {
  function minimalManifest(overrides: Record<string, unknown> = {}) {
    return {
      name: "test-connector",
      systemType: "test",
      description: "test",
      protocol: "rest",
      auth: { type: "bearer" },
      permissions: [],
      endpoints: [],
      dataClassifications: [],
      fixtureMode: true,
      costOwner: "free",
      readWrite: { read: [], write: [] },
      ...overrides
    };
  }

  it("accepts a valid testEndpoint", () => {
    const result = validateConnectorManifest(
      minimalManifest({ testEndpoint: { method: "GET", path: "/user" } })
    );
    expect(result.testEndpoint).toEqual({ method: "GET", path: "/user" });
  });

  it("accepts manifest without a testEndpoint (field is optional)", () => {
    const result = validateConnectorManifest(minimalManifest());
    expect(result.testEndpoint).toBeUndefined();
  });

  it("rejects a malformed testEndpoint (missing method)", () => {
    expect(() =>
      validateConnectorManifest(minimalManifest({ testEndpoint: { path: "/user" } }))
    ).toThrow(/testEndpoint/i);
  });
});
```

### Step 2: Run tests to verify they fail

```bash
npm test -w packages/db -- --run migrations
npm test -w packages/connectors -- --run manifest
```

Expected: FAIL — `pending_approvals` table doesn't exist; `testEndpoint` validation isn't there.

### Step 3: Add the migration

Append to `packages/db/src/migrations.ts` after the last existing migration entry:

```typescript
  {
    id: <next-number>,
    name: "pending_approvals",
    // Promotes the Phase-2 listPendingApprovals façade (which read from
    // sandbox rows) to a real persistence layer. Future approval kinds
    // (connector-call, etc.) land here directly; sandbox-promotion rows are
    // mirrored in by the IPC handler.
    up: `
      CREATE TABLE pending_approvals (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('sandbox-promotion', 'connector-call')),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        riskLevel TEXT NOT NULL CHECK(riskLevel IN ('low', 'medium', 'high')),
        payload TEXT NOT NULL,
        callerSessionId TEXT,
        callerRunId TEXT,
        createdAt TEXT NOT NULL,
        resolvedAt TEXT,
        resolution TEXT CHECK(resolution IN ('approved', 'rejected') OR resolution IS NULL),
        resultJson TEXT
      );

      CREATE INDEX idx_pending_approvals_unresolved
        ON pending_approvals (createdAt)
        WHERE resolvedAt IS NULL;

      CREATE INDEX idx_pending_approvals_session
        ON pending_approvals (callerSessionId);
    `
  }
```

Use the next sequential migration id (read the file to find the current max).

### Step 4: Add `testEndpoint` to the manifest schema

In `packages/connectors/src/manifest.ts`:

1. Find the `ConnectorManifest` TypeScript type (around line 40). Add:
   ```typescript
   testEndpoint?: { method: string; path: string };
   ```

2. Find the JSON-schema-style validator (around line 70-90). Add to the properties:
   ```typescript
   testEndpoint: {
     type: "object",
     required: ["method", "path"],
     properties: {
       method: { type: "string" },
       path: { type: "string" }
     }
   }
   ```

3. Find the runtime validator function (around line 140-180). Add validation:
   ```typescript
   if (record.testEndpoint !== undefined) {
     const te = record.testEndpoint;
     if (typeof te !== "object" || te === null) {
       errors.push("manifest.testEndpoint must be an object when provided.");
     } else {
       if (typeof (te as Record<string, unknown>).method !== "string") {
         errors.push("manifest.testEndpoint.method must be a string.");
       }
       if (typeof (te as Record<string, unknown>).path !== "string") {
         errors.push("manifest.testEndpoint.path must be a string.");
       }
     }
   }
   ```

4. Pass `testEndpoint` through to the returned validated manifest:
   ```typescript
   ...(record.testEndpoint !== undefined ? { testEndpoint: record.testEndpoint } : {})
   ```

### Step 5: Run tests to verify they pass

```bash
npm test -w packages/db -- --run migrations
npm test -w packages/connectors -- --run manifest
```

Expected: 2/2 migrations tests pass, 3/3 manifest tests pass.

### Step 6: Full repo regression check

```bash
npm test --workspaces --if-present
```

Expected: All existing tests still pass. No regressions.

### Step 7: Commit

```bash
git add packages/db/src/migrations.ts packages/db/test/migrations.test.ts packages/connectors/src/manifest.ts packages/connectors/test/manifest.test.ts
git commit -m "$(cat <<'COMMIT_EOF'
add-pending-approvals-table-and-manifest-test-endpoint

Schema foundations for the connector real-transport work:

- New pending_approvals table with kind discriminator (currently
  'sandbox-promotion' | 'connector-call'). The Phase-2
  listPendingApprovals façade will mirror sandbox rows into it on
  read; new approval kinds land here directly.
- Optional ConnectorManifest.testEndpoint field — { method, path }
  — used by the Test button to validate auth without picking a
  random read op. Auto-fallback to first low-risk GET still
  supported when the field is absent.

Both changes are additive. No behaviour change yet — Task 1.4
(approvalQueue) and Task 4.1 (testEndpoint values in shipped
manifests) consume them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
COMMIT_EOF
)"
```

---

## Task 1.2: Sensitivity policy module

**Why:** Pure-function policy decision — `(profileSensitivity, endpoint, manifest) → "execute" | "queue" | "deny"`. Easy to unit-test; the matrix in the design doc is the spec.

**Files:**
- Create: `packages/connectors/src/sensitivityPolicy.ts`
- Test: `packages/connectors/test/sensitivityPolicy.test.ts`

### Step 1: Write the failing tests

```typescript
import { describe, expect, it } from "vitest";
import { decide, type PolicyDecision } from "../src/sensitivityPolicy.js";
import type { ConnectorEndpoint, ConnectorManifest } from "../src/manifest.js";

function manifestWith(overrides: Partial<ConnectorManifest> = {}): ConnectorManifest {
  return {
    name: "test", systemType: "test", description: "test", protocol: "rest",
    auth: { type: "bearer" }, permissions: [],
    endpoints: [], dataClassifications: [], fixtureMode: false,
    costOwner: "free", readWrite: { read: ["listFoo"], write: ["createFoo"] },
    ...overrides
  } as ConnectorManifest;
}

function endpoint(operationId: string, opts: Partial<ConnectorEndpoint> = {}): ConnectorEndpoint {
  return {
    operationId, method: "GET", path: "/x", description: "x",
    permission: "low", inputSchema: {}, outputSchema: {}, dataClassifications: [],
    ...opts
  } as ConnectorEndpoint;
}

describe("sensitivityPolicy.decide", () => {
  const m = manifestWith({
    permissions: [
      { name: "low", riskLevel: "low", requiresApproval: false },
      { name: "high", riskLevel: "high", requiresApproval: true }
    ]
  });
  const readEp = endpoint("listFoo", { permission: "low" });
  const writeEp = endpoint("createFoo", { permission: "low" });
  const approvalReqEp = endpoint("createFoo", { permission: "high" });

  it("standard: reads and writes both execute; approval-required still queues", () => {
    expect(decide(m, readEp, "standard").mode).toBe("execute");
    expect(decide(m, writeEp, "standard").mode).toBe("execute");
    expect(decide(m, approvalReqEp, "standard").mode).toBe("queue");
  });

  it("sensitive: reads execute, writes queue, approval-required queues", () => {
    expect(decide(m, readEp, "sensitive").mode).toBe("execute");
    expect(decide(m, writeEp, "sensitive").mode).toBe("queue");
    expect(decide(m, approvalReqEp, "sensitive").mode).toBe("queue");
  });

  it("regulated: everything queues", () => {
    expect(decide(m, readEp, "regulated").mode).toBe("queue");
    expect(decide(m, writeEp, "regulated").mode).toBe("queue");
    expect(decide(m, approvalReqEp, "regulated").mode).toBe("queue");
  });

  it("air-gapped: everything denied with a clear reason", () => {
    expect(decide(m, readEp, "air-gapped").mode).toBe("deny");
    expect(decide(m, writeEp, "air-gapped").mode).toBe("deny");
    const result = decide(m, approvalReqEp, "air-gapped") as Extract<PolicyDecision, { mode: "deny" }>;
    expect(result.reason).toMatch(/air-gapped/i);
  });

  it("queue decision carries the operation's risk level", () => {
    const result = decide(m, approvalReqEp, "standard") as Extract<PolicyDecision, { mode: "queue" }>;
    expect(result.riskLevel).toBe("high");
  });
});
```

### Step 2: Run tests to verify fail

```bash
npm test -w packages/connectors -- --run sensitivityPolicy
```

Expected: FAIL — module doesn't exist.

### Step 3: Implement `sensitivityPolicy.ts`

```typescript
import type { ConnectorEndpoint, ConnectorManifest, ConnectorPermission } from "./manifest.js";

export type ProfileSensitivity = "standard" | "sensitive" | "regulated" | "air-gapped";

export type PolicyDecision =
  | { mode: "execute" }
  | { mode: "queue"; reason: string; riskLevel: "low" | "medium" | "high" }
  | { mode: "deny"; reason: string };

function findPermission(manifest: ConnectorManifest, name: string): ConnectorPermission | undefined {
  return manifest.permissions.find((p) => p.name === name);
}

function isWriteOperation(manifest: ConnectorManifest, operationId: string): boolean {
  return manifest.readWrite?.write?.includes(operationId) ?? false;
}

export function decide(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  sensitivity: ProfileSensitivity
): PolicyDecision {
  // Air-gapped is the hard wall: no real HTTP at all.
  if (sensitivity === "air-gapped") {
    return {
      mode: "deny",
      reason: "Real HTTP is disabled by the active profile's air-gapped sensitivity."
    };
  }

  const permission = findPermission(manifest, endpoint.permission ?? "");
  const riskLevel = permission?.riskLevel ?? "medium";

  // requiresApproval is always a queue override regardless of profile.
  if (permission?.requiresApproval) {
    return {
      mode: "queue",
      reason: `Operation requires approval (permission "${endpoint.permission}").`,
      riskLevel
    };
  }

  const isWrite = isWriteOperation(manifest, endpoint.operationId);

  if (sensitivity === "regulated") {
    return {
      mode: "queue",
      reason: "Regulated sensitivity queues all operations for approval.",
      riskLevel
    };
  }
  if (sensitivity === "sensitive" && isWrite) {
    return {
      mode: "queue",
      reason: "Sensitive sensitivity queues write operations for approval.",
      riskLevel
    };
  }
  return { mode: "execute" };
}
```

### Step 4: Run tests to verify pass

```bash
npm test -w packages/connectors -- --run sensitivityPolicy
```

Expected: 5/5 pass.

### Step 5: Commit

```bash
git add packages/connectors/src/sensitivityPolicy.ts packages/connectors/test/sensitivityPolicy.test.ts
git commit -m "add-connector-sensitivity-policy-module

Pure-function policy decision over (profileSensitivity, endpoint,
manifest) → 'execute' | 'queue' | 'deny'. Air-gapped denies all,
requiresApproval always queues, regulated queues everything,
sensitive queues writes, standard executes unless requiresApproval.

The PolicyDecision carries the endpoint's risk level forward when
queueing, so the approval row in the queue gets the right risk
chip without re-deriving it later.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.3: HTTP transport module

**Why:** The actual `fetch()` call with path templating, auth, body, error normalization. Replaces the dry-run stub semantics.

**Files:**
- Create: `packages/connectors/src/httpTransport.ts`
- Test: `packages/connectors/test/httpTransport.test.ts`

### Step 1: Write the failing tests

```typescript
import { describe, expect, it, vi } from "vitest";
import { executeRealHttpCall, applyPathTemplate } from "../src/httpTransport.js";
import type { ConnectorEndpoint, ConnectorManifest } from "../src/manifest.js";

function manifest(authType: "bearer" | "basic" | "apiKey" | "none" = "bearer"): ConnectorManifest {
  return {
    name: "test", systemType: "test", description: "test", protocol: "rest",
    auth: authType === "apiKey" ? { type: "apiKey", headerName: "X-API-Key" } : { type: authType },
    permissions: [], endpoints: [], dataClassifications: [],
    fixtureMode: false, costOwner: "free", readWrite: { read: [], write: [] }
  } as ConnectorManifest;
}

function endpoint(method: ConnectorEndpoint["method"], path: string): ConnectorEndpoint {
  return {
    operationId: "test", method, path, description: "test",
    permission: "low", inputSchema: {}, outputSchema: {}, dataClassifications: []
  } as ConnectorEndpoint;
}

describe("applyPathTemplate", () => {
  it("substitutes placeholders and returns residual args", () => {
    const { url, residual } = applyPathTemplate(
      "/repos/{owner}/{repo}/issues",
      { owner: "foo", repo: "bar", title: "x" }
    );
    expect(url).toBe("/repos/foo/bar/issues");
    expect(residual).toEqual({ title: "x" });
  });

  it("URL-encodes path segments", () => {
    const { url } = applyPathTemplate("/file/{path}", { path: "a b/c" });
    expect(url).toBe("/file/a%20b%2Fc");
  });
});

describe("executeRealHttpCall — auth", () => {
  function captureRequest(handler: (init: RequestInit) => Response): { restore: () => void; captured: () => RequestInit | null } {
    let captured: RequestInit | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (_url, init) => {
      captured = init ?? {};
      return handler(captured);
    }) as typeof fetch;
    return { restore: () => { globalThis.fetch = original; }, captured: () => captured };
  }

  it("sends Bearer token for auth.type='bearer'", async () => {
    const { restore, captured } = captureRequest(() =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    );
    try {
      await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/user"), {}, { baseUrl: "https://api.example", apiKey: "sk-test" });
      const init = captured()!;
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    } finally { restore(); }
  });

  it("sends Basic auth header for auth.type='basic'", async () => {
    const { restore, captured } = captureRequest(() =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
    try {
      await executeRealHttpCall(manifest("basic"), endpoint("GET", "/me"), {}, { baseUrl: "https://api.example", apiKey: "tok" });
      const init = captured()!;
      // base64("x:tok") = "eDp0b2s="
      expect((init.headers as Record<string, string>).Authorization).toBe("Basic eDp0b2s=");
    } finally { restore(); }
  });

  it("sends custom header for auth.type='apiKey'", async () => {
    const { restore, captured } = captureRequest(() =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
    try {
      await executeRealHttpCall(manifest("apiKey"), endpoint("GET", "/x"), {}, { baseUrl: "https://api.example", apiKey: "k" });
      const init = captured()!;
      expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("k");
    } finally { restore(); }
  });
});

describe("executeRealHttpCall — body + path templating", () => {
  it("uses templated args in the URL and remaining args as JSON body for POST", async () => {
    let capturedUrl = "";
    let capturedBody = "";
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      capturedUrl = String(url);
      capturedBody = String(init?.body ?? "");
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await executeRealHttpCall(
        manifest("bearer"),
        endpoint("POST", "/repos/{owner}/{repo}/issues"),
        { owner: "foo", repo: "bar", title: "Bug", body: "Details" },
        { baseUrl: "https://api.example", apiKey: "k" }
      );
      expect(capturedUrl).toBe("https://api.example/repos/foo/bar/issues");
      expect(JSON.parse(capturedBody)).toEqual({ title: "Bug", body: "Details" });
    } finally { globalThis.fetch = original; }
  });
});

describe("executeRealHttpCall — error normalization", () => {
  function withStatus(status: number, body = "x"): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(body, { status })) as typeof fetch;
    return () => { globalThis.fetch = original; };
  }

  it("returns code='auth' for 401", async () => {
    const restore = withStatus(401);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("auth");
    } finally { restore(); }
  });
  it("returns code='forbidden' for 403", async () => {
    const restore = withStatus(403);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("forbidden");
    } finally { restore(); }
  });
  it("returns code='not_found' for 404", async () => {
    const restore = withStatus(404);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("not_found");
    } finally { restore(); }
  });
  it("returns code='rate_limit' for 429", async () => {
    const restore = withStatus(429);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("rate_limit");
    } finally { restore(); }
  });
  it("returns code='server_error' for 500", async () => {
    const restore = withStatus(500);
    try {
      const r = await executeRealHttpCall(manifest("bearer"), endpoint("GET", "/x"), {}, { baseUrl: "u", apiKey: "k" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("server_error");
    } finally { restore(); }
  });
});
```

### Step 2: Run tests to verify fail

```bash
npm test -w packages/connectors -- --run httpTransport
```

Expected: FAIL — module doesn't exist.

### Step 3: Implement `httpTransport.ts`

```typescript
import type { ConnectorEndpoint, ConnectorManifest } from "./manifest.js";

export type ConnectorRuntimeSettings = {
  baseUrl: string;
  apiKey: string | null;
};

export type HttpCallResult =
  | { ok: true; status: number; durationMs: number; body: unknown }
  | {
      ok: false;
      code: "auth" | "forbidden" | "not_found" | "rate_limit" | "server_error" | "timeout" | "network" | "unknown";
      status?: number;
      durationMs: number;
      message: string;
    };

export function applyPathTemplate(
  template: string,
  args: Record<string, unknown>
): { url: string; residual: Record<string, unknown> } {
  const residual = { ...args };
  const url = template.replace(/\{([^}]+)\}/g, (_match, key) => {
    const value = residual[key];
    if (value === undefined || value === null) {
      throw new Error(`Missing required path argument: ${key}`);
    }
    delete residual[key];
    return encodeURIComponent(String(value));
  });
  return { url, residual };
}

function buildAuthHeader(manifest: ConnectorManifest, apiKey: string | null): Record<string, string> {
  if (!apiKey) return {};
  const auth = manifest.auth;
  switch (auth.type) {
    case "bearer":
      return { Authorization: `Bearer ${apiKey}` };
    case "basic": {
      const encoded = Buffer.from(`x:${apiKey}`, "utf8").toString("base64");
      return { Authorization: `Basic ${encoded}` };
    }
    case "apiKey": {
      const headerName = (auth as { headerName?: string }).headerName ?? "X-API-Key";
      return { [headerName]: apiKey };
    }
    case "none":
    default:
      return {};
  }
}

function codeForStatus(status: number): HttpCallResult & { ok: false } extends infer T ? Extract<T, { ok: false }>["code"] : never {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server_error";
  return "unknown";
}

export async function executeRealHttpCall(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  args: Record<string, unknown>,
  settings: ConnectorRuntimeSettings,
  options: { timeoutMs?: number } = {}
): Promise<HttpCallResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const start = Date.now();

  let url: string;
  let residual: Record<string, unknown>;
  try {
    const templated = applyPathTemplate(endpoint.path, args);
    url = `${settings.baseUrl.replace(/\/$/, "")}${templated.url.startsWith("/") ? templated.url : "/" + templated.url}`;
    residual = templated.residual;
  } catch (err) {
    return {
      ok: false,
      code: "unknown",
      durationMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const method = endpoint.method.toUpperCase();
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";

  const headers: Record<string, string> = {
    Accept: "application/json",
    ...buildAuthHeader(manifest, settings.apiKey)
  };

  let body: string | undefined;
  if (hasBody && Object.keys(residual).length > 0) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(residual);
  } else if (!hasBody && Object.keys(residual).length > 0) {
    // GET/DELETE → query string
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(residual)) {
      params.append(k, String(v));
    }
    url += (url.includes("?") ? "&" : "?") + params.toString();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    const contentType = response.headers.get("content-type") ?? "";
    const parsed = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => "");

    if (response.ok) {
      return { ok: true, status: response.status, durationMs, body: parsed };
    }
    return {
      ok: false,
      code: codeForStatus(response.status),
      status: response.status,
      durationMs,
      message: typeof parsed === "string"
        ? parsed.slice(0, 500)
        : (parsed && typeof parsed === "object" && "message" in parsed
            ? String((parsed as Record<string, unknown>).message).slice(0, 500)
            : `HTTP ${response.status}`)
    };
  } catch (err) {
    clearTimeout(timer);
    const durationMs = Date.now() - start;
    if (controller.signal.aborted) {
      return { ok: false, code: "timeout", durationMs, message: `Request timed out after ${timeoutMs}ms.` };
    }
    return {
      ok: false,
      code: "network",
      durationMs,
      message: err instanceof Error ? err.message : String(err)
    };
  }
}
```

### Step 4: Run tests to verify pass

```bash
npm test -w packages/connectors -- --run httpTransport
```

Expected: All transport tests pass.

### Step 5: Commit

```bash
git add packages/connectors/src/httpTransport.ts packages/connectors/test/httpTransport.test.ts
git commit -m "add-connector-http-transport-module

Real HTTP transport for connector operations. Replaces the dry-run
stub semantics with actual fetch():

- Path templating (URL-encoded segments, residual args go in
  body/query).
- Auth headers for bearer / basic / apiKey / none.
- Body serialization (JSON for POST/PUT/PATCH; query string for
  GET/DELETE).
- Discriminated-union result: success or one of {auth, forbidden,
  not_found, rate_limit, server_error, timeout, network, unknown}.
- 30s default timeout via AbortController.

This module is pure data-in / data-out — no event emission, no
DB access. Task 1.5 wires it into tools.ts which adds the
observability + IPC plumbing on top.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.4: Approval queue module

**Why:** The data layer for queuing connector calls. Wraps `pending_approvals` table reads/writes behind a small API.

**Files:**
- Create: `packages/connectors/src/approvalQueue.ts`
- Modify: `packages/db/src/database.ts` (add methods for `pending_approvals` CRUD if not already present — check first)
- Test: `packages/connectors/test/approvalQueue.test.ts`

### Step 1: Check existing DB methods

```bash
grep -n "pending_approvals\|PendingApproval" packages/db/src/database.ts | head -10
```

If methods don't exist, add them in this task. If they do (Task 1.1 might have provided them), use them.

### Step 2: Write the failing tests

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { createDatabase } from "@squidbot/db";
import { enqueueApproval, listOpenApprovals, resolveApproval } from "../src/approvalQueue.js";
import { SquidDatabase } from "@squidbot/db";

let db: SquidDatabase;
beforeEach(() => {
  db = createDatabase(":memory:");
});

describe("approvalQueue", () => {
  it("enqueues a connector-call approval and surfaces it in listOpenApprovals", () => {
    const id = enqueueApproval(db, {
      kind: "connector-call",
      title: "Allow github.createIssue?",
      summary: "Args: { title: 'Bug' }",
      riskLevel: "high",
      payload: { connectorName: "github", operationId: "createIssue", args: { title: "Bug" } },
      callerSessionId: "s1",
      callerRunId: "r1"
    });
    expect(id).toMatch(/^ap_/);
    const open = listOpenApprovals(db);
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe("connector-call");
    expect(open[0].title).toContain("github.createIssue");
  });

  it("resolveApproval('approved') sets resolvedAt + resolution + resultJson", () => {
    const id = enqueueApproval(db, {
      kind: "connector-call", title: "x", summary: "x", riskLevel: "low",
      payload: { connectorName: "github", operationId: "listBranches", args: {} }
    });
    const resolved = resolveApproval(db, id, { resolution: "approved", result: { number: 42 } });
    expect(resolved.resolution).toBe("approved");
    expect(resolved.resultJson).toBeTruthy();
    expect(JSON.parse(resolved.resultJson!)).toEqual({ number: 42 });
    expect(listOpenApprovals(db)).toHaveLength(0);
  });

  it("resolveApproval('rejected') with an optional reason", () => {
    const id = enqueueApproval(db, {
      kind: "connector-call", title: "x", summary: "x", riskLevel: "low",
      payload: { connectorName: "x", operationId: "x", args: {} }
    });
    const resolved = resolveApproval(db, id, { resolution: "rejected", reason: "no thanks" });
    expect(resolved.resolution).toBe("rejected");
    expect(JSON.parse(resolved.resultJson!)).toEqual({ rejected: true, reason: "no thanks" });
  });

  it("listResolvedSince filters by session and timestamp", () => {
    const id1 = enqueueApproval(db, { kind: "connector-call", title: "a", summary: "a", riskLevel: "low",
      payload: { connectorName: "x", operationId: "x", args: {} }, callerSessionId: "s1" });
    enqueueApproval(db, { kind: "connector-call", title: "b", summary: "b", riskLevel: "low",
      payload: { connectorName: "x", operationId: "x", args: {} }, callerSessionId: "s2" });
    resolveApproval(db, id1, { resolution: "approved", result: { ok: true } });
    const since = new Date(Date.now() - 60_000).toISOString();
    const { listResolvedSince } = await import("../src/approvalQueue.js");
    const resolved = listResolvedSince(db, { sessionId: "s1", since });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe(id1);
  });
});
```

### Step 3: Run tests to verify fail

```bash
npm test -w packages/connectors -- --run approvalQueue
```

Expected: FAIL — module + DB methods don't exist.

### Step 4: Implement `approvalQueue.ts`

```typescript
import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";

export type ApprovalKind = "sandbox-promotion" | "connector-call";
export type RiskLevel = "low" | "medium" | "high";

export type ApprovalInput = {
  kind: ApprovalKind;
  title: string;
  summary: string;
  riskLevel: RiskLevel;
  payload: Record<string, unknown>;
  callerSessionId?: string;
  callerRunId?: string;
};

export type ApprovalRow = {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  riskLevel: RiskLevel;
  payload: Record<string, unknown>;
  callerSessionId: string | null;
  callerRunId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: "approved" | "rejected" | null;
  resultJson: string | null;
};

export function enqueueApproval(db: SquidDatabase, input: ApprovalInput): string {
  const id = createId("ap");
  const createdAt = new Date().toISOString();
  db.exec(
    `INSERT INTO pending_approvals (id, kind, title, summary, riskLevel, payload, callerSessionId, callerRunId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.kind, input.title, input.summary, input.riskLevel, JSON.stringify(input.payload), input.callerSessionId ?? null, input.callerRunId ?? null, createdAt]
  );
  return id;
}

export function listOpenApprovals(db: SquidDatabase): ApprovalRow[] {
  const rows = db.all(
    `SELECT * FROM pending_approvals WHERE resolvedAt IS NULL ORDER BY createdAt DESC`
  ) as Array<Record<string, unknown>>;
  return rows.map(rowToApproval);
}

export function getApproval(db: SquidDatabase, id: string): ApprovalRow | null {
  const row = db.get(`SELECT * FROM pending_approvals WHERE id = ?`, [id]) as Record<string, unknown> | undefined;
  return row ? rowToApproval(row) : null;
}

export function resolveApproval(
  db: SquidDatabase,
  id: string,
  outcome: { resolution: "approved"; result: unknown } | { resolution: "rejected"; reason?: string }
): ApprovalRow {
  const resolvedAt = new Date().toISOString();
  const resultPayload = outcome.resolution === "approved"
    ? outcome.result
    : { rejected: true, reason: outcome.reason ?? null };
  db.exec(
    `UPDATE pending_approvals SET resolvedAt = ?, resolution = ?, resultJson = ? WHERE id = ?`,
    [resolvedAt, outcome.resolution, JSON.stringify(resultPayload), id]
  );
  const row = getApproval(db, id);
  if (!row) throw new Error(`Approval not found after resolve: ${id}`);
  return row;
}

export function listResolvedSince(
  db: SquidDatabase,
  options: { sessionId: string; since: string }
): ApprovalRow[] {
  const rows = db.all(
    `SELECT * FROM pending_approvals WHERE callerSessionId = ? AND resolvedAt IS NOT NULL AND resolvedAt >= ? ORDER BY resolvedAt ASC`,
    [options.sessionId, options.since]
  ) as Array<Record<string, unknown>>;
  return rows.map(rowToApproval);
}

function rowToApproval(row: Record<string, unknown>): ApprovalRow {
  return {
    id: row.id as string,
    kind: row.kind as ApprovalKind,
    title: row.title as string,
    summary: row.summary as string,
    riskLevel: row.riskLevel as RiskLevel,
    payload: JSON.parse(row.payload as string),
    callerSessionId: (row.callerSessionId as string) ?? null,
    callerRunId: (row.callerRunId as string) ?? null,
    createdAt: row.createdAt as string,
    resolvedAt: (row.resolvedAt as string) ?? null,
    resolution: (row.resolution as "approved" | "rejected" | null) ?? null,
    resultJson: (row.resultJson as string) ?? null
  };
}
```

NOTE: If `SquidDatabase` doesn't expose `exec(sql, params)` / `all(sql, params)` / `get(sql, params)` — match the actual interface used elsewhere in the codebase. Read `packages/db/src/database.ts` to find the existing pattern (probably wraps `better-sqlite3` directly).

### Step 5: Run tests to verify pass

```bash
npm test -w packages/connectors -- --run approvalQueue
```

Expected: 4/4 pass.

### Step 6: Commit

```bash
git add packages/connectors/src/approvalQueue.ts packages/connectors/test/approvalQueue.test.ts
git commit -m "add-connector-approval-queue-module

CRUD over the pending_approvals table for the connector-call
approval kind. enqueueApproval creates a row, listOpenApprovals
surfaces unresolved rows for the Approvals page, resolveApproval
marks a row approved+result or rejected+reason, listResolvedSince
gives the runtime its picks-up-resolutions-since-last-message
query.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.5: Replace dry-run stub in `tools.ts` with the policy switch

**Why:** The integration point. `tools.ts:101-111` currently returns a dry-run object; replace it with the `sensitivityPolicy.decide → {execute, queue, deny}` switch that calls `httpTransport` or `approvalQueue`.

**Files:**
- Modify: `packages/connectors/src/tools.ts` (lines around 100)
- Test: `packages/connectors/test/tools.test.ts` (new tests for the integration paths)

### Step 1: Write failing tests

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createDatabase, type SquidDatabase } from "@squidbot/db";
// ... imports for tools.ts + manifest + a stubbed ToolContext

describe("callConnectorEndpoint — sensitivity policy integration", () => {
  let db: SquidDatabase;
  beforeEach(() => { db = createDatabase(":memory:"); });

  it("executes real HTTP when sensitivity is 'standard' and op is a read", async () => {
    // Stub fetch
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } })
    ) as typeof fetch;
    try {
      const manifest = { /* a real-mode manifest with bearer auth, one GET endpoint */ };
      const result = await callConnectorEndpoint(manifest, manifest.endpoints[0], { /* args */ }, {
        sessionId: "s", runId: "r",
        getSetting: (k: string) => k.endsWith(".baseUrl") ? "https://api.example" : "tok",
        getActiveProfileSensitivity: () => "standard",
        emitEvent: vi.fn(),
        database: db
      });
      expect((result as { mode: string }).mode).toBe("real");
      expect((result as { ok: boolean }).ok).toBe(true);
    } finally { globalThis.fetch = origFetch; }
  });

  it("queues when sensitivity is 'sensitive' and op is a write", async () => {
    // Stub manifest with write op
    // Call tools, assert NO fetch was called and approval was enqueued
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;
    // ...
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(listOpenApprovals(db)).toHaveLength(1);
    // Result returned to agent should be { pending: true, approvalId, ... }
  });

  it("denies all calls when sensitivity is 'air-gapped'", async () => {
    // ...
    const result = await callConnectorEndpoint(/* ... */);
    expect((result as { mode: string }).mode).toBe("denied");
    expect((result as { reason: string }).reason).toMatch(/air-gapped/i);
  });

  it("fixture-mode calls bypass the policy entirely (regression check)", async () => {
    // existing test pattern — ensure this still works
  });
});
```

(Sketch above — fill in concrete manifest fixtures during implementation. The shape is: stub manifest + stub ToolContext, invoke `callConnectorEndpoint`, assert behavior.)

### Step 2: Run to verify fail

```bash
npm test -w packages/connectors -- --run tools
```

Expected: New tests fail (policy integration doesn't exist).

### Step 3: Modify `tools.ts`

Find the dry-run block around lines 101-111. Replace it with:

```typescript
import { decide as decideSensitivityPolicy, type ProfileSensitivity } from "./sensitivityPolicy.js";
import { executeRealHttpCall } from "./httpTransport.js";
import { enqueueApproval } from "./approvalQueue.js";

// Inside the function, replace lines 101-111 with:

const profileSensitivity: ProfileSensitivity =
  context.getActiveProfileSensitivity?.() ?? "standard";
const decision = decideSensitivityPolicy(manifest, endpoint, profileSensitivity);

if (decision.mode === "deny") {
  const response = {
    connectorName: manifest.name,
    operationName: endpoint.operationId,
    mode: "denied",
    fixture: false,
    executed: false,
    reason: decision.reason
  };
  emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
  return response;
}

if (decision.mode === "queue") {
  const approvalId = enqueueApproval(context.database!, {
    kind: "connector-call",
    title: `Allow ${manifest.name}.${endpoint.operationId}?`,
    summary: summarizeArgsForApproval(args),
    riskLevel: decision.riskLevel,
    payload: {
      connectorName: manifest.name,
      operationId: endpoint.operationId,
      args
    },
    callerSessionId: context.sessionId,
    callerRunId: context.runId
  });
  const response = {
    connectorName: manifest.name,
    operationName: endpoint.operationId,
    mode: "pending-approval" as const,
    pending: true,
    approvalId,
    reason: decision.reason
  };
  context.emitEvent?.("connector.approval-requested", {
    connectorName: manifest.name,
    operationName: endpoint.operationId,
    approvalId,
    riskLevel: decision.riskLevel
  });
  emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
  return response;
}

// decision.mode === "execute"
const baseUrl = context.getSetting?.<string>(`${manifest.name}.baseUrl`);
const apiKey = context.getSetting?.<string>(`${manifest.name}.apiKey`) ?? null;
if (!baseUrl) {
  const response = {
    connectorName: manifest.name,
    operationName: endpoint.operationId,
    mode: "not-configured" as const,
    executed: false,
    reason: "No connector base URL is configured. Set one in Integrations → Connectors."
  };
  emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
  return response;
}

const result = await executeRealHttpCall(manifest, endpoint, args, { baseUrl, apiKey });
context.emitEvent?.("connector.http_call", {
  connectorName: manifest.name,
  operationName: endpoint.operationId,
  method: endpoint.method,
  path: endpoint.path,
  status: result.ok ? result.status : (result.status ?? null),
  durationMs: result.durationMs,
  ok: result.ok,
  mode: "real"
});
const response = result.ok
  ? { connectorName: manifest.name, operationName: endpoint.operationId, mode: "real", executed: true, response: result.body, status: result.status }
  : { connectorName: manifest.name, operationName: endpoint.operationId, mode: "real", executed: false, error: result.code, status: result.status, message: result.message };
emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
return response;
```

Add `summarizeArgsForApproval` as a small helper:

```typescript
function summarizeArgsForApproval(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  if (json.length <= 140) return `Args: ${json}`;
  return `Args (truncated): ${json.slice(0, 140)}…`;
}
```

Update the `ToolContext` type (in `packages/core/src/types.ts` or wherever it lives) to add the optional methods:

```typescript
getActiveProfileSensitivity?: () => "standard" | "sensitive" | "regulated" | "air-gapped";
database?: SquidDatabase;
```

### Step 4: Run to verify pass

```bash
npm test -w packages/connectors -- --run tools
npm test -w packages/connectors
npm test --workspaces --if-present
```

Expected: All connector tests pass, full repo green.

### Step 5: Commit

```bash
git add packages/connectors/src/tools.ts packages/connectors/test/tools.test.ts packages/core/src/types.ts
git commit -m "wire-policy-switch-into-connector-tools

Replaces the dry-run stub in tools.ts:101-111 with the
sensitivity-policy switch:
- execute → calls httpTransport.executeRealHttpCall
- queue → calls approvalQueue.enqueueApproval, returns
  { pending: true, approvalId } so the agent can surface it
- deny → returns a not-executed response with the air-gap reason

Adds two optional ToolContext methods: getActiveProfileSensitivity
(supplied by the runtime from the active enterprise profile) and
database (already passed in elsewhere, now formally typed).

Every real call emits a connector.http_call event for trace/audit
without leaking request/response bodies."
```

---

## Task 1.6: Extend `PendingApprovalDto` and update `listPendingApprovals` IPC

**Why:** Wire the new approval kind to the existing IPC the Approvals page consumes.

**Files:**
- Modify: `apps/desktop/src/shared/api.ts` (extend `PendingApprovalDto.kind` + payload)
- Modify: `apps/desktop/src/main/ipc.ts` (rewrite `listPendingApprovals` handler to read from new table)

### Step 1: Write failing tests

Spot-check the IPC handler indirectly: a new test in `App.test.tsx` or `ApprovalsPage.test.tsx` that mocks `listPendingApprovals` returning a `connector-call` row, and asserts the renderer doesn't crash. (Detail in Task 2.1 — for this task, just type-check.)

### Step 2: Update DTO type

In `apps/desktop/src/shared/api.ts`:

```typescript
export type PendingApprovalDto = {
  id: string;
  kind: "sandbox-promotion" | "connector-call";  // ← was just "sandbox-promotion"
  title: string;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
  payload: {
    sandboxId?: string;
    workspacePath?: string;
    // new fields for connector-call:
    connectorName?: string;
    operationId?: string;
    args?: Record<string, unknown>;
    callerSessionId?: string;
    callerRunId?: string;
  };
};
```

### Step 3: Rewrite the IPC handler

In `apps/desktop/src/main/ipc.ts`, find the existing `squidbot:listPendingApprovals` handler. Update it to:

```typescript
ipcMain.handle("squidbot:listPendingApprovals", async (): Promise<PendingApprovalDto[]> => {
  // Pull from the new pending_approvals table (preferred).
  const tableRows = listOpenApprovals(database).map(rowToDto);
  // Keep backwards-compat with the Task 2.1 façade: include active sandboxes too
  // (they're not in pending_approvals until promoted into it by a future migration).
  const sandboxRows = database
    .listSandboxes({ status: "active" })
    .map(sandboxToApprovalDto);
  return [...tableRows, ...sandboxRows];
});

function rowToDto(row: import("@squidbot/connectors").ApprovalRow): PendingApprovalDto {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    riskLevel: row.riskLevel,
    createdAt: row.createdAt,
    payload: (row.payload as PendingApprovalDto["payload"])
  };
}
```

### Step 4: Typecheck

```bash
npm run typecheck -w apps/desktop
```

Expected: clean.

### Step 5: Run full suite

```bash
npm test --workspaces --if-present
```

Expected: pass.

### Step 6: Commit

```bash
git add apps/desktop/src/shared/api.ts apps/desktop/src/main/ipc.ts
git commit -m "extend-pending-approval-dto-for-connector-call-kind

Adds 'connector-call' to the kind discriminator and connector-
specific payload fields (connectorName, operationId, args,
callerSessionId, callerRunId). The listPendingApprovals IPC now
reads from the real pending_approvals table AND continues to
surface active sandboxes (Phase-2 façade preserved for
backwards-compat)."
```

---

## Task 1.7: New IPC handlers — `testConnector`, `approveConnectorCall`, `rejectConnectorCall`

**Why:** The renderer's Test button and Approve/Reject buttons need their backend wiring.

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/shared/api.ts` (extend `SquidbotApi` type)

### Step 1: Add DTO + API surface

In `apps/desktop/src/shared/api.ts`, extend `SquidbotApi`:

```typescript
testConnector: (connectorName: string) => Promise<{
  ok: boolean;
  code?: string;
  message?: string;
  durationMs?: number;
}>;
approveConnectorCall: (approvalId: string) => Promise<{
  ok: boolean;
  result?: unknown;
  error?: string;
}>;
rejectConnectorCall: (approvalId: string, reason?: string) => Promise<{ ok: true }>;
```

### Step 2: Expose in preload

In `apps/desktop/src/preload/index.ts`:

```typescript
testConnector: (name) => ipcRenderer.invoke("squidbot:testConnector", name),
approveConnectorCall: (id) => ipcRenderer.invoke("squidbot:approveConnectorCall", id),
rejectConnectorCall: (id, reason) => ipcRenderer.invoke("squidbot:rejectConnectorCall", id, reason),
```

### Step 3: Implement handlers in ipc.ts

```typescript
ipcMain.handle("squidbot:testConnector", async (_event, connectorName: string) => {
  const registry = new ConnectorRegistry(database);
  installDeveloperWorkflowConnectors(registry);
  const manifest = registry.getConnector(connectorName);
  if (!manifest) return { ok: false, code: "not_found", message: `Connector ${connectorName} not installed.` };

  // Resolve test endpoint: explicit manifest.testEndpoint OR auto-fallback.
  let testEp: { method: string; path: string } | null = null;
  if (manifest.testEndpoint) {
    testEp = manifest.testEndpoint;
  } else {
    const auto = manifest.endpoints.find((ep) => {
      const perm = manifest.permissions.find((p) => p.name === ep.permission);
      const hasPlaceholders = /\{[^}]+\}/.test(ep.path);
      return ep.method === "GET" && perm?.riskLevel === "low" && !hasPlaceholders;
    });
    if (auto) testEp = { method: auto.method, path: auto.path };
  }
  if (!testEp) return { ok: false, code: "no_test_op", message: "Connector has no eligible no-arg GET; configure manifest.testEndpoint." };

  const baseUrl = database.getSetting<string>(`${manifest.name}.baseUrl`);
  const apiKey = database.getSetting<string>(`${manifest.name}.apiKey`) ?? null;
  if (!baseUrl) return { ok: false, code: "not_configured", message: "Base URL not configured." };

  const endpoint = { ...manifest.endpoints[0], ...testEp, operationId: "__test__", inputSchema: {}, outputSchema: {}, dataClassifications: [], description: "Test", permission: "low" };
  const result = await executeRealHttpCall(manifest, endpoint as ConnectorEndpoint, {}, { baseUrl, apiKey });

  const status = result.ok ? "ok" : result.code;
  const at = new Date().toISOString();
  database.setSetting(`${manifest.name}.lastTest.status`, status);
  database.setSetting(`${manifest.name}.lastTest.at`, at);
  if (!result.ok) {
    database.setSetting(`${manifest.name}.lastTest.message`, result.message);
  }
  return result.ok
    ? { ok: true, durationMs: result.durationMs }
    : { ok: false, code: result.code, message: result.message, durationMs: result.durationMs };
});

ipcMain.handle("squidbot:approveConnectorCall", async (_event, approvalId: string) => {
  const row = getApproval(database, approvalId);
  if (!row) return { ok: false, error: "Approval not found" };
  if (row.kind !== "connector-call") return { ok: false, error: `Wrong kind: ${row.kind}` };
  if (row.resolvedAt) return { ok: false, error: `Already ${row.resolution}` };

  const { connectorName, operationId, args } = row.payload as Record<string, unknown>;
  const registry = new ConnectorRegistry(database);
  installDeveloperWorkflowConnectors(registry);
  const manifest = registry.getConnector(connectorName as string);
  if (!manifest) return { ok: false, error: `Connector not found: ${connectorName}` };
  const endpoint = manifest.endpoints.find((ep) => ep.operationId === operationId);
  if (!endpoint) return { ok: false, error: `Endpoint not found: ${operationId}` };

  const baseUrl = database.getSetting<string>(`${manifest.name}.baseUrl`);
  const apiKey = database.getSetting<string>(`${manifest.name}.apiKey`) ?? null;
  if (!baseUrl) return { ok: false, error: "Base URL not configured." };

  const httpResult = await executeRealHttpCall(manifest, endpoint, args as Record<string, unknown>, { baseUrl, apiKey });
  resolveApproval(database, approvalId, {
    resolution: "approved",
    result: httpResult.ok ? { status: httpResult.status, body: httpResult.body } : { error: httpResult.code, message: httpResult.message }
  });
  return httpResult.ok
    ? { ok: true, result: httpResult.body }
    : { ok: false, error: `${httpResult.code}: ${httpResult.message}` };
});

ipcMain.handle("squidbot:rejectConnectorCall", async (_event, approvalId: string, reason?: string) => {
  resolveApproval(database, approvalId, { resolution: "rejected", reason });
  return { ok: true };
});
```

### Step 4: Typecheck + full suite

```bash
npm run typecheck -w apps/desktop
npm test --workspaces --if-present
```

Expected: clean + pass.

### Step 5: Commit

```bash
git add apps/desktop/src/main/ipc.ts apps/desktop/src/preload/index.ts apps/desktop/src/shared/api.ts
git commit -m "add-connector-test-and-approval-resolution-ipc

Three new IPC handlers:

- squidbot:testConnector — runs the manifest's testEndpoint (or
  auto-falls-back to first low-risk no-arg GET) and stores result
  in settings as {name}.lastTest.status / .at / .message.
- squidbot:approveConnectorCall — looks up the queued approval,
  calls executeRealHttpCall with the stored args, stores the
  response, marks the row approved.
- squidbot:rejectConnectorCall — marks the row rejected with
  optional reason.

The deferred-call dispatch in approveConnectorCall is the key
piece that lets the Approvals page Approve button actually fire
the HTTP call right inside the click handler. Task 3.2 will wire
the runtime to surface the resolved approval back to the agent."
```

---

## Phase 1 checkpoint

```bash
npm test --workspaces --if-present
npm run typecheck -w apps/desktop
```

Expected: full repo green. Phase 1 ships **the backend transport without UI changes** — the dry-run stub is gone, sensitivity policy is enforced, approvals queue, but nothing in the renderer looks different yet.

---

# Phase 2 — UI surfacing

## Task 2.1: ApprovalsPage renders `connector-call` kind

**Why:** New approval rows from the queue need to render with operation summary + Approve/Reject buttons that wire to the new IPC handlers.

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/ApprovalsPage.test.tsx`

### Step 1: Write failing test

```typescript
describe("ApprovalsPage — connector-call kind", () => {
  beforeEach(() => {
    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        listPendingApprovals: vi.fn(async () => [
          {
            id: "ap_cc1", kind: "connector-call",
            title: "Allow github.createIssue?",
            summary: "Args: { title: 'Bug', repo: 'foo' }",
            riskLevel: "high",
            createdAt: new Date().toISOString(),
            payload: { connectorName: "github", operationId: "createIssue", args: { title: "Bug" } }
          }
        ]),
        approveConnectorCall: vi.fn(async () => ({ ok: true, result: { number: 42 } })),
        rejectConnectorCall: vi.fn(async () => ({ ok: true }))
      }
    });
  });

  it("renders connector-call rows and routes Approve to approveConnectorCall", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => screen.getByText(/github\.createIssue/i));
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(window.squidbot.approveConnectorCall).toHaveBeenCalledWith("ap_cc1"));
  });

  it("routes Reject to rejectConnectorCall", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => screen.getByText(/github\.createIssue/i));
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    await waitFor(() => expect(window.squidbot.rejectConnectorCall).toHaveBeenCalledWith("ap_cc1"));
  });
});
```

### Step 2: Run to verify fail

```bash
npm test -w apps/desktop -- --run ApprovalsPage
```

Expected: FAIL — current Approve handler doesn't switch on `kind`.

### Step 3: Update ApprovalsPage Approve/Reject branches

In `ApprovalsPage.tsx`, find the `approve` and `reject` functions. Add a switch:

```typescript
async function approve(item: PendingApprovalDto) {
  setBusyId(item.id);
  try {
    if (item.kind === "sandbox-promotion") {
      if (!item.payload.sandboxId) return;
      await squidbotApi.approveSandbox(item.payload.sandboxId);
    } else if (item.kind === "connector-call") {
      await squidbotApi.approveConnectorCall(item.id);
    }
    await refresh();
  } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  finally { setBusyId(null); }
}

async function reject(item: PendingApprovalDto) {
  setBusyId(item.id);
  try {
    if (item.kind === "sandbox-promotion") {
      if (!item.payload.sandboxId) return;
      await squidbotApi.rejectSandbox(item.payload.sandboxId);
    } else if (item.kind === "connector-call") {
      await squidbotApi.rejectConnectorCall(item.id);
    }
    await refresh();
  } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  finally { setBusyId(null); }
}
```

### Step 4: Run + commit

```bash
npm test -w apps/desktop -- --run ApprovalsPage
git add apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx apps/desktop/src/renderer/src/pages/ApprovalsPage.test.tsx
git commit -m "render-connector-call-approval-kind-in-approvals-page

Approve/Reject buttons now branch on item.kind: sandbox-promotion
keeps existing wiring; connector-call calls the new
approveConnectorCall / rejectConnectorCall IPC. Existing tests
still pass."
```

---

## Task 2.2: ConnectorsSection — Test button + status dot/chip

**Why:** Make each connector card show its real state and let the user verify with one click.

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ConnectorsSection.tsx`
- Modify: `apps/desktop/src/renderer/src/components/ConnectorsSection.test.tsx`
- Modify: `apps/desktop/src/renderer/src/styles/app.css` (append status-dot styles)

### Step 1: Failing test

```typescript
describe("ConnectorsSection — Test button + status", () => {
  it("shows a Test button when a key is configured", async () => {
    const settings: SettingsDto = {
      ...emptySettings,
      connectors: [/* github with apiKeyConfigured: true */],
      connectorSettings: { github: { baseUrl: "https://api.github.com", apiKeyConfigured: true } }
    };
    const { ConnectorsSection } = await import("./ConnectorsSection");
    render(<ConnectorsSection settings={settings} onSettingsChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /test/i })).toBeTruthy();
  });

  it("clicking Test calls squidbotApi.testConnector and surfaces ok/error", async () => {
    /* stub testConnector returning { ok: true, durationMs: 120 } */
    /* fireEvent.click */
    /* assert green chip rendered with "tested just now" */
  });
});
```

### Step 2: Run + implement

Run test → fail. Then add the Test button + status logic to ConnectorsSection. Read each connector's `${name}.lastTest.*` settings to compute the visible state per the table in the design doc Section 8.

```typescript
function deriveStatus(connector, settings, activeProfileSensitivity): { dot: string; text: string } {
  if (activeProfileSensitivity === "air-gapped") return { dot: "lock", text: "Real calls disabled by profile sensitivity" };
  if (connector.fixtureMode) return { dot: "yellow", text: "Mock data — toggle off for real" };
  if (!settings.connectorSettings[connector.name]?.apiKeyConfigured) return { dot: "grey", text: "Add a key to use this" };
  const last = readLastTest(connector.name);  // pulls from settings.connectorSettings[name].lastTest if exposed, or via getSettings
  if (!last) return { dot: "blue", text: "Test connection ↗" };
  if (last.status === "ok") {
    const ageMs = Date.now() - Date.parse(last.at);
    if (ageMs < 86400_000) return { dot: "green", text: `tested ${formatRelativeTime(last.at)}` };
    return { dot: "amber", text: "Re-test recommended" };
  }
  if (last.status === "auth") return { dot: "red", text: "Key rejected — check and re-test" };
  return { dot: "red", text: "Provider unreachable" };
}
```

This needs `connectorSettings.{name}.lastTest` to flow into the SettingsDto. Update the readSettings function in `apps/desktop/src/main/ipc.ts` accordingly.

### Step 3: CSS append

```css
.connector-status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.connector-status-dot.grey { background: var(--muted); }
.connector-status-dot.yellow { background: var(--amber); }
.connector-status-dot.blue { background: var(--teal); }
.connector-status-dot.green { background: var(--green); }
.connector-status-dot.amber { background: var(--amber); }
.connector-status-dot.red { background: var(--coral); }
```

### Step 4: Test + typecheck + commit

```bash
npm test -w apps/desktop -- --run ConnectorsSection
npm run typecheck -w apps/desktop
git add apps/desktop/src/renderer/src/components/ConnectorsSection.tsx apps/desktop/src/renderer/src/components/ConnectorsSection.test.tsx apps/desktop/src/renderer/src/styles/app.css apps/desktop/src/main/ipc.ts
git commit -m "add-connector-test-button-and-status-indicators

Per-connector Test button calls the testConnector IPC and updates
the row's status dot + chip based on result. Eight visible states
(not-configured / fixture / configured-untested / working / stale /
auth-failed / unreachable / disabled-by-air-gap) — see design doc
Section 8."
```

---

## Phase 3 — Agent ergonomics

## Task 3.1: System prompt addition for pending-approval convention

**Why:** Agent needs to know how to handle `{ pending: true, approvalId }` tool results without retrying.

**Files:**
- Modify: `packages/core/src/identity.ts` (buildSystemPrompt — the conversation style block we added during the sidebar reorg session)
- Test: `packages/core/test/identity.test.ts`

### Step 1: Failing test

```typescript
it("system prompt teaches the agent the connector-call pending-approval convention", () => {
  database = freshDatabase();
  installSeedProfiles(database);
  activateProfile(database, "profile_seed_generic_business");
  const report = buildIdentityReport(database, new ToolRegistry());
  const prompt = buildSystemPrompt(report);
  expect(prompt).toMatch(/pending.*approval/i);
  expect(prompt).toMatch(/Do NOT retry/i);
});
```

### Step 2: Run to verify fail

### Step 3: Add to the system prompt

In `buildSystemPrompt`, append to the Conversation style block:

```typescript
lines.push(
  "- Connector pending-approval: if a connector tool returns { pending: true, approvalId, ... }, that's not an error — SquidBot is awaiting the operator's sign-off in the Approvals page. Surface this to the user in plain language (explain what you tried to do and that it's pending review). Do NOT retry the operation; the operator's approve/reject will flow back to you on a future message."
);
```

### Step 4: Run + commit

```bash
npm test -w packages/core -- --run identity
git add packages/core/src/identity.ts packages/core/test/identity.test.ts
git commit -m "teach-agent-pending-approval-convention

The conversation-style block in buildSystemPrompt now explains
{ pending: true, approvalId } as 'awaiting human sign-off', not
failure. Agent is instructed NOT to retry and to surface the
pending state to the user conversationally."
```

---

## Task 3.2: Runtime injects resolved-approvals system note

**Why:** When the user approves/rejects an approval, the agent picks it up on its next message via a small system-note injection.

**Files:**
- Modify: `packages/core/src/runtime.ts` (in `sendMessage`)
- Modify: `packages/core/test/runtime.test.ts`

### Step 1: Failing test

Sketch: send two messages, with an approval enqueued + resolved between them. Assert the second message's system messages include a "resolved approval" note referencing the right operation.

### Step 2: Implement

In `runtime.sendMessage`, before calling the model, check the queue:

```typescript
const lastSeen = this.lastResolvedAt.get(this.sessionId) ?? new Date(Date.now() - 60_000).toISOString();
const recentlyResolved = listResolvedSince(this.database, { sessionId: this.sessionId!, since: lastSeen });
if (recentlyResolved.length > 0) {
  const note = "Since your last message, the following connector calls were resolved:\n" +
    recentlyResolved.map((a) => `- ${a.payload.connectorName}.${a.payload.operationId} (${a.id}) — ${a.resolution!.toUpperCase()}`).join("\n");
  this.injectSystemNote(note);
  this.lastResolvedAt.set(this.sessionId, new Date().toISOString());
}
```

(The `injectSystemNote` helper appends a system-role message to the conversation history before generation. If a similar mechanism already exists for memory bulletins, use that.)

### Step 3: Run + commit

```bash
npm test -w packages/core -- --run runtime
git add packages/core/src/runtime.ts packages/core/test/runtime.test.ts
git commit -m "inject-resolved-approvals-as-system-note-on-send

Before generating each chat response, the runtime checks
pending_approvals for rows resolved since the last sendMessage for
this session and injects them as a system note. The agent reads
the resolutions and naturally reasons about them (e.g. 'great, the
github issue is now created — number 42')."
```

---

# Phase 4 — Manifest curation

## Task 4.1: Add `testEndpoint` to the four shipped manifests

**Why:** Make Test button validate auth specifically (not just "first read op happened to work").

**Files:**
- Modify: `connectors/demo/githubConnector.json`
- Modify: `connectors/demo/gitlabConnector.json`
- Modify: `connectors/demo/jiraConnector.json`
- Modify: `connectors/demo/jenkinsConnector.json`

### Step 1: Add the field to each

For github:
```json
"testEndpoint": { "method": "GET", "path": "/user" }
```
For gitlab:
```json
"testEndpoint": { "method": "GET", "path": "/user" }
```
For jira:
```json
"testEndpoint": { "method": "GET", "path": "/rest/api/3/myself" }
```
For jenkins:
```json
"testEndpoint": { "method": "GET", "path": "/me/api/json" }
```

### Step 2: Validate

```bash
node -e "console.log(JSON.parse(require('fs').readFileSync('connectors/demo/githubConnector.json','utf8')).testEndpoint)"
# repeat for each
npm test -w packages/connectors
```

Expected: each prints the expected `{method, path}`; manifest tests pass.

### Step 3: Commit

```bash
git add connectors/demo/*.json
git commit -m "add-test-endpoints-to-shipped-connector-manifests

Explicit testEndpoint values for the four shipped connectors so
the Test button validates auth specifically (returns authenticated
principal):
- github: GET /user
- gitlab: GET /user
- jira: GET /rest/api/3/myself
- jenkins: GET /me/api/json

Auto-fallback to first low-risk no-arg GET still works for any
connector without an explicit testEndpoint (e.g. future custom
connectors)."
```

---

# Final Phase 4 checkpoint

```bash
npm test --workspaces --if-present
npm run typecheck -w apps/desktop
```

Expected: full repo green.

# Acceptance criteria recheck

Go through the design doc Section 11 list. Each box should now be tickable:
- [ ] All 4 shipped connectors make real API calls when fixtureMode=false and a valid key is configured ✓ (Tasks 1.3 + 1.5)
- [ ] Test button returns ✓ within 5s with valid key, ✗ with auth/network error code with invalid key ✓ (Task 1.7 + 4.1)
- [ ] Write operation on `sensitive`-profile session enters Approvals queue ✓ (Tasks 1.2 + 1.5)
- [ ] All operations on `regulated`-profile session enter queue ✓ (Tasks 1.2 + 1.5)
- [ ] Active `air-gapped` profile blocks every real call ✓ (Tasks 1.2 + 1.5)
- [ ] Approve in Approvals page executes deferred call ✓ (Tasks 1.7 + 2.1)
- [ ] Reject marks approval rejected, agent sees rejection ✓ (Tasks 1.7 + 2.1 + 3.2)
- [ ] Agent surfaces `{ pending: true, … }` conversationally ✓ (Task 3.1)
- [ ] Status dot reflects real state per table ✓ (Task 2.2)
- [ ] All existing fixture-mode tests still pass ✓ (regression gate throughout)
- [ ] Navigation smoke test still passes ✓ (untouched)

---

## Done.

Full repo green. Shipped connectors actually call real APIs. Approvals queue gates risky operations per profile sensitivity. Agent surfaces pending state conversationally. The next session can pick up custom user-defined connectors (UI to add brand-new connectors at runtime) — the data layer already supports it.
