# Phase 2 — AI Studio v1 Design

**Date:** 2026-05-21 (brainstormed), 2026-05-22 (finalized)
**Status:** Approved — ready for implementation plan
**Roadmap home:** Phase 2 of `docs/plans/2026-05-18-vs-openclaw-hermes-roadmap.md`
**Implementation plan:** `docs/plans/2026-05-21-ai-studio-v1-plan.md` (to be authored by `superpowers:writing-plans`)

---

## Goal

Ship the AI Studio surface: a centralized control plane where users design, test, approve, deploy, and measure agent workflows ("Blueprints"). Beat OpenClaw and Hermes Agent on enterprise-readiness by giving every workflow a benchmark, an ROI estimate, a canary rollout, an audit trail, and a scope-bounded deployment — out of the box. Ship one fully-built proof-point Blueprint ("AI CEO Operations") in v1 so the value is concrete the moment a user opens the app.

## Architecture in one paragraph

A new top-level renderer surface (`StudioPage` at `apps/desktop/src/renderer/src/pages/StudioPage.tsx`) with 7 tabs (Catalog / Editor / Benchmarks / ROI Dashboard / Pilot Controls / Responsible AI / Scope), backed by a new TypeScript package (`@squidbot/blueprints`) that owns the Blueprint manifest type + CRUD + version history + install/uninstall + scope filtering. A Blueprint is a typed JSON manifest that **references existing entities** — agent roles from `@squidbot/team`, tools from the ToolRegistry, connectors from `@squidbot/connectors`, policies from `@squidbot/governance`, datasets from `@squidbot/evals` — and adds three forward-compatible field groups (`uiContributions`, `trainability`, `adaptivity`) that Phases 4 and 8 will consume without schema migration. Three new SQLite tables (`blueprints`, `blueprint_versions`, `blueprint_runs`), new IPC handlers, a React Flow canvas editor for the graph, and bundled fixture connectors for Gmail + Google Calendar that ship the AI CEO Ops Blueprint in fixture mode (zero-spend per reference §4.2).

## Tech stack

- **Existing:** Electron + React 19 + TypeScript + SQLite + Express (web bundle) + Vitest + Playwright + `@squidbot/*` workspace packages
- **New:** `@xyflow/react` (React Flow, ~30 KB MIT) for the canvas + `dagre` (~20 KB MIT) for auto-layout — both zero-spend
- **No new infrastructure** — Studio is renderer-side; backend is one new TypeScript package + three SQLite migrations

---

## Section 1 — Architecture overview

### 1.1 The Blueprint mental model

A Blueprint is not new code. It is a typed JSON manifest that **binds together existing pieces**:

```
Blueprint "AI CEO Operations"
├── agents:        [coordinator, email-triager, calendar-planner, briefing-writer]
│                  ↳ references @squidbot/team role manifests
├── tools:         [email.read, email.draft, calendar.read, calendar.write, ...]
│                  ↳ references ToolRegistry entries
├── connectors:    [gmail-fixture, gcal-fixture]
│                  ↳ references @squidbot/connectors manifests
├── policies:      [email-send-requires-approval, sensitive-data-redaction, ...]
│                  ↳ references @squidbot/governance policy packs
├── datasets:      [fixture-overnight-inbox-50, fixture-meeting-conflicts-20]
│                  ↳ fixture data for benchmarks
├── benchmarks:    [triage-accuracy ≥0.85, reply-draft-tone-match ≥0.75, ...]
│                  ↳ @squidbot/evals dataset manifests + metric targets
├── kpis:          [emails_triaged_per_day, drafts_accepted_rate, ...]
│                  ↳ business outcome targets
├── rollout:       { status: draft|pilot|stable, canary_percent, ... }
│                  ↳ @squidbot/evals canary state
└── audit:         [every change tracked via existing audit ledger]
                   ↳ @squidbot/governance
```

This is the operational pattern reference §5.10 names "the PwC adoption funnel": strategic workflow → Studio design → reusable components → benchmarks → adoption → governance.

### 1.2 The Studio surface — 7 tabs

The 7 tabs map directly to reference §6.15's capability groups:

