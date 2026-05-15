# Sidebar reorganization + page audit — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Restructure the desktop app's sidebar from a flat 17-item list into a 6-item primary nav + collapsible Advanced group, introduce a top-level Integrations page, merge Runs+Memory into History, restructure Settings as left-rail tabs, and fix the one truly broken page (Approvals) the audit surfaced.

**Architecture:** Pure UI / IPC layer work in `apps/desktop`. No DB schema changes. No new packages. Existing pages get extracted into reusable section components (the pattern we proved this session with `ModelAccountsSection`). One new IPC facade for approvals. One file rename. Backwards-compatible nav redirects so deprecated `PageId` calls keep working.

**Tech Stack:** TypeScript 5.8, React 19, electron-vite, vitest + @testing-library/react, lucide-react icons, existing IPC bridge.

**Design doc:** `docs/plans/2026-05-15-sidebar-reorg-design.md` (read this first for the *why*).

---

## How to use this plan

- Work **one task at a time** in order. Each task ends with a commit.
- Every task follows TDD: failing test → run to confirm failure → implement → run to confirm pass → commit.
- For pure refactors (extraction, rename) the "test" is *the existing test suite passes after the refactor* — same gate, different framing.
- Run from the worktree: `~/Projects/SquidBot 2/.claude/worktrees/frosty-williamson-817c25/`.
- All test commands assume `cd` to the worktree root.
- After each phase, run the **full repo test suite** as a checkpoint (`npm test --workspaces --if-present`).

---

# Phase 1 — Shell (no behavior change, new chrome)

## Task 1.1: Add new PageIds and the deprecated-id redirect map

**Why:** Foundation for everything else. New `PageId` values for `integrations` and `history`; a redirect map so existing `onNavigate("traces" | "memory" | "identity" | ...)` calls don't break.

**Files:**
- Modify: `apps/desktop/src/renderer/src/types.ts:62-79` (`PageId` union)
- Create: `apps/desktop/src/renderer/src/lib/navRedirects.ts`
- Test: `apps/desktop/src/renderer/src/lib/navRedirects.test.ts`

### Step 1: Write the failing test

Create `apps/desktop/src/renderer/src/lib/navRedirects.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveNav } from "./navRedirects";

describe("resolveNav — redirect map for deprecated PageIds", () => {
  it("passes through current PageIds unchanged", () => {
    expect(resolveNav("chat")).toEqual({ pageId: "chat" });
    expect(resolveNav("integrations")).toEqual({ pageId: "integrations" });
    expect(resolveNav("history")).toEqual({ pageId: "history" });
    expect(resolveNav("settings")).toEqual({ pageId: "settings" });
  });

  it("redirects traces → history with tab=activity", () => {
    expect(resolveNav("traces")).toEqual({ pageId: "history", tab: "activity" });
  });

  it("redirects memory → history with tab=memory", () => {
    expect(resolveNav("memory")).toEqual({ pageId: "history", tab: "memory" });
  });

  it("redirects config-y PageIds into Settings tabs", () => {
    expect(resolveNav("identity")).toEqual({ pageId: "settings", tab: "profile" });
    expect(resolveNav("profiles")).toEqual({ pageId: "settings", tab: "profile" });
    expect(resolveNav("skills")).toEqual({ pageId: "settings", tab: "skills" });
    expect(resolveNav("governance")).toEqual({ pageId: "settings", tab: "governance" });
  });

  it("redirects messaging → integrations with tab=messaging", () => {
    expect(resolveNav("messaging")).toEqual({ pageId: "integrations", tab: "messaging" });
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -w apps/desktop -- --run navRedirects
```

Expected: FAIL — module `./navRedirects` doesn't exist.

### Step 3: Update `PageId` union in `types.ts`

In `apps/desktop/src/renderer/src/types.ts:62-79`, replace the existing `PageId` union with:

```typescript
export type PageId =
  | "chat"
  | "onboarding"
  | "integrations"      // NEW — top-level home for AI models / connectors / messaging
  | "history"           // NEW — merges traces (runs) + memory
  | "approvals"
  | "trust"
  | "settings"
  // Advanced (collapsed by default)
  | "jobs"
  | "teams"
  | "evals"
  | "sandboxes"
  | "gaps"
  // Deprecated but kept reachable through navRedirects — do NOT remove,
  // some pages call onNavigate("traces"|"memory"|...) and resolveNav handles
  // the redirect to the new destination.
  | "identity"
  | "profiles"
  | "traces"
  | "memory"
  | "messaging"
  | "governance";
```

### Step 4: Create `navRedirects.ts`

```typescript
import type { PageId } from "../types";

/**
 * Some pages in the codebase call onNavigate("traces") or
 * onNavigate("identity") etc. After the sidebar reorganization those PageIds
 * no longer have their own destinations — they live as tabs inside History
 * or Settings. This function translates a deprecated PageId into the new
 * { pageId, tab? } shape so callers don't have to know about the move.
 *
 * The union of `tab` is intentionally string (not a strict type) — each
 * receiving page validates its own tab values. Keeping it loose here means
 * the redirect map and the tab implementations evolve independently.
 */
export type ResolvedNav = {
  pageId: PageId;
  tab?: string;
};

export function resolveNav(pageId: PageId): ResolvedNav {
  switch (pageId) {
    case "traces":
      return { pageId: "history", tab: "activity" };
    case "memory":
      return { pageId: "history", tab: "memory" };
    case "identity":
      return { pageId: "settings", tab: "profile" };
    case "profiles":
      return { pageId: "settings", tab: "profile" };
    case "skills":
      return { pageId: "settings", tab: "skills" };
    case "governance":
      return { pageId: "settings", tab: "governance" };
    case "messaging":
      return { pageId: "integrations", tab: "messaging" };
    default:
      return { pageId };
  }
}
```

### Step 5: Run test to verify it passes

```bash
npm test -w apps/desktop -- --run navRedirects
```

Expected: PASS, 5/5 tests.

### Step 6: Typecheck the whole desktop app

```bash
npm run typecheck -w apps/desktop
```

Expected: clean exit. New PageId additions don't break any caller because the union is additive.

### Step 7: Commit

```bash
git add apps/desktop/src/renderer/src/types.ts apps/desktop/src/renderer/src/lib/navRedirects.ts apps/desktop/src/renderer/src/lib/navRedirects.test.ts
git commit -m "add-page-ids-and-nav-redirect-map-for-sidebar-reorg

New PageIds (integrations, history) and a resolveNav() helper that
translates deprecated PageIds (traces, memory, identity, profiles,
skills, governance, messaging) into { pageId, tab } pairs pointing
at their new destinations. Foundation for the sidebar reorg."
```

---

## Task 1.2: Extract `ConnectorsSection` from `SettingsPage`

**Why:** The connector configuration block is currently inline in `SettingsPage.tsx`. Extract it so both Settings (legacy, until Task 1.7) and the new Integrations page can use it. Same pattern we used for `ModelAccountsSection` this session.

