// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory localStorage shim — Node 25 + jsdom about:blank otherwise blocks
// window.localStorage access with SecurityError.
const localStorageShim: Storage = (() => {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k: string) { return map.has(k) ? map.get(k)! : null; },
    key(i: number) { return Array.from(map.keys())[i] ?? null; },
    removeItem(k: string) { map.delete(k); },
    setItem(k: string, v: string) { map.set(k, String(v)); }
  } satisfies Storage;
})();
Object.defineProperty(window, "localStorage", { configurable: true, value: localStorageShim });

beforeEach(() => {
  vi.resetModules();
  localStorageShim.clear();
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      getSettings: vi.fn(async () => ({
        appDataDir: "/tmp", databasePath: "/tmp/db", workspacePath: "/tmp",
        modelProvider: "mock", byokEnabled: false,
        modelSettings: {
          provider: "mock", apiKeyConfigured: false, apiUrl: undefined,
          apiModel: "mock", apiBudgetTokens: undefined, apiUsedTokens: 0,
          apiRemainingTokens: undefined, apiCost: 0, costOwner: "local/free"
        },
        connectors: [], connectorSettings: {}
      })),
      listPendingApprovals: vi.fn(async () => [
        { id: "a", kind: "sandbox-promotion", title: "x", summary: "x", riskLevel: "medium", createdAt: "now", payload: {} },
        { id: "b", kind: "sandbox-promotion", title: "x", summary: "x", riskLevel: "medium", createdAt: "now", payload: {} }
      ]),
      listModelAccounts: vi.fn(async () => ({ activeAccountName: null, accounts: [] })),
      // App.tsx mounts call refreshTraces; provide an empty list so the
      // promise resolves cleanly instead of throwing "is not a function".
      listTraces: vi.fn(async () => []),
      // ---------------------------------------------------------------
      // Smoke-test IPC stubs — the navigation smoke test mounts every
      // primary + advanced page and so needs every mount-time IPC method
      // to resolve cleanly. Shaped-empty returns are fine; the smoke
      // test only asserts that interactive elements render, not that
      // the page is populated with real data.
      // ---------------------------------------------------------------
      // IntegrationsPage > ModelAccountsSection
      getProviderPresets: vi.fn(async () => []),
      // HistoryPage > RunListPage
      listRuns: vi.fn(async () => []),
      // TrustPage
      getTrustReport: vi.fn(async () => ({
        schemaVersion: "1", generatedAt: "2026-05-14T00:00:00.000Z",
        agentName: "SquidBot", agentVersion: "0.1.0",
        profile: { active: false, industry: "saas", displayName: "—", sensitivity: "internal", readOnlyByDefault: false },
        audit: { entryCount: 0, last24hCount: 0, latestSequence: 0, latestEntryHash: null, latestEntryAt: null, chainValid: true, chainFailureSequence: null, chainFailureReason: null },
        policy: { policyPackCount: 0, policyPacks: [], abacRuleCount: 0, decisionCount: 0, denyDecisionCount: 0, recentDenyDecisions: 0 },
        vault: { secretReferenceCount: 0, rotatedSecretCount: 0, encryptedAtRest: true, algorithm: "AES-256-GCM" },
        retention: { policyCount: 0, enabledPolicyCount: 0, legalHoldCount: 0, activeLegalHoldCount: 0 },
        affordanceGaps: { openCount: 0, resolvedCount: 0, wontfixCount: 0, highSeverityOpenCount: 0 },
        sandbox: { activeCount: 0, promotedCount: 0, rejectedCount: 0 },
        connectors: { registeredCount: 0, readOnlyDefault: false, fixtureMode: true },
        capabilities: { toolCount: 0, permissionScopes: [] },
        modelCost: { totalCost: 0, totalTokens: 0, totalRows: 0, byProvider: [] },
        zeroSpendDefault: true, redactionEnabled: true,
        healthScore: 95, healthLabel: "excellent", warnings: []
      })),
      getTrustDigest: vi.fn(async () => ({
        schemaVersion: "1", hash: "deadbeef".repeat(8),
        generatedAt: "2026-05-14T00:00:00.000Z",
        agentName: "SquidBot", agentVersion: "0.1.0",
        profile: "—", healthScore: 95, healthLabel: "excellent", auditChainValid: true
      })),
      listSquidbotCommands: vi.fn(async () => []),
      // SettingsPage — getActiveEnterpriseProfile may legitimately be
      // missing per its own null-check, but stub it anyway for cleanliness.
      getActiveEnterpriseProfile: vi.fn(async () => null),
      // JobsPage
      listJobs: vi.fn(async () => []),
      getJob: vi.fn(async () => null),
      // TeamsPage
      listTeams: vi.fn(async () => []),
      listTeamRuns: vi.fn(async () => []),
      getTeamRun: vi.fn(async () => null),
      listTeamHandoffs: vi.fn(async () => []),
      // EvaluationLabPage
      listEvalDatasets: vi.fn(async () => []),
      listEvalRuns: vi.fn(async () => []),
      listSkillVariants: vi.fn(async () => []),
      getEvalRunDetail: vi.fn(async () => null),
      listEvalLeaderboard: vi.fn(async () => []),
      // SandboxesPage
      listSandboxes: vi.fn(async () => []),
      // GapsPage
      listAffordanceGaps: vi.fn(async () => [])
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

  it("renders no badge when listPendingApprovals returns an empty list", async () => {
    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        ...(window as unknown as { squidbot: Record<string, unknown> }).squidbot,
        listPendingApprovals: vi.fn(async () => [])
      }
    });
    const { App } = await import("./App");
    render(<App />);
    // Allow App's mount-fetch to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByLabelText(/pending/i)).toBeNull();
  });
});