1. **Catalog** — browse + install + export Blueprints (default landing). One row per installed Blueprint with status chip, version, last-modified, scope summary.
2. **Editor** — node-graph canvas (React Flow + dagre auto-layout) for the selected Blueprint. Read-only if status is `stable`; clone to `draft` to edit.
3. **Benchmarks** — runs `@squidbot/evals` benchmark suite against current Blueprint version. Pass/fail per metric, leaderboard position vs prior versions.
4. **ROI Dashboard** — KPI definitions + actual values pulled from trace events + variance + computed business-value estimate.
5. **Pilot Controls** — canary % slider, gradual rollout (5% → 25% → 100%), halt-on-failure rule, user feedback collection.
6. **Responsible AI** — policy attachment per Blueprint + per-Blueprint red-team test results (per-Blueprint scope; org-wide Responsible AI Center defers to Phase 7).
7. **Scope** — department/tenant/role/user-level access controls per Blueprint via existing `@squidbot/governance` ABAC.

### 1.3 Backend boundary

- **New package:** `@squidbot/blueprints` — manifest TypeScript types + JSON-schema validator + `BlueprintRegistry` class + install/uninstall/save/promote/rollback methods.
- **New DB tables:** `blueprints` (mutable identity row) + `blueprint_versions` (immutable history) + `blueprint_runs` (per execution).
- **New IPC handlers:** `listBlueprints`, `getBlueprint`, `saveBlueprint`, `deleteBlueprint`, `installBlueprint`, `exportBlueprint`, `promoteBlueprint`, `rollbackBlueprint`, `runBenchmarkSuite`, `listLeaderboard`, `submitFeedback`.
- **New top-level nav item** in `App.tsx` between Briefing and Chat: `{ id: "studio", label: "Studio", icon: Sparkles }`.

### 1.4 Why a new package, not extending existing ones

Blueprints reference 5+ existing entity types. Placing Blueprint logic inside any one of them creates a circular dependency (or forces one package to know about the others). A dedicated package is the seam — it imports from all five upstream packages, exposes a clean Blueprint surface to the runtime + UI, and contains all install/version/promote logic in one well-tested boundary.

---

## Section 2 — Components + sub-phase breakdown

Work splits into **7 sub-phases (2A–2G)**, each shipping in ~1–1.5 weeks. Same A-E sub-phase pattern Phase 1 used. Total: ~46 commits, 7-9 weeks of focused work via subagent-driven execution.

### 2A. Blueprint manifest + storage backend *(~1 week, ~6 commits)*

- Create `packages/blueprints/` with `package.json`, `tsconfig.json`, `src/index.ts`
- Manifest TypeScript types + JSON-schema validator (rejects malformed JSON, missing required fields, unresolved references)
- `BlueprintRegistry` class — in-memory map keyed by slug, persisted via `SquidDatabase`
- DB migration 19 — `blueprints` table (id, slug, name, manifest_json, status, current_version, created_at, updated_at) + `blueprint_versions` table (id, blueprint_id, version, manifest_json, created_at, created_by) + `blueprint_runs` table (id, blueprint_id, version, run_type, result_json, started_at, completed_at)
- `SquidDatabase` methods — `saveBlueprint`, `listBlueprints`, `getBlueprint`, `deleteBlueprint`, `listBlueprintVersions`, `promoteBlueprint`, `rollbackBlueprint`
- IPC handlers wired in `apps/desktop/src/main/ipc.ts`
- **Acceptance:** a Blueprint can be installed from a JSON file, persisted, listed, and exported back to JSON byte-equivalent. Manifest schema rejects malformed JSON with clear error messages.

### 2B. Studio top-level page + Catalog tab *(~1 week, ~5 commits)*

- `StudioPage` component at `apps/desktop/src/renderer/src/pages/StudioPage.tsx` with 7-tab shell
- New nav item in `App.tsx` between Briefing and Chat
- Catalog tab content — list of installed Blueprints with status chip, version, last-modified, scope summary
- Install / Import button — paste manifest JSON or upload `.json` file
- Export button — per-Blueprint download as `.json`
- Empty state — onboarding hint pointing at the upcoming AI CEO Ops install in 2E
- Vitest tests — Catalog renders, install/export round-trip, nav works
- **Acceptance:** user opens Studio → lands on Catalog → imports a Blueprint manifest → it appears in the list with correct metadata.

### 2C. Node-graph canvas editor *(~1.5 weeks, ~8 commits)*