**Files:**
- Create: `apps/desktop/src/renderer/src/components/ConnectorsSection.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` (remove the inline connector block, import the section)
- Test: `apps/desktop/src/renderer/src/components/ConnectorsSection.test.tsx`

### Step 1: Write the failing test

Create the test file. It should mount the component with mocked `window.squidbot` and assert:
- Renders empty-state copy when `settings.connectors.length === 0`
- Renders one row per connector
- Save button on a connector row calls `saveConnectorSetting`

```typescript
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsDto } from "../../../shared/api";

const emptySettings: SettingsDto = {
  appDataDir: "/tmp/x",
  databasePath: "/tmp/x/db",
  workspacePath: "/tmp/x",
  modelProvider: "mock",
  byokEnabled: false,
  modelSettings: {
    provider: "mock", apiKeyConfigured: false, apiUrl: undefined,
    apiModel: "mock", apiBudgetTokens: undefined, apiUsedTokens: 0,
    apiRemainingTokens: undefined, apiCost: 0, costOwner: "local/free"
  },
  connectors: [],
  connectorSettings: {}
};

beforeEach(() => {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: { saveConnectorSetting: vi.fn(async (...args) => ({ ...emptySettings })) }
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

describe("ConnectorsSection", () => {
  it("renders the empty state when no connectors are installed", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    render(<ConnectorsSection settings={emptySettings} onSettingsChange={vi.fn()} />);
    expect(screen.getByText("No connectors installed")).toBeTruthy();
  });

  it("renders one card per installed connector", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    const settings: SettingsDto = {
      ...emptySettings,
      connectors: [
        { name: "stripe", systemType: "payments", description: "Charges", protocol: "rest", fixtureMode: false, costOwner: "user-paid", operations: ["createCharge"] }
      ],
      connectorSettings: { stripe: { baseUrl: undefined, apiKeyConfigured: false } }
    };
    render(<ConnectorsSection settings={settings} onSettingsChange={vi.fn()} />);
    expect(screen.getByText("stripe")).toBeTruthy();
    expect(screen.getByText("Charges")).toBeTruthy();
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -w apps/desktop -- --run ConnectorsSection
```

Expected: FAIL — module doesn't exist.

### Step 3: Create the component

Move the connector-rendering JSX out of `SettingsPage.tsx` (lines starting at the `<section className="connector-settings-list" aria-label="Connector settings">` block) into a new file `apps/desktop/src/renderer/src/components/ConnectorsSection.tsx`. Props are `{ settings, onSettingsChange }` — those are the only data the inner block currently uses.

The signature should be:

```typescript
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { SettingsDto } from "../../../shared/api";

type ConnectorsSectionProps = {
  settings: SettingsDto;
  onSettingsChange: (next: SettingsDto) => void;
};

type ConnectorDrafts = Record<string, { apiKey: string; baseUrl: string }>;

export function ConnectorsSection({ settings, onSettingsChange }: ConnectorsSectionProps) {
  // ...same body that's currently in SettingsPage, including useState for drafts,
  // useEffect to sync drafts when settings change, and the JSX <section>...</section>
}
```

Copy the JSX block, the `updateConnectorDraft` / `saveConnectorSetting` helpers, and the `buildConnectorDrafts` helper verbatim from `SettingsPage.tsx`.

### Step 4: Wire `SettingsPage` to use the new section

In `SettingsPage.tsx`:
1. Add `import { ConnectorsSection } from "../components/ConnectorsSection";`
2. Replace the inline connector block (the `<section className="connector-settings-list" aria-label="Connector settings">...</section>`) with `<ConnectorsSection settings={settings} onSettingsChange={onSettingsChange} />`.
3. Remove the now-unused state and helper functions (`connectorDrafts`, `setConnectorDrafts`, `updateConnectorDraft`, `saveConnectorSetting`, `buildConnectorDrafts`).

### Step 5: Run tests to verify both still pass

```bash
npm test -w apps/desktop -- --run ConnectorsSection SettingsPage
```

Expected: PASS — new component tests pass AND existing SettingsPage tests still pass (the refactor preserves behavior).

```bash
npm run typecheck -w apps/desktop
```

Expected: clean exit.

### Step 6: Commit

```bash
git add apps/desktop/src/renderer/src/components/ConnectorsSection.tsx apps/desktop/src/renderer/src/components/ConnectorsSection.test.tsx apps/desktop/src/renderer/src/pages/SettingsPage.tsx
git commit -m "extract-connectors-section-from-settings-page

Same pattern as ModelAccountsSection (this session). The block is
now a reusable component so the upcoming IntegrationsPage can render
it alongside ModelAccountsSection and MessagingSection."
```

---

## Task 1.3: Extract `MessagingSection` from `MessagingPage`

**Why:** Messaging moves to Integrations as a tab. Extracting the inner content from `MessagingPage` lets us drop it into the Integrations tab without copying the markup.

**Files:**
- Read first: `apps/desktop/src/renderer/src/pages/MessagingPage.tsx` (300 lines, 18 interaction sites — understand what's there)
- Create: `apps/desktop/src/renderer/src/components/MessagingSection.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/MessagingPage.tsx` (becomes a thin wrapper)
- Test: existing `apps/desktop/src/renderer/src/pages/MessagingPage.test.tsx` must still pass

### Step 1: Read MessagingPage to understand what's there

```bash
wc -l apps/desktop/src/renderer/src/pages/MessagingPage.tsx
grep -n "useState\|useEffect\|squidbotApi" apps/desktop/src/renderer/src/pages/MessagingPage.tsx | head -20
```

### Step 2: Extract everything except the outer `<main>` header

Create `apps/desktop/src/renderer/src/components/MessagingSection.tsx` containing the body of `MessagingPage` minus the `<header>` chrome. Props: none (the page is self-contained — it manages its own data via IPC).

### Step 3: Reduce `MessagingPage` to a wrapper

`MessagingPage` becomes:

```typescript
import { MessagingSection } from "../components/MessagingSection";

export function MessagingPage() {
  return (
    <main className="page-panel">
      <header className="page-header">
        <div>
          <p className="section-label">Messaging</p>
          <h2>Messaging adapters & channels</h2>
        </div>
      </header>
      <MessagingSection />
    </main>
  );
}
```

### Step 4: Run existing tests

```bash
npm test -w apps/desktop -- --run MessagingPage
```

Expected: PASS — existing tests verify the page renders correctly via the wrapper.

### Step 5: Commit

```bash
git add apps/desktop/src/renderer/src/components/MessagingSection.tsx apps/desktop/src/renderer/src/pages/MessagingPage.tsx
git commit -m "extract-messaging-section-from-messaging-page

Body moves into a reusable component; the page becomes a thin
wrapper. Sets up the move to Integrations → Messaging tab in
Task 1.4."
```

---

## Task 1.4: Build `IntegrationsPage` with 3 tabs

**Why:** The new top-level destination. Uses the existing `ModelAccountsSection` (no change), the new `ConnectorsSection` (Task 1.2), and the new `MessagingSection` (Task 1.3).

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/IntegrationsPage.tsx`
- Test: `apps/desktop/src/renderer/src/pages/IntegrationsPage.test.tsx`
- CSS: append to `apps/desktop/src/renderer/src/styles/app.css`

### Step 1: Write the failing test

```typescript
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listModelAccounts: vi.fn(async () => ({ activeAccountName: null, accounts: [] })),
      getProviderPresets: vi.fn(async () => []),
      getSettings: vi.fn(async () => ({
        appDataDir: "/tmp", databasePath: "/tmp/db", workspacePath: "/tmp",
        modelProvider: "mock", byokEnabled: false,
        modelSettings: { provider: "mock", apiKeyConfigured: false, apiUrl: undefined, apiModel: "mock", apiBudgetTokens: undefined, apiUsedTokens: 0, apiRemainingTokens: undefined, apiCost: 0, costOwner: "local/free" },
        connectors: [], connectorSettings: {}
      })),
      saveConnectorSetting: vi.fn()
    }
  });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "squidbot"); });

