// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingsDto } from "../../../shared/api";

const baseSettings: SettingsDto = {
  appDataDir: "/tmp/example/.squidbot",
  databasePath: "/tmp/example/.squidbot/squidbot.sqlite",
  workspacePath: "/tmp/example",
  modelProvider: "mock",
  byokEnabled: false,
  modelSettings: {
    provider: "mock",
    apiKeyConfigured: false,
    apiUrl: undefined,
    apiModel: "deterministic-mock",
    apiBudgetTokens: undefined,
    apiUsedTokens: 0,
    apiRemainingTokens: undefined,
    apiCost: 0,
    costOwner: "local/free"
  },
  connectors: [],
  connectorSettings: {}
};

const navigateMock = vi.fn();

// JSDOM defaults its URL to `about:blank`, which is an opaque origin — any
// access to window.localStorage from there throws SecurityError. Node 25
// also exposes its own experimental localStorage built-in that masks
// jsdom's. Either way, SettingsPage's tab-persistence logic needs a working
// Storage shim for the assertion to mean anything. We install a tiny
// in-memory shim once per test file so the SettingsPage tab tests can
// actually read back what they wrote.
const localStorageShim: Storage = (() => {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    }
  } satisfies Storage;
})();

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorageShim
});

beforeEach(() => {
  vi.resetModules();
  navigateMock.mockClear();
  // SettingsPage persists the active tab in localStorage; clear the shim
  // between tests so each case starts from the General default unless it
  // explicitly primes the storage or passes initialTab.
  localStorageShim.clear();
});

afterEach(() => {
  // Vitest doesn't auto-cleanup the React DOM between tests in this project's
  // setup, so we do it explicitly to avoid duplicate-match errors on shared
  // text strings (e.g. "Onboarding shortcut") that span multiple test runs.
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

function mountWithProfile(profileId: string | null) {
  const seededProfile = profileId
    ? {
        id: profileId,
        industry: profileId === "profile_seed_generic_business" ? "general_business" : "saas",
        displayName: profileId === "profile_seed_generic_business" ? "Generic Business" : "Acme Corp",
        businessUnit: null,
        role: null,
        primarySystems: [],
        primaryChannels: [],
        sensitivity: "standard",
        vocabulary: {},
        branding: {},
        policyPacks: [],
        defaultSkills: [],
        defaultConnectors: [],
        readOnlyByDefault: false,
        isActive: true,
        seeded: profileId === "profile_seed_generic_business",
        metadata: {},
        createdAt: "now",
        updatedAt: "now"
      }
    : null;
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      chooseWorkspace: vi.fn(),
      saveSetting: vi.fn(),
      saveConnectorSetting: vi.fn(),
      getSettings: vi.fn(),
      getActiveEnterpriseProfile: vi.fn(async () => seededProfile),
      // The Profile / Identity / Skills / Governance tabs each call IPC on
      // mount. We stub them with shaped empty / minimal responses so the
      // tabbed shell can render any tab without tearing down on missing IPC.
      listEnterpriseProfiles: vi.fn(async () => (seededProfile ? [seededProfile] : [])),
      activateEnterpriseProfile: vi.fn(async () => ({})),
      createEnterpriseProfile: vi.fn(async () => seededProfile),
      getIdentityReport: vi.fn(async () => ({
        card: {
          id: "singleton",
          agentName: "SquidBot",
          agentVersion: "0.1.0",
          mission: "Local-first AI agent.",
          installedAt: "now",
          updatedAt: "now"
        },
        profile: seededProfile,
        capabilities: { toolCount: 0, tools: [], permissionScopes: [] }
      })),
      listSquidbotCommands: vi.fn(async () => []),
      runSquidbotCommand: vi.fn(async () => ({})),
      listSkills: vi.fn(async () => []),
      getSkill: vi.fn(async () => null),
      evaluateSkill: vi.fn(),
      promoteSkill: vi.fn(),
      rollbackSkill: vi.fn(),
      runSkill: vi.fn(),
      bootstrapGovernance: vi.fn(async () => ({
        organizationId: "local-org",
        tenantId: "local-tenant",
        adminUserId: "user_local_admin",
        rolesCreated: 1
      })),
      getGovernanceStatus: vi.fn(async () => ({
        tenantId: "local-tenant",
        users: 0,
        roles: 0,
        decisions: 0,
        auditEntries: 0,
        secrets: 0,
        retentionPolicies: 0,
        legalHolds: 0,
        n8nIntegrations: 0,
        policyPacks: 0
      })),
      listGovernanceUsers: vi.fn(async () => []),
      listGovernanceRoles: vi.fn(async () => []),
      listGovernancePolicyDecisions: vi.fn(async () => []),
      listGovernanceSecrets: vi.fn(async () => []),
      listGovernanceAudit: vi.fn(async () => []),
      listGovernanceRetentionPolicies: vi.fn(async () => []),
      listGovernanceN8nIntegrations: vi.fn(async () => []),
      simulateGovernancePolicy: vi.fn(async () => ({
        tenantId: "local-tenant",
        decision: "allow",
        reason: "stub",
        matchedPolicies: [],
        obligations: []
      }))
    }
  });
}