- Add deps: `@xyflow/react` + `dagre` to `apps/desktop/package.json` (both MIT, zero-spend)
- `CanvasEditor` component at `apps/desktop/src/renderer/src/components/CanvasEditor.tsx`
- Custom node types: `AgentNode`, `ToolNode`, `ConnectorNode`, `PolicyNode`, `DatasetNode`, `BenchmarkNode` (six types in v1; plugin extensibility defers — see Section 5)
- Custom edge types: `DataFlowEdge`, `ControlFlowEdge`, `ApprovalGateEdge`
- Auto-layout via `dagre` with fixed seed for determinism
- Save-to-Blueprint: serialize canvas state into manifest's `graph` field
- Load-from-Blueprint: deserialize manifest's `graph` field into canvas
- Read-only mode when `rollout.status === "stable"` (must clone to `draft` to edit)
- Vitest tests via `@testing-library/react` — node interactions, save/load roundtrip, dagre layout deterministic
- **Acceptance:** user opens a Blueprint → sees its workflow as nodes + edges → edits → saves → exported JSON matches canvas state byte-for-byte. Dagre layout produces identical `{x,y}` coordinates across test runs.

### 2D. Fixture Gmail + Calendar connectors *(~1 week, ~5 commits)*

- New manifest connectors at `connectors/builtin/gmail-fixture.json` + `connectors/builtin/gcal-fixture.json`
- Fixture data: synthetic inbox of 50 emails (urgent / routine / spam / questions / FYI) + synthetic calendar of 20 events (conflicts / today / future / past)
- Gmail endpoints: `list_inbox`, `get_email`, `search`, `draft`, `send` (approval-gated), `archive`
- GCal endpoints: `list_events`, `get_event`, `search`, `create`, `update`, `delete` (all approval-gated)
- Fixture mode default — returns deterministic synthetic data, no `Date.now()`, no randomness
- Real-mode placeholder — OAuth wiring defers to Phase 5 (Connector Builder)
- Vitest tests — fixture responses deterministic, schemas validate, all writes blocked without approval
- **Acceptance:** `gmail-fixture.list_inbox` returns same 50 emails every call; `gmail-fixture.send` requires explicit approval before fixture write occurs.

### 2E. AI CEO Ops Blueprint *(~1 week, ~7 commits)*

- New `blueprints/builtin/ai-ceo-ops/` directory with `manifest.json` + `README.md` + `benchmarks/` + `fixtures/`
- Agent roles: `coordinator`, `email-triager`, `calendar-planner`, `briefing-writer` (manifests under `@squidbot/team`)
- Tools: references fixture connector ops from 2D + existing memory/reflection tools
- Policies: `email-send-requires-approval`, `sensitive-data-redaction`, `read-only-by-default`
- Benchmark suite: `triage-accuracy ≥0.85`, `reply-tone-match ≥0.75`, `briefing-actionable-items ≥3 per day`, `calendar-conflict-resolution-rate ≥0.90`
- KPI targets: `emails_triaged_per_day`, `drafts_accepted_rate`, `briefings_delivered_on_time_rate`, `meetings_rescheduled_per_day`
- "Install AI CEO Ops Blueprint" wizard in Studio Catalog
- Briefing page wiring: Phase 1's empty Briefing slots now populate from the Blueprint's runs when installed
- Vitest + integration tests — Blueprint installs, benchmarks pass against fixtures, Briefing page shows real numbers
- **Acceptance:** user installs Blueprint → opens canvas → sees 4 agent roles + connections → runs benchmarks → all targets pass → promotes to pilot → Briefing page updates within current session.

### 2F. Benchmark runner + Promotion/Rollback + KPI/ROI dashboard *(~1.5 weeks, ~7 commits)*