describe("IntegrationsPage", () => {
  it("renders three tabs: AI models, Connectors, Messaging", async () => {
    const { IntegrationsPage } = await import("./IntegrationsPage");
    render(<IntegrationsPage />);
    expect(screen.getByRole("tab", { name: /ai models/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /connectors/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /messaging/i })).toBeTruthy();
  });

  it("defaults to the AI models tab", async () => {
    const { IntegrationsPage } = await import("./IntegrationsPage");
    render(<IntegrationsPage />);
    expect(screen.getByText(/save one or more api keys/i)).toBeTruthy();
  });

  it("switches to Connectors when its tab is clicked", async () => {
    const { IntegrationsPage } = await import("./IntegrationsPage");
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("tab", { name: /connectors/i }));
    expect(screen.getByText(/no connectors installed/i)).toBeTruthy();
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -w apps/desktop -- --run IntegrationsPage
```

Expected: FAIL — module doesn't exist.

### Step 3: Create the page

```typescript
import { useState } from "react";
import { Plug, Cpu, MessageCircle } from "lucide-react";
import { ModelAccountsSection } from "../components/ModelAccountsSection";
import { ConnectorsSection } from "../components/ConnectorsSection";
import { MessagingSection } from "../components/MessagingSection";
import { squidbotApi } from "../lib/api";
import type { SettingsDto } from "../../../shared/api";

type IntegrationsTab = "models" | "connectors" | "messaging";

type IntegrationsPageProps = {
  /**
   * Optional initial tab so onNavigate("messaging") (deprecated) can land
   * directly on the Messaging tab via the redirect map.
   */
  initialTab?: IntegrationsTab;
};

export function IntegrationsPage({ initialTab = "models" }: IntegrationsPageProps) {
  const [tab, setTab] = useState<IntegrationsTab>(initialTab);
  const [settings, setSettings] = useState<SettingsDto | null>(null);

  // ConnectorsSection needs settings — load lazily when its tab is opened.
  // (Avoids an upfront fetch for users who only ever use AI models.)
  if (tab === "connectors" && settings === null) {
    void squidbotApi.getSettings().then(setSettings);
  }

  return (
    <main className="page-panel integrations-page">
      <header className="page-header">
        <div>
          <p className="section-label">Integrations</p>
          <h2>Connect your tools</h2>
          <p className="page-subtitle">
            SquidBot uses AI models for reasoning and connectors for action. Keys live on this machine only —
            they never reach our servers.
          </p>
        </div>
      </header>

      <div className="integrations-tabs" role="tablist" aria-label="Integration types">
        <button role="tab" aria-selected={tab === "models"} className={tab === "models" ? "is-active" : ""} onClick={() => setTab("models")}>
          <Cpu size={15} aria-hidden /> AI models
        </button>
        <button role="tab" aria-selected={tab === "connectors"} className={tab === "connectors" ? "is-active" : ""} onClick={() => setTab("connectors")}>
          <Plug size={15} aria-hidden /> Connectors
        </button>
        <button role="tab" aria-selected={tab === "messaging"} className={tab === "messaging" ? "is-active" : ""} onClick={() => setTab("messaging")}>
          <MessageCircle size={15} aria-hidden /> Messaging
        </button>
      </div>

      <div className="integrations-tab-content">
        {tab === "models" && <ModelAccountsSection />}
        {tab === "connectors" && settings && <ConnectorsSection settings={settings} onSettingsChange={setSettings} />}
        {tab === "messaging" && <MessagingSection />}
      </div>
    </main>
  );
}
```

### Step 4: Add CSS for the tab strip

Append to `apps/desktop/src/renderer/src/styles/app.css`:

```css
/* ---- Integrations page tab strip ---- */
.integrations-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 18px;
}

.integrations-tabs button[role="tab"] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--muted);
  font-size: 13.5px;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: -1px;
}

.integrations-tabs button[role="tab"]:hover {
  color: var(--ink);
}

.integrations-tabs button[role="tab"].is-active {
  color: var(--teal-strong);
  border-bottom-color: var(--teal);
}
```

### Step 5: Run tests + typecheck

```bash
npm test -w apps/desktop -- --run IntegrationsPage
npm run typecheck -w apps/desktop
```

Expected: PASS + clean typecheck.

### Step 6: Commit

```bash
git add apps/desktop/src/renderer/src/pages/IntegrationsPage.tsx apps/desktop/src/renderer/src/pages/IntegrationsPage.test.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "add-integrations-page-with-three-tabs

Top-level destination for everything SquidBot connects to: AI
models, action connectors, messaging channels. Reuses existing
section components — no new IPC, no new data model."
```

---

## Task 1.5: Build `HistoryPage` with 2 tabs

**Why:** Merges traces (runs) + memory into one destination — both answer "what's SquidBot been up to?"

**Files:**
- Create: `apps/desktop/src/renderer/src/pages/HistoryPage.tsx`
- Test: `apps/desktop/src/renderer/src/pages/HistoryPage.test.tsx`

### Step 1: Write the failing test

```typescript
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listRuns: vi.fn(async () => []),
      listTraces: vi.fn(async () => []),
      listMemories: vi.fn(async () => [])
    }
  });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "squidbot"); });

