# Connector MCP support + model catalog freshness + demo cleanup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` (or `superpowers:subagent-driven-development` if dispatching this from the same session) to implement this plan task-by-task.

**Goal:** Ship the three independent pieces of work from `docs/plans/2026-05-17-connector-mcp-and-catalog-design.md`: (A) cleanup demos and flip default connectors to real-mode, (B) refresh the static model catalog and add live auto-refresh on form open, (C) add MCP server support so operators can plug in any of hundreds of community MCP tools.

**Architecture:** All three pieces extend existing structures rather than adding new top-level concepts. Demo cleanup is a one-line refactor + JSON edits. Catalog refresh is a content edit + a debounced `useEffect`. MCP is a new pair of modules (`McpClient` / `McpClientManager`) wired into the existing `ToolRegistry` so MCP tools land alongside manifest connectors as `mcp.<server>.<tool>` — the sensitivity policy, approval queue, and trace events all apply for free.

**Tech Stack:** TypeScript, React (renderer), Electron IPC, `better-sqlite3` (DB), Vitest (tests), `@modelcontextprotocol/sdk` (new, for MCP client). Node 22+. The workspace is a yarn-classic-style npm monorepo under `packages/*` and `apps/*`.

**Phasing:** A first (10 min, smallest, unblocks visual verification of B/C). B next (independent of A and C; 30 min). C last (largest; 2-3 hours; split into seven sub-tasks so each is committable).

**Conventions:**
- All commits use the prefix-free imperative style this repo uses (`update-X`, `add-Y`, `fix-Z`) — never Conventional Commits.
- TDD: write the failing test first, run it to see it fail, then implement.
- Frequent commits — one per task at minimum, more if natural break points appear.
- DRY / YAGNI: use existing helpers (`mergeWithLiveModels`, `registerConnector` upsert semantics, `ToolContext.emitEvent`, etc.) rather than re-inventing.
- Subagents executing this plan should read the design doc once at start (`docs/plans/2026-05-17-connector-mcp-and-catalog-design.md`) and the design's section 7 acceptance criteria again before claiming a task complete.

---

# Phase A — Demo cleanup + real-mode defaults

This phase is intentionally first because it lands in ~15 minutes and visually changes the Connectors tab from "filled with demos" to "ready to configure" — making later phases easier to test in-app.

### Task A.1: Always-upsert shipped manifests in `devIntegration.ts`

**Why first:** Without this change, every other JSON edit in this phase is invisible to existing app installs (the DB row keeps the old `fixtureMode: true` cached manifest).

**Files:**
- Modify: `packages/connectors/src/devIntegration.ts:14-28`
- Test: `packages/connectors/test/devIntegration.test.ts` (new)

**Step 1: Write the failing test**

Create `packages/connectors/test/devIntegration.test.ts`:

```typescript
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase } from "@squidbot/db";
import { ConnectorRegistry, installDeveloperWorkflowConnectors } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-devint-"));
  tempDirs.push(dir);
  return initializeDatabase(path.join(dir, "test.sqlite"));
}

describe("installDeveloperWorkflowConnectors", () => {
  it("refreshes the cached manifest from disk on every install", () => {
    const database = tempDb();
    const registry = new ConnectorRegistry(database);

    // Pre-seed a stale manifest for "github" with fixtureMode: true.
    database.saveConnector({
      id: "connector-stale",
      name: "github",
      manifest: {
        name: "github",
        systemType: "version_control",
        description: "Stale.",
        protocol: "rest",
        auth: { type: "bearer" },
        permissions: [],
        endpoints: [],
        dataClassifications: ["public"],
        costOwner: "free",
        fixtureMode: true,
        readWrite: { read: [], write: [] }
      },
      createdAt: new Date().toISOString()
    });

    // Construct a fresh registry that reads the stale row into memory…
    const stale = new ConnectorRegistry(database);
    expect(stale.getConnector("github")?.fixtureMode).toBe(true);

    // …then run install. The disk manifest's current value must overwrite.
    const refreshed = installDeveloperWorkflowConnectors(stale);
    const github = refreshed.find((c) => c.name === "github");
    expect(github).toBeDefined();
    // After Task A.2 lands the file flip, this will be `false`. Until then,
    // the test only proves that the manifest was re-read from disk by
    // checking that endpoints (the real manifest has 22) replaced the empty
    // stub above:
    expect((github?.endpoints.length ?? 0)).toBeGreaterThan(5);
    database.close();
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@squidbot/connectors -- devIntegration`
Expected: FAIL — the assertion `endpoints.length > 5` currently fails because the early-return preserves the stub.

**Step 3: Implement — drop the early-return**

Edit `packages/connectors/src/devIntegration.ts:14-28` from:

```typescript
export function installDeveloperWorkflowConnectors(registry: ConnectorRegistry): ConnectorManifest[] {
  const installed: ConnectorManifest[] = [];

  for (const relativePath of developerConnectorManifestRelativePaths) {
    const manifestPath = resolveRepoFile(relativePath);
    const manifest = registry.loadManifest(manifestPath);
    if (!registry.getConnector(manifest.name)) {
      installed.push(registry.registerConnector(manifest));
    } else {
      installed.push(registry.getConnector(manifest.name)!);
    }
  }

  return installed;
}
```

To:

```typescript
export function installDeveloperWorkflowConnectors(registry: ConnectorRegistry): ConnectorManifest[] {
  const installed: ConnectorManifest[] = [];

  for (const relativePath of developerConnectorManifestRelativePaths) {
    const manifestPath = resolveRepoFile(relativePath);
    const manifest = registry.loadManifest(manifestPath);
    // Shipped manifests are versioned through the JSON file — the file is
    // the source of truth. Always upsert so a fixtureMode flip or endpoint
    // update lands for existing installs without needing a migration.
    installed.push(registry.registerConnector(manifest));
  }

  return installed;
}
```

**Step 4: Run the test to verify it passes**

Run: `npm test --workspace=@squidbot/connectors -- devIntegration`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/src/devIntegration.ts packages/connectors/test/devIntegration.test.ts
git commit -m "always-upsert-shipped-manifests-from-disk

Existing installs kept the stale fixtureMode: true row when the JSON
files changed. Dropping the early-return makes the bundled JSON the
source of truth, so future flips propagate without a migration."
```

---

### Task A.2: Flip the four shipped connectors to `fixtureMode: false`

**Files:**
- Modify: `connectors/demo/githubConnector.json`
- Modify: `connectors/demo/gitlabConnector.json`
- Modify: `connectors/demo/jiraConnector.json`
- Modify: `connectors/demo/jenkinsConnector.json`

**Step 1: Edit each JSON file**

For all four files: change `"fixtureMode": true` → `"fixtureMode": false`. Also strip the sentence `"Fixture mode is enabled by default."` from the `description` field where present.

For `githubConnector.json`, change `"description"` from:
```
"GitHub repository, issue, pull request, and Actions connector. Fixture mode is enabled by default."
```
to:
```
"GitHub repository, issue, pull request, and Actions connector."
```

Repeat the analogous edit for gitlab, jira, jenkins.

**Step 2: Verify with a quick test run**

The Phase A.1 test now stops being load-bearing for `fixtureMode` — extend it with one assertion:

Edit `packages/connectors/test/devIntegration.test.ts` to add at the end of the existing test, after the `endpoints.length` check:

```typescript
    expect(github?.fixtureMode).toBe(false);
```

Run: `npm test --workspace=@squidbot/connectors -- devIntegration`
Expected: PASS.

**Step 3: Update existing tests that depended on `fixtureMode: true` defaults**

The shipped manifests' fixtureMode now starts as `false`. Tests that previously relied on `fixtureMode: true` being the default need to set it explicitly.

Run: `grep -rn "fixtureMode" packages/connectors/test/ apps/desktop/src/ | grep -v ".test.tsx.snap"`
For each test that asserts `fixtureMode: true` against a github/gitlab/jira/jenkins manifest, either (a) the test was specifically about fixture behavior and the test should construct its own manifest with `fixtureMode: true` (not load from disk), or (b) the test was incidentally depending on it and should be updated.

Specifically expect to update:
- `apps/desktop/src/renderer/src/components/ConnectorsSection.test.tsx` — if any fixture chip assertion exists for github/gitlab/jira/jenkins, flip the expected text.

**Step 4: Run the full connector + UI test suite**

Run: `npm test --workspace=@squidbot/connectors && npm test --workspace=squidbot-desktop -- ConnectorsSection`
Expected: PASS.

**Step 5: Commit**

```bash
git add connectors/demo/githubConnector.json connectors/demo/gitlabConnector.json connectors/demo/jiraConnector.json connectors/demo/jenkinsConnector.json packages/connectors/test/devIntegration.test.ts apps/desktop/src/renderer/src/components/ConnectorsSection.test.tsx
git commit -m "flip-shipped-connectors-to-real-mode-default