describe("SettingsPage onboarding shortcut", () => {
  it("renders the 'Start onboarding' shortcut when the user is still on Generic Business", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    await waitFor(() => {
      expect(screen.getByText("Configure SquidBot for your business")).toBeTruthy();
    });
    expect(screen.getByText("Start onboarding")).toBeTruthy();
  });

  it("renders the 'Re-run onboarding' shortcut when a custom profile is active", async () => {
    mountWithProfile("profile_custom_acme");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    // "Re-run onboarding" appears as both the section heading and the CTA
    // button label, so we wait for any occurrence rather than exactly one.
    await waitFor(() => {
      expect(screen.getAllByText("Re-run onboarding").length).toBeGreaterThan(0);
    });
    // Adaptive copy must reference the user's profile by name.
    expect(screen.getByText(/onboarded as Acme Corp/i)).toBeTruthy();
  });

  it("navigates to the Onboarding page when the CTA is clicked", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    // Use role+name so we click the button, not the matching h3 heading.
    const cta = await screen.findByRole("button", { name: /start onboarding wizard/i });
    fireEvent.click(cta);
    expect(navigateMock).toHaveBeenCalledWith("onboarding");
  });

  it("omits the shortcut when onNavigate is not provided (preserves existing behaviour)", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(<SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} />);
    // The shortcut section uses aria-label="Onboarding shortcut"; without
    // onNavigate, the entire section is omitted.
    expect(screen.queryByLabelText("Onboarding shortcut")).toBeNull();
  });
});

describe("SettingsPage docs section", () => {
  it("renders the Docs & guides header with the intro copy", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    // The section is keyed by aria-label so screen readers announce it as a
    // landmark. The header text must be the human-readable phrase.
    expect(screen.getByLabelText("Docs and guides")).toBeTruthy();
    expect(screen.getByText("Docs & guides")).toBeTruthy();
  });

  it("lists the key onboarding-journey topics", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    // Spot-check that the most important topics are present. We don't assert
    // on every topic to keep the test resilient to copy edits — just the
    // load-bearing ones an operator would expect to find.
    expect(screen.getByText("What SquidBot is")).toBeTruthy();
    expect(screen.getByText("Getting started")).toBeTruthy();
    expect(screen.getByText("Model accounts (BYOK)")).toBeTruthy();
    expect(screen.getByText("Trust report")).toBeTruthy();
  });

  it("expanding a topic reveals its body paragraph", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    // Native <details> in jsdom: the body is still in the DOM when collapsed
    // (the attribute toggles open/closed visually). To verify the body really
    // belongs to the topic we click the summary and look up its sibling.
    const summary = screen.getByText("What SquidBot is");
    fireEvent.click(summary);
    expect(
      screen.getByText(/local-first AI agent that runs entirely on your machine/i)
    ).toBeTruthy();
  });

  it("clicking a topic's Open button navigates to that page", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    // The trust-report topic has a deep-link button. Click it.
    const trustCta = screen.getByRole("button", { name: /open trust report/i });
    fireEvent.click(trustCta);
    expect(navigateMock).toHaveBeenCalledWith("trust");
  });

  it("does not render an Open button for topics without a target page", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    // "What SquidBot is" is a pure explainer — there's no single page to deep
    // link to, so the CTA must be omitted (it would just confuse the user).
    // We assert by looking inside that specific <details>: its descendant
    // button set is empty.
    const aboutSummary = screen.getByText("What SquidBot is");
    const aboutDetails = aboutSummary.closest("details");
    expect(aboutDetails).not.toBeNull();
    expect(aboutDetails!.querySelectorAll("button").length).toBe(0);
  });
});

// NOTE: the seven "SettingsPage model accounts section" tests that used to
// live here moved to `../components/ModelAccountsSection.test.tsx` in Task
// 1.7 when the ModelAccountsSection render was removed from SettingsPage
// (the section lives in IntegrationsPage now). The behavioural coverage is
// preserved — it's just attached to the component rather than a former host.

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

  it("defaults to the General tab", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(<SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />);
    expect(screen.getByRole("tab", { name: /^general$/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("clicking the Profile tab activates it and persists the choice", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(<SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />);
    fireEvent.click(screen.getByRole("tab", { name: /^profile$/i }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /^profile$/i }).getAttribute("aria-selected")).toBe("true");
    });
    expect(window.localStorage.getItem("settings.activeTab")).toBe("profile");
  });

  it("respects initialTab prop", async () => {
    mountWithProfile("profile_seed_generic_business");
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage
        settings={baseSettings}
        onSettingsChange={vi.fn()}
        onNavigate={navigateMock}
        initialTab="skills"
      />
    );
    expect(screen.getByRole("tab", { name: /^skills$/i }).getAttribute("aria-selected")).toBe("true");
  });
});
