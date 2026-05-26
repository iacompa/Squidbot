# Connector real-HTTP transport — design

**Date:** 2026-05-17
**Status:** Design approved; awaiting writing-plans handoff.
**Scope:** Wire the four shipped connectors (github, gitlab, jira, jenkins) to make real HTTP calls against their providers' APIs, gated by the active profile's sensitivity. Approval-required operations queue in the existing Approvals page rather than executing silently. Custom user-defined connectors are explicitly out of scope (separate session).

**Related:**
- `docs/plans/2026-05-17-security-roadmap.md` — broader security agenda (S1–S4) deferred to other sessions.
- `docs/plans/2026-05-15-sidebar-reorg-design.md` — the Approvals queue this design plugs into was built there.

---

## 1. Problem

Today, none of the shipped connectors actually call real APIs. The execution path in `packages/connectors/src/tools.ts:101-111` looks like this when `fixtureMode: false`:

```typescript
return {
  ...,
  mode: "dry-run",
  executed: false,
  reason: "Real connector transport is intentionally dry-run in this phase unless a reviewed adapter is added."
};
```

So setting a real API key on a connector and asking SquidBot to use it results in… nothing. The UI implies the connector "works" once a key is set; in fact every call is a silent no-op. The user noticed during the Integrations-page review: *"the ones that are there I'm not even sure if those work or not are if they are demo connectors"* — entirely correct, because they don't.

At the same time, real HTTP from an AI agent is a sharp tool. Once `tools.ts` actually fires `fetch()`, the agent can create GitHub issues, merge pull requests, fire Jenkins builds — without an approval step between LLM-generated intent and irreversible side effect, that's a major safety regression. The previous Phase 2 work built an Approvals queue infrastructure expecting exactly this kind of integration; the `PendingApprovalDto.kind` discriminator was reserved for future approval kinds like `"connector-call"`.

This design wires both: the real HTTP transport, and the approval-queue safety net.

---

## 2. Decisions

Captured via brainstorming with the user on 2026-05-17:

| Decision | Choice |
|---|---|
| Priority of "make defaults work" vs "custom connectors" | **Real transport first.** Custom connectors deferred to a separate session. |
| Approval policy for write/risky operations | **Queue in the existing Approvals page**, tied to the active profile's sensitivity level. |
| Test-connection mechanism | **Explicit `testEndpoint` in manifest with auto-fallback** to the first low-risk no-arg GET op. |
| Approach | **B** — HTTP transport + Approvals queue integration. Connector-spend telemetry rendering in Trust report is a follow-up. |
| Broader security asks (PIN, account ownership, team sharing, DB encryption) | Captured in `2026-05-17-security-roadmap.md` as separate brainstorming items. NOT in this design. |

---

## 3. Architecture

### 3.1 Component map

```
   tools.ts (callConnectorEndpoint, currently dry-run on fixtureMode=false)
              │
              ▼
   sensitivityPolicy.ts  (NEW)
              │
   ┌──────────┼──────────┐
   │          │          │
"execute"  "queue"     "deny"
   │          │          │
   ▼          ▼          ▼
 httpTransport.ts   approvalQueue       return AirGapDenied
       │            .enqueue()
       ▼                │
  fetch + parse        ▼
       │       Pending row in DB
       ▼                │
  ToolResult     Approvals page
                shows row + Approve
                       │
                       ▼
              approveConnectorCall IPC
                       │
                       ▼ (dispatcher)
               httpTransport.ts
                       │
                       ▼
              result stored + event
```

### 3.2 New / changed files