github / gitlab / jira / jenkins now ship with fixtureMode: false so
new and existing installs see 'Add a key to use this' (grey dot) by
default instead of 'Mock data — toggle off for real' (yellow dot)."
```

---

### Task A.3: Delete `demoSales` connector

**Files:**
- Delete: `connectors/demo/salesConnector.json`
- Modify: `apps/cli/src/index.ts:310,326,607-608` — drop references in CLI usage text.

**Step 1: Verify what references the file**

Run: `grep -rn "salesConnector\.json\|connectors/demo/salesConnector" apps/ packages/ docs/ 2>/dev/null`

Expected references (acceptable / to update):
- `apps/cli/src/index.ts:310` — error message in `npm run connectors -- install` usage hint.
- `apps/cli/src/index.ts:607-608` — usage text for the help command.

Test files using the literal `demoSales` connector name (e.g. `packages/connectors/test/connectors.test.ts`, `packages/db/test/db.test.ts`) construct the manifest in-test and do not load `salesConnector.json` from disk — they keep working without changes.

**Step 2: Delete the file**

```bash
rm connectors/demo/salesConnector.json
```

**Step 3: Update CLI usage text**

In `apps/cli/src/index.ts` change every reference to `./connectors/demo/salesConnector.json` to point at a still-existing manifest (use `githubConnector.json` as the example):

`apps/cli/src/index.ts:310`:
```typescript
throw new Error("Usage: npm run connectors -- install ./connectors/demo/githubConnector.json");
```

`apps/cli/src/index.ts:607-608`:
```typescript
console.log("  npm run connectors -- install ./connectors/demo/githubConnector.json");
console.log("  npm run connectors -- import-openapi ./packages/connectors/test/fixtures/petstore.json --name petstore");
```

(The second line anticipates Task A.4's move; update both at once.)

**Step 4: Run the full test suite for regressions**

Run: `npm test --workspace=@squidbot/connectors && npm test --workspace=@squidbot/db && npm test --workspace=squidbot-cli`
Expected: PASS.

**Step 5: Commit**

```bash
git add -A connectors/demo/salesConnector.json apps/cli/src/index.ts
git commit -m "remove-demosales-connector

A pure fixture with no real API behind it. Confusing in a real product.
Test suites that construct demoSales manifests in-test continue to
work since they never loaded the JSON file from disk."
```

---

### Task A.4: Move petstore artifacts to test fixtures

**Files:**
- Move: `connectors/generated/petstore.json` → `packages/connectors/test/fixtures/petstore.json`
- Move: `packages/connectors/src/generated/petstore/index.ts` → `packages/connectors/test/fixtures/petstore-generated/index.ts`
- Modify: `packages/connectors/src/index.ts` — drop the petstore re-export if present.
- Modify: `packages/connectors/test/connectors.test.ts:129-130` — update import paths if it references the old locations.

**Step 1: Move the artifacts**

```bash
mkdir -p packages/connectors/test/fixtures
git mv connectors/generated/petstore.json packages/connectors/test/fixtures/petstore.json
git mv packages/connectors/src/generated/petstore packages/connectors/test/fixtures/petstore-generated
```

If `connectors/generated/` is now empty:

```bash
rmdir connectors/generated 2>/dev/null || true
```

**Step 2: Check for stale exports**

Run: `grep -rn "src/generated/petstore\|connectors/generated/petstore" packages/ apps/ 2>/dev/null`

If any code imports from `packages/connectors/src/generated/petstore`, update those imports to the new test-fixture path (only test files should be importing this).

**Step 3: Update `packages/connectors/test/connectors.test.ts`**

Check if `connectors.test.ts:129-130` does:
```typescript
const specPath = path.join(tempDir, "petstore.json");
const manifestPath = path.join(tempDir, "petstoreConnector.json");
```

It writes a temp `petstore.json` in the test — so no path change needed. But if any tests *load* the petstore artifact from the old `src/generated/petstore` path, update that path to `test/fixtures/petstore-generated`.

**Step 4: Run the full connectors test suite**

Run: `npm test --workspace=@squidbot/connectors`
Expected: PASS.

**Step 5: Commit**

```bash
git add -A
git commit -m "move-petstore-artifacts-to-test-fixtures

Petstore stays useful as an OpenAPI-import fixture but should not
ship as a visible connector in production. Moving to
packages/connectors/test/fixtures keeps the artifacts accessible
to tests without showing up in the Connectors list."
```

---

### Task A.5: Visual verification

**Step 1: Boot the desktop app**

```bash
npm run electron:dev
```

**Step 2: Open Integrations → Connectors tab**

Expected:
- Four connectors visible (github / gitlab / jira / jenkins).
- All four show the grey-dot status with "Add a key to use this" — not the yellow "Mock data" indicator.
- No `demoSales` row.
- No `petstore` row.

**Step 3: Verify the status indicator can be changed**

For one connector (github), paste any string into the API key field and click Save. The status should flip from grey → blue ("Test connection ↗"). Click Test. Expect a red status with an auth error code — proving the real HTTP path executes (no fixture stub returned).

**Step 4: Commit nothing (verification only)**

This task produces no file changes — it's a smoke check that A.1-A.4 worked end-to-end. If something is off, return to the failing task. If it works, move on to Phase B.

---

# Phase B — Model catalog freshness

### Task B.1: Refresh `providerCatalog.ts` static content

**Why this task is content-heavy:** The model lists for each major provider are stale. This is a research + edit task — fetch each provider's docs and replace the entries. The structure stays identical.

**Files:**
- Modify: `packages/core/src/providerCatalog.ts:146-322` (the per-provider arrays for anthropic, deepseek, gemini, groq, openai, together, xai)
- Modify: `packages/core/src/providerCatalog.ts:77-143` (the openrouter array — refresh the top entries)
- Test: `packages/core/test/providerCatalog.test.ts` (new)

**Step 1: Research current models for each provider**

For each provider, fetch the docs page or pricing page. Use `WebFetch` tool with these URLs:

| Provider | URL | What to extract |
|---|---|---|
| Anthropic | `https://docs.anthropic.com/en/docs/about-claude/models` | All current Claude Opus / Sonnet / Haiku model ids + list prices per 1M tokens. |
| OpenAI | `https://platform.openai.com/docs/models` | Current GPT-5 family, GPT-4o family, o3 family + prices. |
| DeepSeek | `https://api-docs.deepseek.com/quick_start/pricing` | V3 / V3.1 / R1 / R1-Lite / Coder model ids + prices. |
| Gemini | `https://ai.google.dev/gemini-api/docs/models/gemini` | Gemini 2.5 Pro / Flash / Flash-Lite, 2.0 Flash + prices. |
| xAI | `https://docs.x.ai/docs/models` | Grok 4 / 4-fast / 3 / 3-mini + prices. |
| Groq | `https://console.groq.com/docs/models` | Current Llama / Mixtral / Qwen list + prices. |
| OpenRouter | (optional — pulls live) | Skip; the openrouter array is just a "what's popular" sampler. |

The actual list lands at implementation time — don't pin specific model ids in this plan; pin the *count* (≥3 per direct provider; ≥6 for OpenRouter sampler).

**Step 2: Write the structural-invariant test first**

Create `packages/core/test/providerCatalog.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { PROVIDER_MODEL_CATALOG, getDefaultModelForProvider } from "../src/providerCatalog.js";

describe("PROVIDER_MODEL_CATALOG", () => {
  const directProviders = ["anthropic", "deepseek", "gemini", "groq", "openai", "together", "xai"] as const;

  describe.each(directProviders)("%s", (provider) => {
    const catalog = PROVIDER_MODEL_CATALOG[provider];

    it("has at least 3 entries", () => {
      expect(catalog.length).toBeGreaterThanOrEqual(3);
    });

    it("has at least one flagship-tier entry", () => {
      expect(catalog.some((entry) => entry.tier === "flagship")).toBe(true);
    });

    it("attaches pricing to every entry", () => {
      for (const entry of catalog) {
        expect(entry.pricing, `${entry.id} missing pricing`).toBeDefined();
        expect(entry.pricing!.inputPerMTokens).toBeDefined();
        expect(entry.pricing!.outputPerMTokens).toBeDefined();
      }
    });

    it("has unique model ids", () => {
      const ids = catalog.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("exposes a non-null default model", () => {
      expect(getDefaultModelForProvider(provider)).not.toBeNull();
    });
  });

  it("openrouter sampler has at least 6 entries", () => {
    expect(PROVIDER_MODEL_CATALOG.openrouter.length).toBeGreaterThanOrEqual(6);
  });

  it("ollama and custom remain unaffected by the refresh", () => {
    expect(PROVIDER_MODEL_CATALOG.ollama.length).toBeGreaterThan(0);
    expect(PROVIDER_MODEL_CATALOG.custom.length).toBe(0);
  });
});
```