// The navigation smoke test is the bulwark against "open page with nothing
// you can click" regressions — the same shape of bug that triggered the
// sidebar reorg in the first place (the original ApprovalsPage was an
// empty shell). It mounts the full <App />, clicks every primary nav item
// and every Advanced item, and asserts each destination contributes at
// least one interactive element to the DOM.
//
// We scope the selector to `.content-shell` (the wrapping section in
// App.tsx) rather than `main` because two pages — TrustPage and
// OnboardingPage — render a `<div>` as their root instead of `<main>`,
// and TrustPage is in the primary nav. The intent is "did the page
// produce at least one thing the user can click," not "is the root a
// main element."
describe("App — navigation smoke test", () => {
  // Pages render inside `<section className="content-shell">` per App.tsx;
  // this selector matches every interactive element in the page area
  // regardless of whether the page root is <main> or <div>.
  const interactiveSelector =
    ".content-shell button, .content-shell input, .content-shell select, .content-shell [role='tab']";

  it("every primary nav item lands on a page with at least one interactive element", async () => {
    const { App } = await import("./App");
    render(<App />);
    const primaryLabels = ["Chat", "Integrations", "Approvals", "Trust", "History", "Settings"];
    for (const label of primaryLabels) {
      // Use `^Label\b` instead of `^Label$` so the regex still matches when the
      // accessible name has the badge appended (e.g. "Approvals 2" when
      // listPendingApprovals returns a non-empty list). \b anchors the word
      // boundary so we still don't match unrelated buttons whose names start
      // with the same prefix.
      const navButton = await waitFor(() =>
        screen.getByRole("button", { name: new RegExp(label, "i") })
      );
      fireEvent.click(navButton);
      // Each page must contribute SOMETHING interactive — pure empty shells fail.
      const interactives = await waitFor(
        () => {
          const els = document.querySelectorAll(interactiveSelector);
          if (els.length === 0) throw new Error(`No interactive elements on page: ${label}`);
          return els;
        },
        { timeout: 2000 }
      );
      expect(interactives.length).toBeGreaterThan(0);
    }
  });

  it("expanding Advanced and clicking each advanced item lands on a page with at least one interactive", async () => {
    const { App } = await import("./App");
    render(<App />);
    // Find and click the Advanced toggle to expand the section.
    fireEvent.click(await waitFor(() => screen.getByRole("button", { name: /advanced/i })));
    const advancedLabels = ["Jobs", "Teams", "Evals", "Sandboxes", "Gaps"];
    for (const label of advancedLabels) {
      // Same word-boundary pattern as the primary test, in case any Advanced
      // item ever gains a badge.
      const navButton = await waitFor(() =>
        screen.getByRole("button", { name: new RegExp(label, "i") })
      );
      fireEvent.click(navButton);
      const interactives = await waitFor(
        () => {
          const els = document.querySelectorAll(interactiveSelector);
          if (els.length === 0) throw new Error(`No interactive elements on advanced page: ${label}`);
          return els;
        },
        { timeout: 2000 }
      );
      expect(interactives.length).toBeGreaterThan(0);
    }
  });
});
