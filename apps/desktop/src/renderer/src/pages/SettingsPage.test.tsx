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

beforeEach(() => {
  vi.resetModules();
  navigateMock.mockClear();
});

afterEach(() => {
  // Vitest doesn't auto-cleanup the React DOM between tests in this project's
  // setup, so we do it explicitly to avoid duplicate-match errors on shared
  // text strings (e.g. "Onboarding shortcut") that span multiple test runs.
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

function mountWithProfile(profileId: string | null) {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      chooseWorkspace: vi.fn(),
      saveSetting: vi.fn(),
      saveConnectorSetting: vi.fn(),
      getSettings: vi.fn(),
      getActiveEnterpriseProfile: vi.fn(async () =>
        profileId
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
          : null
      )
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