**Step 3: Run the test to verify it passes against the current catalog**

Run: `npm test --workspace=@squidbot/core -- providerCatalog`
Expected: PASS — the test pins structural invariants the current catalog already meets (3 entries each, all with prices, etc.). The test is the *bulwark* for the refresh; if you accidentally drop pricing on an entry in step 4, this catches it.

**Step 4: Update each provider's array**

Now edit `packages/core/src/providerCatalog.ts`. For each direct provider, the new array is what you researched in Step 1. Maintain ordering rule: **first entry = the workhorse default** (cheap+fast), with flagship and reasoning tier entries after. Maintain `tier`, optional `description`, and `pricing` (both `inputPerMTokens` and `outputPerMTokens`).

Example shape (Anthropic — fill the actual values from docs):

```typescript
anthropic: [
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    tier: "fast",
    description: "Cheapest + fastest Claude — great for high-volume work.",
    pricing: { inputPerMTokens: 0.8, outputPerMTokens: 4 }
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    tier: "balanced",
    description: "Strong default — fast enough for chat, smart enough for code.",
    pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
  },
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    tier: "balanced",
    pricing: { inputPerMTokens: 3, outputPerMTokens: 15 }
  },
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    tier: "flagship",
    description: "Most capable Claude — premium pricing.",
    pricing: { inputPerMTokens: 15, outputPerMTokens: 75 }
  },
  {
    id: "claude-opus-4-6",
    label: "Claude Opus 4.6",
    tier: "flagship",
    pricing: { inputPerMTokens: 15, outputPerMTokens: 75 }
  },
  {
    id: "claude-opus-4-5",
    label: "Claude Opus 4.5",
    tier: "legacy",
    pricing: { inputPerMTokens: 15, outputPerMTokens: 75 }
  }
],
```

Repeat the same pattern for deepseek (V3, V3.1, R1, R1-Lite, Coder), gemini (2.5 Pro, 2.5 Flash, 2.5 Flash-Lite, 2.0 Flash), xai (Grok 4, Grok 4 Fast, Grok 3, Grok 3 Mini), groq (current Llama / Mixtral / Qwen), openai (GPT-5 family, o3 family, GPT-4o family).

For the OpenRouter sampler at lines 77-143, keep the existing 6+ entries and update model ids where the underlying provider has dropped them. The OpenRouter array is illustrative, not authoritative — live `/v1/models` always wins.

**Step 5: Update the "Last reviewed" comment**

Change line 23 from:
```typescript
 * Last reviewed: 2026-05. Refresh when providers ship new flagships.
```
to:
```typescript
 * Last reviewed: 2026-05-17. Refresh when providers ship new flagships.
```

**Step 6: Run the structural-invariant test**

Run: `npm test --workspace=@squidbot/core -- providerCatalog`
Expected: PASS.

**Step 7: Run modelAccounts tests to make sure nothing depended on specific old ids**

Run: `npm test --workspace=@squidbot/core -- modelAccounts`
Expected: PASS. If any test pins a specific old model id (like `"claude-opus-4-5"` is no longer first in the array), update the test to use one of the new ids.

**Step 8: Commit**

```bash
git add packages/core/src/providerCatalog.ts packages/core/test/providerCatalog.test.ts
git commit -m "refresh-static-model-catalog-to-2026-05

Anthropic now ships Opus 4.7 / 4.6 / 4.5, Sonnet 4.6 / 4.5, Haiku 4.5.
DeepSeek ships V3 / V3.1 / R1 / R1-Lite / Coder. Gemini ships 2.5 Pro /
Flash / Flash-Lite + 2.0 Flash. xAI ships Grok 4 / 4 Fast / 3 / 3 Mini.
OpenAI, Groq, Together refreshed against current docs. Pricing pulled
from each provider's pricing page.

Adds a structural-invariant test that pins shape (>=3 entries per
direct provider, every entry has pricing, ids unique) without pinning
specific ids so the catalog can be refreshed in the future without
breaking the test."
```

---

