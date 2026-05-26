# Phase 2 (AI Studio v1) — Brainstorm Progress / Session Handoff

**Date:** 2026-05-21 (created), 2026-05-22 (Section 3 added)
**Purpose:** This document captures the exact state of an in-progress brainstorming session so a fresh Claude Code session can resume without re-asking questions or re-reading prior context.
**Worktree:** `~/Projects/SquidBot 2/.claude/worktrees/frosty-williamson-817c25`
**Branch:** `claude/frosty-williamson-817c25`

---

## 0. Where you are (start here, fresh session)

You're mid-brainstorm on **Phase 2 (AI Studio v1)** of the SquidBot roadmap. The brainstorm follows `superpowers:brainstorming` (6-step checklist). State:

| Step | Status |
|---|---|
| 1. Explore project context | ✅ Done |
| 2. Ask clarifying questions | ✅ Done (2 key questions answered) |
| 3. Propose 2-3 approaches | ✅ Done (Approach A picked) |
| 4. Present design in sections | ⚠ **In progress — Sections 1 + 2 + 3 approved, Sections 4-5 pending** |
| 5. Write design doc | ⏳ Pending — output goes to `docs/plans/2026-05-21-ai-studio-v1-design.md` |
| 6. Hand off to `superpowers:writing-plans` | ⏳ Pending |

**Your next action when you resume:** Present Section 4 (testing strategy) to the user. Then Section 5 (out of scope). Then write the design doc and invoke writing-plans.

**NEW REQUIREMENT (added 2026-05-22):** the user wants SquidBot to be **trainable to do whatever user(s) want — customizable UI + functionality + adaptive over time**. This maps to existing v2 roadmap phases (functional customization = Phase 2 / 3 / 5; UI customization = Phase 8 Adaptive Enterprise Profile UI; adapt-over-time = Phase 4 Autonomy loop). Section 3's Blueprint manifest schema was designed with **three forward-compatible field groups** (`uiContributions`, `trainability`, `adaptivity`) so Phases 4 + 8 plug in without breaking schema migrations.

---

## 1. The bigger picture (one-paragraph context)

SquidBot is a local-first agent operating system (positioning: "the agent operating system you can trust, inspect, govern, and improve"). Phase 1 (responsive UI + Briefing home + web bundle) shipped 31 commits ending 2026-05-21, all green tests, fully verified. The strategic roadmap was reconciled against the authoritative reference docs (`docs/FUTURE_READY_AGENT_REFERENCE.md` and `FUTURE_READY_AGENT_EXECUTION_PLAN.md`) on 2026-05-21 and now has 13 phases. Phase 2 is **AI Studio v1** — the centralized control plane for designing, testing, approving, deploying, and measuring agent workflows (reference §6.15). Neither OpenClaw nor Hermes Agent ships anything like this; it's the headline differentiator.

---

## 2. Answers locked in from clarifying questions

| Question | User's answer |
|---|---|
| First Blueprint to ship as proof point? | **AI CEO Operations** (email triage + calendar mgmt + briefing + proactive tasks) |
| Editor style? | **Node-graph canvas** (React Flow / `@xyflow/react`) |
| Scope of v1? | **Approach A — Big v1** (full §6.15: all 16 sub-features, 8-10 weeks) |
| Real vs fixture connectors in v1? | **Fixture mode** (per reference §5.12 zero-spend rule); real OAuth follows when user adds credentials |

These four answers shape every downstream decision in the design.

---

## 3. Approved design sections

### Section 1 — Architecture overview *(approved)*

The AI Studio is **a new top-level surface** in the desktop renderer + **a new typed entity** (`Blueprint`) in the database + **a new backend package** (`@squidbot/blueprints`) that orchestrates references to existing entities.

**The Blueprint mental model:**

A Blueprint is **not new code** — it's a typed manifest that **binds together existing pieces**:

```
Blueprint "AI CEO Operations"
├── agents:        [coordinator, email-triager, calendar-planner, briefing-writer]
│                  ↳ references to @squidbot/team role manifests
├── tools:         [email.read, email.draft, calendar.read, calendar.write, ...]
│                  ↳ references to ToolRegistry entries
├── connectors:    [gmail-fixture, gcal-fixture]
│                  ↳ references to @squidbot/connectors manifests
├── policies:      [email-send-requires-approval, sensitive-data-redaction, ...]
│                  ↳ references to @squidbot/governance policy packs
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

**The Studio surface** has 7 tabs that map to §6.15 capability groups:
1. **Catalog** — browse + install + share Blueprints (default landing)
2. **Editor** — node-graph canvas for the selected Blueprint
3. **Benchmarks** — eval datasets + benchmark runner + leaderboards
4. **ROI Dashboard** — KPIs + measurable business value per Blueprint
5. **Pilot Controls** — canary rollout, feedback collection, deployment readiness checklist
6. **Responsible AI** — policy attachment, red-team tests (per-Blueprint defers to Phase 7)
7. **Scope** — department/tenant access controls per Blueprint

**Backend boundary:**
- New package `@squidbot/blueprints` (manifest validation, CRUD, install/uninstall, install from URL/file)
- New DB tables: `blueprints` + `blueprint_versions` (immutable history)
- New IPC handlers: list / get / install / uninstall / save / promote / rollback / runBenchmark / listLeaderboard / submitFeedback
- New top-level nav item in App.tsx between Briefing and Chat: "Studio" (icon: `Sparkles`)

**Why a new package, not extending existing ones:**
Blueprints reference 5+ existing entity types. Putting Blueprint logic inside any one of them creates a circular dep or forces one package to know about all the others. A dedicated package is the seam — it imports from all five, exposes a clean Blueprint surface to the runtime + UI.

### Section 2 — Components + sub-phase breakdown *(approved)*

The work splits into **7 sub-phases (2A–2G)** each shipping in ~1–1.5 weeks. Same pattern Phase 1 used (A–E sub-phases).

#### 2A. Blueprint manifest + storage backend *(~1 week, ~6 commits)*

- New package `@squidbot/blueprints` — manifest TypeScript types + JSON-schema validator + `BlueprintRegistry` class
- DB migration 19 — `blueprints` table (id, name, slug, manifest_json, status, version, created_at, updated_at) + `blueprint_versions` table (immutable history)
- `SquidDatabase` methods — CRUD: save / list / get / delete / listVersions / promote / rollback
- IPC handlers — `listBlueprints`, `getBlueprint`, `saveBlueprint`, `deleteBlueprint`, `installBlueprint`, `exportBlueprint`, `promoteBlueprint`, `rollbackBlueprint`
- Tests — manifest validation rejects malformed JSON; storage roundtrips; version history preserved
- **Acceptance** — A Blueprint can be installed from a JSON file, persisted, listed, and exported back to JSON byte-equivalent

#### 2B. Studio top-level page + Catalog tab *(~1 week, ~5 commits)*

- New `StudioPage` component at `apps/desktop/src/renderer/src/pages/StudioPage.tsx`
- New nav item in App.tsx between Briefing and Chat: `{ id: "studio", label: "Studio", icon: Sparkles }`
- Catalog tab content — list of installed Blueprints (name, description, status chip, version, last-modified)
- Install / Import button — paste manifest JSON or upload `.json` file
- Export button — per-Blueprint download as `.json`
- Empty state — onboarding hint pointing at the upcoming AI CEO Ops install in 2E
- Tests — Catalog renders, install/export round-trip, navigation works
- **Acceptance** — User opens Studio → lands on Catalog → can import a Blueprint manifest and see it appear

#### 2C. Node-graph canvas editor *(~1.5 weeks, ~8 commits)*

- New dep: React Flow (`@xyflow/react`) — ~30 KB minified, MIT, zero-spend
- `CanvasEditor` component at `apps/desktop/src/renderer/src/components/CanvasEditor.tsx`
- Custom node types — `AgentNode`, `ToolNode`, `ConnectorNode`, `PolicyNode`, `DatasetNode`, `BenchmarkNode`
- Custom edge types — `DataFlowEdge`, `ControlFlowEdge`, `ApprovalGateEdge`
- Auto-layout via `dagre` (also free, ~20 KB)
- Save-to-Blueprint — serialize canvas state into Blueprint manifest
- Load-from-Blueprint — deserialize manifest to canvas
- Read-only mode for `stable` Blueprints (must clone to `draft` to edit)
- Tests — render, node interactions, save/load roundtrip, dagre layout deterministic
- **Acceptance** — User opens a Blueprint → sees its workflow as nodes + edges → can edit + save → exported JSON matches canvas state byte-for-byte

#### 2D. Fixture Gmail + Calendar connectors *(~1 week, ~5 commits)*

- New manifest connectors at `connectors/builtin/gmail-fixture.json` + `connectors/builtin/gcal-fixture.json`
- Fixture data — synthetic inbox of 50 emails (urgent / routine / spam / questions / FYI) + synthetic calendar of 20 events (conflicts / today / future / past)
- Gmail endpoints — `list`, `get`, `search`, `draft`, `send` (approval-gated), `archive`
- GCal endpoints — `list`, `get`, `search`, `create`, `update`, `delete` (all approval-gated)
- Fixture mode by default — returns deterministic synthetic data
- Real-mode placeholder — OAuth wiring defers to a future sub-phase
- Tests — fixture responses deterministic, schemas validate, all writes blocked without approval
- **Acceptance** — `gmail-fixture.list_inbox` returns same 50 emails every time; `gmail-fixture.send` requires explicit approval

#### 2E. AI CEO Ops Blueprint *(~1 week, ~7 commits)*

- New `blueprints/builtin/ai-ceo-ops/` directory with `manifest.json` + `README.md` + `benchmarks/` + `fixtures/`
- Agent roles — `coordinator`, `email-triager`, `calendar-planner`, `briefing-writer`
- Tools — references fixture connector ops from 2D + existing memory/reflection tools
- Policies — `email-send-requires-approval`, `sensitive-data-redaction`, `read-only-by-default`
- Benchmark suite — `triage-accuracy ≥0.85`, `reply-tone-match ≥0.75`, `briefing-actionable-items ≥3 per day`, `calendar-conflict-resolution-rate ≥0.90`
- KPI targets — `emails_triaged_per_day`, `drafts_accepted_rate`, `briefings_delivered_on_time_rate`, `meetings_rescheduled_per_day`
- "Install AI CEO Ops Blueprint" wizard in Studio Catalog
- Briefing page wiring — Phase 1's empty Briefing slots now populate from the Blueprint's runs when installed
- Tests — Blueprint installs, benchmarks pass against fixtures, Briefing page shows real numbers
- **Acceptance** — User installs Blueprint → opens canvas → sees 4 agent roles + connections → runs benchmarks → all targets pass → promotes to pilot → Briefing page updates

#### 2F. Benchmark runner + Promotion/Rollback + KPI/ROI dashboard *(~1.5 weeks, ~7 commits)*

- Benchmarks tab — runs `@squidbot/evals` benchmark suite against current Blueprint
- Results visualization — pass/fail per metric, comparison vs baseline, leaderboard position
- Promotion wizard — draft → pilot (canary % slider, default 10%) → stable
- ROI dashboard tab — KPI definition + actual values from trace events + variance + business-value computed estimate
- Rollback button — re-activate previous version with audit entry
- Tests — benchmark + promotion + rollback all auditable in chained-hash ledger
- **Acceptance** — Click "Promote to stable" → canary runs in audit ledger → if benchmarks pass, promotion completes; if they fail, rollback fires + audit entry created

#### 2G. Pilot controls + feedback + scope + leaderboards + final polish *(~1.5 weeks, ~8 commits)*

- Pilot Controls tab — canary % slider, gradual rollout (5% → 25% → 100%), halt-on-failure rule
- User feedback collection — per-Blueprint-run thumbs up/down + comments
- Skill/workflow leaderboards — top-N variants by metric
- Scope tab — department/tenant access controls per Blueprint (uses existing ABAC + identity store)
- Deployment readiness checklist — gating function before promotion enabled
- Responsive treatment — Studio's 7 tabs work mobile-tablet-desktop (Phase 1 pattern)
- 5-layer test extension — Vitest + Playwright + a11y + visual baselines + touch targets
- **Acceptance** — Pilot launched at 5% → feedback collected → leaderboard shows variants → scope restricts Blueprint to one department; Studio passes `npm run test:responsive`

**Total Phase 2:** ~46 commits across 7 sub-phases. ~7-9 weeks of focused work. Subagent-driven cycle same as Phase 1.

### Section 3 — Data flow + new entities *(approved 2026-05-22)*

#### 3.1 Three new entity types

| Entity | Lifetime | Stored where | Mutable? |
|---|---|---|---|
| **`Blueprint`** | Conceptual identity (slug, display name, owner) | `blueprints` table | Yes (status, current version, scope) |
| **`BlueprintVersion`** | Immutable snapshot of the manifest at a point in time | `blueprint_versions` table | **No** — every save creates a new version |
| **`BlueprintRun`** | One execution (benchmark / pilot / production / reflection) | `blueprint_runs` table | Result only; not retroactively edited |

Same pattern eval pipeline already uses (skill / skill_version / skill_evaluation).

#### 3.2 Blueprint manifest schema (stable contract for Phases 2 / 4 / 8)

```typescript
type BlueprintManifest = {
  // Identity
  name: string;
  slug: string;
  version: string;                        // semver
  description: string;
  owner: string;                          // user id or "system"
  tags: string[];

  // The graph (canvas state)
  graph: {
    nodes: GraphNode[];                   // AgentNode | ToolNode | ConnectorNode | PolicyNode | DatasetNode | BenchmarkNode
    edges: GraphEdge[];                   // DataFlowEdge | ControlFlowEdge | ApprovalGateEdge
    layout?: Record<string, {x: number, y: number}>;
  };

  // References to existing entities
  agentRoles: AgentRoleRef[];             // @squidbot/team role manifests
  tools: ToolRef[];                       // ToolRegistry entries
  connectors: ConnectorRef[];             // @squidbot/connectors manifests
  policies: PolicyRef[];                  // @squidbot/governance policy packs
  datasets: DatasetRef[];                 // fixture/eval datasets

  // Benchmarks + KPIs (Phase 2F)
  benchmarks: BenchmarkTarget[];          // { datasetId, metric, threshold, baseline? }
  kpis: KpiTarget[];                      // { name, target, unit, businessValuePerUnit }

  // Rollout state (Phase 2F)
  rollout: {
    status: "draft" | "pilot" | "stable" | "archived";
    canaryPercent?: number;               // 0–100
    haltOnFailure: boolean;
    previousVersion?: string;
  };

  // Scope (Phase 2G — uses existing identity store)
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

  // Audit ledger
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

#### 3.3 Data flow — install through promote

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

#### 3.4 BlueprintRun → existing trace events

Every Blueprint execution emits standard SquidBot trace events. Nothing new:
- `agent.task.started` / `completed`
- `tool.called` / `completed`
- `model.invoked` / `completed`
- `memory.read` / `written`
- `policy.checked` / `denied`
- `audit.entry` — but new event_type values: `blueprint.installed`, `blueprint.edited`, `blueprint.promoted`, `blueprint.rolled_back`, `blueprint.benchmark_run`, `blueprint.canary_metric`

**Why this matters:** every Blueprint run is auditable via the existing audit-ledger infrastructure. Compliance officers (Phase 7) don't need a new ledger — they query the same one.

#### 3.5 Audit ledger integration

Every Blueprint state change creates a chained-hash audit entry (already supported by `@squidbot/governance`):

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

**Tamper-evident:** retroactive edit invalidates every subsequent hash. Existing audit-export tools verify the chain.

#### 3.6 Scope integration with existing ABAC

The `scope` field plugs into the existing `@squidbot/governance` ABAC engine:

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

#### 3.7 UI contribution hooks (stored now, consumed by Phase 8)

When a Blueprint installs with `uiContributions.sidebarItems`, the renderer **could** display those items. Phase 2 stores the data; Phase 8 consumes it via the UI generator.

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

#### 3.8 Trainability hooks (stored now, consumed by Phase 4)

Phase 4 autonomy loop consults `blueprint.trainability` to know what's allowed:

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

#### 3.9 Adaptive behavior hooks (stored now, consumed by Phase 4)

```typescript
function shouldFireReflection(blueprintRun: BlueprintRun, blueprint: Blueprint): boolean {
  if (!blueprint.adaptivity) return defaultReflectionPolicy(blueprintRun);
  const policy = blueprint.adaptivity.reflectionTrigger;
  // per reference §10.1: fire on multi-tool task, long runtime, plan revision,
  // repeated failure, user correction, high-risk op, scheduled job complete, PR/deploy
  return /* applies policy */;
}
```

#### 3.10 Per-Blueprint affordance gaps + memory partitioning

Each Blueprint gets:
- Own affordance gap log (existing `@squidbot/reflection` partitioned by blueprintSlug)
- Optional memory domain (subset of memory graph visible only when this Blueprint runs)

Cross-Blueprint memory access requires explicit user grant (audit-logged).

#### 3.11 Summary diagram

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

## 4. Pre-design verification (done 2026-05-21, all green)

Before writing the design doc, I verified the Phase 2 plan fits the existing codebase. All checks passed:

| Verification | Result |
|---|---|
| `@squidbot/evals` exposes all 14 modules Blueprints will reference | ✅ confirmed in `packages/evals/src/index.ts` |
| `@squidbot/skills` exposes manifest + service + types | ✅ confirmed in `packages/skills/src/index.ts` |
| `@squidbot/team` exposes 10 classes + 17 types (incl. `RoleRegistry`, `validateRoleManifest`, `AgentRoleManifest`, `TeamManifest`) | ✅ confirmed in `packages/team/src/index.ts` |
| `@squidbot/connectors` manifest schema supports Gmail/Calendar shape (auth, endpoints, fixtureMode, fixtureData) | ✅ confirmed against `connectors/demo/githubConnector.json` |
| Zero DB table name collisions (`blueprints`, `blueprint_versions` are new) | ✅ confirmed against `packages/db/src/migrations.ts` (~30 existing tables) |
| Zero IPC channel collisions (no `Blueprint`-prefixed channels exist) | ✅ confirmed against `apps/desktop/src/main/ipc.ts` |
| Workspace pattern picks up new package automatically (`packages/*` glob) | ✅ confirmed in root `package.json` |
| Phase 1 test infrastructure (Vitest + Playwright + a11y + visual + touch) extends cleanly | ✅ all 5 layers already in place |

**Result:** Phase 2 is implementable as designed. No refactor of existing packages needed — pure additive work.

---

## 5. Sections still pending (resume here)

When you resume this brainstorm in a fresh session, **present these to the user in order**:

### Section 4 — Testing strategy (pending)

Cover:
- Vitest unit tests for `@squidbot/blueprints` (manifest validator, registry, version history)
- Vitest tests for StudioPage + each tab + CanvasEditor
- Playwright smoke tests for the Studio web-bundle path
- Playwright a11y tests for Studio at mobile/tablet/desktop
- Playwright visual regression baselines for the Studio surface
- Touch-target audit for Studio's controls
- Integration tests: install Blueprint → benchmark → promote → rollback end-to-end

### Section 5 — Out of scope for v1 (pending)

Cover (per reference §3.3 + §20.3):
- Real OAuth Gmail/Calendar wiring (fixture mode only in v1)
- Connector Builder UI (Phase 5 of v2 roadmap)
- Adaptive Enterprise Profile UI (Phase 8)
- Digital twins (Phase 10)
- Federation (Phase 13)
- Visual workflow editor for non-Blueprint things (chat surface stays chat-shaped)
- Marketplace for blueprints (community sharing defers to Phase 13)

### Then write design doc

After all sections are approved, write `docs/plans/2026-05-21-ai-studio-v1-design.md` (combining Sections 1-5) and commit. Then invoke `superpowers:writing-plans` to produce the implementation plan, which lives at `docs/plans/2026-05-21-ai-studio-v1-plan.md`.

After that, the user chooses execution mode (subagent-driven in same session vs parallel session) per the writing-plans skill's terminal handoff.

---

## 6. Useful state for the resumed session

### What's already done (committed)

```
3421efa  reconcile-roadmap-v2-against-future-ready-reference-docs
10ca9ed  verify-phase-1-acceptance-44-of-47-met-3-documented-deviations
01f78a8  add-test-responsive-aggregator-script           (Phase 1 E.4)
055981c  add-visual-regression-baselines-for-briefing-page (Phase 1 E.3)
... 28 more Phase 1 commits ...
3690b3a  plan-responsive-ui-briefing-home-and-web-reach   (Phase 1 plan)
```

### Test state

- 100 Vitest test files, **435 tests passing**, 0 failures
- 20 Playwright tests passing (web-smoke 3 + touch-targets 9 + a11y 3 + visual 5)
- Renderer import audit clean
- Build clean
- `npm run test:responsive` works end-to-end

### The reference docs that drive the design

- `~/Projects/SquidBot 2/docs/FUTURE_READY_AGENT_REFERENCE.md` (3,250 lines)
- `~/Projects/SquidBot 2/docs/FUTURE_READY_AGENT_EXECUTION_PLAN.md` (3,524 lines)

Phase 2 specifically draws from:
- §6.15 (AI Studio capabilities — 16 sub-features the Studio must ship)
- §5.10 (PwC enterprise adoption pattern — the 6-stage lifecycle Studio embodies)
- §5.12 (Vertical Blueprint Library — what blueprints look like)
- §6.12 (Business + enterprise operating layer — RBAC/ABAC integration)
- §3.3 (Anti-goals — what NOT to build in v1)

### Working directory + branch

```
cd "~/Projects/SquidBot 2/.claude/worktrees/frosty-williamson-817c25"
git status   # should be clean
git log --oneline -5   # most recent commits
```

### Quick verification before starting Section 3

```bash
# 1. Confirm clean working tree
git status

# 2. Confirm tests still pass
npm test --workspace=@squidbot/desktop -- --run 2>&1 | tail -3
# Expected: Test Files 31 passed, Tests 120 passed

# 3. Confirm web bundle still works
npm run web:serve --workspace=@squidbot/desktop &
sleep 3
curl -s -X POST http://localhost:8080/api/listModelAccounts -H 'content-type: application/json' -d '{"args":[]}' | head -1
kill %1 2>/dev/null
# Expected: {"accounts":[],"activeAccountName":null}

# 4. Confirm the existing eval/skill/team backends are intact (they are — but worth verifying)
grep "^export" packages/evals/src/index.ts | wc -l   # Expected: 14
grep "^export" packages/team/src/index.ts | wc -l    # Expected: 11
```

---

## 7. Resume script for a fresh Claude session

If you're a fresh Claude opening this file: greet the user briefly, confirm you've read this doc, then **present Section 3 (data flow + new entities) for approval**. Do NOT re-ask the clarifying questions that are already answered above. Do NOT re-propose approaches. Do NOT re-verify what's already verified in §4 above unless something has changed in the codebase (run the verification commands in §6 if you want to be sure).

After Sections 3, 4, 5 are approved:
1. Write `docs/plans/2026-05-21-ai-studio-v1-design.md` combining all 5 sections
2. Commit
3. Invoke `superpowers:writing-plans` for the implementation plan
4. User chooses execution mode

Estimated time to complete the remaining brainstorm: 20-30 minutes of conversation.
Estimated time to complete the writing-plans output: 30-45 minutes.
Estimated time to execute Phase 2 (7 sub-phases): 7-9 weeks subagent-driven.