| File | Type | Purpose |
|---|---|---|
| `packages/connectors/src/sensitivityPolicy.ts` | NEW | Pure function deriving `"execute" \| "queue" \| "deny"` from `(profileSensitivity, endpoint, manifest)`. |
| `packages/connectors/src/httpTransport.ts` | NEW | The `executeRealHttpCall` function — path templating, auth, body, response parsing, error normalization. |
| `packages/connectors/src/approvalQueue.ts` | NEW | Thin wrapper over `database.savePendingApproval` + `database.resolvePendingApproval` for the `connector-call` kind. |
| `packages/connectors/src/tools.ts` | MODIFY | Replace the dry-run stub with the policy switch. |
| `packages/connectors/src/manifest.ts` | MODIFY | Add optional `testEndpoint?: { method: string; path: string }` to the manifest schema. |
| `apps/desktop/src/shared/api.ts` | MODIFY | Extend `PendingApprovalDto.kind` union + payload. Add `testConnector` to `SquidbotApi`. |
| `apps/desktop/src/main/ipc.ts` | MODIFY | Add IPC handlers: `testConnector`, `approveConnectorCall`, `rejectConnectorCall`. Update `listPendingApprovals` to surface the new kind. |
| `apps/desktop/src/preload/index.ts` | MODIFY | Expose the new IPC methods. |
| `apps/desktop/src/renderer/src/components/ConnectorsSection.tsx` | MODIFY | Add Test button + status dot/chip per connector card. |
| `apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx` | MODIFY | Render the `connector-call` kind with operation summary + Approve/Reject. |
| `packages/core/src/identity.ts` (system prompt builder) | MODIFY | 2–3 lines explaining the `{ pending: true, approvalId }` tool-result convention to the agent. |
| `packages/core/src/runtime.ts` | MODIFY | On `sendMessage`, look up recently-resolved approvals for this session and surface them as a system note. |
| `connectors/demo/githubConnector.json` etc. | MODIFY | Add `testEndpoint` field to each of the 4 shipped manifests. |
| `packages/db/src/migrations.ts` | MODIFY | New migration: `pending_approvals` table (if not already present — Task 2.1 mapped to active sandboxes; this design promotes it to a real table). |

### 3.3 The `pending_approvals` table

Task 2.1 implemented `listPendingApprovals` as a façade over `database.listSandboxes({status:"active"})` — there was no dedicated table because sandboxes were the only approval kind. This design adds a real table:

```sql
CREATE TABLE pending_approvals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('sandbox-promotion', 'connector-call')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  riskLevel TEXT NOT NULL CHECK(riskLevel IN ('low', 'medium', 'high')),
  payload TEXT NOT NULL,           -- JSON-serialized kind-specific data
  callerSessionId TEXT,
  callerRunId TEXT,
  createdAt TEXT NOT NULL,
  resolvedAt TEXT,
  resolution TEXT CHECK(resolution IN ('approved', 'rejected') OR resolution IS NULL),
  resultJson TEXT                  -- the HTTP response when approved+executed
);
CREATE INDEX idx_pending_approvals_unresolved ON pending_approvals(createdAt) WHERE resolvedAt IS NULL;
CREATE INDEX idx_pending_approvals_session ON pending_approvals(callerSessionId);
```

The `listPendingApprovals` IPC now reads from this table (still composes sandbox-promotion rows from `listSandboxes`, but new approvals land here directly).

---

## 4. Sensitivity policy

| Profile sensitivity | Read ops | Write ops | `requiresApproval: true` override | Air-gap rule |
|---|---|---|---|---|
| `standard` | execute | execute | queue | — |
| `sensitive` | execute | queue | queue | — |
| `regulated` | queue | queue | queue | — |
| `air-gapped` | **deny** | **deny** | deny | All real HTTP disabled regardless of key — fixture mode forced. |

A read vs write classification comes from the existing `manifest.readWrite.read[]` / `manifest.readWrite.write[]` arrays in every shipped manifest. The per-operation `requiresApproval: true` is an **upgrade override** — an op flagged as approval-required queues regardless of profile (so `mergePullRequest` always queues, even on `standard`).

Function shape:

```typescript
type PolicyDecision =
  | { mode: "execute" }
  | { mode: "queue"; reason: string; riskLevel: "low" | "medium" | "high" }
  | { mode: "deny"; reason: string };

function decide(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  profileSensitivity: ProfileSensitivity
): PolicyDecision;
```

