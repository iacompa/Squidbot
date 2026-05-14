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
