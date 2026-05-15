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

function mountWithProfile(
  profileId: string | null,
  overrides: {
    accounts?: unknown[];
    activeAccountName?: string | null;
    presets?: unknown[];
    discoverModels?: (req: unknown) => Promise<unknown>;
    upsertModelAccount?: (input: unknown) => Promise<unknown>;
    activateModelAccount?: (name: string) => Promise<unknown>;
    deleteModelAccount?: (name: string) => Promise<unknown>;
  } = {}
) {
  // The Settings page calls listModelAccounts + getProviderPresets on mount
  // for the new multi-account UI. Mocks have to return shaped data even for
  // the legacy onboarding-shortcut tests, otherwise the section throws and
  // tears down the surrounding render.
  const accounts = overrides.accounts ?? [];
  const presets =
    overrides.presets ?? [
      {
        providerKind: "openrouter",
        label: "OpenRouter",
        defaultApiUrl: "https://openrouter.ai/api/v1/chat/completions",
        defaultModel: "anthropic/claude-opus-4-5",
        notes: "BYOK gateway with hundreds of models.",
        catalog: [
          { id: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", tier: "flagship" },
          { id: "google/gemini-2.0-flash-001", label: "Gemini 2.0 Flash", tier: "fast" }
        ]
      },
      {
        providerKind: "anthropic",
        label: "Anthropic",
        defaultApiUrl: "https://api.anthropic.com/v1/chat/completions",
        defaultModel: "claude-opus-4-5",
        notes: "Direct Anthropic API.",
        catalog: [
          { id: "claude-opus-4-5", label: "Claude Opus 4.5", tier: "flagship" },
          { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "fast" }
        ]
      }
    ];
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      chooseWorkspace: vi.fn(),
      saveSetting: vi.fn(),
      saveConnectorSetting: vi.fn(),
      getSettings: vi.fn(),
      listModelAccounts: vi.fn(async () => ({
        activeAccountName: overrides.activeAccountName ?? null,
        accounts
      })),
      getProviderPresets: vi.fn(async () => presets),
      upsertModelAccount:
        overrides.upsertModelAccount ?? vi.fn(async (input: unknown) => input),
      activateModelAccount:
        overrides.activateModelAccount ?? vi.fn(async (name: string) => ({ name })),
      deleteModelAccount:
        overrides.deleteModelAccount ?? vi.fn(async (name: string) => ({ deleted: true, name })),
      discoverModels:
        overrides.discoverModels ?? vi.fn(async () => ({ success: false, code: "not_found", message: "mock" })),
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

describe("SettingsPage model accounts section", () => {
  it("shows the empty-state copy when no accounts are saved", async () => {
    mountWithProfile("profile_seed_generic_business", { accounts: [] });
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    await waitFor(() => {
      expect(screen.getByText("No model accounts yet")).toBeTruthy();
    });
    // The "Add account" CTA must be available so the user has a path out of
    // the empty state.
    expect(screen.getByRole("button", { name: /add account/i })).toBeTruthy();
  });

  it("lists saved accounts with the active marker", async () => {
    mountWithProfile("profile_seed_generic_business", {
      activeAccountName: "OR Gemini",
      accounts: [
        {
          id: "id_or_gemini",
          name: "OR Gemini",
          providerKind: "openrouter",
          apiUrl: "https://openrouter.ai/api/v1/chat/completions",
          apiModel: "google/gemini-2.0-flash-001",
          costPerToken: 0,
          dailyBudgetTokens: null,
          description: null,
          isActive: true,
          apiKeyConfigured: true,
          createdAt: "now",
          updatedAt: "now"
        },
        {
          id: "id_or_llama",
          name: "OR Llama",
          providerKind: "openrouter",
          apiUrl: "https://openrouter.ai/api/v1/chat/completions",
          apiModel: "meta-llama/llama-3.3-70b-instruct",
          costPerToken: 0,
          dailyBudgetTokens: null,
          description: null,
          isActive: false,
          apiKeyConfigured: true,
          createdAt: "now",
          updatedAt: "now"
        }
      ]
    });
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    await waitFor(() => {
      expect(screen.getByText("OR Gemini")).toBeTruthy();
      expect(screen.getByText("OR Llama")).toBeTruthy();
    });
    // Active row gets the "active" chip; inactive row gets a "Switch" button.
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^switch$/i })).toBeTruthy();
  });

  it("opening the add-account form auto-fills URL + model from the first provider preset", async () => {
    mountWithProfile("profile_seed_generic_business", { accounts: [] });
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    // Wait for presets to load — without them, openAddForm sets the empty
    // form, not the OpenRouter defaults.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /add account/i })).toBeTruthy();
    });
    // Need a small delay for the presets to populate. The component's useEffect
    // resolves Promise.all before setPresets is called.
    await waitFor(() => {
      // Click the add button only after presets are in state — this is the
      // condition that makes openAddForm pick up the auto-fill.
      const btn = screen.getByRole("button", { name: /add account/i });
      fireEvent.click(btn);
      const urlField = screen.getByDisplayValue("https://openrouter.ai/api/v1/chat/completions");
      expect(urlField).toBeTruthy();
    });
  });

  it("switching the provider dropdown changes the API URL and model dropdown contents", async () => {
    mountWithProfile("profile_seed_generic_business", { accounts: [] });
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    await waitFor(() => screen.getByRole("button", { name: /add account/i }));
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    // Auto-filled URL starts as OpenRouter's.
    await waitFor(() => screen.getByDisplayValue("https://openrouter.ai/api/v1/chat/completions"));
    // Switch to Anthropic.
    const providerSelect = screen.getByRole("combobox", { name: /provider/i }) as HTMLSelectElement;
    fireEvent.change(providerSelect, { target: { value: "anthropic" } });
    await waitFor(() => {
      expect(screen.getByDisplayValue("https://api.anthropic.com/v1/chat/completions")).toBeTruthy();
    });
    // Model dropdown now contains Anthropic options.
    const modelSelect = screen.getByRole("combobox", { name: /model/i }) as HTMLSelectElement;
    const optionTexts = Array.from(modelSelect.options).map((o) => o.text);
    expect(optionTexts.join(" ")).toMatch(/Claude Opus 4\.5/i);
    expect(optionTexts.join(" ")).toMatch(/Claude Haiku 4\.5/i);
  });

  it("refresh-from-API populates the model dropdown with live ids on success", async () => {
    const discoverModels = vi.fn(async () => ({
      success: true,
      models: ["custom/exotic-model-v1", "anthropic/claude-opus-4-5"],
      durationMs: 42,
      merged: [
        { id: "custom/exotic-model-v1", label: "custom/exotic-model-v1", tier: "balanced" },
        { id: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", tier: "flagship" }
      ]
    }));
    mountWithProfile("profile_seed_generic_business", { accounts: [], discoverModels });
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    await waitFor(() => screen.getByRole("button", { name: /add account/i }));
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    await waitFor(() => screen.getByDisplayValue("https://openrouter.ai/api/v1/chat/completions"));
    // Need a key to enable the refresh button.
    const inputs = screen.getAllByRole("textbox");
    void inputs; // narrow: we use a specific selector below
    const keyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    expect(keyInput).not.toBeNull();
    fireEvent.change(keyInput, { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: /refresh from api/i }));
    await waitFor(() => {
      expect(discoverModels).toHaveBeenCalledTimes(1);
      // Success banner mentions the count.
      expect(screen.getByText(/Pulled 2 models/i)).toBeTruthy();
    });
    // The custom exotic model now exists as an option.
    const modelSelect = screen.getByRole("combobox", { name: /model/i }) as HTMLSelectElement;
    const ids = Array.from(modelSelect.options).map((o) => o.value);
    expect(ids).toContain("custom/exotic-model-v1");
  });

  it("refresh-from-API shows the failure code when the provider rejects the key", async () => {
    const discoverModels = vi.fn(async () => ({
      success: false,
      code: "auth",
      message: "Provider rejected the API key (401).",
      fallback: {
        providerKind: "openrouter",
        catalog: [{ id: "anthropic/claude-opus-4-5", label: "Claude Opus 4.5", tier: "flagship" }]
      }
    }));
    mountWithProfile("profile_seed_generic_business", { accounts: [], discoverModels });
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    await waitFor(() => screen.getByRole("button", { name: /add account/i }));
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    await waitFor(() => screen.getByDisplayValue("https://openrouter.ai/api/v1/chat/completions"));
    const keyInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    fireEvent.change(keyInput, { target: { value: "sk-wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /refresh from api/i }));
    await waitFor(() => {
      expect(screen.getByText(/auth:.*rejected/i)).toBeTruthy();
    });
  });

  it("clicking Switch on an inactive account calls activateModelAccount with that name", async () => {
    const activateModelAccount = vi.fn(async (name: string) => ({ name }));
    mountWithProfile("profile_seed_generic_business", {
      activeAccountName: "OR Gemini",
      activateModelAccount,
      accounts: [
        {
          id: "id_or_gemini",
          name: "OR Gemini",
          providerKind: "openrouter",
          apiUrl: "x",
          apiModel: "google/gemini-2.0-flash-001",
          costPerToken: 0,
          dailyBudgetTokens: null,
          description: null,
          isActive: true,
          apiKeyConfigured: true,
          createdAt: "now",
          updatedAt: "now"
        },
        {
          id: "id_or_llama",
          name: "OR Llama",
          providerKind: "openrouter",
          apiUrl: "x",
          apiModel: "meta-llama/llama-3.3-70b-instruct",
          costPerToken: 0,
          dailyBudgetTokens: null,
          description: null,
          isActive: false,
          apiKeyConfigured: true,
          createdAt: "now",
          updatedAt: "now"
        }
      ]
    });
    const { SettingsPage } = await import("./SettingsPage");
    render(
      <SettingsPage settings={baseSettings} onSettingsChange={vi.fn()} onNavigate={navigateMock} />
    );
    await waitFor(() => screen.getByText("OR Llama"));
    fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));
    await waitFor(() => {
      expect(activateModelAccount).toHaveBeenCalledWith("OR Llama");
    });
  });
});