### Task B.2: Auto-refresh `discoverModels` on Provider change

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ModelAccountsSection.tsx:139-151` (the `selectProvider` function)
- Modify: `apps/desktop/src/renderer/src/components/ModelAccountsSection.test.tsx` (add a test)

**Step 1: Write the failing test**

In `ModelAccountsSection.test.tsx`, add a new test inside the existing `describe`:

```typescript
it("calls discoverModels when the user changes provider with a key already set", async () => {
  const discover = vi.fn(async () => ({
    success: true,
    models: ["claude-opus-4-7"],
    merged: [{ id: "claude-opus-4-7", label: "Claude Opus 4.7", tier: "flagship" }]
  }));
  mount({ discoverModels: discover });
  const { ModelAccountsSection } = await import("./ModelAccountsSection");
  const { getByText, getByLabelText } = render(<ModelAccountsSection forceOpenForm />);

  // Wait for presets to render
  await waitFor(() => expect(getByLabelText(/API key/i)).toBeInTheDocument());

  // Type a key
  fireEvent.change(getByLabelText(/API key/i), { target: { value: "sk-test" } });

  // Switch to anthropic — should fire discoverModels immediately
  fireEvent.change(getByLabelText(/Provider/i), { target: { value: "anthropic" } });

  await waitFor(() => {
    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({ providerKind: "anthropic", apiKey: "sk-test" })
    );
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test --workspace=squidbot-desktop -- ModelAccountsSection`
Expected: FAIL — `discover` is not called.

**Step 3: Implement the auto-refresh**

In `apps/desktop/src/renderer/src/components/ModelAccountsSection.tsx:139-151`, change the `selectProvider` function to fire `refreshModels` when the key is already set:

```typescript
function selectProvider(kind: ProviderKindDto): void {
  const preset = presets.find((p) => p.providerKind === kind);
  if (!preset) return;
  setForm((current) => ({
    ...current,
    providerKind: kind,
    apiUrl: preset.defaultApiUrl,
    apiModel: preset.defaultModel ?? "",
    catalog: preset.catalog,
    discoveryError: null,
    discoverySuccess: null
  }));
  // If a key is already in the form, auto-refresh against the new provider
  // so the dropdown reflects what's actually available on that key. This
  // covers the case where the user typed a key, switched providers, and
  // would otherwise see the new provider's STATIC catalog instead of the
  // live one.
  // NB: we read the form state inside a setTimeout(0) so the state above
  // has flushed before refreshModels reads form.providerKind. Without the
  // defer, refreshModels would see the OLD providerKind.
  setTimeout(() => {
    setForm((current) => {
      if (current.apiKey && current.apiUrl) {
        void refreshModels();
      }
      return current;
    });
  }, 0);
}
```

**Step 4: Run the test to verify it passes**

Run: `npm test --workspace=squidbot-desktop -- ModelAccountsSection`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ModelAccountsSection.tsx apps/desktop/src/renderer/src/components/ModelAccountsSection.test.tsx
git commit -m "auto-refresh-models-on-provider-change

When the user already has a key entered and switches the Provider
dropdown, fire discoverModels for the new provider so the model
dropdown swaps to that provider's live catalog instead of the
static one."
```

---

### Task B.3: Debounced auto-refresh `discoverModels` on API key entry

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ModelAccountsSection.tsx:73-130` (add a `useEffect` debouncing the key)
- Modify: `apps/desktop/src/renderer/src/components/ModelAccountsSection.test.tsx` (add a test using vi.useFakeTimers)

**Step 1: Write the failing test**

Add to `ModelAccountsSection.test.tsx`:

```typescript
it("debounces and calls discoverModels 300ms after key entry stops", async () => {
  vi.useFakeTimers();
  const discover = vi.fn(async () => ({
    success: true,
    models: ["claude-opus-4-7"],
    merged: [{ id: "claude-opus-4-7", label: "Claude Opus 4.7", tier: "flagship" }]
  }));
  mount({ discoverModels: discover });
  const { ModelAccountsSection } = await import("./ModelAccountsSection");
  const { getByLabelText } = render(<ModelAccountsSection forceOpenForm />);
  await waitFor(() => expect(getByLabelText(/API key/i)).toBeInTheDocument());

  // Type the key character by character
  fireEvent.change(getByLabelText(/API key/i), { target: { value: "s" } });
  fireEvent.change(getByLabelText(/API key/i), { target: { value: "sk" } });
  fireEvent.change(getByLabelText(/API key/i), { target: { value: "sk-" } });
  fireEvent.change(getByLabelText(/API key/i), { target: { value: "sk-test" } });

  // Not yet fired
  expect(discover).not.toHaveBeenCalled();

  // Advance 250ms — still not fired
  vi.advanceTimersByTime(250);
  expect(discover).not.toHaveBeenCalled();

  // Advance another 100ms (350ms total since last keystroke) — fires
  vi.advanceTimersByTime(100);
  await waitFor(() => {
    expect(discover).toHaveBeenCalledTimes(1);
    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test" })
    );
  });
  vi.useRealTimers();
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test --workspace=squidbot-desktop -- ModelAccountsSection`
Expected: FAIL.

**Step 3: Implement the debounced effect**

Add to `apps/desktop/src/renderer/src/components/ModelAccountsSection.tsx` after the existing `useEffect` at line 116-131:

```typescript
/**
 * Debounced auto-refresh from the live /v1/models endpoint whenever the
 * user finishes editing the API key. 300ms is "just long enough that
 * paste-and-tab feels instant, but not so short that each keystroke
 * fires a request." Without this, the user has to click Refresh after
 * pasting their key — a small but real friction point.
 */
useEffect(() => {
  if (!showForm || !form.apiKey || !form.apiUrl) return;
  const handle = setTimeout(() => {
    void refreshModels();
  }, 300);
  return () => clearTimeout(handle);
  // We deliberately depend only on apiKey, apiUrl, and showForm — NOT
  // on the rest of the form. We don't want this to re-fire when the
  // user picks a different model in the dropdown.
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [form.apiKey, form.apiUrl, showForm]);
```

**Step 4: Run the test to verify it passes**

Run: `npm test --workspace=squidbot-desktop -- ModelAccountsSection`
Expected: PASS.

**Step 5: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ModelAccountsSection.tsx apps/desktop/src/renderer/src/components/ModelAccountsSection.test.tsx
git commit -m "debounced-auto-refresh-on-api-key-entry

300ms after the user stops typing in the API key field, fire
discoverModels so the dropdown swaps to the live model list without
requiring a manual Refresh click. Debounce coalesces keystrokes; the
effect doesn't re-fire when the user picks a different model from
the dropdown."
```

---

### Task B.4: Visual verification of Phase B

**Step 1: Boot the desktop app**

```bash
npm run electron:dev
```

**Step 2: Open Integrations → AI models → "+ Add account"**

- Provider: Anthropic
- Expected: Model dropdown shows **at least 6 entries** including "Claude Opus 4.7" and "Claude Sonnet 4.6". (Previously: only 3 entries, none of them 4.7.)

**Step 3: Switch provider to DeepSeek**

- Expected: Model dropdown shows V3, V3.1, R1, R1-Lite, Coder (5+ entries).

**Step 4: Paste an API key**

- Wait ~500ms after pasting.
- Expected: Either the dropdown swaps to a longer live list (success) OR the existing static list stays and a small error toast appears (auth failed) — but the dropdown is never empty.

**Step 5: Commit nothing (verification only)**

If any of the above doesn't behave as expected, return to the failing task. Otherwise move on to Phase C.

---

# Phase C — MCP integration

MCP integration is the largest piece. Split into seven sub-tasks so each lands in <1 hour and is independently committable.

### Task C.1: Add the `@modelcontextprotocol/sdk` dependency

**Files:**
- Modify: `packages/connectors/package.json`

**Step 1: Add the dependency**

Edit `packages/connectors/package.json` dependencies block:

```json
"dependencies": {
  "@modelcontextprotocol/sdk": "^1.0.0",
  "@squidbot/core": "0.1.0",
  "@squidbot/db": "0.1.0",
  "yaml": "^2.8.1"
}
```

**Step 2: Install**

Run: `npm install --workspace=@squidbot/connectors`
Expected: lockfile updated, no errors.

**Step 3: Verify the import works**

Quickly create `/tmp/mcp-sanity-check.ts` and run it to confirm the SDK loads:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
console.log("MCP SDK OK", typeof Client, typeof StdioClientTransport);
```

Run: `cd packages/connectors && npx tsx /tmp/mcp-sanity-check.ts`
Expected: prints `MCP SDK OK function function`.

Delete the sanity script.

**Step 4: Run the existing connectors test suite to verify no regression**

Run: `npm test --workspace=@squidbot/connectors`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/package.json package-lock.json
git commit -m "add-mcp-sdk-dependency

Adds @modelcontextprotocol/sdk as a runtime dependency of
@squidbot/connectors so the upcoming McpClient / McpClientManager
modules can speak the Model Context Protocol over stdio."
```

---

### Task C.2: DB migration 18 — `mcp_servers` table

**Files:**
- Modify: `packages/db/src/migrations.ts` (append migration 18)
- Modify: `packages/db/src/database.ts` (add CRUD methods)
- Test: `packages/db/test/db.test.ts` (add test)

**Step 1: Write the failing test**

In `packages/db/test/db.test.ts`, add a new describe block:

```typescript
describe("mcp_servers", () => {
  it("round-trips an MCP server config", () => {
    const db = openTestDatabase();
    const saved = db.saveMcpServer({
      id: "mcp_1",
      name: "filesystem-home",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"],
      env: { READ_ONLY: "true" },
      riskLevel: "medium",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    expect(saved.name).toBe("filesystem-home");
    expect(saved.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"]);
    expect(saved.env).toEqual({ READ_ONLY: "true" });
    expect(saved.enabled).toBe(true);

    const list = db.listMcpServers();
    expect(list.find((s) => s.name === "filesystem-home")).toBeDefined();

    db.updateMcpServer("filesystem-home", { enabled: false, lastConnectedAt: new Date().toISOString() });
    const after = db.getMcpServer("filesystem-home");
    expect(after?.enabled).toBe(false);
    expect(after?.lastConnectedAt).toBeTruthy();

    db.deleteMcpServer("filesystem-home");
    expect(db.getMcpServer("filesystem-home")).toBeNull();

    db.close();
  });

  it("rejects invalid riskLevel via the CHECK constraint", () => {
    const db = openTestDatabase();
    expect(() => db.saveMcpServer({
      id: "bad",
      name: "bad",
      transport: "stdio",
      command: "echo",
      args: [],
      env: {},
      riskLevel: "bogus" as never,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })).toThrow();
    db.close();
  });
});
```

(`openTestDatabase` is the existing helper at the top of `db.test.ts`.)

**Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@squidbot/db -- mcp_servers`
Expected: FAIL (methods don't exist).

**Step 3: Implement the migration**

Append to `packages/db/src/migrations.ts` after migration 17:

```typescript
  {
    id: 18,
    name: "mcp_servers",
    up: `
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        transport TEXT NOT NULL CHECK (transport IN ('stdio')),
        command TEXT NOT NULL,
        argsJson TEXT NOT NULL DEFAULT '[]',
        envJson TEXT NOT NULL DEFAULT '{}',
        riskLevel TEXT NOT NULL CHECK (riskLevel IN ('low', 'medium', 'high', 'critical')),
        enabled INTEGER NOT NULL DEFAULT 1,
        lastConnectedAt TEXT,
        lastError TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled
        ON mcp_servers (enabled)
        WHERE enabled = 1;
    `
  }
```

**Step 4: Implement the CRUD methods**

Add to `packages/db/src/database.ts` near the `saveConnector` method (around line 1249):

```typescript
type StoredMcpServer = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  argsJson: string;
  envJson: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  enabled: number;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type McpServerRecord = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  riskLevel: "low" | "medium" | "high" | "critical";
  enabled: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type McpServerInput = Omit<McpServerRecord, "lastConnectedAt" | "lastError"> & {
  lastConnectedAt?: string | null;
  lastError?: string | null;
};

function parseMcpServer(row: StoredMcpServer): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: JSON.parse(row.argsJson) as string[],
    env: JSON.parse(row.envJson) as Record<string, string>,
    riskLevel: row.riskLevel,
    enabled: row.enabled === 1,
    lastConnectedAt: row.lastConnectedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
```

Then add CRUD methods on `SquidDatabase` (find a sensible spot, e.g. after `getConnector`):

```typescript
saveMcpServer(input: McpServerInput): McpServerRecord {
  this.db
    .prepare(
      `INSERT INTO mcp_servers
       (id, name, transport, command, argsJson, envJson, riskLevel, enabled, lastConnectedAt, lastError, createdAt, updatedAt)
       VALUES (@id, @name, @transport, @command, @argsJson, @envJson, @riskLevel, @enabled, @lastConnectedAt, @lastError, @createdAt, @updatedAt)
       ON CONFLICT(name) DO UPDATE SET
         command = excluded.command,
         argsJson = excluded.argsJson,
         envJson = excluded.envJson,
         riskLevel = excluded.riskLevel,
         enabled = excluded.enabled,
         lastConnectedAt = excluded.lastConnectedAt,
         lastError = excluded.lastError,
         updatedAt = excluded.updatedAt`
    )
    .run({
      id: input.id,
      name: input.name,
      transport: input.transport,
      command: input.command,
      argsJson: JSON.stringify(input.args),
      envJson: JSON.stringify(input.env),
      riskLevel: input.riskLevel,
      enabled: input.enabled ? 1 : 0,
      lastConnectedAt: input.lastConnectedAt ?? null,
      lastError: input.lastError ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt
    });
  const saved = this.getMcpServer(input.name);
  if (!saved) throw new Error(`MCP server was not saved: ${input.name}`);
  return saved;
}

listMcpServers(): McpServerRecord[] {
  const rows = this.db
    .prepare("SELECT * FROM mcp_servers ORDER BY name ASC")
    .all() as StoredMcpServer[];
  return rows.map(parseMcpServer);
}

getMcpServer(name: string): McpServerRecord | null {
  const row = this.db
    .prepare("SELECT * FROM mcp_servers WHERE name = ?")
    .get(name) as StoredMcpServer | undefined;
  return row ? parseMcpServer(row) : null;
}

updateMcpServer(
  name: string,
  updates: Partial<Pick<McpServerInput, "enabled" | "lastConnectedAt" | "lastError" | "command" | "args" | "env" | "riskLevel">>
): void {
  const existing = this.getMcpServer(name);
  if (!existing) throw new Error(`MCP server not found: ${name}`);
  this.saveMcpServer({
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString()
  });
}

deleteMcpServer(name: string): void {
  this.db.prepare("DELETE FROM mcp_servers WHERE name = ?").run(name);
}
```

**Step 5: Run the test to verify it passes**

Run: `npm test --workspace=@squidbot/db -- mcp_servers`
Expected: PASS.

**Step 6: Run the full DB test suite for regressions**

Run: `npm test --workspace=@squidbot/db`
Expected: PASS — migrations are idempotent and migration 18 is purely additive.

**Step 7: Commit**

```bash
git add packages/db/src/migrations.ts packages/db/src/database.ts packages/db/test/db.test.ts
git commit -m "add-mcp-servers-table-and-crud

Migration 18 introduces the mcp_servers table (id, name, transport,
command, args, env, riskLevel, enabled, lastConnectedAt, lastError,
timestamps). transport is currently CHECK'd to 'stdio' only.
riskLevel CHECK matches the same four levels as connector permissions.

SquidDatabase gains saveMcpServer (upsert by name), listMcpServers,
getMcpServer, updateMcpServer, deleteMcpServer."
```

---

### Task C.3: `McpClient` — one connection per server

**Files:**
- Create: `packages/connectors/src/mcpClient.ts`
- Modify: `packages/connectors/src/index.ts` (re-export McpClient + types)
- Test: `packages/connectors/test/mcpClient.test.ts` (new)

**Step 1: Write the failing test**

Create `packages/connectors/test/mcpClient.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { McpClient } from "../src/mcpClient.js";

describe("McpClient", () => {
  // We avoid spawning real npx MCP servers in unit tests — those are slow
  // and require network. Instead, point the client at a tiny inline node
  // script that speaks the MCP JSON-RPC handshake. Created via stdin.
  it("connects to a minimal stdio MCP server and lists tools", async () => {
    // A fake MCP server that handles initialize + tools/list and replies
    // with two tools.
    const fakeServer = `
      process.stdin.on("data", (chunk) => {
        for (const line of chunk.toString().split("\\n").filter(Boolean)) {
          const msg = JSON.parse(line);
          let response;
          if (msg.method === "initialize") {
            response = { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "fake", version: "1" }, capabilities: { tools: {} } } };
          } else if (msg.method === "notifications/initialized") {
            continue;
          } else if (msg.method === "tools/list") {
            response = { jsonrpc: "2.0", id: msg.id, result: { tools: [
              { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
              { name: "write_file", description: "Write a file", inputSchema: { type: "object" } }
            ] } };
          } else {
            response = { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown" } };
          }
          process.stdout.write(JSON.stringify(response) + "\\n");
        }
      });
    `;

    const client = new McpClient({
      name: "fake",
      command: "node",
      args: ["-e", fakeServer],
      env: {}
    });
    await client.connect();
    const tools = client.tools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["read_file", "write_file"]);
    await client.close();
  });

  it("surfaces a spawn error when the command does not exist", async () => {
    const client = new McpClient({
      name: "bogus",
      command: "/nonexistent/binary",
      args: [],
      env: {}
    });
    await expect(client.connect()).rejects.toThrow();
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@squidbot/connectors -- mcpClient`
Expected: FAIL (module doesn't exist).

**Step 3: Implement `McpClient`**

Create `packages/connectors/src/mcpClient.ts`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export type McpClientConfig = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
};

export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

/**
 * A single connection to an MCP server. Wraps the SDK's stdio transport
 * with a small surface tuned for our needs: connect → list tools → call
 * tool → close. The lifecycle is owned by McpClientManager (the pool);
 * this class doesn't restart itself.
 */
export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private cachedTools: McpToolDescriptor[] = [];

  constructor(private readonly config: McpClientConfig) {}

  async connect(): Promise<void> {
    if (this.client) return;
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: { ...process.env, ...this.config.env }
    });
    this.client = new Client(
      { name: `squidbot-mcp-${this.config.name}`, version: "0.1.0" },
      { capabilities: { tools: {} } }
    );
    await this.client.connect(this.transport);
    const list = await this.client.listTools();
    this.cachedTools = list.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object" }
    }));
  }

  tools(): McpToolDescriptor[] {
    return [...this.cachedTools];
  }

  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error(`McpClient for ${this.config.name} is not connected`);
    const result = await this.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  async close(): Promise<void> {
    try {
      await this.client?.close();
    } finally {
      this.client = null;
      this.transport = null;
      this.cachedTools = [];
    }
  }

  get name(): string {
    return this.config.name;
  }
}
```

Add to `packages/connectors/src/index.ts`:

```typescript
export { McpClient } from "./mcpClient.js";
export type { McpClientConfig, McpToolDescriptor } from "./mcpClient.js";
```

**Step 4: Run the test to verify it passes**

Run: `npm test --workspace=@squidbot/connectors -- mcpClient`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/src/mcpClient.ts packages/connectors/src/index.ts packages/connectors/test/mcpClient.test.ts
git commit -m "add-mcp-client-module

One McpClient instance per configured MCP server. Wraps the official
SDK's stdio transport with a small surface (connect / tools /
callTool / close). The lifecycle is owned by McpClientManager — this
class doesn't restart itself; it just speaks the protocol."
```

---

### Task C.4: `McpClientManager` — pool, registration, restart logic

**Files:**
- Create: `packages/connectors/src/mcpManager.ts`
- Modify: `packages/connectors/src/index.ts` (re-export)
- Test: `packages/connectors/test/mcpManager.test.ts`

**Step 1: Write the failing test**

Create `packages/connectors/test/mcpManager.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@squidbot/core";
import { McpClientManager } from "../src/mcpManager.js";

const FAKE_SERVER_SCRIPT = `
  process.stdin.on("data", (chunk) => {
    for (const line of chunk.toString().split("\\n").filter(Boolean)) {
      const msg = JSON.parse(line);
      let response;
      if (msg.method === "initialize") {
        response = { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "fake", version: "1" }, capabilities: { tools: {} } } };
      } else if (msg.method === "notifications/initialized") {
        continue;
      } else if (msg.method === "tools/list") {
        response = { jsonrpc: "2.0", id: msg.id, result: { tools: [
          { name: "ping", description: "Ping", inputSchema: { type: "object" } }
        ] } };
      } else if (msg.method === "tools/call") {
        response = { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "pong" }] } };
      } else {
        response = { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown" } };
      }
      process.stdout.write(JSON.stringify(response) + "\\n");
    }
  });
`;

describe("McpClientManager", () => {
  it("spawns enabled servers and registers their tools with mcp.<server>.<tool> naming", async () => {
    const toolRegistry = new ToolRegistry();
    const manager = new McpClientManager(toolRegistry);
    await manager.spawnAll([
      {
        name: "fakesrv",
        transport: "stdio",
        command: "node",
        args: ["-e", FAKE_SERVER_SCRIPT],
        env: {},
        riskLevel: "low"
      }
    ]);

    const tool = toolRegistry.get("mcp.fakesrv.ping");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("low");
    expect(tool?.metadata?.mcpServer).toBe("fakesrv");

    await manager.shutdown();
  });

  it("routes tool.handler calls through the MCP client", async () => {
    const toolRegistry = new ToolRegistry();
    const manager = new McpClientManager(toolRegistry);
    await manager.spawnAll([
      {
        name: "fakesrv",
        transport: "stdio",
        command: "node",
        args: ["-e", FAKE_SERVER_SCRIPT],
        env: {},
        riskLevel: "low"
      }
    ]);

    const events: { type: string; data: unknown }[] = [];
    const result = await toolRegistry.execute("mcp.fakesrv.ping", {}, {
      sessionId: "s",
      runId: "r",
      emitEvent: (type, data) => events.push({ type, data })
    });
    expect(result).toBeTruthy();
    expect(events.some((e) => e.type === "connector.http_call")).toBe(true);
    await manager.shutdown();
  });

  it("shutdown disconnects all clients", async () => {
    const toolRegistry = new ToolRegistry();
    const manager = new McpClientManager(toolRegistry);
    await manager.spawnAll([
      {
        name: "fakesrv",
        transport: "stdio",
        command: "node",
        args: ["-e", FAKE_SERVER_SCRIPT],
        env: {},
        riskLevel: "low"
      }
    ]);
    await manager.shutdown();
    expect(manager.clients()).toHaveLength(0);
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test --workspace=@squidbot/connectors -- mcpManager`
Expected: FAIL (module doesn't exist).

**Step 3: Implement `McpClientManager`**

Create `packages/connectors/src/mcpManager.ts`:

```typescript
import type { JsonObject, RiskLevel, ToolContext, ToolRegistry } from "@squidbot/core";
import { McpClient, type McpClientConfig } from "./mcpClient.js";

export type McpServerConfig = McpClientConfig & {
  transport: "stdio";
  riskLevel: RiskLevel;
};

/**
 * Owns the pool of McpClient instances. On `spawnAll`, connects every
 * provided server, discovers its tools, and registers them in the
 * ToolRegistry as `mcp.<serverName>.<toolName>` — so they live alongside
 * manifest connectors and pick up the same sensitivity policy, approval
 * queue, and trace event plumbing for free.
 */
export class McpClientManager {
  private readonly registry = new Map<string, McpClient>();

  constructor(private readonly toolRegistry: ToolRegistry) {}

  async spawnAll(configs: readonly McpServerConfig[]): Promise<void> {
    await Promise.all(configs.map((config) => this.spawnOne(config)));
  }

  async spawnOne(config: McpServerConfig): Promise<void> {
    const client = new McpClient(config);
    try {
      await client.connect();
    } catch (err) {
      // We don't crash startup if one MCP server fails — log + skip.
      // The UI will surface the failure via `getMcpServer().lastError`.
      console.error(`[mcp] failed to connect ${config.name}:`, err);
      return;
    }
    this.registry.set(config.name, client);

    for (const tool of client.tools()) {
      const toolName = `mcp.${config.name}.${tool.name}`;
      if (this.toolRegistry.get(toolName)) continue;
      this.toolRegistry.register({
        name: toolName,
        description: tool.description ?? `${config.name}.${tool.name}`,
        inputSchema: tool.inputSchema as JsonObject,
        permissionScopes: ["mcp.tool", `mcp:${config.name}`],
        riskLevel: config.riskLevel,
        metadata: {
          mcpServer: config.name,
          mcpTool: tool.name,
          mode: "mcp"
        },
        handler: async (args: JsonObject, context: ToolContext): Promise<JsonObject> => {
          context.emitEvent?.("connector.http_call", {
            connectorName: config.name,
            operationName: tool.name,
            method: "MCP",
            path: tool.name,
            args,
            mode: "mcp"
          });
          const result = await client.callTool(tool.name, args);
          return (result as JsonObject) ?? {};
        }
      });
    }
  }

  clients(): McpClient[] {
    return [...this.registry.values()];
  }

  async removeServer(name: string): Promise<void> {
    const client = this.registry.get(name);
    if (!client) return;
    try {
      await client.close();
    } finally {
      this.registry.delete(name);
      // Note: we leave tools registered with no handler for now — the
      // ToolRegistry doesn't have a public unregister yet. Re-spawning
      // the same server with the same tools is the workaround.
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.registry.values()].map((client) => client.close()));
    this.registry.clear();
  }
}
```

Add to `packages/connectors/src/index.ts`:

```typescript
export { McpClientManager } from "./mcpManager.js";
export type { McpServerConfig } from "./mcpManager.js";
```

**Step 4: Run the test to verify it passes**

Run: `npm test --workspace=@squidbot/connectors -- mcpManager`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/connectors/src/mcpManager.ts packages/connectors/src/index.ts packages/connectors/test/mcpManager.test.ts
git commit -m "add-mcp-client-manager

McpClientManager owns the pool of McpClients. spawnAll connects every
configured server, discovers its tools via tools/list, and registers
them in the ToolRegistry as mcp.<server>.<tool>. Tool handlers route
calls through the MCP client and emit connector.http_call events with
mode: 'mcp' so trace plumbing works unchanged."
```

---

### Task C.5: IPC handlers + preload + SquidbotApi types

**Files:**
- Modify: `apps/desktop/src/shared/api.ts` (add types + handler names)
- Modify: `apps/desktop/src/preload/index.ts` (wire handlers)
- Modify: `apps/desktop/src/main/ipc.ts` (implement handlers)
- Test: `apps/desktop/src/main/ipc.test.ts` (add tests if smoke coverage exists; otherwise rely on Task C.6 E2E)

**Step 1: Add the DTOs in `shared/api.ts`**

Add to `apps/desktop/src/shared/api.ts`:

```typescript
export type McpServerDto = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  riskLevel: "low" | "medium" | "high" | "critical";
  enabled: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
  toolCount: number;
};

export type McpServerInputDto = {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  riskLevel: "low" | "medium" | "high" | "critical";
  enabled: boolean;
};

export type McpServerTestResultDto =
  | { ok: true; toolCount: number; durationMs: number }
  | { ok: false; code: string; message: string };
```

Add to the `SquidbotApi` interface in the same file:

```typescript
listMcpServers: () => Promise<McpServerDto[]>;
addMcpServer: (input: McpServerInputDto) => Promise<McpServerDto>;
updateMcpServer: (name: string, input: Partial<McpServerInputDto>) => Promise<McpServerDto>;
removeMcpServer: (name: string) => Promise<void>;
testMcpServer: (input: McpServerInputDto) => Promise<McpServerTestResultDto>;
```

**Step 2: Wire the preload bridges**

Add to `apps/desktop/src/preload/index.ts` inside the `api: SquidbotApi = {…}` block, alphabetically near `listMemories`:

```typescript
listMcpServers: () => ipcRenderer.invoke("squidbot:listMcpServers"),
addMcpServer: (input) => ipcRenderer.invoke("squidbot:addMcpServer", input),
updateMcpServer: (name, input) => ipcRenderer.invoke("squidbot:updateMcpServer", name, input),
removeMcpServer: (name) => ipcRenderer.invoke("squidbot:removeMcpServer", name),
testMcpServer: (input) => ipcRenderer.invoke("squidbot:testMcpServer", input),
```

**Step 3: Implement the main-process handlers**

Add to `apps/desktop/src/main/ipc.ts` — in `registerIpcHandlers` near the `squidbot:testConnector` handler. First, persist a manager singleton at module scope (so the renderer doesn't re-spawn servers on every call):

```typescript
// Module-scope so the McpClientManager survives across IPC calls.
// Initialized lazily in createRuntime / on demand.
let mcpManager: McpClientManager | null = null;

function getMcpManager(toolRegistry: ToolRegistry): McpClientManager {
  if (!mcpManager) {
    mcpManager = new McpClientManager(toolRegistry);
  }
  return mcpManager;
}
```

Then the handlers:

```typescript
ipcMain.handle("squidbot:listMcpServers", (): McpServerDto[] => {
  const servers = database.listMcpServers();
  const manager = mcpManager;
  return servers.map((s) => ({
    id: s.id,
    name: s.name,
    command: s.command,
    args: s.args,
    env: s.env,
    riskLevel: s.riskLevel,
    enabled: s.enabled,
    lastConnectedAt: s.lastConnectedAt,
    lastError: s.lastError,
    toolCount: manager?.clients().find((c) => c.name === s.name)?.tools().length ?? 0
  }));
});

ipcMain.handle("squidbot:addMcpServer", async (_event, input: McpServerInputDto): Promise<McpServerDto> => {
  const now = new Date().toISOString();
  const saved = database.saveMcpServer({
    id: createId("mcp"),
    name: input.name,
    transport: "stdio",
    command: input.command,
    args: input.args,
    env: input.env,
    riskLevel: input.riskLevel,
    enabled: input.enabled,
    createdAt: now,
    updatedAt: now
  });

  if (saved.enabled) {
    // Spawn lazily into the runtime's tool registry. The runtime is
    // (re)constructed per chat request, so we don't have a long-lived
    // toolRegistry to register into here. Trade-off documented below.
    try {
      const tempRegistry = new ToolRegistry();
      const manager = new McpClientManager(tempRegistry);
      await manager.spawnAll([{
        name: saved.name,
        transport: "stdio",
        command: saved.command,
        args: saved.args,
        env: saved.env,
        riskLevel: saved.riskLevel
      }]);
      database.updateMcpServer(saved.name, { lastConnectedAt: new Date().toISOString(), lastError: null });
      await manager.shutdown();
    } catch (err) {
      database.updateMcpServer(saved.name, {
        lastError: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const updated = database.getMcpServer(saved.name)!;
  return {
    id: updated.id,
    name: updated.name,
    command: updated.command,
    args: updated.args,
    env: updated.env,
    riskLevel: updated.riskLevel,
    enabled: updated.enabled,
    lastConnectedAt: updated.lastConnectedAt,
    lastError: updated.lastError,
    toolCount: 0
  };
});

ipcMain.handle("squidbot:updateMcpServer", async (_event, name: string, input: Partial<McpServerInputDto>): Promise<McpServerDto> => {
  database.updateMcpServer(name, input);
  const updated = database.getMcpServer(name);
  if (!updated) throw new Error(`MCP server not found: ${name}`);
  return {
    id: updated.id,
    name: updated.name,
    command: updated.command,
    args: updated.args,
    env: updated.env,
    riskLevel: updated.riskLevel,
    enabled: updated.enabled,
    lastConnectedAt: updated.lastConnectedAt,
    lastError: updated.lastError,
    toolCount: 0
  };
});

ipcMain.handle("squidbot:removeMcpServer", async (_event, name: string): Promise<void> => {
  database.deleteMcpServer(name);
});

ipcMain.handle("squidbot:testMcpServer", async (_event, input: McpServerInputDto): Promise<McpServerTestResultDto> => {
  const start = Date.now();
  const tempRegistry = new ToolRegistry();
  const manager = new McpClientManager(tempRegistry);
  try {
    await manager.spawnAll([{
      name: input.name,
      transport: "stdio",
      command: input.command,
      args: input.args,
      env: input.env,
      riskLevel: input.riskLevel
    }]);
    const clients = manager.clients();
    const found = clients.find((c) => c.name === input.name);
    if (!found) {
      return { ok: false, code: "spawn_failed", message: "Server failed to spawn." };
    }
    return { ok: true, toolCount: found.tools().length, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, code: "test_error", message: err instanceof Error ? err.message : String(err) };
  } finally {
    await manager.shutdown();
  }
});
```

Also update `createRuntime` at `apps/desktop/src/main/ipc.ts:170-182` to spawn enabled MCP servers into the runtime's tool registry:

```typescript
function createRuntime(database: SquidDatabase, workspacePath: string, sessionId?: string): AgentRuntime {
  const toolRegistry = new ToolRegistry();
  registerWorkspaceTools(toolRegistry);
  registerTerminalTools(toolRegistry);
  registerTestTools(toolRegistry);
  registerModelAccountTools(toolRegistry, database);
  const connectorRegistry = new ConnectorRegistry(database);
  installDeveloperWorkflowConnectors(connectorRegistry);
  registerConnectorTools(toolRegistry, connectorRegistry);

  // Spawn enabled MCP servers into the same ToolRegistry. We don't await
  // — startup shouldn't block on slow MCP servers. Tools that aren't yet
  // registered when an agent message arrives simply aren't available;
  // they appear on the next runtime construction.
  const mcpManager = new McpClientManager(toolRegistry);
  void mcpManager.spawnAll(
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

  return new AgentRuntime({ database, workspacePath, sessionId, toolRegistry });
}
```

**Step 4: Run the existing IPC tests for regressions**

Run: `npm test --workspace=squidbot-desktop`
Expected: PASS — none of the existing handlers were modified.

**Step 5: Commit**

```bash
git add apps/desktop/src/shared/api.ts apps/desktop/src/preload/index.ts apps/desktop/src/main/ipc.ts
git commit -m "wire-mcp-server-ipc-handlers

Adds listMcpServers / addMcpServer / updateMcpServer / removeMcpServer
/ testMcpServer IPCs with DTOs in shared/api.ts and bridges in
preload/index.ts. createRuntime now spawns all enabled MCP servers
into the runtime's ToolRegistry on construction — tools become
available as mcp.<server>.<tool> for the agent."
```

---

### Task C.6: MCP servers sub-section UI

**Files:**
- Create: `apps/desktop/src/renderer/src/components/McpServersSection.tsx`
- Create: `apps/desktop/src/renderer/src/components/McpServersSection.test.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/IntegrationsPage.tsx` (mount the new sub-section under the Connectors tab)

**Step 1: Write the failing test**

Create `apps/desktop/src/renderer/src/components/McpServersSection.test.tsx`:

```typescript
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function mount(overrides: {
  servers?: unknown[];
  addMcpServer?: (input: unknown) => Promise<unknown>;
  testMcpServer?: (input: unknown) => Promise<unknown>;
  removeMcpServer?: (name: string) => Promise<void>;
} = {}) {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listMcpServers: vi.fn(async () => overrides.servers ?? []),
      addMcpServer: overrides.addMcpServer ?? vi.fn(async (input: unknown) => input),
      testMcpServer: overrides.testMcpServer ?? vi.fn(async () => ({ ok: true, toolCount: 3, durationMs: 100 })),
      removeMcpServer: overrides.removeMcpServer ?? vi.fn(async () => undefined),
      updateMcpServer: vi.fn(async (_n: string, i: unknown) => i)
    }
  });
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("McpServersSection", () => {
  it("renders empty state when there are no servers", async () => {
    mount();
    const { McpServersSection } = await import("./McpServersSection");
    render(<McpServersSection />);
    await waitFor(() => {
      expect(screen.getByText(/No MCP servers configured/i)).toBeInTheDocument();
    });
  });

  it("renders a row per server", async () => {
    mount({
      servers: [
        { id: "1", name: "fs-home", command: "npx", args: [], env: {}, riskLevel: "medium", enabled: true, lastConnectedAt: null, lastError: null, toolCount: 8 }
      ]
    });
    const { McpServersSection } = await import("./McpServersSection");
    render(<McpServersSection />);
    await waitFor(() => {
      expect(screen.getByText("fs-home")).toBeInTheDocument();
      expect(screen.getByText(/8 tools/)).toBeInTheDocument();
    });
  });

  it("calls addMcpServer when the form is submitted", async () => {
    const addFn = vi.fn(async (input: unknown) => input);
    mount({ addMcpServer: addFn });
    const { McpServersSection } = await import("./McpServersSection");
    render(<McpServersSection />);
    await waitFor(() => expect(screen.getByText(/Add MCP server/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Add MCP server/i));
    fireEvent.change(screen.getByLabelText(/Server name/i), { target: { value: "filesystem-home" } });
    fireEvent.change(screen.getByLabelText(/Command/i), { target: { value: "npx" } });
    fireEvent.change(screen.getByLabelText(/Arguments/i), { target: { value: "-y @modelcontextprotocol/server-filesystem /Users/me" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save/i }));
    await waitFor(() => {
      expect(addFn).toHaveBeenCalledWith(expect.objectContaining({
        name: "filesystem-home",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"]
      }));
    });
  });
});
```

**Step 2: Run the test to verify it fails**

Run: `npm test --workspace=squidbot-desktop -- McpServersSection`
Expected: FAIL (module doesn't exist).

**Step 3: Implement the component**

Create `apps/desktop/src/renderer/src/components/McpServersSection.tsx`:

```typescript
import { useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { McpServerDto, McpServerInputDto } from "../../../shared/api";

const EMPTY_FORM: McpServerInputDto = {
  name: "",
  command: "npx",
  args: [],
  env: {},
  riskLevel: "medium",
  enabled: true
};

export function McpServersSection() {
  const [servers, setServers] = useState<McpServerDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<McpServerInputDto>(EMPTY_FORM);
  const [argsText, setArgsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setServers(await squidbotApi.listMcpServers());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => { void reload(); }, []);

  async function saveServer() {
    setSaving(true);
    setError(null);
    try {
      const args = argsText.trim().split(/\s+/).filter(Boolean);
      await squidbotApi.addMcpServer({ ...form, args });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setArgsText("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeServer(name: string) {
    if (!window.confirm(`Remove MCP server "${name}"?`)) return;
    await squidbotApi.removeMcpServer(name);
    await reload();
  }

  return (
    <section className="mcp-servers" aria-label="MCP servers">
      <header className="mcp-servers__header">
        <div>
          <h3>MCP servers</h3>
          <p className="muted">
            MCP servers are programs that run on your machine with your user's
            permissions. Only add servers you trust.
          </p>
        </div>
        {!showForm && (
          <button type="button" className="primary-button" onClick={() => setShowForm(true)}>
            <Plus size={14} aria-hidden /> Add MCP server
          </button>
        )}
      </header>

      {error && <div className="mcp-servers__error">{error}</div>}

      {servers.length === 0 && !showForm ? (
        <div className="empty-state compact">
          <h4>No MCP servers configured</h4>
          <p>Add one to give the agent access to hundreds of community-built tools.</p>
        </div>
      ) : (
        <ul className="mcp-servers__list">
          {servers.map((server) => (
            <li key={server.id} className="mcp-server-row">
              <div className="mcp-server-row__main">
                <strong>{server.name}</strong>
                <span className="chip chip--risk">{server.riskLevel}</span>
                <span className="muted">{server.toolCount} tools</span>
                {server.lastError && <span className="chip chip--error">error</span>}
              </div>
              <div className="mcp-server-row__actions">
                <button
                  type="button"
                  className="ghost-button"
                  aria-label={`Remove ${server.name}`}
                  onClick={() => void removeServer(server.name)}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {showForm && (
        <form
          className="mcp-servers__form"
          onSubmit={(e) => { e.preventDefault(); void saveServer(); }}
        >
          <label>
            <span>Server name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))}
              placeholder="e.g. filesystem-home"
              autoComplete="off"
              required
            />
          </label>
          <label>
            <span>Command</span>
            <input
              type="text"
              value={form.command}
              onChange={(e) => setForm((c) => ({ ...c, command: e.target.value }))}
              autoComplete="off"
              required
            />
          </label>
          <label>
            <span>Arguments</span>
            <input
              type="text"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem /Users/me"
              autoComplete="off"
            />
          </label>
          <label>
            <span>Risk level</span>
            <select
              value={form.riskLevel}
              onChange={(e) => setForm((c) => ({ ...c, riskLevel: e.target.value as McpServerInputDto["riskLevel"] }))}
            >
              <option value="low">Low — read-only tools</option>
              <option value="medium">Medium — writes prompt for approval on Sensitive profile</option>
              <option value="high">High — writes always prompt</option>
              <option value="critical">Critical — every call prompts</option>
            </select>
          </label>
          <div className="mcp-servers__form-actions">
            <button type="button" className="ghost-button" onClick={() => setShowForm(false)}>Cancel</button>
            <button type="submit" className="primary-button" disabled={saving}>
              <Save size={14} aria-hidden /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
```

**Step 4: Mount it on the IntegrationsPage**

Edit `apps/desktop/src/renderer/src/pages/IntegrationsPage.tsx` — under the Connectors tab content. Replace the current connectors-tab block (line 93-100) with a stacked layout that renders both ConnectorsSection AND McpServersSection:

```typescript
{tab === "connectors" && settings && (
  <>
    <ConnectorsSection
      settings={settings}
      onSettingsChange={setSettings}
      activeProfileSensitivity={activeProfile?.sensitivity}
    />
    <McpServersSection />
  </>
)}
{tab === "connectors" && !settings && <div className="muted">Loading…</div>}
```

And add the import at the top:

```typescript
import { McpServersSection } from "../components/McpServersSection";
```

**Step 5: Run the test to verify it passes**

Run: `npm test --workspace=squidbot-desktop -- McpServersSection`
Expected: PASS.

**Step 6: Run the navigation smoke test to verify Integrations still renders**

Run: `npm test --workspace=squidbot-desktop -- "navigation\|IntegrationsPage"`
Expected: PASS — both ConnectorsSection and McpServersSection render under the Connectors tab.

**Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/McpServersSection.tsx apps/desktop/src/renderer/src/components/McpServersSection.test.tsx apps/desktop/src/renderer/src/pages/IntegrationsPage.tsx
git commit -m "add-mcp-servers-ui-subsection

New McpServersSection lists configured servers with a 'Add MCP server'
form (name, command, args, risk level). The warning banner about trust
is shown above the form. Mounted under Integrations → Connectors tab
below the existing ConnectorsSection."
```

---

### Task C.7: End-to-end smoke + visual verification

**Step 1: Boot the desktop app**

```bash
npm run electron:dev
```

**Step 2: Navigate to Integrations → Connectors**

Expected: both the existing connector list (github, gitlab, jira, jenkins) AND the new "MCP servers" sub-section are visible. The MCP section shows empty state.

**Step 3: Add a real MCP server (filesystem)**

- Click "+ Add MCP server"
- Server name: `filesystem-test`
- Command: `npx`
- Arguments: `-y @modelcontextprotocol/server-filesystem /tmp`
- Risk level: `medium`
- Save

Expected:
- The save succeeds (~3-10s while npx downloads).
- The row appears with `8 tools` (or thereabouts — `read_file`, `write_file`, `list_directory`, etc.).
- No `lastError` chip.

**Step 4: Restart the app**

Quit and re-launch.
Expected: the `filesystem-test` row is still visible. The tool count may take ~10s to populate after restart (the runtime is constructed lazily on first chat).

**Step 5: Verify the agent can call MCP tools**

In the chat panel, ask: "List the files in /tmp using the filesystem MCP tool."

Expected: the agent calls `mcp.filesystem-test.list_directory` (visible in the History → traces tab), the result appears in the response, and the call shows up in trace events tagged with `mode: "mcp"`.

**Step 6: Remove the server**

Back on Integrations → Connectors → MCP servers, click the trash icon next to `filesystem-test` and confirm.
Expected: the row disappears. After restart, the tool is no longer registered.

**Step 7: Commit (visual verification only — no file changes)**

If anything is off (UI broken, save fails, tools don't register), return to the failing task. If everything works, the phase is done.

---

# Acceptance criteria recap (from the design)

Before claiming the plan complete, re-read `docs/plans/2026-05-17-connector-mcp-and-catalog-design.md` section 7 and confirm every checkbox:

**MCP integration:**
- [ ] Operator can add an MCP server via Integrations → Connectors → MCP servers → + Add MCP server.
- [ ] Saved servers persist across app restarts.
- [ ] On app start, all enabled MCP servers spawn (lazily via createRuntime).
- [ ] Tools from each MCP server register as `mcp.<server>.<tool>`.
- [ ] Calling an `mcp.*` tool from the agent routes through the MCP client.
- [ ] Crashed servers — note: the manager logs but doesn't currently auto-restart (out of scope for v1; see "deferred" below).
- [ ] Test button reports server health (toolCount > 0 → green; else red with error).
- [ ] Removing a server unregisters and deletes the row.

**Model catalog freshness:**
- [ ] Anthropic dropdown shows Opus 4.7 / Sonnet 4.6 in static catalog.
- [ ] DeepSeek dropdown shows ≥5 models.
- [ ] Form-open + key-present auto-fires `discoverModels` within 500ms.
- [ ] Provider change immediately fires `discoverModels` when key set.
- [ ] Manual "Refresh from API" button still works.
- [ ] Live API errors keep static catalog visible.

**Demo cleanup:**
- [ ] `demoSales` not in visible Connectors list.
- [ ] `petstore` artifacts moved to `packages/connectors/test/fixtures/`.
- [ ] github/gitlab/jira/jenkins show grey-dot "Add a key to use this".
- [ ] Existing installs see the flip on restart, no migration prompt.
- [ ] Existing fixture-mode tests still pass.

# Deferred (intentional)

- **MCP crash auto-restart with backoff** — McpClientManager currently logs failures but doesn't restart. Design Section 3.3 mentions backoff (1s → 2s → 5s → 30s cap); ship it in a follow-up to keep this v1 small.
- **MCP per-tool risk** — the protocol doesn't carry per-tool risk; per-server risk applies uniformly.
- **HTTP / SSE MCP transports** — stdio only for v1.
- **"Verified by SquidBot" curated server list** — future v2 work.

# Execution handoff

Plan complete and saved to `docs/plans/2026-05-17-connector-mcp-and-catalog-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch fresh subagent per task, two-stage review (spec compliance, then code quality) between tasks. Fast iteration, stays in this session.

**2. Parallel Session (separate)** — Open a new session in this worktree with `superpowers:executing-plans`. Batch execution with manual checkpoints between phases.

Recommended: **Subagent-Driven** for Phase A (small, fast feedback loop) and Phase B (focused single-file changes); **Parallel Session** for Phase C if you want to step away while the long-pole MCP work runs.

Which approach?