- Benchmarks tab — runs `@squidbot/evals` benchmark suite against current Blueprint version
- Results visualization — pass/fail per metric, comparison vs baseline (previous version's results), leaderboard position
- Promotion wizard — `draft` → `pilot` (canary % slider, default 10%) → `stable`
- ROI dashboard tab — KPI definition + actual values from trace events + variance + business-value estimate (`actual × businessValuePerUnit`)
- Rollback button — re-activates previous version, audit entry chained
- Vitest + integration tests — benchmark + promotion + rollback all produce chained-hash audit entries
- **Acceptance:** click "Promote to stable" → canary runs in audit ledger → if benchmarks pass, promotion completes; if they fail, rollback fires + audit entry created. Audit chain hash verifies end-to-end after each operation.

### 2G. Pilot controls + feedback + scope + leaderboards + final polish *(~1.5 weeks, ~8 commits)*

- Pilot Controls tab — canary % slider, gradual rollout schedule (5% → 25% → 100%), halt-on-failure rule
- User feedback collection — per-Blueprint-run thumbs up/down + comments, stored in `blueprint_runs.result_json.feedback`
- Skill/workflow leaderboards — top-N variants by metric across Blueprint version history
- Scope tab — department/tenant/role/user access controls per Blueprint (uses existing ABAC + identity store)
- Deployment readiness checklist — gating function before promotion enabled (all benchmarks ≥ baseline + policies attached + scope set + audit chain valid)
- Responsive treatment — Studio's 7 tabs work mobile/tablet/desktop per Phase 1 pattern (canvas is **view-only below tablet** — see Section 5)
- 5-layer test extension complete — Vitest + Playwright web-smoke + touch-targets + a11y + 25 visual baselines
- **Acceptance:** pilot launched at 5% → feedback collected → leaderboard shows variants ranked by metric → scope restricts Blueprint to one department → `npm run test:responsive` passes including all new Studio coverage.

**Total Phase 2:** ~46 commits across 7 sub-phases. ~7-9 weeks via subagent-driven cycle.

---

## Section 3 — Data flow + new entities

### 3.1 Three new entity types

| Entity | Lifetime | Stored where | Mutable? |
|---|---|---|---|
| **`Blueprint`** | Conceptual identity (slug, display name, owner) | `blueprints` table | Yes (status, current version, scope) |
| **`BlueprintVersion`** | Immutable snapshot of the manifest at a point in time | `blueprint_versions` table | **No** — every save creates a new version |
| **`BlueprintRun`** | One execution (benchmark / pilot / production / reflection) | `blueprint_runs` table | Result only; not retroactively edited |

Same pattern the eval pipeline already uses (skill / skill_version / skill_evaluation).

### 3.2 Blueprint manifest schema (stable contract for Phases 2 / 4 / 8)

```typescript
type BlueprintManifest = {
  // ─── Identity ───
  name: string;
  slug: string;
  version: string;                        // semver
  description: string;
  owner: string;                          // user id or "system"
  tags: string[];

  // ─── The graph (canvas state) ───
  graph: {
    nodes: GraphNode[];                   // AgentNode | ToolNode | ConnectorNode | PolicyNode | DatasetNode | BenchmarkNode
    edges: GraphEdge[];                   // DataFlowEdge | ControlFlowEdge | ApprovalGateEdge
    layout?: Record<string, {x: number, y: number}>;
  };

  // ─── References to existing entities ───
  agentRoles: AgentRoleRef[];             // @squidbot/team role manifests
  tools: ToolRef[];                       // ToolRegistry entries
  connectors: ConnectorRef[];             // @squidbot/connectors manifests
  policies: PolicyRef[];                  // @squidbot/governance policy packs
  datasets: DatasetRef[];                 // fixture/eval datasets

  // ─── Benchmarks + KPIs (Phase 2F) ───
  benchmarks: BenchmarkTarget[];          // { datasetId, metric, threshold, baseline? }
  kpis: KpiTarget[];                      // { name, target, unit, businessValuePerUnit }

  // ─── Rollout state (Phase 2F) ───
  rollout: {
    status: "draft" | "pilot" | "stable" | "archived";
    canaryPercent?: number;               // 0–100
    haltOnFailure: boolean;
    previousVersion?: string;
  };

  // ─── Scope (Phase 2G — uses existing identity store) ───
  scope: {
    tenants?: string[];
    departments?: string[];
    roles?: string[];
    users?: string[];
  };

  // ─── STABLE-CONTRACT FIELDS for Phases 4 + 8 (stored now, consumed later) ───

  // UI contributions (Phase 8 consumes; Phase 2 only stores)
  uiContributions?: {
    dashboardWidgets?: WidgetRef[];       // additive widgets on Briefing
    sidebarItems?: SidebarItemRef[];      // additive nav items
    pageOverlays?: PageOverlayRef[];      // tabs/sections contributed to existing pages
    themes?: ThemeRef[];                  // color/density preferences
    homeScreen?: string;                  // override Briefing for users scoped here
  };

  // Trainability hooks (Phase 4 consumes; Phase 2 only stores)
  trainability?: {
    feedbackTargets: string[];            // which agent outputs collect ratings
    mutationCandidates: string[];         // skill ids autonomy loop may mutate
    promotionGate: "manual" | "auto-with-benchmark" | "auto-with-eval+rollback";
    rollbackOnBenchmarkRegression: boolean;
  };

  // Adaptive behavior (Phase 4 consumes; Phase 2 only stores)
  adaptivity?: {
    reflectionTrigger: ReflectionTriggerPolicy;
    memoryNudgeFrequency?: string;        // "daily" | "weekly" | "manual" | "after_N_runs"
    affordanceGapPolicy: "log-only" | "auto-propose-skill" | "block-on-detection";
  };

  // ─── Audit ───
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  auditTrail: BlueprintAuditEntry[];      // chained-hash entries
};
```

**Why the three forward-compatible field groups matter:**

- **Trainable** — `trainability` tells Phase 4's autonomy loop what's safe to mutate. Without it, autonomy is reckless.
- **Customizable UI** — `uiContributions` lets a Blueprint add sidebar items, widgets, page overlays. Phase 8 reads these to generate adaptive UI. Phase 2 only stores them.
- **Adaptive over time** — `adaptivity` controls reflection fire policy, memory nudges, affordance gap handling. Phase 4 consumes.

### 3.3 Data flow — install through promote

```
1.  User opens Studio → Catalog tab
2.  User clicks "Install AI CEO Ops Blueprint"
3.  Studio reads bundled manifest from blueprints/builtin/ai-ceo-ops/manifest.json
4.  @squidbot/blueprints.BlueprintRegistry.install()
        ├── validates manifest against JSON schema
        ├── checks for collisions (slug already installed?)
        ├── resolves references (do all agentRoles + tools + connectors + policies + datasets exist?)
        ├── installs missing dependencies (e.g. gmail-fixture connector)
        ├── creates row in `blueprints` table (status="draft")
        ├── creates version 1.0.0 in `blueprint_versions` (immutable)
        ├── emits audit event: `blueprint.installed`
        └── returns the Blueprint record
5.  User navigates to Editor tab → canvas loads the manifest's graph
6.  User edits a node (e.g. tweaks email-triager agent's policy)
7.  User clicks "Save"
        ├── canvas state serialized to a new manifest
        ├── new version 1.0.1 created in `blueprint_versions`
        ├── `blueprints.currentVersion` updated to "1.0.1"
        ├── audit event: `blueprint.edited`
        └── canvas reloads (round-trip verified)
8.  User clicks "Run benchmarks"
        ├── @squidbot/blueprints calls @squidbot/evals.benchmarkRunner
        ├── reads BenchmarkTarget[] from manifest
        ├── runs the agent team against each dataset
        ├── produces BlueprintRun row in `blueprint_runs`
        ├── compares against baseline (previous version's results)
        └── displays pass/fail per metric in Benchmarks tab
9.  All benchmarks pass → "Promote to pilot" button enables
10. User clicks "Promote to pilot (canary 10%)"
        ├── @squidbot/blueprints calls @squidbot/evals.canary
        ├── rollout.status = "pilot", canaryPercent = 10
        ├── audit event: `blueprint.promoted`
        ├── for users scoped, 10% of new sessions use the pilot version
        └── ROI dashboard accumulates real KPI values
11. Canary metrics meet criteria after threshold
        ├── auto-promote to stable (or manual gate per trainability.promotionGate)
        ├── rollout.status = "stable", canaryPercent = 100
        └── audit event: `blueprint.stable`
```

Failure paths at every step emit audit events + rollback flows wired via `@squidbot/evals.rollback`.

### 3.4 BlueprintRun → existing trace events

Every Blueprint execution emits standard SquidBot trace events. Nothing new:
- `agent.task.started` / `completed`
- `tool.called` / `completed`
- `model.invoked` / `completed`
- `memory.read` / `written`
- `policy.checked` / `denied`
- `audit.entry` — with new `event_type` values: `blueprint.installed`, `blueprint.edited`, `blueprint.promoted`, `blueprint.rolled_back`, `blueprint.benchmark_run`, `blueprint.canary_metric`

Every Blueprint run is auditable via the existing audit-ledger infrastructure. Compliance officers (Phase 7) don't need a new ledger — they query the same one.

### 3.5 Audit ledger integration

Every Blueprint state change creates a chained-hash audit entry (supported by `@squidbot/governance`):

```typescript
type BlueprintAuditEntry = {
  id: string;
  blueprintSlug: string;
  blueprintVersion: string;
  eventType: "installed" | "edited" | "benchmark_run" | "promoted" | "rolled_back" | "uninstalled" | "scope_changed";
  actor: string;                          // user id
  timestamp: string;
  prevHash: string;                       // links to previous entry
  hash: string;                           // sha256(prevHash + this entry's fields)
  payload: Record<string, unknown>;
};
```

Retroactive edit invalidates every subsequent hash. Existing audit-export tools verify the chain.

### 3.6 Scope integration with existing ABAC

```typescript
function visibleBlueprints(user: User, allBlueprints: Blueprint[]): Blueprint[] {
  return allBlueprints.filter(bp => {
    if (bp.scope.users?.length && !bp.scope.users.includes(user.id)) return false;
    if (bp.scope.tenants?.length && !bp.scope.tenants.includes(user.tenantId)) return false;
    if (bp.scope.departments?.length && !bp.scope.departments.includes(user.department)) return false;
    if (bp.scope.roles?.length && !user.roles.some(r => bp.scope.roles!.includes(r))) return false;
    return true;
  });
}
```

Studio Catalog shows only visible Blueprints. Studio Editor refuses to load a Blueprint outside scope. Trace events log scope checks.

### 3.7 UI contribution hooks (stored now, consumed by Phase 8)

```json
{
  "uiContributions": {
    "dashboardWidgets": [
      { "id": "ai-ceo-overnight", "label": "Overnight activity", "source": "blueprint:ai-ceo-ops", "position": "briefing.overnight" }
    ],
    "sidebarItems": [
      { "id": "ai-ceo-inbox", "label": "Inbox triage", "icon": "Inbox", "blueprint": "ai-ceo-ops", "requiresRole": ["admin", "user"] }
    ],
    "pageOverlays": [
      { "page": "settings", "tab": "blueprints", "blueprint": "ai-ceo-ops" }
    ]
  }
}
```

**Phase 2 commitment:** store + validate. **Phase 8 will:** read from all installed Blueprints + active enterprise profile + current user's role, generate the adapted sidebar / dashboard / overlays. Per reference §6.16: AI-generated UI is reviewable + editable + versioned + reversible.

### 3.8 Trainability hooks (stored now, consumed by Phase 4)

```typescript
async function maybeMutateSkill(skillId: string, reflection: Reflection): Promise<void> {
  const owningBlueprints = await blueprintsContainingSkill(skillId);
  for (const bp of owningBlueprints) {
    if (!bp.trainability) continue;
    if (!bp.trainability.mutationCandidates.includes(skillId)) continue;
    if (reflection.failureMode === "irrecoverable") continue;
    if (bp.trainability.promotionGate === "auto-with-eval+rollback") {
      const mutation = await mutationProposer.propose(skillId, reflection);
      const benchmark = await benchmarkRunner.compare(skillId, mutation);
      if (benchmark.passed) {
        await promote(skillId, mutation.version);
      } else if (bp.trainability.rollbackOnBenchmarkRegression) {
        await rollback(skillId);
      }
    }
  }
}
```

### 3.9 Adaptive behavior hooks (stored now, consumed by Phase 4)

```typescript
function shouldFireReflection(blueprintRun: BlueprintRun, blueprint: Blueprint): boolean {
  if (!blueprint.adaptivity) return defaultReflectionPolicy(blueprintRun);
  const policy = blueprint.adaptivity.reflectionTrigger;
  // per reference §10.1: fire on multi-tool task, long runtime, plan revision,
  // repeated failure, user correction, high-risk op, scheduled job complete, PR/deploy
  return /* applies policy */;
}
```

### 3.10 Per-Blueprint affordance gaps + memory partitioning

Each Blueprint gets:
- Own affordance gap log (existing `@squidbot/reflection` partitioned by `blueprintSlug`)
- Optional memory domain (subset of memory graph visible only when this Blueprint runs)

Cross-Blueprint memory access requires explicit user grant (audit-logged).

### 3.11 Summary diagram

```
                    ┌─────────────────────────────────────┐
                    │       Blueprint Manifest            │
                    │  ┌─────────────────────────────┐    │
                    │  │ Graph (nodes + edges)       │    │
                    │  │ References (agents, tools,  │    │
                    │  │   connectors, policies)     │    │
                    │  │ Benchmarks + KPIs           │    │
                    │  │ Rollout state + scope       │    │
                    │  │ uiContributions (Ph. 8)     │    │
                    │  │ trainability (Ph. 4)        │    │
                    │  │ adaptivity (Ph. 4)          │    │
                    │  └─────────────────────────────┘    │
                    └─────────────────────────────────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
         BlueprintVersion   BlueprintRun    Audit ledger
         (immutable)        (per execution) (chained-hash)
                │                 │                 │
                ▼                 ▼                 ▼
         @squidbot/evals  Existing trace   @squidbot/governance
         benchmarkRunner  event taxonomy   (existing)
         canary
         rollback
```

---

## Section 4 — Testing strategy

Phase 1 established **5 test layers** that run cleanly: Vitest unit, Playwright web-smoke, Playwright touch-targets, Playwright a11y, Playwright visual-regression. Phase 2 extends those layers to cover the Studio surface, plus one new layer: **end-to-end integration tests** for the install → edit → benchmark → promote → rollback state machine.

### 4.1 Layer-by-layer extension

| Layer | Phase 1 baseline | Phase 2 addition |
|---|---|---|
| **Vitest unit** | 120 tests across 31 files | `@squidbot/blueprints` package — manifest validator, registry, version history, install/uninstall, scope filtering. Component tests for `StudioPage` + each of 7 tabs + `CanvasEditor` via `@testing-library/react`. |
| **Playwright web-smoke** | 3 tests verifying renderer reaches API over HTTP | `/studio` route loads, Catalog tab renders, install-from-JSON round-trips, navigating between tabs preserves state. |
| **Playwright touch-targets** | 9 tests asserting 44×44 hit area | Studio's controls (canvas toolbar, node-handle drag targets, tab buttons, install/export buttons, slider thumbs) all clear 44×44. |
| **Playwright a11y** | 3 tests via `@axe-core/playwright` at mobile/tablet/desktop | Studio gets the same axe scan at each breakpoint. Canvas needs explicit `aria-label`s on nodes since they're divs, not native widgets. |
| **Playwright visual-regression** | 5 baselines (Briefing × 5 widths) | 25 new baselines: Catalog (empty + populated), Editor (canvas with AI CEO Ops loaded), Benchmarks, ROI dashboard, Pilot Controls — each × 5 widths. |

### 4.2 New integration test layer

End-to-end critical path runs in Vitest with a real SQLite test DB + in-memory IPC (avoids browser overhead for backend-heavy flows):

```
1. installBlueprint("ai-ceo-ops")              → row in blueprints, version 1.0.0 in blueprint_versions
2. getBlueprint("ai-ceo-ops")                  → returns manifest matching what was installed
3. runBenchmarks("ai-ceo-ops")                 → BlueprintRun row, benchmark.passed: true
4. promoteBlueprint("ai-ceo-ops", "pilot", 10) → audit entry chained, rollout.status: "pilot"
5. simulate canary failure                     → triggers rollback
6. rollback                                    → previous version restored, audit chain intact
7. verifyAuditChain                            → sha256 chain validates end-to-end
```

This is one test file (`packages/blueprints/test/install-promote-rollback.test.ts`) but covers the riskiest cross-package interaction in Phase 2.

### 4.3 Determinism guarantees (critical for `npm run test:responsive` staying flake-free)

- **Fixture connectors** (Gmail-fixture, GCal-fixture) return identical data every call — no `Date.now()`, no randomness, no real network. Timestamps synthesized via a `--seed` parameter.
- **React Flow auto-layout via dagre** runs with a fixed seed → identical `{x, y}` coordinates per Blueprint per test run.
- **Audit ledger hashes** use a test-mode clock injected via dependency injection so chained hashes are reproducible.
- **Benchmark runner** uses fixture-only datasets in tests — no live model calls. Local Ollama or deterministic stub.

### 4.4 Coverage gates (subagent-driven cycle, same pattern as Phase 1)

For each sub-phase 2A-2G commit:
- New exported function in `@squidbot/blueprints` requires a Vitest test (PR-blocking gate via existing pre-commit hook)
- New React component requires `@testing-library/react` test
- New IPC handler requires a Vitest integration test
- Each sub-phase ends with `npm run test:responsive` passing as final acceptance gate

---

## Section 5 — Out of scope for v1

### 5.1 Capability-level deferrals (each has a phase home in the v2 roadmap)

| Out of v1 | Home phase | Rationale |
|---|---|---|
| **Real OAuth Gmail/Calendar wiring** | Phase 5 (Connector Builder UI) | Per reference §4.2 zero-spend rule. Fixture mode proves workflow without burning paid APIs while Blueprint is still draft. |
| **Connector Builder UI** (point-and-click new connector creation) | Phase 5 | v1's connectors are manifest-authored (JSON files in `connectors/builtin/`). UI authoring is its own 4-6 week feature. |
| **Adaptive Enterprise Profile UI** (AI-generated sidebar/dashboards from `uiContributions`) | Phase 8 | Phase 2 *stores* `uiContributions`. Phase 8 *consumes*. The schema commitment is intentional — it lets Phase 8 plug in without migration. |
| **Self-improvement / autonomy loop** consuming `trainability` + `adaptivity` | Phase 4 | Same pattern — stored now, consumed later. v1 promotes Blueprints via manual benchmark gate, not autonomous mutation. |
| **Digital twins** (multiple agent personas per role) | Phase 10 | One agent per role in v1. Twin orchestration is its own capability. |
| **Federated governance** (cross-tenant audit verification + cross-org Blueprint sharing) | Phase 13 | v1 is single-tenant. |
| **Voice + Menu-bar surface** | Phase 9 | Studio is desktop-renderer-first in v1. |
| **Responsible AI Center** (org-wide red-team console, model card registry, bias dashboards) | Phase 7 | Per-Blueprint Responsible AI tab in Studio (2F) covers Blueprint-level concerns. Org-wide center is separate. |

### 5.2 Engineering nice-to-haves deferred

YAGNI in v1. Each would push the ship date out by weeks:

- **Undo/redo on the canvas.** v1 has explicit save → new version. To undo, promote a prior version from the version history dropdown.
- **Real-time multi-user collaboration on a Blueprint.** Single-user editor in v1. Audit ledger captures who edited what.
- **Visual diff of Blueprint versions.** v1 shows version JSON in a text-diff view. Node-level visual diff is polish.
- **Blueprint forking/branching by slug.** One slug, one Blueprint, one current version. "Clone to edit" creates a draft sibling without a `branch_of` field.
- **Internationalization.** English-only in v1.
- **Mobile canvas editing.** Studio renders responsively on mobile, but the canvas is **view-only below 768px**. Touch-drag on a 375px viewport is poor authoring UX; we don't pretend otherwise. Mobile users can browse Catalog, view Benchmarks, view ROI, but editing requires ≥768px.
- **Plugin system for custom node types.** Six built-in types in v1.
- **Outgoing webhooks for Blueprint events.** Events emit to internal trace bus + audit ledger. External webhook integration defers to Phase 12 (Messaging adapter expansion).
- **Blueprint marketplace / public sharing.** "Export to JSON file" + "Import from JSON file" is the only sharing mechanism in v1.
- **Performance optimization for hundreds of nodes.** v1 targets ~20-40 nodes per Blueprint (AI CEO Ops is 12). 200-node Blueprints are a v1.1 concern.

### 5.3 Scope-drift patterns to flag during execution

(Citing reference §3.3 anti-goals — patterns to catch in subagent-driven spec compliance review)

- "While I'm in `CanvasEditor.tsx`, let me also add..." — No. Each sub-phase 2A-2G has tight acceptance criteria; drift gets caught at spec compliance review.
- "Studio should also have a chat-shaped..." — No. Studio is design-time. The chat surface stays chat-shaped (reference §3.3).
- "Let me make the Blueprint manifest more flexible just in case..." — No. The forward-compatible fields (`uiContributions`, `trainability`, `adaptivity`) are explicitly bounded. New top-level fields require schema migration + version bump.
- "This deserves a dedicated package..." — No. `@squidbot/blueprints` is the one new package. Related logic stays inside it.

---

## Pre-design verification (done 2026-05-21, re-verified 2026-05-22)

All architectural checks passed before this design was finalized:

| Check | Result |
|---|---|
| `@squidbot/evals` exposes 14 modules Blueprints reference | ✅ |
| `@squidbot/skills` exposes manifest + service + types | ✅ (5 exports) |
| `@squidbot/team` exposes `RoleRegistry`, `validateRoleManifest`, manifests | ✅ (13 exports) |
| `@squidbot/connectors` manifest schema supports Gmail/Calendar shape | ✅ (10 exports) |
| `@squidbot/governance` ABAC + audit infrastructure available | ✅ (20 exports) |
| Zero DB table name collisions (`blueprints`, `blueprint_versions`, `blueprint_runs` are new) | ✅ |
| Zero IPC channel collisions for `blueprint*`/`studio*` | ✅ |
| Workspace pattern picks up new `packages/blueprints` automatically | ✅ |
| Phase 1 test infrastructure (5 layers) extends cleanly | ✅ all green: 120 Vitest, 20 Playwright |

**Result:** Phase 2 is implementable as designed. No refactor of existing packages needed — pure additive work.

---

## Execution path

After this design ships, invoke `superpowers:writing-plans` to produce the implementation plan at `docs/plans/2026-05-21-ai-studio-v1-plan.md`. That plan will break each sub-phase 2A-2G into bite-sized TDD tasks (failing test → minimal code → passing test → commit) for subagent-driven execution.

Estimated time-to-ship: 7-9 weeks subagent-driven across sub-phases 2A-2G, totaling ~46 commits.