Air-gapped profile returns `deny` for *any* `fixtureMode: false` call — but `tools.ts` still has the fixture-mode branch as a fallback, so an air-gapped user can still test connectors with mock data. They just can't make real outbound calls.

---

## 5. HTTP transport (`httpTransport.ts`)

Single exported function:

```typescript
async function executeRealHttpCall(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  args: JsonObject,
  settings: ConnectorRuntimeSettings,
  options?: { timeoutMs?: number }
): Promise<HttpCallResult>;
```

`ConnectorRuntimeSettings` is `{ baseUrl: string; apiKey: string | null }` — both read from the settings table by `tools.ts` before calling the transport.

`HttpCallResult` is a discriminated union:

```typescript
type HttpCallResult =
  | { ok: true; status: number; durationMs: number; body: JsonObject | string }
  | { ok: false; code: "auth" | "forbidden" | "not_found" | "rate_limit" | "server_error" | "timeout" | "network" | "unknown";
      status?: number; durationMs: number; message: string };
```

Internal steps:

1. **Path templating.** `applyTemplate("/repos/{owner}/{repo}/issues", args)` produces the URL and returns the residual args (those not consumed by `{x}` placeholders).
2. **Auth header** (read from `manifest.auth.type`):
   - `bearer` → `Authorization: Bearer ${apiKey}`
   - `basic` → `Authorization: Basic ${base64("x:" + apiKey)}` (the "x" username convention works for GitHub PATs, GitLab PATs, Atlassian API tokens, and most modern providers)
   - `apiKey` → header name from `manifest.auth.headerName` (default `X-API-Key`), value `${apiKey}`
   - `none` → no auth header
3. **Body**: for `POST` / `PUT` / `PATCH`, the residual args go in the JSON body. For `GET` / `DELETE`, residual args appended as query-string params.
4. **Fetch** with 30s default timeout (configurable via `options.timeoutMs`), `AbortController` wired in.
5. **Response parsing.** JSON if `content-type: application/json`, plain text otherwise. Empty body → `{}`.
6. **Error normalization.**
   - `401` → `code: "auth"`
   - `403` → `code: "forbidden"`
   - `404` → `code: "not_found"`
   - `429` → `code: "rate_limit"` (include `Retry-After` header in message if present)
   - `5xx` → `code: "server_error"`
   - `AbortError` → `code: "timeout"`
   - Other fetch errors → `code: "network"`
7. **Event emission.** Every call emits one event:
   ```
   connector.http_call {
     connectorName, operationId, method, path,
     status, durationMs, mode: "real", ok
   }
   ```
   No request body, no response body — keep sensitive data out of the trace. Future trust-report work can aggregate these into "Connector spend" / "Connector activity" surfaces.

---

## 6. Approvals queue integration

When `sensitivityPolicy.decide(...)` returns `{ mode: "queue" }`:

1. `tools.ts` calls `approvalQueue.enqueue(...)`:

   ```typescript
   const approvalId = approvalQueue.enqueue({
     kind: "connector-call",
     title: `Allow ${manifest.name}.${endpoint.operationId}?`,
     summary: summarizeArgsSafely(args),     // truncates secrets, formats for human read
     riskLevel: deriveRiskFromPermission(endpoint, manifest),
     payload: {
       connectorName: manifest.name,
       operationId: endpoint.operationId,
       args,
       callerSessionId: context.sessionId,
       callerRunId: context.runId
     }
   });
   ```

2. The tool returns to the agent:
   ```typescript
   return {
     pending: true,
     approvalId,
     reason: "Awaiting your approval — see Approvals page.",
     connector: manifest.name,
     operation: endpoint.operationId
   };
   ```

3. The agent's system prompt gets a small addition (Phase 3):
   > "When a connector tool returns `{ pending: true, approvalId, … }`, that's not a failure — SquidBot needs the operator's sign-off before performing this action. Surface this to the user in plain language: explain what you tried to do, that it's awaiting their approval in the Approvals page, and that you'll continue once they review it. Do NOT retry the operation yourself."

