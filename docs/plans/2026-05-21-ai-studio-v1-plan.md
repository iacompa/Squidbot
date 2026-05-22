# AI Studio v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development` if executing in-session) to implement this plan task-by-task.

**Goal:** Ship the AI Studio surface in SquidBot — a centralized control plane where users design, test, approve, deploy, and measure agent workflows ("Blueprints"), with one fully-built proof-point Blueprint ("AI CEO Operations") in v1.

**Architecture:** New top-level renderer surface (`StudioPage` with 7 tabs) backed by a new TypeScript package `@squidbot/blueprints` that owns the Blueprint manifest type + CRUD + version history + install/uninstall + scope filtering. Three new SQLite tables (`blueprints`, `blueprint_versions`, `blueprint_runs`), new IPC handlers, a React Flow canvas editor for the graph, and bundled fixture connectors for Gmail + Google Calendar so the AI CEO Ops Blueprint runs zero-spend.

**Tech Stack:** Electron + React 19 + TypeScript + SQLite + Vitest + Playwright + `@xyflow/react` (React Flow, new) + `dagre` (auto-layout, new) + existing `@squidbot/*` workspace packages.

**Reference design:** `docs/plans/2026-05-21-ai-studio-v1-design.md` — read this first. The plan below executes that design.

---

## Sub-phase index

| Sub-phase | Title | ~Tasks | ~Commits | ~Time |
|---|---|---|---|---|
| **2A** | Blueprint manifest + storage backend | 7 | 6 | 1 week |
| **2B** | Studio top-level page + Catalog tab | 5 | 5 | 1 week |
| **2C** | Node-graph canvas editor | 8 | 8 | 1.5 weeks |
| **2D** | Fixture Gmail + Calendar connectors | 5 | 5 | 1 week |
| **2E** | AI CEO Ops Blueprint (the proof point) | 7 | 7 | 1 week |
| **2F** | Benchmark runner + Promotion/Rollback + KPI/ROI dashboard | 7 | 7 | 1.5 weeks |
| **2G** | Pilot controls + feedback + scope + final polish | 8 | 8 | 1.5 weeks |
| **Total** | | **47** | **46** | **8.5 weeks** |

---

## Conventions (apply to every task unless noted)

### Working directory + branch

All commands run from the worktree root: `~/Projects/SquidBot 2/.claude/worktrees/frosty-williamson-817c25` on branch `claude/frosty-williamson-817c25`.

### TDD cycle for every task

1. **Write the failing test first** — exact code in `test:` file
2. **Run the test, verify it fails** — exact command, exact expected failure text
3. **Implement the minimum to make it pass** — exact code in `create:`/`modify:` files
4. **Run the test, verify it passes** — exact command, expected PASS
5. **Commit** — using the HEREDOC pattern (NEVER `--amend`, NEVER `--no-verify`)

### Commit message format

Imperative kebab-case subject, body explaining the why. Always include co-author trailer:

```bash
git commit -m "$(cat <<'EOF'
<subject-in-kebab-case>

<body — 1-3 sentences on why this commit exists, what the test verifies>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Test layer mapping

- **`@squidbot/*` package logic** → Vitest in `packages/*/test/`
- **Renderer components** → Vitest + `@testing-library/react` in `apps/desktop/src/renderer/src/**/*.test.tsx`
- **IPC handlers + integration** → Vitest in `apps/desktop/src/main/**/*.test.ts`
- **End-to-end web bundle** → Playwright in `apps/desktop/test/*.spec.ts`
- **Touch-target / a11y / visual** → Playwright (existing `test/touch-targets.spec.ts`, `test/a11y.spec.ts`, `test/visual.spec.ts`)

### Verification gate at end of each sub-phase

```bash
cd apps/desktop && npm run test:responsive
```

Must pass before opening the next sub-phase.

### Skills to use

- TDD discipline: `superpowers:test-driven-development`
- Code quality review per task: `superpowers:requesting-code-review`
- If stuck debugging: `superpowers:systematic-debugging` (no fix without root cause)

### Anti-patterns to refuse

From design Section 5.3 — if a subagent proposes any of these, the spec compliance review rejects the work:

- "While I'm in `<file>.tsx`, let me also add..." — No. Stay in scope.
- "Studio should also have a chat-shaped..." — No. Studio is design-time.
- "Let me make the Blueprint manifest more flexible just in case..." — No. The schema is bounded.
- "This deserves a dedicated package..." — No. `@squidbot/blueprints` is the one new package.

---

## Sub-phase 2A — Blueprint manifest + storage backend

**Goal:** Ship the `@squidbot/blueprints` package + the three new DB tables + the IPC layer. After 2A, a Blueprint manifest JSON can be installed, persisted, listed, exported, and version-history preserved across saves.

### Task A.1: Create `@squidbot/blueprints` package skeleton

**Files:**
- Create: `packages/blueprints/package.json`
- Create: `packages/blueprints/tsconfig.json`
- Create: `packages/blueprints/vitest.config.ts`
- Create: `packages/blueprints/src/index.ts`
- Create: `packages/blueprints/test/package.test.ts`

**Step 1: Write the failing test**

`packages/blueprints/test/package.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import * as blueprints from "../src/index.js";

describe("@squidbot/blueprints package", () => {
  it("exports something (placeholder until A.2)", () => {
    expect(blueprints).toBeDefined();
  });
});
```

**Step 2: Run test, verify it fails**

```bash
cd packages/blueprints && npm test 2>&1 | tail -5
```

Expected: Error — `Cannot find module '../src/index.js'` or `package.json not found`.

**Step 3: Implement minimum**

`packages/blueprints/package.json` (model after `packages/team/package.json`):

```json
{
  "name": "@squidbot/blueprints",
  "version": "0.1.0",
  "private": true,
  "description": "Blueprint manifest types, registry, and lifecycle management for SquidBot AI Studio.",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@squidbot/core": "0.1.0",
    "@squidbot/db": "0.1.0",
    "@squidbot/governance": "0.1.0",
    "@squidbot/evals": "0.1.0",
    "@squidbot/team": "0.1.0",
    "@squidbot/connectors": "0.1.0"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

`packages/blueprints/tsconfig.json` (copy from `packages/team/tsconfig.json` and adjust paths).

`packages/blueprints/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"]
  }
});
```

`packages/blueprints/src/index.ts` (placeholder):

```typescript
export const BLUEPRINTS_PACKAGE_VERSION = "0.1.0";
```

**Step 4: Install workspace + run test, verify it passes**

```bash
npm install        # from worktree root — picks up new packages/blueprints
cd packages/blueprints && npm test 2>&1 | tail -5
```

Expected: `1 passed`.

**Step 5: Commit**

```bash
git add packages/blueprints/ package-lock.json
git commit -m "$(cat <<'EOF'
add-squidbot-blueprints-package-skeleton

Bootstraps @squidbot/blueprints — the package that will own Blueprint
manifest types, validation, registry, and lifecycle (install / version /
promote / rollback). Workspace deps target @squidbot/core, db,
governance, evals, team, connectors per the design — Blueprints
reference all five.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A.2: Define `BlueprintManifest` TypeScript types

**Files:**
- Modify: `packages/blueprints/src/index.ts`
- Create: `packages/blueprints/src/types.ts`
- Create: `packages/blueprints/test/types.test.ts`

**Step 1: Write the failing test**

`packages/blueprints/test/types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type {
  BlueprintManifest,
  GraphNode,
  GraphEdge,
  AgentRoleRef,
  ToolRef,
  BenchmarkTarget,
  KpiTarget,
  BlueprintAuditEntry
} from "../src/types.js";

describe("BlueprintManifest types", () => {
  it("compiles a minimal manifest", () => {
    const manifest: BlueprintManifest = {
      name: "Test Blueprint",
      slug: "test-bp",
      version: "1.0.0",
      description: "smoke",
      owner: "system",
      tags: [],
      graph: { nodes: [], edges: [] },
      agentRoles: [],
      tools: [],
      connectors: [],
      policies: [],
      datasets: [],
      benchmarks: [],
      kpis: [],
      rollout: { status: "draft", haltOnFailure: true },
      scope: {},
      createdAt: "2026-05-21T00:00:00Z",
      createdBy: "system",
      updatedAt: "2026-05-21T00:00:00Z",
      updatedBy: "system",
      auditTrail: []
    };
    expect(manifest.slug).toBe("test-bp");
  });

  it("rollout status is bounded to allowed values", () => {
    // type-only test: this assignment must be a compile error
    // @ts-expect-error — "deployed" is not a valid status
    const bad: BlueprintManifest["rollout"] = { status: "deployed", haltOnFailure: true };
    expect(bad).toBeDefined();
  });
});
```

**Step 2: Run test, verify it fails**

```bash
cd packages/blueprints && npm test 2>&1 | tail -5
```

Expected: Error — `Cannot find module '../src/types.js'`.

**Step 3: Implement**

`packages/blueprints/src/types.ts`:

```typescript
// --- Identity references (typed pointers to existing entities) ---

export type AgentRoleRef = { id: string; version?: string };
export type ToolRef = { id: string; permission?: string };
export type ConnectorRef = { name: string; fixtureMode?: boolean };
export type PolicyRef = { id: string };
export type DatasetRef = { id: string; source: "fixture" | "live" };

// --- Graph (canvas state) ---

export type GraphNodeKind =
  | "agent"
  | "tool"
  | "connector"
  | "policy"
  | "dataset"
  | "benchmark";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  refId: string;             // references one of AgentRoleRef.id / ToolRef.id / etc
  label: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
};

export type GraphEdgeKind = "data" | "control" | "approval-gate";

export type GraphEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;            // GraphNode.id
  target: string;            // GraphNode.id
  label?: string;
};

// --- Benchmarks + KPIs ---

export type BenchmarkTarget = {
  datasetId: string;
  metric: string;
  threshold: number;
  baseline?: number;
};

export type KpiTarget = {
  name: string;
  target: number;
  unit: string;
  businessValuePerUnit?: number;
};

// --- Audit ---

export type BlueprintAuditEntry = {
  id: string;
  blueprintSlug: string;
  blueprintVersion: string;
  eventType:
    | "installed"
    | "edited"
    | "benchmark_run"
    | "promoted"
    | "rolled_back"
    | "uninstalled"
    | "scope_changed";
  actor: string;
  timestamp: string;
  prevHash: string;
  hash: string;
  payload: Record<string, unknown>;
};

// --- Forward-compatible Phase 4 + Phase 8 hooks ---

export type WidgetRef = { id: string; label: string; source: string; position: string };
export type SidebarItemRef = { id: string; label: string; icon?: string; blueprint: string; requiresRole?: string[] };
export type PageOverlayRef = { page: string; tab?: string; blueprint: string };
export type ThemeRef = { id: string; preferDensity?: "compact" | "comfortable"; preferColorScheme?: "light" | "dark" | "auto" };

export type ReflectionTriggerPolicy = {
  onMultiToolTask?: boolean;
  onLongRuntime?: boolean;
  onPlanRevision?: boolean;
  onRepeatedFailure?: boolean;
  onUserCorrection?: boolean;
  onHighRiskOp?: boolean;
  onScheduledJobComplete?: boolean;
};

// --- The manifest itself ---

export type BlueprintManifest = {
  name: string;
  slug: string;
  version: string;             // semver
  description: string;
  owner: string;
  tags: string[];

  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    layout?: Record<string, { x: number; y: number }>;
  };

  agentRoles: AgentRoleRef[];
  tools: ToolRef[];
  connectors: ConnectorRef[];
  policies: PolicyRef[];
  datasets: DatasetRef[];

  benchmarks: BenchmarkTarget[];
  kpis: KpiTarget[];

  rollout: {
    status: "draft" | "pilot" | "stable" | "archived";
    canaryPercent?: number;
    haltOnFailure: boolean;
    previousVersion?: string;
  };

  scope: {
    tenants?: string[];
    departments?: string[];
    roles?: string[];
    users?: string[];
  };

  // Stored now, consumed by Phase 8 (uiContributions) and Phase 4 (trainability + adaptivity).
  uiContributions?: {
    dashboardWidgets?: WidgetRef[];
    sidebarItems?: SidebarItemRef[];
    pageOverlays?: PageOverlayRef[];
    themes?: ThemeRef[];
    homeScreen?: string;
  };

  trainability?: {
    feedbackTargets: string[];
    mutationCandidates: string[];
    promotionGate: "manual" | "auto-with-benchmark" | "auto-with-eval+rollback";
    rollbackOnBenchmarkRegression: boolean;
  };

  adaptivity?: {
    reflectionTrigger: ReflectionTriggerPolicy;
    memoryNudgeFrequency?: "daily" | "weekly" | "manual" | "after_N_runs";
    affordanceGapPolicy: "log-only" | "auto-propose-skill" | "block-on-detection";
  };

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  auditTrail: BlueprintAuditEntry[];
};
```

`packages/blueprints/src/index.ts` (replace placeholder):

```typescript
export * from "./types.js";
export const BLUEPRINTS_PACKAGE_VERSION = "0.1.0";
```

**Step 4: Run test, verify it passes**

```bash
cd packages/blueprints && npm test 2>&1 | tail -5
```

Expected: `2 passed`.

**Step 5: Commit**

```bash
git add packages/blueprints/src/ packages/blueprints/test/
git commit -m "$(cat <<'EOF'
define-blueprint-manifest-typescript-types

Adds packages/blueprints/src/types.ts with BlueprintManifest as the
stable contract: graph state, references to existing entities,
benchmarks + KPIs, rollout state, scope, and three forward-compatible
field groups (uiContributions for Phase 8, trainability + adaptivity
for Phase 4). The rollout.status union is bounded to {draft, pilot,
stable, archived} — verified by ts-expect-error on a bad value.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A.3: JSON-schema validator for `BlueprintManifest`

**Files:**
- Create: `packages/blueprints/src/validator.ts`
- Create: `packages/blueprints/src/schema.ts`
- Create: `packages/blueprints/test/validator.test.ts`
- Modify: `packages/blueprints/src/index.ts`

**Step 1: Write the failing test**

`packages/blueprints/test/validator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { validateManifest } from "../src/validator.js";

const minimal = {
  name: "Test",
  slug: "test",
  version: "1.0.0",
  description: "smoke",
  owner: "system",
  tags: [],
  graph: { nodes: [], edges: [] },
  agentRoles: [],
  tools: [],
  connectors: [],
  policies: [],
  datasets: [],
  benchmarks: [],
  kpis: [],
  rollout: { status: "draft", haltOnFailure: true },
  scope: {},
  createdAt: "2026-05-21T00:00:00Z",
  createdBy: "system",
  updatedAt: "2026-05-21T00:00:00Z",
  updatedBy: "system",
  auditTrail: []
};

describe("validateManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const result = validateManifest(minimal);
    expect(result.ok).toBe(true);
  });

  it("rejects manifest missing required slug", () => {
    const bad = { ...minimal, slug: undefined };
    const result = validateManifest(bad as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("|")).toMatch(/slug/i);
  });

  it("rejects malformed semver version", () => {
    const bad = { ...minimal, version: "not-a-semver" };
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("|")).toMatch(/version/i);
  });

  it("rejects unknown rollout status", () => {
    const bad = { ...minimal, rollout: { status: "wat", haltOnFailure: true } };
    const result = validateManifest(bad as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("|")).toMatch(/rollout|status/i);
  });

  it("rejects slug with whitespace", () => {
    const bad = { ...minimal, slug: "test ai" };
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
  });
});
```

**Step 2: Run test, verify it fails**

```bash
cd packages/blueprints && npm test 2>&1 | tail -10
```

Expected: `Cannot find module '../src/validator.js'`.

**Step 3: Implement**

`packages/blueprints/src/validator.ts`:

```typescript
import type { BlueprintManifest } from "./types.js";

export type ValidationResult =
  | { ok: true; manifest: BlueprintManifest }
  | { ok: false; errors: string[] };

const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
const SLUG = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const ALLOWED_ROLLOUT = new Set(["draft", "pilot", "stable", "archived"]);
const ALLOWED_PROMOTION = new Set(["manual", "auto-with-benchmark", "auto-with-eval+rollback"]);

export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];
  const m = input as Record<string, unknown>;

  function require(field: string, type: string): void {
    const v = m?.[field];
    if (v === undefined || v === null) errors.push(`Missing required field: ${field}`);
    else if (type === "string" && typeof v !== "string") errors.push(`${field} must be a string`);
    else if (type === "array" && !Array.isArray(v)) errors.push(`${field} must be an array`);
    else if (type === "object" && (typeof v !== "object" || Array.isArray(v))) errors.push(`${field} must be an object`);
  }

  if (!m || typeof m !== "object") {
    return { ok: false, errors: ["Manifest must be an object"] };
  }

  require("name", "string");
  require("slug", "string");
  require("version", "string");
  require("description", "string");
  require("owner", "string");
  require("tags", "array");
  require("graph", "object");
  require("agentRoles", "array");
  require("tools", "array");
  require("connectors", "array");
  require("policies", "array");
  require("datasets", "array");
  require("benchmarks", "array");
  require("kpis", "array");
  require("rollout", "object");
  require("scope", "object");
  require("createdAt", "string");
  require("createdBy", "string");
  require("updatedAt", "string");
  require("updatedBy", "string");
  require("auditTrail", "array");

  if (typeof m.slug === "string" && !SLUG.test(m.slug)) {
    errors.push("slug must be lowercase kebab-case (e.g. 'ai-ceo-ops')");
  }
  if (typeof m.version === "string" && !SEMVER.test(m.version)) {
    errors.push(`version "${m.version}" is not valid semver (expected major.minor.patch)`);
  }

  const rollout = m.rollout as Record<string, unknown> | undefined;
  if (rollout) {
    if (typeof rollout.status !== "string" || !ALLOWED_ROLLOUT.has(rollout.status)) {
      errors.push(`rollout.status must be one of ${[...ALLOWED_ROLLOUT].join("|")}`);
    }
    if (typeof rollout.haltOnFailure !== "boolean") {
      errors.push("rollout.haltOnFailure must be a boolean");
    }
    if (rollout.canaryPercent !== undefined) {
      const p = rollout.canaryPercent as number;
      if (typeof p !== "number" || p < 0 || p > 100) {
        errors.push("rollout.canaryPercent must be a number between 0 and 100");
      }
    }
  }

  // trainability + adaptivity are optional, but if present must be valid
  const train = m.trainability as Record<string, unknown> | undefined;
  if (train) {
    if (typeof train.promotionGate !== "string" || !ALLOWED_PROMOTION.has(train.promotionGate)) {
      errors.push(`trainability.promotionGate must be one of ${[...ALLOWED_PROMOTION].join("|")}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: m as unknown as BlueprintManifest };
}
```

`packages/blueprints/src/schema.ts`:

```typescript
// Re-exports of regex constants for use by other modules.
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
```

`packages/blueprints/src/index.ts` (extend):

```typescript
export * from "./types.js";
export { validateManifest, type ValidationResult } from "./validator.js";
export { SLUG_PATTERN, SEMVER_PATTERN } from "./schema.js";
export const BLUEPRINTS_PACKAGE_VERSION = "0.1.0";
```

**Step 4: Run test, verify it passes**

```bash
cd packages/blueprints && npm test 2>&1 | tail -10
```

Expected: `7 passed` (2 from earlier + 5 validator).

**Step 5: Commit**

```bash
git add packages/blueprints/src/ packages/blueprints/test/
git commit -m "$(cat <<'EOF'
add-blueprint-manifest-json-schema-validator

validateManifest() returns { ok, errors? } and enforces required fields,
slug kebab-case, semver version, bounded rollout.status, valid
trainability.promotionGate. Five tests cover: minimal valid manifest,
missing slug, bad semver, unknown rollout status, whitespace-in-slug.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A.4: DB migration 19 — `blueprints` + `blueprint_versions` + `blueprint_runs` tables

**Files:**
- Modify: `packages/db/src/migrations.ts` (append migration object)
- Create: `packages/db/test/migration-19-blueprints.test.ts`

**Step 1: Write the failing test**

`packages/db/test/migration-19-blueprints.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../src/migrations.js";

describe("migration 19 — blueprints tables", () => {
  it("creates blueprints, blueprint_versions, blueprint_runs", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);

    expect(tables).toContain("blueprints");
    expect(tables).toContain("blueprint_versions");
    expect(tables).toContain("blueprint_runs");
  });

  it("blueprints table has expected columns", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    const cols = db.prepare("PRAGMA table_info(blueprints)").all().map((r) => (r as { name: string }).name);
    expect(cols).toEqual(
      expect.arrayContaining(["id", "slug", "name", "manifest_json", "status", "current_version", "createdAt", "updatedAt"])
    );
  });

  it("blueprint_versions has unique (blueprint_id, version) constraint", () => {
    const db = new Database(":memory:");
    runMigrations(db);
    db.prepare(
      "INSERT INTO blueprints (id, slug, name, manifest_json, status, current_version, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("bp1", "test", "Test", "{}", "draft", "1.0.0", "2026-05-21T00:00:00Z", "2026-05-21T00:00:00Z");

    db.prepare(
      "INSERT INTO blueprint_versions (id, blueprint_id, version, manifest_json, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("v1", "bp1", "1.0.0", "{}", "2026-05-21T00:00:00Z", "system");

    expect(() => {
      db.prepare(
        "INSERT INTO blueprint_versions (id, blueprint_id, version, manifest_json, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("v2", "bp1", "1.0.0", "{}", "2026-05-21T00:00:00Z", "system");
    }).toThrow(/UNIQUE/);
  });

  it("blueprint_runs has FK to blueprints", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    expect(() => {
      db.prepare(
        "INSERT INTO blueprint_runs (id, blueprint_id, version, run_type, result_json, startedAt) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("r1", "nonexistent-bp", "1.0.0", "benchmark", "{}", "2026-05-21T00:00:00Z");
    }).toThrow(/FOREIGN KEY/);
  });
});
```

**Step 2: Run test, verify it fails**

```bash
cd packages/db && npm test 2>&1 | tail -10
```

Expected: `no such table: blueprints` (or similar).

**Step 3: Implement — append to `packages/db/src/migrations.ts` migrations array**

Insert before the closing `];` of the `migrations` array:

```typescript
  {
    id: 19,
    name: "blueprints",
    // AI Studio v1 — Phase 2 of vs-openclaw-hermes roadmap.
    // Three new tables: identity row, immutable version history, per-run results.
    // Cascades enforce referential integrity; ON DELETE CASCADE on blueprint_versions
    // and blueprint_runs so deleting a Blueprint cleans up its history.
    up: `
      CREATE TABLE IF NOT EXISTS blueprints (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'pilot', 'stable', 'archived')),
        current_version TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS blueprint_versions (
        id TEXT PRIMARY KEY,
        blueprint_id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        createdBy TEXT NOT NULL,
        UNIQUE (blueprint_id, version),
        FOREIGN KEY (blueprint_id) REFERENCES blueprints(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS blueprint_runs (
        id TEXT PRIMARY KEY,
        blueprint_id TEXT NOT NULL,
        version TEXT NOT NULL,
        run_type TEXT NOT NULL CHECK (run_type IN ('benchmark', 'pilot', 'production', 'reflection')),
        result_json TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        completedAt TEXT,
        FOREIGN KEY (blueprint_id) REFERENCES blueprints(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_blueprint_versions_bp ON blueprint_versions(blueprint_id);
      CREATE INDEX IF NOT EXISTS idx_blueprint_runs_bp ON blueprint_runs(blueprint_id);
      CREATE INDEX IF NOT EXISTS idx_blueprint_runs_type ON blueprint_runs(run_type);
    `
  }
```

**Step 4: Run test, verify it passes**

```bash
cd packages/db && npm test 2>&1 | tail -10
```

Expected: `4 passed` for migration-19 tests + existing tests still green.

**Step 5: Commit**

```bash
git add packages/db/src/migrations.ts packages/db/test/migration-19-blueprints.test.ts
git commit -m "$(cat <<'EOF'
add-migration-19-blueprints-blueprint-versions-blueprint-runs

Three new SQLite tables for Phase 2 AI Studio: blueprints (identity +
current state), blueprint_versions (immutable manifest history with
UNIQUE(blueprint_id, version)), blueprint_runs (per-execution results
typed by run_type benchmark|pilot|production|reflection). CASCADE on
delete keeps the version + run history aligned with the parent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A.5: `SquidDatabase` Blueprint CRUD methods

**Files:**
- Modify: `packages/db/src/database.ts`
- Create: `packages/db/test/blueprint-methods.test.ts`

**Step 1: Write the failing test**

`packages/db/test/blueprint-methods.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SquidDatabase } from "../src/database.js";

let db: SquidDatabase;

beforeEach(() => {
  db = new SquidDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

const manifestJson = JSON.stringify({ slug: "test-bp", version: "1.0.0", name: "Test" });

describe("SquidDatabase Blueprint methods", () => {
  it("saveBlueprint creates a new row and a version", () => {
    const id = db.saveBlueprint({
      slug: "test-bp",
      name: "Test",
      manifest_json: manifestJson,
      status: "draft",
      current_version: "1.0.0"
    }, "system");

    expect(id).toBeDefined();

    const fetched = db.getBlueprint("test-bp");
    expect(fetched).toMatchObject({ slug: "test-bp", status: "draft", current_version: "1.0.0" });

    const versions = db.listBlueprintVersions(id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe("1.0.0");
  });

  it("saveBlueprint on existing slug creates a new version", () => {
    const id = db.saveBlueprint({
      slug: "test-bp",
      name: "Test",
      manifest_json: manifestJson,
      status: "draft",
      current_version: "1.0.0"
    }, "system");

    const newManifest = JSON.stringify({ slug: "test-bp", version: "1.0.1", name: "Test" });
    db.saveBlueprint({
      slug: "test-bp",
      name: "Test",
      manifest_json: newManifest,
      status: "draft",
      current_version: "1.0.1"
    }, "user-1");

    const versions = db.listBlueprintVersions(id);
    expect(versions.map((v) => v.version).sort()).toEqual(["1.0.0", "1.0.1"]);
  });

  it("deleteBlueprint cascades to versions", () => {
    const id = db.saveBlueprint({
      slug: "test-bp",
      name: "Test",
      manifest_json: manifestJson,
      status: "draft",
      current_version: "1.0.0"
    }, "system");
    db.deleteBlueprint(id);
    expect(db.getBlueprint("test-bp")).toBeNull();
    expect(db.listBlueprintVersions(id)).toHaveLength(0);
  });

  it("listBlueprints returns all in newest-first order", () => {
    db.saveBlueprint({ slug: "a", name: "A", manifest_json: "{}", status: "draft", current_version: "1.0.0" }, "system");
    db.saveBlueprint({ slug: "b", name: "B", manifest_json: "{}", status: "draft", current_version: "1.0.0" }, "system");
    const list = db.listBlueprints();
    expect(list.map((bp) => bp.slug)).toEqual(["b", "a"]);
  });
});
```

**Step 2: Run test, verify it fails**

```bash
cd packages/db && npm test 2>&1 | tail -10
```

Expected: `saveBlueprint is not a function` or similar.

**Step 3: Implement — add to `packages/db/src/database.ts`**

(Read the file first to find the right insertion point — methods are typically grouped by entity. Add a `// === Blueprints ===` section. The exact prepared statements:)

```typescript
// === Blueprints ===

private blueprintInsertStmt = this.db.prepare(
  "INSERT OR REPLACE INTO blueprints (id, slug, name, manifest_json, status, current_version, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
);
private blueprintVersionInsertStmt = this.db.prepare(
  "INSERT INTO blueprint_versions (id, blueprint_id, version, manifest_json, createdAt, createdBy) VALUES (?, ?, ?, ?, ?, ?)"
);
private blueprintSelectBySlugStmt = this.db.prepare(
  "SELECT * FROM blueprints WHERE slug = ?"
);
private blueprintSelectByIdStmt = this.db.prepare(
  "SELECT * FROM blueprints WHERE id = ?"
);
private blueprintListStmt = this.db.prepare(
  "SELECT * FROM blueprints ORDER BY createdAt DESC"
);
private blueprintDeleteStmt = this.db.prepare("DELETE FROM blueprints WHERE id = ?");
private blueprintVersionsByBpStmt = this.db.prepare(
  "SELECT * FROM blueprint_versions WHERE blueprint_id = ? ORDER BY createdAt ASC"
);

public saveBlueprint(
  input: { slug: string; name: string; manifest_json: string; status: string; current_version: string },
  actor: string
): string {
  const existing = this.blueprintSelectBySlugStmt.get(input.slug) as { id: string } | undefined;
  const id = existing?.id ?? crypto.randomUUID();
  const now = new Date().toISOString();

  const tx = this.db.transaction(() => {
    this.blueprintInsertStmt.run(
      id,
      input.slug,
      input.name,
      input.manifest_json,
      input.status,
      input.current_version,
      existing ? (this.blueprintSelectByIdStmt.get(id) as { createdAt: string }).createdAt : now,
      now
    );
    // Always create a new version row (idempotent by UNIQUE if same version)
    try {
      this.blueprintVersionInsertStmt.run(
        crypto.randomUUID(),
        id,
        input.current_version,
        input.manifest_json,
        now,
        actor
      );
    } catch (e) {
      // version already exists — that's fine for "save without bumping version"
    }
  });
  tx();
  return id;
}

public getBlueprint(slug: string): Record<string, unknown> | null {
  return (this.blueprintSelectBySlugStmt.get(slug) as Record<string, unknown> | undefined) ?? null;
}

public getBlueprintById(id: string): Record<string, unknown> | null {
  return (this.blueprintSelectByIdStmt.get(id) as Record<string, unknown> | undefined) ?? null;
}

public listBlueprints(): Array<Record<string, unknown>> {
  return this.blueprintListStmt.all() as Array<Record<string, unknown>>;
}

public deleteBlueprint(id: string): void {
  this.blueprintDeleteStmt.run(id);
}

public listBlueprintVersions(blueprintId: string): Array<{ version: string; manifest_json: string; createdAt: string; createdBy: string }> {
  return this.blueprintVersionsByBpStmt.all(blueprintId) as Array<{ version: string; manifest_json: string; createdAt: string; createdBy: string }>;
}
```

**Step 4: Run test, verify it passes**

```bash
cd packages/db && npm test 2>&1 | tail -10
```

Expected: `4 passed` for blueprint-methods + all other tests green.

**Step 5: Commit**

```bash
git add packages/db/src/database.ts packages/db/test/blueprint-methods.test.ts
git commit -m "$(cat <<'EOF'
add-squiddatabase-blueprint-crud-methods

saveBlueprint() upserts identity + appends a version atomically.
getBlueprint() / listBlueprints() / deleteBlueprint() / listBlueprintVersions()
round out the surface @squidbot/blueprints will use. saveBlueprint
tolerates "save without bumping version" by swallowing the UNIQUE
constraint on (blueprint_id, version).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A.6: `BlueprintRegistry` class with install/uninstall

**Files:**
- Create: `packages/blueprints/src/registry.ts`
- Create: `packages/blueprints/test/registry.test.ts`
- Modify: `packages/blueprints/src/index.ts`

**Step 1: Write the failing test**

`packages/blueprints/test/registry.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { BlueprintRegistry } from "../src/registry.js";
import type { BlueprintManifest } from "../src/types.js";

function makeManifest(overrides: Partial<BlueprintManifest> = {}): BlueprintManifest {
  return {
    name: "Test",
    slug: "test-bp",
    version: "1.0.0",
    description: "smoke",
    owner: "system",
    tags: [],
    graph: { nodes: [], edges: [] },
    agentRoles: [],
    tools: [],
    connectors: [],
    policies: [],
    datasets: [],
    benchmarks: [],
    kpis: [],
    rollout: { status: "draft", haltOnFailure: true },
    scope: {},
    createdAt: "2026-05-21T00:00:00Z",
    createdBy: "system",
    updatedAt: "2026-05-21T00:00:00Z",
    updatedBy: "system",
    auditTrail: [],
    ...overrides
  };
}

const makeMockDb = () => {
  const rows: Record<string, unknown>[] = [];
  return {
    saveBlueprint: vi.fn((input: { slug: string }) => {
      const existing = rows.find((r) => r.slug === input.slug);
      if (existing) return existing.id as string;
      const id = `bp-${rows.length + 1}`;
      rows.push({ id, ...input });
      return id;
    }),
    getBlueprint: vi.fn((slug: string) => rows.find((r) => r.slug === slug) ?? null),
    listBlueprints: vi.fn(() => rows),
    deleteBlueprint: vi.fn((id: string) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    }),
    listBlueprintVersions: vi.fn(() => [])
  };
};

describe("BlueprintRegistry", () => {
  it("install persists a valid manifest", () => {
    const db = makeMockDb();
    const reg = new BlueprintRegistry(db as never);
    const result = reg.install(makeManifest(), "user-1");
    expect(result.ok).toBe(true);
    expect(db.saveBlueprint).toHaveBeenCalled();
  });

  it("install rejects an invalid manifest", () => {
    const db = makeMockDb();
    const reg = new BlueprintRegistry(db as never);
    const result = reg.install(makeManifest({ slug: "BAD SLUG" }), "user-1");
    expect(result.ok).toBe(false);
  });

  it("uninstall removes the blueprint", () => {
    const db = makeMockDb();
    const reg = new BlueprintRegistry(db as never);
    reg.install(makeManifest(), "user-1");
    reg.uninstall("test-bp", "user-1");
    expect(db.deleteBlueprint).toHaveBeenCalled();
  });

  it("list returns installed Blueprints", () => {
    const db = makeMockDb();
    const reg = new BlueprintRegistry(db as never);
    reg.install(makeManifest(), "user-1");
    reg.install(makeManifest({ slug: "second", name: "Second" }), "user-1");
    expect(reg.list()).toHaveLength(2);
  });
});
```

**Step 2: Run test, verify it fails**

```bash
cd packages/blueprints && npm test 2>&1 | tail -10
```

Expected: `Cannot find module '../src/registry.js'`.

**Step 3: Implement**

`packages/blueprints/src/registry.ts`:

```typescript
import { validateManifest } from "./validator.js";
import type { BlueprintManifest } from "./types.js";

// Minimal interface the registry needs from the DB — keeps coupling low.
export interface BlueprintStore {
  saveBlueprint(
    input: { slug: string; name: string; manifest_json: string; status: string; current_version: string },
    actor: string
  ): string;
  getBlueprint(slug: string): Record<string, unknown> | null;
  listBlueprints(): Array<Record<string, unknown>>;
  deleteBlueprint(id: string): void;
  listBlueprintVersions(blueprintId: string): Array<{ version: string; manifest_json: string; createdAt: string; createdBy: string }>;
}

export type InstallResult =
  | { ok: true; id: string; manifest: BlueprintManifest }
  | { ok: false; errors: string[] };

export class BlueprintRegistry {
  constructor(private readonly store: BlueprintStore) {}

  install(manifest: BlueprintManifest, actor: string): InstallResult {
    const v = validateManifest(manifest);
    if (!v.ok) return { ok: false, errors: v.errors };
    const id = this.store.saveBlueprint(
      {
        slug: manifest.slug,
        name: manifest.name,
        manifest_json: JSON.stringify(manifest),
        status: manifest.rollout.status,
        current_version: manifest.version
      },
      actor
    );
    return { ok: true, id, manifest };
  }

  uninstall(slug: string, _actor: string): void {
    const bp = this.store.getBlueprint(slug);
    if (!bp) return;
    this.store.deleteBlueprint(bp.id as string);
  }

  get(slug: string): BlueprintManifest | null {
    const row = this.store.getBlueprint(slug);
    if (!row) return null;
    return JSON.parse(row.manifest_json as string) as BlueprintManifest;
  }

  list(): BlueprintManifest[] {
    return this.store.listBlueprints().map((row) => JSON.parse(row.manifest_json as string) as BlueprintManifest);
  }

  versions(slug: string): Array<{ version: string; manifest: BlueprintManifest; createdAt: string; createdBy: string }> {
    const bp = this.store.getBlueprint(slug);
    if (!bp) return [];
    const rows = this.store.listBlueprintVersions(bp.id as string);
    return rows.map((r) => ({
      version: r.version,
      manifest: JSON.parse(r.manifest_json) as BlueprintManifest,
      createdAt: r.createdAt,
      createdBy: r.createdBy
    }));
  }
}
```

`packages/blueprints/src/index.ts` (extend):

```typescript
export * from "./types.js";
export { validateManifest, type ValidationResult } from "./validator.js";
export { SLUG_PATTERN, SEMVER_PATTERN } from "./schema.js";
export { BlueprintRegistry, type BlueprintStore, type InstallResult } from "./registry.js";
export const BLUEPRINTS_PACKAGE_VERSION = "0.1.0";
```

**Step 4: Run test, verify it passes**

```bash
cd packages/blueprints && npm test 2>&1 | tail -10
```

Expected: `11 passed` total.

**Step 5: Commit**

```bash
git add packages/blueprints/src/ packages/blueprints/test/
git commit -m "$(cat <<'EOF'
add-blueprint-registry-install-uninstall-list

BlueprintRegistry depends only on a narrow BlueprintStore interface
(saveBlueprint/getBlueprint/listBlueprints/deleteBlueprint/
listBlueprintVersions) so the package stays decoupled from
@squidbot/db while integration tests can stub it out. install()
validates first, then persists; uninstall() removes by slug;
list() returns full manifests parsed from JSON.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task A.7: IPC handlers — `listBlueprints`, `getBlueprint`, `installBlueprint`, `exportBlueprint`, `deleteBlueprint`

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts` (add handlers near other entity-section handlers)
- Modify: `apps/desktop/src/preload/index.ts` (expose to renderer)
- Modify: `apps/desktop/src/renderer/src/types.ts` and/or shared API types
- Create: `apps/desktop/src/main/blueprint-ipc.test.ts`

**Step 1: Write the failing test**

`apps/desktop/src/main/blueprint-ipc.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { BlueprintRegistry } from "@squidbot/blueprints";

// Verify the registry can be wired from IPC. Integration of ipcMain.handle
// is covered indirectly by the web bundle Playwright tests in 2B.
describe("Blueprint IPC wiring smoke", () => {
  it("BlueprintRegistry constructs against any BlueprintStore-shaped object", () => {
    const stub = {
      saveBlueprint: () => "bp-1",
      getBlueprint: () => null,
      listBlueprints: () => [],
      deleteBlueprint: () => {},
      listBlueprintVersions: () => []
    };
    const reg = new BlueprintRegistry(stub as never);
    expect(reg.list()).toEqual([]);
  });
});
```

**Step 2: Run, verify it fails**

```bash
cd apps/desktop && npm test -- --run 2>&1 | tail -10
```

Expected: Module resolution error if `@squidbot/blueprints` is not yet linked into desktop deps.

**Step 3: Implement**

Add `@squidbot/blueprints: "0.1.0"` to `apps/desktop/package.json` dependencies. Run `npm install` from worktree root.

In `apps/desktop/src/main/ipc.ts`, add at top with other imports:

```typescript
import { BlueprintRegistry } from "@squidbot/blueprints";
```

After other registry instantiations (search for `new RoleRegistry` for reference position), add:

```typescript
const blueprintRegistry = new BlueprintRegistry(database);
```

After other `ipcMain.handle` blocks for similar entity types, add (use the existing `squidbot:` namespace pattern):

```typescript
ipcMain.handle("squidbot:listBlueprints", () => {
  return { blueprints: blueprintRegistry.list() };
});

ipcMain.handle("squidbot:getBlueprint", (_event, slug: string) => {
  const manifest = blueprintRegistry.get(slug);
  if (!manifest) throw new Error(`Blueprint not found: ${slug}`);
  return { manifest };
});

ipcMain.handle("squidbot:installBlueprint", (_event, manifest: unknown, actor?: string) => {
  const result = blueprintRegistry.install(manifest as Parameters<BlueprintRegistry["install"]>[0], actor ?? "user");
  if (!result.ok) {
    throw new Error(`Invalid Blueprint: ${result.errors.join("; ")}`);
  }
  return { id: result.id, slug: result.manifest.slug };
});

ipcMain.handle("squidbot:exportBlueprint", (_event, slug: string) => {
  const manifest = blueprintRegistry.get(slug);
  if (!manifest) throw new Error(`Blueprint not found: ${slug}`);
  return { json: JSON.stringify(manifest, null, 2) };
});

ipcMain.handle("squidbot:deleteBlueprint", (_event, slug: string, actor?: string) => {
  blueprintRegistry.uninstall(slug, actor ?? "user");
  return { ok: true };
});

ipcMain.handle("squidbot:listBlueprintVersions", (_event, slug: string) => {
  return { versions: blueprintRegistry.versions(slug) };
});
```

In `apps/desktop/src/preload/index.ts`, expose to `window.squidbot`:

```typescript
listBlueprints: () => ipcRenderer.invoke("squidbot:listBlueprints"),
getBlueprint: (slug: string) => ipcRenderer.invoke("squidbot:getBlueprint", slug),
installBlueprint: (manifest: unknown, actor?: string) => ipcRenderer.invoke("squidbot:installBlueprint", manifest, actor),
exportBlueprint: (slug: string) => ipcRenderer.invoke("squidbot:exportBlueprint", slug),
deleteBlueprint: (slug: string, actor?: string) => ipcRenderer.invoke("squidbot:deleteBlueprint", slug, actor),
listBlueprintVersions: (slug: string) => ipcRenderer.invoke("squidbot:listBlueprintVersions", slug),
```

In the shared API type def (likely `apps/desktop/shared/api.ts` — find via `grep -r "listModelAccounts" apps/desktop/shared/`), add the same five method signatures.

In `apps/desktop/src/server/webApiBridge.ts`, the existing Proxy-based dispatch automatically picks up these methods because it forwards any `/api/<method>` to `window.squidbot[method]`. No code change needed there — but **verify** by greping: `grep -A 5 "router.post" apps/desktop/src/server/webApiBridge.ts` should show a generic dispatcher.

**Step 4: Run test, verify it passes**

```bash
cd apps/desktop && npm test -- --run 2>&1 | tail -10
```

Expected: `1 passed` for blueprint-ipc smoke. All other desktop tests still pass.

**Step 5: Run end-of-sub-phase gate**

```bash
cd apps/desktop && npm run test:responsive 2>&1 | tail -10
```

Expected: All Vitest + Playwright passing.

**Step 6: Commit**

```bash
git add apps/desktop/src/main/ipc.ts apps/desktop/src/main/blueprint-ipc.test.ts apps/desktop/src/preload/index.ts apps/desktop/shared/api.ts apps/desktop/package.json package-lock.json
git commit -m "$(cat <<'EOF'
add-blueprint-ipc-handlers-and-preload-bridge

Wires 6 new IPC channels: listBlueprints, getBlueprint, installBlueprint,
exportBlueprint, deleteBlueprint, listBlueprintVersions. Preload exposes
them to window.squidbot; the web bundle's Proxy-based dispatcher in
webApiBridge.ts picks them up automatically. Sub-phase 2A complete:
backend can install/persist/list/export Blueprint manifests end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Sub-phase 2A acceptance check:**
- `cd packages/blueprints && npm test` → all green
- `cd packages/db && npm test` → all green including new migration tests
- `cd apps/desktop && npm run test:responsive` → all green

---

## Sub-phase 2B — Studio top-level page + Catalog tab

**Goal:** Add the `Studio` nav item + the `StudioPage` component with a 7-tab shell + the Catalog tab. After 2B, a user opens Studio → lands on Catalog → can import a Blueprint manifest from JSON → sees it appear in the list.

### Task B.1: `StudioPage` skeleton with 7-tab shell

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/StudioPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioPage.test.tsx`

**Step 1: Write the failing test**

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StudioPage } from "./StudioPage";

afterEach(cleanup);

describe("StudioPage", () => {
  it("renders all 7 tabs", () => {
    render(<StudioPage />);
    expect(screen.getByRole("tab", { name: /catalog/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /editor/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /benchmarks/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /roi/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /pilot/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /responsible ai/i })).toBeDefined();
    expect(screen.getByRole("tab", { name: /scope/i })).toBeDefined();
  });

  it("defaults to the Catalog tab", () => {
    render(<StudioPage />);
    expect(screen.getByRole("tab", { name: /catalog/i, selected: true })).toBeDefined();
  });
});
```

**Step 2-5:** Run test → fail → implement minimal `StudioPage.tsx` with 7 tab buttons (model after existing `SettingsPage.tsx` tab pattern) → run test → pass → commit.

Implementation skeleton:

```tsx
import { useState } from "react";

type StudioTab = "catalog" | "editor" | "benchmarks" | "roi" | "pilot" | "responsible-ai" | "scope";
const TABS: { id: StudioTab; label: string }[] = [
  { id: "catalog", label: "Catalog" },
  { id: "editor", label: "Editor" },
  { id: "benchmarks", label: "Benchmarks" },
  { id: "roi", label: "ROI Dashboard" },
  { id: "pilot", label: "Pilot Controls" },
  { id: "responsible-ai", label: "Responsible AI" },
  { id: "scope", label: "Scope" }
];

export function StudioPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<StudioTab>("catalog");
  return (
    <main className="page-panel studio-page">
      <header className="page-header">
        <h2>AI Studio</h2>
        <p>Design, benchmark, deploy, and measure agent workflows.</p>
      </header>
      <div role="tablist" className="studio-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className={activeTab === t.id ? "active" : ""}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="studio-panel">
        {activeTab === "catalog" && <div data-testid="catalog-panel">Catalog (B.2 wiring)</div>}
        {activeTab !== "catalog" && <div className="empty-tab">Coming in later sub-phase</div>}
      </div>
    </main>
  );
}
```

Commit: `add-studiopage-skeleton-with-7-tab-shell`.

---

### Task B.2: Wire Studio into top-level nav

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/types.ts` (add `"studio"` to `PageId` union)
- Modify: `apps/desktop/src/renderer/src/lib/navRedirects.ts` if redirects need to know about studio
- Modify: `apps/desktop/src/renderer/src/App.test.tsx` (or create renderPage smoke test)

**Step 1-5 condensed:**

Test: navigating to `pageId: "studio"` renders `StudioPage`. Implement: add `Sparkles` import, add `{ id: "studio", label: "Studio", icon: Sparkles }` between Briefing and Chat in `primaryPages` array, extend `PageId` union, add the `if (activePage === "studio") return <StudioPage />` branch in `renderPage()`.

Commit: `wire-studio-into-app-shell-nav`.

---

### Task B.3: Catalog tab — list installed Blueprints

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/StudioPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioCatalog.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioCatalog.test.tsx`

**Step 1: Failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { StudioCatalog } from "./StudioCatalog";

beforeEach(() => {
  (window as unknown as Record<string, unknown>).squidbot = {
    listBlueprints: vi.fn().mockResolvedValue({
      blueprints: [
        { name: "AI CEO Ops", slug: "ai-ceo-ops", version: "1.0.0", rollout: { status: "draft" } }
      ]
    })
  };
});

afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).squidbot;
});

describe("StudioCatalog", () => {
  it("lists installed Blueprints", async () => {
    render(<StudioCatalog />);
    await waitFor(() => {
      expect(screen.getByText(/AI CEO Ops/)).toBeDefined();
      expect(screen.getByText(/1\.0\.0/)).toBeDefined();
      expect(screen.getByText(/draft/i)).toBeDefined();
    });
  });

  it("shows empty state when no Blueprints installed", async () => {
    ((window as unknown as { squidbot: { listBlueprints: ReturnType<typeof vi.fn> } }).squidbot.listBlueprints).mockResolvedValueOnce({ blueprints: [] });
    render(<StudioCatalog />);
    await waitFor(() => {
      expect(screen.getByText(/no blueprints installed/i)).toBeDefined();
    });
  });
});
```

**Steps 2-5:** Run, fail, implement, pass, commit.

Implementation outline of `StudioCatalog.tsx`: `useEffect` calls `squidbotApi.listBlueprints()`, renders rows with name/slug/version/status chip, empty state when list is empty.

Commit: `add-studio-catalog-tab-listing-installed-blueprints`.

---

### Task B.4: Catalog — Install from JSON (paste + upload)

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/StudioCatalog.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/StudioCatalog.test.tsx`

**Step 1: Test additions**

```typescript
it("install button accepts JSON paste and installs", async () => {
  const installMock = vi.fn().mockResolvedValue({ id: "bp-1", slug: "test" });
  (window as unknown as { squidbot: Record<string, unknown> }).squidbot.installBlueprint = installMock;

  render(<StudioCatalog />);
  fireEvent.click(screen.getByRole("button", { name: /install.*json/i }));
  fireEvent.change(screen.getByRole("textbox", { name: /manifest json/i }), {
    target: { value: '{"slug":"test","name":"Test","version":"1.0.0"}' }
  });
  fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

  await waitFor(() => expect(installMock).toHaveBeenCalled());
});
```

**Steps 2-5:** Add a modal/inline form with textarea + file-upload input, wire to `installBlueprint`, refresh list on success. Commit: `add-studio-catalog-install-from-json`.

---

### Task B.5: Catalog — Export Blueprint as JSON download

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/StudioCatalog.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/StudioCatalog.test.tsx`

**Steps 1-5 condensed:** Add export button per Blueprint row → calls `squidbotApi.exportBlueprint(slug)` → triggers browser download via `URL.createObjectURL(new Blob([json], { type: "application/json" }))`. Test verifies the function is invoked. Commit: `add-studio-catalog-export-blueprint-as-json`.

**Sub-phase 2B acceptance check:**
- `cd apps/desktop && npm run test:responsive` → all green
- Open desktop app or `web:serve` → click Studio nav → land on Catalog → install/export round-trips.

---

## Sub-phase 2C — Node-graph canvas editor

**Goal:** Add React Flow + dagre, build a canvas that renders a Blueprint's graph as nodes + edges, supports six custom node types and three custom edge types, deterministic auto-layout, save/load round-trip. After 2C, opening a Blueprint in the Editor tab renders its workflow visually and any edits round-trip through manifest JSON byte-for-byte.

### Task C.1: Add `@xyflow/react` + `dagre` deps

**Files:**
- Modify: `apps/desktop/package.json`
- Run: `npm install` from worktree root

**Step 1-5 condensed:** Add `"@xyflow/react": "^12.x"` and `"dagre": "^0.8.x"` + `"@types/dagre": "^0.7.x"` to devDependencies. Run install. Verify with a tiny smoke test importing both. Commit: `add-react-flow-and-dagre-deps-for-canvas`.

---

### Task C.2: `CanvasEditor` component shell with `<ReactFlow>` mount

**Files:**
- Create: `apps/desktop/src/renderer/src/components/CanvasEditor.tsx`
- Create: `apps/desktop/src/renderer/src/components/CanvasEditor.test.tsx`

**Step 1: Failing test**

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { CanvasEditor } from "./CanvasEditor";

afterEach(cleanup);

describe("CanvasEditor", () => {
  it("renders an empty canvas", () => {
    const { container } = render(<CanvasEditor nodes={[]} edges={[]} onSave={() => {}} />);
    expect(container.querySelector(".react-flow")).toBeDefined();
  });
});
```

**Steps 2-5:** Implement `CanvasEditor` accepting `nodes`, `edges`, `onSave` props, wrapping `<ReactFlow>` from `@xyflow/react` with required CSS import. Commit: `add-canvas-editor-react-flow-shell`.

---

### Task C.3: Custom node types — `AgentNode`, `ToolNode`, `ConnectorNode`, `PolicyNode`, `DatasetNode`, `BenchmarkNode`

**Files:**
- Create: `apps/desktop/src/renderer/src/components/canvas-nodes/AgentNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/canvas-nodes/ToolNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/canvas-nodes/ConnectorNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/canvas-nodes/PolicyNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/canvas-nodes/DatasetNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/canvas-nodes/BenchmarkNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/canvas-nodes/index.ts`
- Create: `apps/desktop/src/renderer/src/components/canvas-nodes/nodes.test.tsx`

**Step 1: One failing test covering all 6**

```typescript
it.each([
  ["agent", AgentNode],
  ["tool", ToolNode],
  ["connector", ConnectorNode],
  ["policy", PolicyNode],
  ["dataset", DatasetNode],
  ["benchmark", BenchmarkNode]
])("%s node renders with label and aria-label", (kind, Component) => {
  const { container } = render(<Component data={{ label: `Test ${kind}` }} />);
  const root = container.firstElementChild as HTMLElement;
  expect(root.getAttribute("aria-label")).toMatch(new RegExp(kind, "i"));
});
```

**Steps 2-5:** Implement each as a small functional component returning `<div role="group" aria-label="${kind}: ${data.label}">{data.label}</div>` with kind-specific CSS class. Export a `nodeTypes` registry mapping kind → component. Commit: `add-six-custom-canvas-node-types-with-aria-labels`.

---

### Task C.4: Custom edge types — `DataFlowEdge`, `ControlFlowEdge`, `ApprovalGateEdge`

**Files:**
- Create: `apps/desktop/src/renderer/src/components/canvas-edges/*.tsx`
- Create: `apps/desktop/src/renderer/src/components/canvas-edges/edges.test.tsx`

**Step 1-5 condensed:** Same pattern as nodes — three custom edge components, registry, single parameterized test. Commit: `add-three-custom-canvas-edge-types`.

---

### Task C.5: Dagre auto-layout with fixed seed

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/canvasLayout.ts`
- Create: `apps/desktop/src/renderer/src/lib/canvasLayout.test.ts`

**Step 1: Failing test**

```typescript
import { describe, expect, it } from "vitest";
import { layoutGraph } from "./canvasLayout";

describe("layoutGraph", () => {
  const nodes = [
    { id: "a", kind: "agent" as const, refId: "a", label: "A" },
    { id: "b", kind: "tool" as const, refId: "b", label: "B" }
  ];
  const edges = [
    { id: "e1", kind: "data" as const, source: "a", target: "b" }
  ];

  it("returns positions for every node", () => {
    const result = layoutGraph(nodes, edges);
    expect(result["a"]).toBeDefined();
    expect(result["b"]).toBeDefined();
  });

  it("produces identical layout across runs (deterministic)", () => {
    const run1 = layoutGraph(nodes, edges);
    const run2 = layoutGraph(nodes, edges);
    expect(run1).toEqual(run2);
  });
});
```

**Steps 2-5:** Implement `layoutGraph(nodes, edges): Record<string, {x,y}>` using `dagre.graphlib.Graph` + `dagre.layout`. Force determinism by sorting node insertion order alphabetically by id. Commit: `add-dagre-auto-layout-with-deterministic-seed`.

---

### Task C.6: Serialize canvas state → `BlueprintManifest.graph`

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CanvasEditor.tsx`
- Create: `apps/desktop/src/renderer/src/lib/canvasSerialize.ts`
- Create: `apps/desktop/src/renderer/src/lib/canvasSerialize.test.ts`

**Step 1: Failing test**

```typescript
it("round-trips manifest graph through serialize / deserialize", () => {
  const manifestGraph = {
    nodes: [{ id: "a", kind: "agent" as const, refId: "agent-1", label: "Coordinator", position: { x: 0, y: 0 } }],
    edges: [{ id: "e", kind: "data" as const, source: "a", target: "a" }]
  };
  const reactFlowState = deserializeForCanvas(manifestGraph);
  const roundTrip = serializeFromCanvas(reactFlowState.nodes, reactFlowState.edges);
  expect(roundTrip).toEqual(manifestGraph);
});
```

**Steps 2-5:** Implement `serializeFromCanvas` and `deserializeForCanvas`. Commit: `add-canvas-state-to-manifest-graph-serialization`.

---

### Task C.7: Read-only mode for `stable` Blueprints

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/CanvasEditor.tsx`
- Modify: `apps/desktop/src/renderer/src/components/CanvasEditor.test.tsx`

**Step 1: Test addition**

```typescript
it("ReadOnly flag disables node dragging and edge creation", () => {
  const { container } = render(<CanvasEditor nodes={[]} edges={[]} onSave={() => {}} readOnly />);
  const reactFlow = container.querySelector(".react-flow");
  expect(reactFlow?.getAttribute("data-readonly")).toBe("true");
});
```

**Steps 2-5:** Pass through `nodesDraggable={!readOnly}` + `edgesUpdatable={!readOnly}` + `elementsSelectable={!readOnly}` + `data-readonly={readOnly}`. Commit: `add-canvas-editor-readonly-mode-for-stable-blueprints`.

---

### Task C.8: Wire Editor tab into `StudioPage`

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/StudioPage.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioEditor.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioEditor.test.tsx`

**Step 1: Failing test**

```typescript
it("Editor tab loads the selected Blueprint's graph into the canvas", async () => {
  // mocks window.squidbot.getBlueprint → returns a Blueprint with 2 nodes
  // navigates to Editor tab
  // asserts canvas renders 2 nodes
});
```

**Steps 2-5:** Implement Editor tab: select a Blueprint from a dropdown (defaulting to currently-installed list), `useEffect` calls `getBlueprint(slug)`, sets state, passes to `CanvasEditor`. Save button calls `installBlueprint` with the serialized graph (bumps version). Commit: `wire-canvas-editor-into-studio-editor-tab`.

**Sub-phase 2C acceptance check:**
- `cd apps/desktop && npm run test:responsive` → all green
- Manual: open Studio → Editor tab → select AI CEO Ops Blueprint (will appear in 2E) → see canvas with nodes.

---

## Sub-phase 2D — Fixture Gmail + Calendar connectors

**Goal:** Ship two new bundled connector manifests + their deterministic fixture data. After 2D, the AI CEO Ops Blueprint (2E) can read mock email and calendar data without any OAuth flow.

### Task D.1: Gmail-fixture connector manifest

**Files:**
- Create: `connectors/builtin/gmail-fixture.json`
- Create: `connectors/builtin/fixtures/gmail-inbox-50.json` (the synthetic inbox)
- Create: `packages/connectors/test/gmail-fixture.test.ts`

**Step 1: Failing test**

```typescript
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("gmail-fixture connector", () => {
  it("manifest is valid JSON with expected shape", () => {
    const raw = readFileSync(join(__dirname, "../../../connectors/builtin/gmail-fixture.json"), "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.name).toBe("gmail-fixture");
    expect(manifest.fixtureMode).toBe(true);
    expect(manifest.endpoints.find((e) => e.operationId === "list_inbox")).toBeDefined();
    expect(manifest.endpoints.find((e) => e.operationId === "send").permission).toBe("emailWrite");
  });

  it("fixture inbox contains 50 emails", () => {
    const raw = readFileSync(join(__dirname, "../../../connectors/builtin/fixtures/gmail-inbox-50.json"), "utf-8");
    const inbox = JSON.parse(raw);
    expect(Array.isArray(inbox.messages)).toBe(true);
    expect(inbox.messages).toHaveLength(50);
  });
});
```

**Steps 2-5:** Author both JSON files. Manifest follows existing connector format from `connectors/demo/githubConnector.json` (above). Fixture inbox is 50 emails with mix of categories. Commit: `add-gmail-fixture-connector-with-50-message-inbox`.

---

### Task D.2: GCal-fixture connector manifest + 20-event calendar

**Files:**
- Create: `connectors/builtin/gcal-fixture.json`
- Create: `connectors/builtin/fixtures/gcal-events-20.json`
- Create: `packages/connectors/test/gcal-fixture.test.ts`

**Step 1-5 condensed:** Same pattern as D.1. 20 events with mix of conflicts/today/future/past. Commit: `add-gcal-fixture-connector-with-20-events`.

---

### Task D.3: Fixture connector loader picks up `connectors/builtin/`

**Files:**
- Modify: `packages/connectors/src/registry.ts` (or wherever the existing connector loader is — check `grep -r "installDeveloperWorkflowConnectors" packages/connectors/src/`)
- Modify: `packages/connectors/test/registry.test.ts`

**Step 1: Failing test**

```typescript
it("loads builtin connectors from connectors/builtin/ on registry init", () => {
  const reg = new ConnectorRegistry({ builtinDir: "/path/to/connectors/builtin" });
  reg.loadBuiltin();
  expect(reg.get("gmail-fixture")).toBeDefined();
  expect(reg.get("gcal-fixture")).toBeDefined();
});
```

**Steps 2-5:** Extend the existing connector loader to also scan `connectors/builtin/*.json` in addition to `connectors/demo/*.json`. Commit: `extend-connector-loader-to-scan-builtin-directory`.

---

### Task D.4: Approval gates on fixture write endpoints

**Files:**
- Modify: `connectors/builtin/gmail-fixture.json` (verify `send`/`archive` have `requiresApproval: true`)
- Modify: `connectors/builtin/gcal-fixture.json` (verify all writes)
- Create: `packages/connectors/test/approval-gates.test.ts`

**Step 1-5 condensed:** Test that calling `gmail-fixture.send` without approval throws or queues an approval. Implementation: hook into existing approval flow (see `getApproval` / `listOpenApprovals` from `@squidbot/connectors`). Commit: `gate-fixture-connector-writes-on-explicit-approval`.

---

### Task D.5: Determinism verification — fixture responses identical across calls

**Files:**
- Create: `packages/connectors/test/fixture-determinism.test.ts`

**Step 1-5 condensed:** Test that calling `gmail-fixture.list_inbox` twice returns identical JSON (including timestamps). Implementation: ensure fixtures don't use `Date.now()` — all timestamps are static or seeded. Commit: `verify-fixture-connector-responses-are-deterministic`.

**Sub-phase 2D acceptance check:**
- `cd packages/connectors && npm test` → all green
- `cd apps/desktop && npm run test:responsive` → all green

---

## Sub-phase 2E — AI CEO Ops Blueprint (the proof point)

**Goal:** Ship the bundled `ai-ceo-ops` Blueprint that demonstrates the full Studio surface. After 2E, a user installs the Blueprint via Catalog, opens the canvas, sees 4 agent roles + their connections, and the Briefing page populates with real (fixture-driven) numbers.

### Task E.1: Agent role manifests for `coordinator`, `email-triager`, `calendar-planner`, `briefing-writer`

**Files:**
- Create: `blueprints/builtin/ai-ceo-ops/roles/coordinator.json`
- Create: `blueprints/builtin/ai-ceo-ops/roles/email-triager.json`
- Create: `blueprints/builtin/ai-ceo-ops/roles/calendar-planner.json`
- Create: `blueprints/builtin/ai-ceo-ops/roles/briefing-writer.json`
- Create: `packages/team/test/ai-ceo-ops-roles.test.ts`

**Step 1: Failing test**

```typescript
it("all 4 AI CEO Ops role manifests validate", () => {
  for (const role of ["coordinator", "email-triager", "calendar-planner", "briefing-writer"]) {
    const raw = readFileSync(join(__dirname, "../../../blueprints/builtin/ai-ceo-ops/roles", `${role}.json`), "utf-8");
    const manifest = JSON.parse(raw);
    const result = validateRoleManifest(manifest);
    expect(result.ok).toBe(true);
  }
});
```

**Steps 2-5:** Author 4 role manifests following the `@squidbot/team` `AgentRoleManifest` schema. Each defines role name, responsibilities, allowed tools, prompting template. Commit: `add-ai-ceo-ops-four-agent-role-manifests`.

---

### Task E.2: Policy packs — `email-send-requires-approval`, `sensitive-data-redaction`, `read-only-by-default`

**Files:**
- Create: `blueprints/builtin/ai-ceo-ops/policies/email-send-requires-approval.json`
- Create: `blueprints/builtin/ai-ceo-ops/policies/sensitive-data-redaction.json`
- Create: `blueprints/builtin/ai-ceo-ops/policies/read-only-by-default.json`
- Create: `packages/governance/test/ai-ceo-ops-policies.test.ts`

**Step 1-5 condensed:** Test that each policy pack loads via `@squidbot/governance` policy validator. Implementation: JSON files matching existing policy pack format (find via `find packages/governance -name "*.json" -path "*policies*"`). Commit: `add-ai-ceo-ops-three-policy-packs`.

---

### Task E.3: Benchmark datasets — `fixture-overnight-inbox-50` + `fixture-meeting-conflicts-20`

**Files:**
- Create: `blueprints/builtin/ai-ceo-ops/benchmarks/overnight-inbox-50.json`
- Create: `blueprints/builtin/ai-ceo-ops/benchmarks/meeting-conflicts-20.json`
- Create: `packages/evals/test/ai-ceo-ops-benchmarks.test.ts`

**Step 1-5 condensed:** Two benchmark dataset JSON files matching `@squidbot/evals` dataset schema. Each is an array of {input, expected_output, scoring_metric} triples. Commit: `add-ai-ceo-ops-benchmark-datasets`.

---

### Task E.4: The Blueprint manifest itself

**Files:**
- Create: `blueprints/builtin/ai-ceo-ops/manifest.json`
- Create: `blueprints/builtin/ai-ceo-ops/README.md`
- Create: `packages/blueprints/test/ai-ceo-ops-manifest.test.ts`

**Step 1: Failing test**

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest } from "../src/index.js";

describe("ai-ceo-ops Blueprint manifest", () => {
  it("validates against the schema", () => {
    const raw = readFileSync(join(__dirname, "../../../blueprints/builtin/ai-ceo-ops/manifest.json"), "utf-8");
    const result = validateManifest(JSON.parse(raw));
    expect(result.ok).toBe(true);
  });

  it("references 4 agent roles, 2 connectors, 3 policies, 2 datasets, 4 benchmarks, 4 kpis", () => {
    const raw = readFileSync(join(__dirname, "../../../blueprints/builtin/ai-ceo-ops/manifest.json"), "utf-8");
    const m = JSON.parse(raw);
    expect(m.agentRoles).toHaveLength(4);
    expect(m.connectors).toHaveLength(2);
    expect(m.policies).toHaveLength(3);
    expect(m.datasets).toHaveLength(2);
    expect(m.benchmarks).toHaveLength(4);
    expect(m.kpis).toHaveLength(4);
  });
});
```

**Steps 2-5:** Author the full manifest matching the design's spec. README documents the workflow. Commit: `add-ai-ceo-ops-blueprint-manifest-and-readme`.

---

### Task E.5: "Install AI CEO Ops Blueprint" wizard in Catalog

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/StudioCatalog.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/StudioCatalog.test.tsx`
- Modify: IPC: extend `installBlueprint` to support loading from `blueprints/builtin/<slug>/manifest.json`

**Step 1-5 condensed:** Catalog shows a featured banner "Install AI CEO Operations Blueprint" when not yet installed. Click → confirmation modal → installs the bundled manifest. Commit: `add-ai-ceo-ops-install-wizard-to-studio-catalog`.

---

### Task E.6: Briefing page wiring — populate from Blueprint runs

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/BriefingPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/BriefingPage.test.tsx`
- Modify: IPC: add `listBlueprintRuns` handler

**Step 1: Failing test**

```typescript
it("Briefing shows AI CEO Ops triaged-email count when Blueprint is installed and has runs", async () => {
  mockSquidbot({
    listBlueprints: () => Promise.resolve({ blueprints: [{ slug: "ai-ceo-ops", ... }] }),
    listBlueprintRuns: () => Promise.resolve({ runs: [{ run_type: "production", result_json: '{"emails_triaged": 12}' }] })
  });
  render(<BriefingPage onNavigate={() => {}} />);
  await waitFor(() => expect(screen.getByText(/12 emails triaged/i)).toBeDefined());
});
```

**Steps 2-5:** When Blueprint is installed, replace the em-dash placeholders on Briefing with real counts from latest run. Commit: `wire-briefing-page-to-ai-ceo-ops-blueprint-runs`.

---

### Task E.7: Integration test — install → render → verify

**Files:**
- Create: `apps/desktop/test/ai-ceo-ops-install.spec.ts` (Playwright)

**Step 1-5 condensed:** Playwright test: open `/`, click Studio, click Install AI CEO Ops banner, click Editor tab, assert 4 agent nodes render on canvas. Commit: `add-playwright-test-for-ai-ceo-ops-end-to-end-install`.

**Sub-phase 2E acceptance check:**
- `cd apps/desktop && npm run test:responsive` → all green
- Manual: install AI CEO Ops → Briefing shows real numbers from latest fixture run.

---

## Sub-phase 2F — Benchmark runner + Promotion/Rollback + KPI/ROI dashboard

**Goal:** Wire the Benchmarks tab to actually run benchmarks via `@squidbot/evals`, the ROI dashboard to actually compute KPI values from `blueprint_runs`, and the Promotion wizard to transition draft → pilot → stable with chained-hash audit entries + rollback.

### Task F.1: `runBenchmarkSuite` in `@squidbot/blueprints`

**Files:**
- Create: `packages/blueprints/src/benchmarks.ts`
- Create: `packages/blueprints/test/benchmarks.test.ts`

**Step 1: Failing test**

```typescript
import { describe, expect, it, vi } from "vitest";
import { runBenchmarkSuite } from "../src/benchmarks.js";

it("runs all benchmarks in a manifest and returns pass/fail per metric", async () => {
  const manifest = { ...minimalManifest, benchmarks: [
    { datasetId: "ds-1", metric: "accuracy", threshold: 0.85 }
  ]};
  const mockRunner = vi.fn().mockResolvedValue({ accuracy: 0.92 });
  const result = await runBenchmarkSuite(manifest, { run: mockRunner });
  expect(result.results).toHaveLength(1);
  expect(result.results[0]).toMatchObject({ datasetId: "ds-1", metric: "accuracy", actual: 0.92, passed: true });
});
```

**Steps 2-5:** Implement `runBenchmarkSuite(manifest, { run })`. The `run` injectable is the `@squidbot/evals` benchmark runner. Returns `{ results: BenchmarkResult[], allPassed: boolean }`. Commit: `add-runbenchmarksuite-in-blueprints-package`.

---

### Task F.2: Benchmarks tab UI

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/StudioBenchmarks.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioBenchmarks.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/StudioPage.tsx`
- Add IPC: `runBenchmarkSuite`

**Step 1-5 condensed:** Tab shows benchmark list per current Blueprint, "Run All" button kicks off `runBenchmarkSuite`, results table shows metric / threshold / actual / passed. Commit: `add-studio-benchmarks-tab-with-run-all-button`.

---

### Task F.3: Promotion wizard — draft → pilot → stable

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/StudioBenchmarks.tsx`
- Create: `apps/desktop/src/renderer/src/components/PromotionWizard.tsx`
- Add IPC: `promoteBlueprint(slug, targetStatus, canaryPercent)`
- Add to `packages/blueprints/src/registry.ts`: `promote(slug, target, canaryPercent, actor)`
- Add to `@squidbot/governance`: audit entry chain helper if not already there

**Step 1: Failing test (registry-level)**

```typescript
it("promote() updates rollout.status and writes a chained-hash audit entry", () => {
  const reg = new BlueprintRegistry(mockDb);
  reg.install(manifest, "user-1");
  const auditBefore = mockDb.lastAuditEntry();
  reg.promote("test-bp", "pilot", 10, "user-1");
  const auditAfter = mockDb.lastAuditEntry();
  expect(auditAfter.eventType).toBe("promoted");
  expect(auditAfter.prevHash).toBe(auditBefore.hash);
});
```

**Steps 2-5:** Implement `promote()` in registry + IPC + UI wizard. Audit chain via existing `@squidbot/governance` API. Commit: `add-blueprint-promotion-wizard-draft-pilot-stable`.

---

### Task F.4: Rollback button + previous-version restoration

**Files:**
- Modify: `packages/blueprints/src/registry.ts`: add `rollback(slug, actor)`
- Modify: `apps/desktop/src/renderer/src/components/PromotionWizard.tsx`
- Add IPC: `rollbackBlueprint`

**Step 1: Failing test**

```typescript
it("rollback() restores the previous version and writes audit entry", () => {
  const reg = new BlueprintRegistry(mockDb);
  reg.install({ ...manifest, version: "1.0.0" }, "user-1");
  reg.install({ ...manifest, version: "1.0.1" }, "user-1");
  reg.promote("test-bp", "pilot", 10, "user-1");
  reg.rollback("test-bp", "user-1");
  const current = reg.get("test-bp");
  expect(current.version).toBe("1.0.0");
});
```

**Steps 2-5:** Implement. Commit: `add-blueprint-rollback-with-previous-version-restore`.

---

### Task F.5: ROI dashboard tab

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/StudioRoi.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioRoi.test.tsx`

**Step 1-5 condensed:** Tab reads `listBlueprintRuns(slug)` + manifest's `kpis` array. Computes per-KPI: actual (from latest runs), target (from manifest), variance, businessValue (= actual × businessValuePerUnit). Renders as a table or cards. Commit: `add-studio-roi-dashboard-tab`.

---

### Task F.6: Integration test — install → benchmark → promote → rollback end-to-end

**Files:**
- Create: `packages/blueprints/test/install-promote-rollback.test.ts`

**Step 1: Failing test**

```typescript
import Database from "better-sqlite3";
import { SquidDatabase } from "@squidbot/db";
import { BlueprintRegistry } from "../src/index.js";

describe("install → promote → rollback end-to-end", () => {
  it("audit chain validates after the full cycle", () => {
    const db = new SquidDatabase(":memory:");
    const reg = new BlueprintRegistry(db);
    reg.install({ ...minimalManifest, version: "1.0.0" }, "user-1");
    reg.install({ ...minimalManifest, version: "1.0.1" }, "user-1");
    reg.promote("test-bp", "pilot", 10, "user-1");
    reg.rollback("test-bp", "user-1");

    const auditChain = db.listAuditEntries({ blueprintSlug: "test-bp" });
    for (let i = 1; i < auditChain.length; i++) {
      expect(auditChain[i].prevHash).toBe(auditChain[i - 1].hash);
    }
  });
});
```

**Steps 2-5:** Verify all infrastructure ties together. Commit: `add-end-to-end-install-promote-rollback-integration-test`.

---

### Task F.7: Audit ledger verification helper

**Files:**
- Modify: `packages/governance/src/audit.ts` (or wherever the chained-hash code lives — find via `grep -r "prevHash" packages/governance/src/`)
- Create: `packages/governance/test/audit-chain-blueprint-events.test.ts`

**Step 1-5 condensed:** Extend audit verification to handle the new event types `blueprint.installed|edited|promoted|rolled_back|benchmark_run|canary_metric|scope_changed`. Commit: `extend-audit-ledger-verification-to-blueprint-events`.

**Sub-phase 2F acceptance check:**
- `cd packages/blueprints && npm test` → all green including end-to-end integration
- `cd packages/governance && npm test` → all green
- `cd apps/desktop && npm run test:responsive` → all green

---

## Sub-phase 2G — Pilot controls + feedback + scope + leaderboards + final polish

**Goal:** Ship the remaining 4 Studio tabs (Pilot Controls + Responsible AI + Scope + final visual polish) plus 25 visual regression baselines covering the full Studio surface at 5 widths.

### Task G.1: Pilot Controls tab — canary slider + gradual rollout

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/StudioPilot.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioPilot.test.tsx`

**Step 1-5 condensed:** Slider with stops at 5%, 25%, 100%, halt-on-failure toggle. Calls `promoteBlueprint(slug, "pilot", percent)`. Touch-target ≥44×44 on slider thumb. Commit: `add-studio-pilot-controls-tab-with-canary-slider`.

---

### Task G.2: User feedback collection — thumbs up/down per Blueprint run

**Files:**
- Modify: `packages/blueprints/src/registry.ts`: `submitFeedback(slug, runId, rating, comment, actor)`
- Add IPC: `submitFeedback`
- Modify: `apps/desktop/src/renderer/src/pages/StudioPilot.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioPilot-feedback.test.tsx`

**Step 1-5 condensed:** Feedback panel inside Pilot Controls. Stores in `blueprint_runs.result_json.feedback`. Commit: `add-per-run-feedback-collection-with-thumbs-and-comment`.

---

### Task G.3: Skill/workflow leaderboards

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/StudioLeaderboard.tsx` (renders inside Pilot Controls or Benchmarks)
- Create: `apps/desktop/src/renderer/src/pages/StudioLeaderboard.test.tsx`

**Step 1-5 condensed:** Sorts versions of the current Blueprint by latest benchmark score. Commit: `add-blueprint-version-leaderboard`.

---

### Task G.4: Scope tab — ABAC controls per Blueprint

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/StudioScope.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioScope.test.tsx`
- Modify: `packages/blueprints/src/registry.ts`: `updateScope(slug, scope, actor)`
- Add IPC: `updateBlueprintScope`

**Step 1-5 condensed:** Multi-select chips for tenants/departments/roles/users (uses existing `@squidbot/governance` identity store). Saves to manifest's `scope` field, bumps version. Commit: `add-studio-scope-tab-for-per-blueprint-abac`.

---

### Task G.5: Responsible AI tab — per-Blueprint policy attachment + red-team results

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/StudioResponsibleAi.tsx`
- Create: `apps/desktop/src/renderer/src/pages/StudioResponsibleAi.test.tsx`

**Step 1-5 condensed:** Lists attached policies (from manifest's `policies` array). Shows latest red-team run results (from `blueprint_runs` where `run_type='reflection'`). "Run red-team scan" button kicks off a benchmark variant. Commit: `add-studio-responsible-ai-tab-policy-and-red-team-view`.

---

### Task G.6: Deployment readiness checklist

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/PromotionWizard.tsx`
- Create: `apps/desktop/src/renderer/src/lib/deploymentReadiness.ts`
- Create: `apps/desktop/src/renderer/src/lib/deploymentReadiness.test.ts`

**Step 1: Failing test**

```typescript
it("returns ready when all benchmarks pass + policies attached + scope set + audit chain valid", () => {
  const result = checkDeploymentReadiness({ manifest, runs, auditChainValid: true });
  expect(result.ready).toBe(true);
});

it("returns blocked when no policies attached", () => {
  const result = checkDeploymentReadiness({ manifest: { ...manifest, policies: [] }, runs, auditChainValid: true });
  expect(result.ready).toBe(false);
  expect(result.blockers).toContain("No policies attached");
});
```

**Steps 2-5:** Implement gating function. PromotionWizard disables "Promote" button if `!ready` and shows reasons. Commit: `add-deployment-readiness-checklist-gating-promotion`.

---

### Task G.7: Responsive treatment for Studio (mobile/tablet/desktop)

**Files:**
- Modify: `apps/desktop/src/renderer/src/styles/app.css` (add `.studio-*` rules)
- Modify: `apps/desktop/src/renderer/src/components/CanvasEditor.tsx` (view-only at mobile widths)

**Step 1: Failing test addition to existing touch-targets / a11y suites**

Add to `test/touch-targets.spec.ts` the page list: `"studio"` (so it's included in the parameterized `pages.forEach` loop).

**Steps 2-5:** Add CSS for tab bar reflow at mobile, canvas hides + shows "Open in desktop" hint below 768px, all controls ≥44×44. Commit: `add-responsive-treatment-for-studio-surface`.

---

### Task G.8: 25 visual regression baselines for Studio

**Files:**
- Modify: `apps/desktop/test/visual.spec.ts` (extend the existing baseline-driver loop)

**Step 1: Failing test** — extend the `pages` list in `visual.spec.ts`:

```typescript
const pages: { route: string; tabClick?: string }[] = [
  { route: "/briefing" },                                  // existing
  { route: "/studio" },                                    // catalog (default)
  { route: "/studio", tabClick: "Editor" },
  { route: "/studio", tabClick: "Benchmarks" },
  { route: "/studio", tabClick: "ROI Dashboard" },
  { route: "/studio", tabClick: "Pilot Controls" }
];

for (const page of pages) {
  for (const w of [400, 768, 1024, 1440, 2560]) {
    test(`${page.route} ${page.tabClick ?? "default"} @ ${w}px`, async ({ page: pwPage }) => {
      // navigate, take screenshot, compare to baseline
    });
  }
}
```

**Steps 2-5:** Generate baselines once with `--update-snapshots`. Verify subsequent runs match. Commit: `add-25-visual-regression-baselines-for-studio-surface`.

**Sub-phase 2G acceptance check:**
- `cd apps/desktop && npm run test:responsive` → all green
- Total visual baselines: 5 (Phase 1 Briefing) + 25 (Phase 2 Studio) = 30
- Total Playwright tests: 20 (Phase 1) + ~20 (Phase 2 additions) ≈ 40

---

## Final Phase 2 acceptance gate

After Task G.8 commits, run the full verification suite from worktree root:

```bash
# 1. Workspace test matrix (all packages)
npm test 2>&1 | tail -20

# 2. Desktop responsive aggregator
cd apps/desktop && npm run test:responsive

# 3. Web bundle smoke (manual)
npm run web:serve &
sleep 5
curl -s -X POST http://localhost:8080/api/listBlueprints -H 'content-type: application/json' -d '{"args":[]}' | head -c 200
kill %1

# 4. Build clean
npm run build 2>&1 | tail -10
```

All four steps must pass with zero failures.

Then create a Phase 2 acceptance verification doc at `docs/plans/2026-05-21-phase-2-acceptance-verification.md` (modeled after `docs/plans/2026-05-21-phase-1-acceptance-verification.md`) documenting which design criteria are met, any deviations, and the final commit count.

---

## Execution handoff

**Plan complete and saved to `docs/plans/2026-05-21-ai-studio-v1-plan.md`. Two execution options:**

**1. Subagent-Driven (this session)** — I dispatch a fresh implementer subagent per task, run spec compliance review then code quality review between tasks, fast iteration with checkpoints. Stays in this session, no context switch.

**2. Parallel Session (separate)** — Open a new session in this worktree, that session uses `superpowers:executing-plans` to batch-execute with human-in-the-loop checkpoints.

**Which approach?**