describe("HistoryPage", () => {
  it("renders both Activity and Memory tabs", async () => {
    const { HistoryPage } = await import("./HistoryPage");
    render(<HistoryPage />);
    expect(screen.getByRole("tab", { name: /activity/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /memory/i })).toBeTruthy();
  });

  it("defaults to Activity tab", async () => {
    const { HistoryPage } = await import("./HistoryPage");
    render(<HistoryPage />);
    // RunListPage renders some Activity-specific copy — relax this to your
    // codebase's actual default copy if needed.
    expect(screen.getByRole("tab", { name: /activity/i })).toHaveAttribute("aria-selected", "true");
  });

  it("respects initialTab prop", async () => {
    const { HistoryPage } = await import("./HistoryPage");
    render(<HistoryPage initialTab="memory" />);
    expect(screen.getByRole("tab", { name: /memory/i })).toHaveAttribute("aria-selected", "true");
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -w apps/desktop -- --run HistoryPage
```

Expected: FAIL.

### Step 3: Create the page

```typescript
import { useState } from "react";
import { Activity, Database } from "lucide-react";
import { RunListPage } from "./RunListPage";
import { MemoryPage } from "./MemoryPage";

type HistoryTab = "activity" | "memory";

type HistoryPageProps = {
  initialTab?: HistoryTab;
};

export function HistoryPage({ initialTab = "activity" }: HistoryPageProps) {
  const [tab, setTab] = useState<HistoryTab>(initialTab);
  return (
    <main className="page-panel history-page">
      <header className="page-header">
        <div>
          <p className="section-label">History</p>
          <h2>Everything SquidBot has done and learned</h2>
        </div>
      </header>

      <div className="integrations-tabs" role="tablist" aria-label="History views">
        <button role="tab" aria-selected={tab === "activity"} className={tab === "activity" ? "is-active" : ""} onClick={() => setTab("activity")}>
          <Activity size={15} aria-hidden /> Activity
        </button>
        <button role="tab" aria-selected={tab === "memory"} className={tab === "memory" ? "is-active" : ""} onClick={() => setTab("memory")}>
          <Database size={15} aria-hidden /> Memory
        </button>
      </div>

      <div className="integrations-tab-content">
        {tab === "activity" && <RunListPage />}
        {tab === "memory" && <MemoryPage />}
      </div>
    </main>
  );
}
```

**Important:** the existing `RunListPage` and `MemoryPage` render their own `<main>` + `<header>` chrome. When dropped inside HistoryPage's `<main>` they nest. Either (a) refactor those two pages to optionally suppress their chrome via a prop, or (b) accept the nested rendering for v1 and clean up in a follow-up. **Pick (a) for v1**: add `embedded?: boolean` prop to RunListPage and MemoryPage that, when true, skips the outer header chrome.

### Step 4: Run tests + typecheck

```bash
npm test -w apps/desktop -- --run HistoryPage
npm run typecheck -w apps/desktop
```

Expected: PASS + clean typecheck.

### Step 5: Commit

```bash
git add apps/desktop/src/renderer/src/pages/HistoryPage.tsx apps/desktop/src/renderer/src/pages/HistoryPage.test.tsx apps/desktop/src/renderer/src/pages/RunListPage.tsx apps/desktop/src/renderer/src/pages/MemoryPage.tsx
git commit -m "add-history-page-with-activity-and-memory-tabs

Wraps existing RunListPage + MemoryPage as tab contents. Both
existing pages gain an embedded prop that lets the wrapper skip
their outer chrome to avoid nested <main> elements."
```

---

## Task 1.6: Extract `ProfileSection`, `IdentitySection`, `SkillsSection`, `GovernanceSection`

**Why:** Same pattern as Task 1.3 (Messaging). These existing pages become section components so they can drop into Settings tabs.

**Files (per extraction):**
- Create: `apps/desktop/src/renderer/src/components/<Name>Section.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/<Name>Page.tsx` (becomes thin wrapper)

Do **one extraction per commit** — four small commits, not one big one. Each follows the pattern:

1. Read the source page (e.g., `ProfilesPage.tsx`).
2. Create `ProfileSection.tsx` containing the body minus the `<header>` chrome.
3. Reduce the page to a thin wrapper that renders `<main><header>...</header><ProfileSection /></main>`.
4. Run existing tests: `npm test -w apps/desktop -- --run ProfilesPage` → must still pass.
5. Commit: `extract-profile-section-from-profiles-page` (etc.)

Repeat for `IdentityPage`, `SkillsPage`, `GovernancePage`.

**Special case — `IdentitySection`:** Add a `readonly?: boolean` prop (default true). When true, hide any "edit" / "regenerate" buttons inside (Identity is purely informational in the Profile tab — write actions stay on the standalone `IdentityPage` if it's referenced anywhere else). Read the page first to know if there ARE write actions to gate; if not, the prop is a no-op for now but reserves the future.

---

## Task 1.7: Rebuild `SettingsPage` as a left-rail tab shell

**Why:** Settings becomes a tabbed container — four tabs (General, Profile, Skills, Governance). General holds the existing workspace/app-prefs/onboarding-shortcut/docs content minus the connector and model sections (those moved to Integrations in Task 1.4).

**Files:**
- Modify (heavy rewrite): `apps/desktop/src/renderer/src/pages/SettingsPage.tsx`
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx` (update mounting + add tab-switching test)
- CSS: append left-rail styles to `apps/desktop/src/renderer/src/styles/app.css`

### Step 1: Write failing tests for the new tab structure

Add to `SettingsPage.test.tsx`:

```typescript
describe("SettingsPage — left-rail tabs", () => {
  it("renders four tabs in the rail: General, Profile, Skills, Governance", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(<SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />);
    expect(screen.getByRole("tab", { name: /^general$/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^profile$/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^skills$/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^governance$/i })).toBeTruthy();
  });

  it("clicking the Profile tab reveals the Profile section (and persists choice)", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(<SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />);
    fireEvent.click(screen.getByRole("tab", { name: /^profile$/i }));
    expect(window.localStorage.getItem("settings.activeTab")).toBe("profile");
  });

  it("respects initialTab prop", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(<SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} initialTab="skills" />);
    expect(screen.getByRole("tab", { name: /^skills$/i })).toHaveAttribute("aria-selected", "true");
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -w apps/desktop -- --run SettingsPage
```

Expected: FAIL on the new tests (existing ones still pass for now).

### Step 3: Rewrite `SettingsPage` as the tabbed shell

The page now has:
- A left rail with 4 tab buttons.
- A right-hand content panel that renders one of: `<GeneralSettings />` (the existing workspace + app-prefs + onboarding-shortcut + Docs accordion content), `<ProfileSection />` + `<IdentitySection readonly />`, `<SkillsSection />`, `<GovernanceSection />`.
- Tab state persists to `localStorage("settings.activeTab")`. Reads on mount, writes on every change.
- Accepts `initialTab?: SettingsTab` prop for deep-link redirects from `resolveNav`.

```typescript
type SettingsTab = "general" | "profile" | "skills" | "governance";

const TAB_STORAGE_KEY = "settings.activeTab";

function loadInitialTab(initialFromProps?: SettingsTab): SettingsTab {
  if (initialFromProps) return initialFromProps;
  const stored = window.localStorage.getItem(TAB_STORAGE_KEY);
  if (stored === "general" || stored === "profile" || stored === "skills" || stored === "governance") return stored;
  return "general";
}

export function SettingsPage({ settings, onSettingsChange, onNavigate, initialTab }: SettingsPageProps) {
  const [tab, setTab] = useState<SettingsTab>(() => loadInitialTab(initialTab));
  function switchTab(next: SettingsTab) {
    setTab(next);
    window.localStorage.setItem(TAB_STORAGE_KEY, next);
  }
  return (
    <main className="page-panel settings-page">
      {/* ... left rail + right panel ... */}
    </main>
  );
}
```

Inline the existing `<GeneralSettings>` content (workspace folder, model budget, db path, app data, onboarding shortcut, Docs section). **Remove the inline connector and model-routing markup** — those moved to Integrations.

### Step 4: Add left-rail CSS

```css
.settings-page--tabbed {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 24px;
  align-items: start;
}

.settings-rail {
  display: flex;
  flex-direction: column;
  gap: 2px;
  position: sticky;
  top: 24px;
}

.settings-rail button[role="tab"] {
  background: transparent;
  border: none;
  text-align: left;
  padding: 9px 14px;
  border-radius: 8px;
  font-size: 13.5px;
  color: var(--muted);
  cursor: pointer;
  font-weight: 500;
}

.settings-rail button[role="tab"]:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.settings-rail button[role="tab"][aria-selected="true"] {
  background: var(--teal);
  color: #fff;
  font-weight: 600;
}

@media (max-width: 800px) {
  .settings-page--tabbed { grid-template-columns: 1fr; }
  .settings-rail { flex-direction: row; flex-wrap: wrap; position: static; }
}
```

### Step 5: Run all tests + typecheck

```bash
npm test -w apps/desktop
npm run typecheck -w apps/desktop
```

Expected: PASS. The existing onboarding-shortcut and docs-accordion tests still pass because those live inside the General tab and are rendered when General is the active tab (which is the default).

### Step 6: Commit

```bash
git add apps/desktop/src/renderer/src/pages/SettingsPage.tsx apps/desktop/src/renderer/src/pages/SettingsPage.test.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "rebuild-settings-as-left-rail-tab-shell

Four tabs (General / Profile / Skills / Governance). Tab state
persists across reloads. Removes the inline connector and
model-routing sections (now lives in Integrations). General tab
preserves all existing Settings content (workspace, onboarding
shortcut, Docs accordion, app prefs)."
```

---

## Task 1.8: Update `App.tsx` — sidebar reorg + onNavigate redirect plumbing

**Why:** The shell phase ends here. The sidebar shows the 6 primary items + collapsible Advanced; `onNavigate` calls flow through `resolveNav`.

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- CSS: append Advanced-collapse styles to `apps/desktop/src/renderer/src/styles/app.css`

### Step 1: Update the page registry

In `App.tsx`, replace the existing flat `pages` array. New structure:

```typescript
type NavItem = { id: PageId; label: string; icon: typeof MessageSquare };

const primaryPages: NavItem[] = [
  { id: "chat", label: "Chat", icon: MessageSquare },
  { id: "integrations", label: "Integrations", icon: Plug },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "trust", label: "Trust", icon: ShieldCheck },
  { id: "history", label: "History", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings }
];

const advancedPages: NavItem[] = [
  { id: "jobs", label: "Jobs", icon: CalendarClock },
  { id: "teams", label: "Teams", icon: UsersRound },
  { id: "evals", label: "Evals", icon: FlaskConical },
  { id: "sandboxes", label: "Sandboxes", icon: Boxes },
  { id: "gaps", label: "Gaps", icon: ShieldAlert }
];

const ADVANCED_OPEN_KEY = "sidebar.advancedOpen";
```

Remove the old flat `pages` array entirely. Update icon imports to drop now-unused ones (Wand2, Bot, UserCog, Database, Sparkles, MessageCircle, FlaskConical may still be used elsewhere — verify with grep).

### Step 2: Wire the sidebar JSX

Find the `<aside className="sidebar">` block. Replace its body so it renders:

```tsx
<aside className="sidebar">
  {/* Brand at top — unchanged */}
  <nav className="sidebar-nav" aria-label="Primary">
    {primaryPages.map(item => (
      <button key={item.id} ...>
        <item.icon size={17} aria-hidden />
        {item.label}
        {item.id === "approvals" && pendingApprovalCount > 0 && (
          <span className="nav-badge" aria-label={`${pendingApprovalCount} pending`}>
            {pendingApprovalCount}
          </span>
        )}
      </button>
    ))}
  </nav>

  <button
    type="button"
    className="sidebar-section-toggle"
    aria-expanded={advancedOpen}
    onClick={() => {
      setAdvancedOpen(v => !v);
      window.localStorage.setItem(ADVANCED_OPEN_KEY, String(!advancedOpen));
    }}
  >
    Advanced {advancedOpen ? "▾" : "▸"}
  </button>

  {advancedOpen && (
    <nav className="sidebar-nav sidebar-nav--advanced" aria-label="Advanced">
      {advancedPages.map(item => (
        <button key={item.id} ...>
          <item.icon size={15} aria-hidden />
          {item.label}
        </button>
      ))}
    </nav>
  )}

  {/* Status strip at bottom — unchanged */}
</aside>
```

### Step 3: Add `advancedOpen` + `pendingApprovalCount` state

In the `App` component body, add:

```typescript
const [advancedOpen, setAdvancedOpen] = useState<boolean>(() => {
  return window.localStorage.getItem(ADVANCED_OPEN_KEY) === "true";
});
const [pendingApprovalCount, setPendingApprovalCount] = useState<number>(0);
// pendingApprovalCount stays 0 in Phase 1 — Task 2.4 will wire it to listPendingApprovals.
```

### Step 4: Wire `onNavigate` through `resolveNav`

Find the `onNavigate` prop passed into `SettingsPage` and any other page that exposes one. Replace direct `setActivePage(pageId)` calls with:

```typescript
import { resolveNav } from "./lib/navRedirects";

const handleNavigate = (pageId: PageId, payload?: { tab?: string }) => {
  const resolved = resolveNav(pageId);
  setActivePage(resolved.pageId);
  if (resolved.tab || payload?.tab) {
    setPendingTab(payload?.tab ?? resolved.tab ?? null);
  }
};
```

Then route `pendingTab` into the destination page's `initialTab` prop.

### Step 5: Wire the page renderer

In the page-rendering switch/conditional inside `App.tsx`:

```typescript
{activePage === "chat" && <ChatPage ... />}
{activePage === "integrations" && <IntegrationsPage initialTab={pendingTab as any} />}
{activePage === "history" && <HistoryPage initialTab={pendingTab as any} />}
{activePage === "settings" && <SettingsPage ... initialTab={pendingTab as any} />}
{activePage === "approvals" && <ApprovalsPage />}
{activePage === "trust" && <TrustPage />}
{activePage === "onboarding" && <OnboardingPage />}
{activePage === "jobs" && <JobsPage />}
{activePage === "teams" && <TeamsPage />}
{activePage === "evals" && <EvaluationLabPage />}
{activePage === "sandboxes" && <SandboxesPage />}
{activePage === "gaps" && <AffordancePage />}    {/* renamed in Phase 3 */}
```

### Step 6: Append Advanced-toggle CSS

```css
.sidebar-section-toggle {
  margin: 14px 14px 6px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--muted);
  cursor: pointer;
  width: calc(100% - 28px);
  border-radius: 6px;
}
.sidebar-section-toggle:hover { background: var(--surface-2); color: var(--ink); }

.sidebar-nav--advanced button { padding: 8px 14px; font-size: 13px; }

.nav-badge {
  background: var(--coral);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  padding: 1px 7px;
  border-radius: 999px;
  margin-left: auto;
}
```

### Step 7: Test + typecheck + live-verify

```bash
npm test -w apps/desktop
npm run typecheck -w apps/desktop
npm run dev   # manually click each nav item; advanced collapse/expand works
```

Expected: tests pass, typecheck clean, every nav item lands somewhere (Approvals still empty — Phase 2 fixes that).

### Step 8: Commit

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "switch-sidebar-to-six-primary-plus-advanced-collapse

Replaces the flat 17-item sidebar with 6 primary items
(Chat / Integrations / Approvals / Trust / History / Settings)
plus a collapsed-by-default Advanced group (Jobs / Teams / Evals /
Sandboxes / Gaps). State persists per-machine in localStorage.

onNavigate calls now flow through resolveNav so deprecated PageIds
(traces, memory, identity, profiles, skills, governance, messaging)
redirect to their new destinations with a tab hint.

Approvals badge wiring stubbed (count=0 always) — Task 2.4 wires
it to the real pending count."
```

---

**Checkpoint after Phase 1:** Full repo test suite green; `npm run dev` launches; clicking every primary nav item + Advanced item lands on a rendering page. Approvals lands on the existing empty shell (Phase 2 fixes).

```bash
npm test --workspaces --if-present
```

---

# Phase 2 — Wire ApprovalsPage to real backend

## Task 2.1: Add `squidbot:listPendingApprovals` IPC facade

**Why:** The renderer should ask one stable IPC for "all things waiting for approval." Internally for v1 that maps to active sandboxes, but the facade lets us add other approval kinds later without renderer changes.

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts` (add the handler)
- Modify: `apps/desktop/src/preload/index.ts` (expose to renderer)
- Modify: `apps/desktop/src/shared/api.ts` (type the new API method)
- Test: `apps/desktop/src/main/ipc.test.ts` (if it doesn't exist, smoke test in `apps/cli` tests — verify IPC handler is registered)

### Step 1: Define the DTO

In `apps/desktop/src/shared/api.ts`, add:

```typescript
export type PendingApprovalDto = {
  id: string;                          // sandbox.id (for v1)
  kind: "sandbox-promotion";           // discriminator — future: "high-risk-tool", etc.
  title: string;                       // e.g. "Promote sandbox sb_abc to workspace"
  summary: string;                     // one-line context
  riskLevel: "low" | "medium" | "high";
  createdAt: string;
  payload: {                           // kind-specific data
    sandboxId?: string;
    workspacePath?: string;
  };
};
```

Add to the `SquidbotApi` type:

```typescript
listPendingApprovals: () => Promise<PendingApprovalDto[]>;
```

### Step 2: Expose in preload

In `apps/desktop/src/preload/index.ts`:

```typescript
listPendingApprovals: () => ipcRenderer.invoke("squidbot:listPendingApprovals"),
```

### Step 3: Implement the IPC handler

In `apps/desktop/src/main/ipc.ts` near the existing `approveSandbox` handler:

```typescript
ipcMain.handle("squidbot:listPendingApprovals", (): PendingApprovalDto[] => {
  // For v1 the only kind of approval is sandbox promotion. Other approval
  // kinds (high-risk tool call queues, etc.) plug in here later.
  const sandboxes = database.listSandboxes({ status: "active" });
  return sandboxes.map((sandbox) => ({
    id: sandbox.id,
    kind: "sandbox-promotion" as const,
    title: `Promote sandbox ${sandbox.id.slice(0, 12)}…`,
    summary: `Workspace: ${sandbox.workspacePath} · ${sandbox.diff.length} bytes of diff`,
    riskLevel: "medium",   // sandbox promotions are uniformly medium-risk
    createdAt: sandbox.createdAt,
    payload: { sandboxId: sandbox.id, workspacePath: sandbox.workspacePath }
  }));
});
```

### Step 4: Run typecheck + existing tests

```bash
npm run typecheck -w apps/desktop
npm test -w apps/desktop
```

Expected: clean. New handler doesn't affect existing tests.

### Step 5: Commit

```bash
git add apps/desktop/src/main/ipc.ts apps/desktop/src/preload/index.ts apps/desktop/src/shared/api.ts
git commit -m "add-list-pending-approvals-ipc-facade

For v1 maps to active sandboxes. The DTO has a kind discriminator
so future approval types (high-risk tool calls, etc.) can join
the queue without renderer changes."
```

---

## Task 2.2: Rebuild `ApprovalsPage` as a real queue with approve/reject actions

**Why:** Replaces the 20-line empty shell with a functional queue.

**Files:**
- Modify (heavy rewrite): `apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx`
- Test: `apps/desktop/src/renderer/src/pages/ApprovalsPage.test.tsx`

### Step 1: Write the failing test

```typescript
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sample = [
  { id: "sb_one", kind: "sandbox-promotion", title: "Promote sandbox sb_one…", summary: "Workspace: /tmp/x · 1024 bytes of diff", riskLevel: "medium", createdAt: "2026-05-15T10:00:00Z", payload: { sandboxId: "sb_one", workspacePath: "/tmp/x" } }
];

let listPending: ReturnType<typeof vi.fn>;
let approveSandbox: ReturnType<typeof vi.fn>;
let rejectSandbox: ReturnType<typeof vi.fn>;

beforeEach(() => {
  listPending = vi.fn(async () => sample);
  approveSandbox = vi.fn(async (id: string) => ({ id, status: "promoted" }));
  rejectSandbox = vi.fn(async (id: string) => ({ id, status: "rejected" }));
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: { listPendingApprovals: listPending, approveSandbox, rejectSandbox }
  });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "squidbot"); });

describe("ApprovalsPage", () => {
  it("renders the queue from listPendingApprovals", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText(/Promote sandbox sb_one/i)).toBeTruthy());
    expect(screen.getByText(/1024 bytes of diff/i)).toBeTruthy();
  });

  it("shows an empty state when nothing is pending", async () => {
    listPending.mockResolvedValueOnce([]);
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => expect(screen.getByText(/no pending approvals/i)).toBeTruthy());
  });

  it("clicking Approve calls approveSandbox and removes the row", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => screen.getByText(/Promote sandbox sb_one/i));
    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    await waitFor(() => expect(approveSandbox).toHaveBeenCalledWith("sb_one"));
  });

  it("clicking Reject calls rejectSandbox", async () => {
    const { ApprovalsPage } = await import("./ApprovalsPage");
    render(<ApprovalsPage />);
    await waitFor(() => screen.getByText(/Promote sandbox sb_one/i));
    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    await waitFor(() => expect(rejectSandbox).toHaveBeenCalledWith("sb_one"));
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -w apps/desktop -- --run ApprovalsPage
```

Expected: FAIL on every test — the current page has no `listPendingApprovals` call.

### Step 3: Rewrite `ApprovalsPage.tsx`

```typescript
import { useCallback, useEffect, useState } from "react";
import { Check, ShieldCheck, X } from "lucide-react";
import { squidbotApi } from "../lib/api";
import type { PendingApprovalDto } from "../../../shared/api";

export function ApprovalsPage() {
  const [pending, setPending] = useState<PendingApprovalDto[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await squidbotApi.listPendingApprovals();
      setPending(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function approve(item: PendingApprovalDto) {
    if (item.kind !== "sandbox-promotion" || !item.payload.sandboxId) return;
    setBusyId(item.id);
    try {
      await squidbotApi.approveSandbox(item.payload.sandboxId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function reject(item: PendingApprovalDto) {
    if (item.kind !== "sandbox-promotion" || !item.payload.sandboxId) return;
    setBusyId(item.id);
    try {
      await squidbotApi.rejectSandbox(item.payload.sandboxId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="page-panel approvals-page">
      <header className="page-header">
        <div>
          <p className="section-label">Approvals</p>
          <h2>Pending actions</h2>
          <p className="page-subtitle">
            SquidBot pauses risky operations and waits for your approval. Items in this queue are
            blocking real work — clear them when ready.
          </p>
        </div>
      </header>

      {error && <div className="error-strip">{error}</div>}

      {pending.length === 0 ? (
        <div className="empty-state">
          <ShieldCheck size={24} />
          <h3>No pending approvals</h3>
          <p>SquidBot will queue items here when it needs your sign-off on a risky action.</p>
        </div>
      ) : (
        <ul className="approval-list">
          {pending.map((item) => (
            <li className="approval-row" key={item.id}>
              <div className="approval-row__main">
                <div className="approval-row__title">
                  <strong>{item.title}</strong>
                  <span className={`chip chip--risk-${item.riskLevel}`}>{item.riskLevel}</span>
                </div>
                <div className="approval-row__summary">{item.summary}</div>
                <div className="approval-row__meta">
                  {item.kind} · {new Date(item.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="approval-row__actions">
                <button type="button" className="primary-button" onClick={() => void approve(item)} disabled={busyId === item.id}>
                  <Check size={14} aria-hidden /> Approve
                </button>
                <button type="button" className="ghost-button" onClick={() => void reject(item)} disabled={busyId === item.id}>
                  <X size={14} aria-hidden /> Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

### Step 4: Append CSS

```css
.approval-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.approval-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding: 14px 18px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); }
.approval-row__main { flex: 1; min-width: 0; }
.approval-row__title { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; font-size: 14px; color: var(--ink); }
.approval-row__summary { font-size: 13px; color: var(--ink); margin-bottom: 4px; }
.approval-row__meta { font-size: 11.5px; color: var(--muted); }
.approval-row__actions { display: flex; gap: 6px; flex-shrink: 0; }
.chip--risk-low { background: var(--green); color: #fff; }
.chip--risk-medium { background: var(--amber); color: #fff; }
.chip--risk-high { background: var(--coral); color: #fff; }
.chip--risk-low, .chip--risk-medium, .chip--risk-high { font-size: 11px; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
```

### Step 5: Run tests + typecheck

```bash
npm test -w apps/desktop -- --run ApprovalsPage
npm run typecheck -w apps/desktop
```

Expected: PASS.

### Step 6: Commit

```bash
git add apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx apps/desktop/src/renderer/src/pages/ApprovalsPage.test.tsx apps/desktop/src/renderer/src/styles/app.css
git commit -m "rebuild-approvals-page-as-real-queue-with-actions

Replaces the 20-line empty shell with a functional queue. Pulls
from listPendingApprovals (currently sandbox-promotion only),
exposes Approve / Reject buttons that mutate state via the
existing sandbox IPC, and renders a non-empty empty state when
nothing is pending."
```

---

## Task 2.3: Wire the sidebar badge to real pending count

**Why:** The badge stub in Task 1.8 always shows 0. Hook it up to `listPendingApprovals`. Poll on mount + after each chat send (catches mid-session new approvals).

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.tsx`

### Step 1: Add a test for the badge

In a new file `apps/desktop/src/renderer/src/App.test.tsx`:

```typescript
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      getSettings: vi.fn(async () => ({
        appDataDir: "/tmp", databasePath: "/tmp/db", workspacePath: "/tmp",
        modelProvider: "mock", byokEnabled: false,
        modelSettings: { provider: "mock", apiKeyConfigured: false, apiUrl: undefined, apiModel: "mock", apiBudgetTokens: undefined, apiUsedTokens: 0, apiRemainingTokens: undefined, apiCost: 0, costOwner: "local/free" },
        connectors: [], connectorSettings: {}
      })),
      listPendingApprovals: vi.fn(async () => [
        { id: "a", kind: "sandbox-promotion", title: "x", summary: "x", riskLevel: "medium", createdAt: "now", payload: {} },
        { id: "b", kind: "sandbox-promotion", title: "x", summary: "x", riskLevel: "medium", createdAt: "now", payload: {} }
      ]),
      listModelAccounts: vi.fn(async () => ({ activeAccountName: null, accounts: [] }))
    }
  });
});
afterEach(() => { cleanup(); Reflect.deleteProperty(window, "squidbot"); });

describe("App — sidebar badges", () => {
  it("shows a [2] badge on the Approvals nav item when pendingCount is 2", async () => {
    const { App } = await import("./App");
    render(<App />);
    await waitFor(() => {
      const badge = screen.getByLabelText(/2 pending/i);
      expect(badge).toBeTruthy();
      expect(badge.textContent).toBe("2");
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -w apps/desktop -- --run App.test
```

Expected: FAIL — `pendingApprovalCount` is hardcoded to 0 from Task 1.8.

### Step 3: Wire the count

In `App.tsx`, replace the stub state with real polling:

```typescript
const [pendingApprovalCount, setPendingApprovalCount] = useState<number>(0);

const refreshPendingCount = useCallback(async () => {
  try {
    const list = await squidbotApi.listPendingApprovals();
    setPendingApprovalCount(list.length);
  } catch {
    // Non-fatal — keep last known value.
  }
}, []);

useEffect(() => {
  void refreshPendingCount();
}, [refreshPendingCount]);
```

Also call `refreshPendingCount()` after `sendChatMessage` resolves (a chat turn can produce a new sandbox approval). Pass the callback to ChatPage via a new prop, or expose via a context.

### Step 4: Run test + typecheck

```bash
npm test -w apps/desktop -- --run App.test
npm run typecheck -w apps/desktop
```

Expected: PASS.

### Step 5: Commit

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/App.test.tsx
git commit -m "wire-approvals-badge-to-real-pending-count

Sidebar [N] chip on Approvals reflects listPendingApprovals().length.
Polls on App mount and after every chat send (a chat turn can create
new sandbox approvals via tool execution)."
```

---

**Checkpoint after Phase 2:** Approvals page works end-to-end. Create a test sandbox via the CLI (`npm run sandbox -- create ...`) and verify:
- The Approvals nav item shows `[1]`.
- Clicking Approvals lists the sandbox.
- Approve → sandbox promoted, badge drops to 0.

```bash
npm test --workspaces --if-present
```

---

# Phase 3 — Cleanup

## Task 3.1: Rename `AffordancePage.tsx` → `GapsPage.tsx`

**Why:** Sidebar label "Gaps" should match the file/component name. Pure rename, no behavior change.

**Steps:**

```bash
git mv apps/desktop/src/renderer/src/pages/AffordancePage.tsx apps/desktop/src/renderer/src/pages/GapsPage.tsx
git mv apps/desktop/src/renderer/src/pages/AffordancePage.test.tsx apps/desktop/src/renderer/src/pages/GapsPage.test.tsx
```

In the renamed files, rename the React component (`AffordancePage` → `GapsPage`) and update the import in `App.tsx`. Search for any other references:

```bash
grep -rn "AffordancePage" apps/desktop/src
```

Update each reference. Run tests + typecheck.

```bash
npm test -w apps/desktop
npm run typecheck -w apps/desktop
git add -A
git commit -m "rename-affordance-page-to-gaps-page

Pure rename to match the sidebar label. Component, file, and test
file all align — searching for 'Gaps' now reveals the file directly
without an indirection through App.tsx's label/route lookup."
```

---

## Task 3.2: Update the Docs section's deep-link PageIds

**Why:** The Docs accordion (currently in Settings → General) has deep-link buttons pointing at old PageIds. After the reorg, those PageIds still resolve via `resolveNav`, but the *button labels* should match the new destinations.

**Files:**
- Modify: `apps/desktop/src/renderer/src/pages/SettingsPage.tsx` (the `DOC_TOPICS` constant)

### Step 1: Audit current DOC_TOPICS

```bash
grep -n "page:\s*\"" apps/desktop/src/renderer/src/pages/SettingsPage.tsx
```

### Step 2: Update labels to reflect new destinations

For each topic that referenced an old PageId, update the `page` value AND the `pageLabel` to match the new destination. Example:

```typescript
{
  title: "Memory",
  body: "...",
  page: "history",                // was: "memory"
  pageLabel: "Open History → Memory"  // was: "Open memory"
},
```

Full mapping:
- `"identity"` → `"settings"` + label "Open Settings → Profile" (Identity is now inside Profile)
- `"profiles"` → `"settings"` + label "Open Settings → Profile"
- `"skills"` → `"settings"` + label "Open Settings → Skills"
- `"governance"` → `"settings"` + label "Open Settings → Governance"
- `"messaging"` → `"integrations"` + label "Open Integrations → Messaging"
- `"traces"` (if present) → `"history"` + label "Open History"
- `"memory"` → `"history"` + label "Open History → Memory"

Add a new topic for Integrations (it didn't exist before — previously the connector setup was buried).

### Step 3: Run SettingsPage tests + commit

```bash
npm test -w apps/desktop -- --run SettingsPage
git add apps/desktop/src/renderer/src/pages/SettingsPage.tsx
git commit -m "update-docs-section-deep-links-for-sidebar-reorg

Topic CTAs in the Docs accordion now point at the new destinations
(Identity/Profile/Skills/Governance live in Settings tabs;
Messaging in Integrations; Memory in History). Adds a new
Integrations topic that previously didn't exist."
```

---

# Phase 4 — Polish

## Task 4.1: Navigation smoke test

**Why:** Prevents future "open page with nothing you can click" regressions. One test that mounts `<App />`, clicks every nav item, and asserts each page renders at least one interactive element.

**Files:**
- Modify: `apps/desktop/src/renderer/src/App.test.tsx` (extend the file from Task 2.3)

### Step 1: Write the test

```typescript
describe("App — navigation smoke test", () => {
  it("every primary nav item lands on a page with at least one button or input", async () => {
    const { App } = await import("./App");
    render(<App />);
    const primaryLabels = ["Chat", "Integrations", "Approvals", "Trust", "History", "Settings"];
    for (const label of primaryLabels) {
      const navButton = await waitFor(() => screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") }));
      fireEvent.click(navButton);
      // Each page must contribute SOMETHING interactive — pure empty shells fail.
      const interactives = await waitFor(() => {
        const els = document.querySelectorAll("main button, main input, main select, main [role='tab']");
        if (els.length === 0) throw new Error(`No interactive elements on page: ${label}`);
        return els;
      });
      expect(interactives.length).toBeGreaterThan(0);
    }
  });

  it("expanding Advanced and clicking each advanced item lands on a page with at least one interactive", async () => {
    const { App } = await import("./App");
    render(<App />);
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /advanced/i })));
    const advancedLabels = ["Jobs", "Teams", "Evals", "Sandboxes", "Gaps"];
    for (const label of advancedLabels) {
      const navButton = await waitFor(() => screen.getByRole("button", { name: new RegExp(`^${label}$`, "i") }));
      fireEvent.click(navButton);
      const interactives = document.querySelectorAll("main button, main input, main select, main [role='tab']");
      expect(interactives.length).toBeGreaterThan(0);
    }
  });
});
```

### Step 2: Run; expect to surface any genuinely-empty Advanced pages

```bash
npm test -w apps/desktop -- --run App.test
```

If any Advanced page fails because it has zero interactives, address it inline (likely needs at least a refresh/filter control). The audit said all Advanced pages have 9–19 interaction sites, so this test should pass — but it'll catch any that *appear* implemented but render empty in jsdom.

### Step 3: Commit

```bash
git add apps/desktop/src/renderer/src/App.test.tsx
git commit -m "add-navigation-smoke-test-for-sidebar

Mounts App, clicks every primary and Advanced nav item, asserts
each lands on a page with at least one button/input/select/tab.
Bulwark against future 'open page with nothing you can click'
regressions like the pre-reorg ApprovalsPage."
```

---

## Task 4.2: Audit and live-verify

**Why:** Manual checklist before declaring done. Cannot be automated.

### Step 1: Launch the dev server

```bash
cd "~/Projects/SquidBot 2"
npm run dev
```

### Step 2: Run the acceptance criteria from the design doc

Check each box in `docs/plans/2026-05-15-sidebar-reorg-design.md` Section 9. Note any failures; create follow-up tasks for each.

### Step 3: Run full repo test suite

```bash
npm test --workspaces --if-present
```

Expected: all green across packages and apps.

### Step 4: Update CLAUDE.md / docs as needed

If the sidebar reorganization changes how a future engineer would navigate the codebase, mention it in the appropriate doc. (Probably not needed — code structure didn't change significantly.)

### Step 5: Final commit (only if any of the above produced changes)

```bash
git add -A
git commit -m "polish-pass-after-sidebar-reorganization

Live verification, doc touch-ups, and any small fixes surfaced
during the manual click-through. Closes out the sidebar reorg
work."
```

---

## Done.

Full repo green. Sidebar matches design. Approvals works. Old deep links still resolve. Plan complete.