4. The Approvals page (already exists, was built in the prior sidebar-reorg work) gets a small renderer addition for the `connector-call` kind: shows `title` + `summary` + risk chip + Approve / Reject buttons.

5. **Click "Approve"** → `squidbot:approveConnectorCall(approvalId)` IPC:
   - Looks up the row in `pending_approvals`.
   - Calls `httpTransport.executeRealHttpCall(...)` with the stored args + current settings.
   - Stores the result in `pending_approvals.resultJson`, marks `resolution = "approved"`, sets `resolvedAt`.
   - Emits `connector.approved-call` event for the trace (with caller's sessionId + runId in the payload so trace search can correlate).
   - Returns the result to the renderer for UI feedback.

6. **Click "Reject"** → `squidbot:rejectConnectorCall(approvalId, reason?)`:
   - Marks `resolution = "rejected"`, sets `resolvedAt`.
   - Stores the optional reason in `resultJson` for audit.
   - Emits `connector.rejected-call` event.

7. **Agent picks up the resolution on next chat turn.** In `runtime.sendMessage`, before generating the next response, look up any approvals resolved since the last message for this session. If any, prepend a system note to the conversation:

   > "SYSTEM: Since your last message, the following connector calls were resolved:
   > - `github.createIssue` (approvalId: ap_xxx) — APPROVED, result: { number: 42, … }
   > - `jenkins.triggerBuild` (approvalId: ap_yyy) — REJECTED by operator."

   The agent can now reason about and respond to those resolutions naturally ("Great, the GitHub issue is created — number 42").

---

## 7. Test connection

UI: a **Test** button on each connector card in `Integrations → Connectors`. Mechanics:

1. Renderer clicks Test → `squidbot:testConnector(connectorName)` IPC.
2. Handler resolves the test endpoint:
   - **Explicit:** if `manifest.testEndpoint = { method, path }` is set, use it directly.
   - **Auto fallback:** scan `manifest.endpoints` for the first entry where:
     - `method === "GET"`
     - `endpoint.permission` resolves to a permission with `riskLevel === "low"`
     - path has no `{placeholders}` (or all placeholders are listed in `manifest.testDefaults` — extension point)
   - If neither resolves → return `{ ok: false, code: "no_test_op", message: "Connector has no eligible no-arg GET; configure manifest.testEndpoint" }`.
3. Run through `httpTransport.executeRealHttpCall(...)` with `{}` args. Same code path real ops use → green check on Test ≈ "operations of this risk level work."
4. Persist result to `settings`:
   - `${connectorName}.lastTest.status` → `"ok"` / `"auth"` / `"timeout"` / etc.
   - `${connectorName}.lastTest.at` → ISO timestamp.
   - `${connectorName}.lastTest.message` → human-readable message if not ok.
5. Return result to renderer; status dot/chip updates immediately.

For the four shipped manifests, add `testEndpoint`:

| Manifest | `testEndpoint` |
|---|---|
| github | `{ method: "GET", path: "/user" }` |
| gitlab | `{ method: "GET", path: "/user" }` |
| jira | `{ method: "GET", path: "/rest/api/3/myself" }` |
| jenkins | `{ method: "GET", path: "/me/api/json" }` |

These all return the authenticated principal — a 200 means the key works AND the base URL is correct.

---

## 8. Status indicators per connector card

| Visible state | Trigger | Dot | Chip text |
|---|---|---|---|
| Not configured | `fixtureMode: false` AND no `apiKey` | Grey | "Add a key to use this" |
| Fixture mode | `fixtureMode: true` (shipped default) | Yellow | "Mock data — toggle off for real" |
| Configured, untested | Key set, never tested | Blue | "Test connection ↗" (clickable) |
| ✓ Working | `lastTest.status === "ok"` AND `lastTest.at < 24h` ago | Green | `tested ${time-ago}` |
| ⚠ Stale | `lastTest.status === "ok"` AND `lastTest.at >= 24h` ago | Amber | "Re-test recommended" |
| ✗ Auth failed | `lastTest.status === "auth"` | Red | "Key rejected — check and re-test" |
| ✗ Unreachable | `lastTest.status === "timeout" \| "network"` | Red | "Provider unreachable" |
| 🔒 Disabled (air-gapped) | Active profile is `air-gapped` | Padlock | "Real calls disabled by profile sensitivity" |

The dot is a single colored circle next to the connector name. No other visual noise — each row is one line with the existing operation pills below.

---

## 9. Implementation phases

**Phase 1 — Backend transport + sensitivity policy** (no UI changes)
1. New `sensitivityPolicy.ts` with pure-function tests for the policy matrix.
2. New `httpTransport.ts` with unit tests (mocked fetch) covering all auth types + all error codes.
3. New `approvalQueue.ts` + `pending_approvals` table migration.
4. Replace the dry-run stub in `tools.ts` with the policy switch.
5. Extend `PendingApprovalDto` `kind` union + payload.
6. New IPC: `testConnector`, `approveConnectorCall`, `rejectConnectorCall`. `listPendingApprovals` now reads from the new table (still composes sandbox-promotion rows).
7. Integration test: queue → approve → execute round-trip.

**Phase 2 — UI surfacing** (depends on Phase 1)
1. Update Approvals page row renderer to handle `connector-call` kind: title, summary, risk chip, Approve/Reject calling the new IPCs.
2. Update Integrations → Connectors tab: Test button per row, status dot/chip from `${connectorName}.lastTest`.
3. Tests for both surfaces.

**Phase 3 — Agent ergonomics** (depends on Phase 1, parallel-safe with Phase 2)
1. System prompt addition explaining `{ pending: true, approvalId }` convention.
2. Runtime injects a system note about resolved approvals at the start of each `sendMessage`.
3. Test the agent's behaviour on a real "you create issue → approval pending → user approves → next message" cycle.

**Phase 4 — Manifest curation** (anywhere after Phase 1)
1. Add `testEndpoint` to each of the 4 shipped connector manifests.
2. Light spot-check of paths and auth types against current provider API docs.

Each phase is independently shippable. Strict order: 1 → (2 || 3), with 4 anywhere after 1.

---

## 10. Out of scope (deferred)

- **Custom user-defined connectors** (UI to add brand-new connectors at runtime). The data layer supports it; the UI is its own session.
- **OAuth / device-code flows.** v1 supports `bearer`, `basic`, and `apiKey` header types only.
- **Webhook ingestion.** Connectors call OUT only.
- **Per-operation cost tracking.** Events emit duration/status but no money. Most v1 connectors are free.
- **Connector marketplace.** Connectors ship with the app.
- **Trust-report connector-spend rendering.** Events fire (data exists) but the UI panel is a follow-up.
- **S1–S4 security roadmap** (PIN, account ownership, team sharing, DB encryption). See `2026-05-17-security-roadmap.md`.

---

## 11. Acceptance criteria

The work is complete when:

- [ ] All 4 shipped connectors (github, gitlab, jira, jenkins) make real API calls when `fixtureMode: false` and a valid key is configured.
- [ ] Test button returns ✓ within 5 seconds with a valid key, ✗ with a clear auth/network error code with an invalid key.
- [ ] Write operation on a `sensitive`-profile session enters the Approvals queue instead of executing.
- [ ] All operations on a `regulated`-profile session enter the queue (reads + writes).
- [ ] Active `air-gapped` profile blocks every real call regardless of key — fixture mode is forced.
- [ ] Clicking Approve in the Approvals page actually executes the deferred call and stores the result.
- [ ] Clicking Reject marks the approval rejected, agent sees the rejection on next turn.
- [ ] Agent surfaces `{ pending: true, … }` tool results in plain conversational language.
- [ ] Status dot reflects real state per the table in Section 8.
- [ ] All existing fixture-mode tests still pass.
- [ ] Navigation smoke test still passes.

---

## 12. Next step

Hand off to `superpowers:writing-plans` to produce a detailed task-by-task implementation plan from this design.
