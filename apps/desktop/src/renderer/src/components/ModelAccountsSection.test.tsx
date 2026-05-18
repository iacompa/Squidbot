// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Component-level tests for ModelAccountsSection. These tests previously
 * lived in SettingsPage.test.tsx because SettingsPage was the only place
 * the section rendered. Task 1.4 moved the section to IntegrationsPage; Task
 * 1.7 finalised that move by dropping the render from SettingsPage entirely.
 * The behavioural coverage (empty state, list rendering, add-form auto-fill,
 * provider switching, refresh-from-API success / failure, account switching)
 * is still load-bearing — it just belongs here now, attached to the
 * component itself rather than a former host page.
 */

function mount(overrides: {
  accounts?: unknown[];
  activeAccountName?: string | null;
  presets?: unknown[];
  discoverModels?: (req: unknown) => Promise<unknown>;
  upsertModelAccount?: (input: unknown) => Promise<unknown>;
  activateModelAccount?: (name: string) => Promise<unknown>;
  deleteModelAccount?: (name: string) => Promise<unknown>;
} = {}) {
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
        overrides.discoverModels ?? vi.fn(async () => ({ success: false, code: "not_found", message: "mock" }))
    }
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

describe("ModelAccountsSection", () => {
  it("shows the empty-state copy when no accounts are saved", async () => {
    mount({ accounts: [] });
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    render(<ModelAccountsSection />);
    await waitFor(() => {
      expect(screen.getByText("No model accounts yet")).toBeTruthy();
    });
    // The "Add account" CTA must be available so the user has a path out of
    // the empty state.
    expect(screen.getByRole("button", { name: /add account/i })).toBeTruthy();
  });

  it("lists saved accounts with the active marker", async () => {
    mount({
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
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    render(<ModelAccountsSection />);
    await waitFor(() => {
      expect(screen.getByText("OR Gemini")).toBeTruthy();
      expect(screen.getByText("OR Llama")).toBeTruthy();
    });
    // Active row gets the "active" chip; inactive row gets a "Switch" button.
    expect(screen.getByText("active")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^switch$/i })).toBeTruthy();
  });

  it("opening the add-account form auto-fills URL + model from the first provider preset", async () => {
    mount({ accounts: [] });
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    render(<ModelAccountsSection />);
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
    mount({ accounts: [] });
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    render(<ModelAccountsSection />);
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
    mount({ accounts: [], discoverModels });
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    render(<ModelAccountsSection />);
    await waitFor(() => screen.getByRole("button", { name: /add account/i }));
    fireEvent.click(screen.getByRole("button", { name: /add account/i }));
    await waitFor(() => screen.getByDisplayValue("https://openrouter.ai/api/v1/chat/completions"));
    // Need a key to enable the refresh button.
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
    mount({ accounts: [], discoverModels });
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    render(<ModelAccountsSection />);
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

  it("calls discoverModels when the user changes provider with a key already set", async () => {
    const discover = vi.fn(async () => ({
      success: true,
      models: ["claude-opus-4-7"],
      merged: [{ id: "claude-opus-4-7", label: "Claude Opus 4.7", tier: "flagship" }]
    }));
    mount({ discoverModels: discover });
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    const { getByText, getByLabelText } = render(<ModelAccountsSection forceOpenForm />);

    // Wait for the form to be fully populated with the first preset's
    // defaults — the useEffect that pre-fills the URL fires asynchronously
    // after presets load, and we don't want that effect to fire AFTER our
    // key-change below and wipe the apiKey we just typed.
    await waitFor(() => expect(getByLabelText(/API key/i)).toBeTruthy());
    await waitFor(() =>
      expect((getByLabelText(/API URL/i) as HTMLInputElement).value).toMatch(/openrouter/i)
    );

    fireEvent.change(getByLabelText(/API key/i), { target: { value: "sk-test" } });

    fireEvent.change(getByLabelText(/Provider/i), { target: { value: "anthropic" } });

    await waitFor(() => {
      expect(discover).toHaveBeenCalledWith(
        expect.objectContaining({ providerKind: "anthropic", apiKey: "sk-test" })
      );
    });
  });

  it("debounces and calls discoverModels 300ms after API key entry stops", async () => {
    vi.useFakeTimers();
    const discover = vi.fn(async () => ({
      success: true,
      models: ["claude-opus-4-7"],
      merged: [{ id: "claude-opus-4-7", label: "Claude Opus 4.7", tier: "flagship" }]
    }));
    mount({ discoverModels: discover });
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    const { getByLabelText } = render(<ModelAccountsSection forceOpenForm />);

    // waitFor needs real timers to advance, so flush microtasks manually
    // until the API key field is in the DOM.
    await vi.waitFor(() => expect(getByLabelText(/API key/i)).toBeTruthy());
    await vi.waitFor(() =>
      expect((getByLabelText(/API URL/i) as HTMLInputElement).value).toMatch(/openrouter/i)
    );

    // Type the key over multiple keystrokes.
    fireEvent.change(getByLabelText(/API key/i), { target: { value: "s" } });
    fireEvent.change(getByLabelText(/API key/i), { target: { value: "sk" } });
    fireEvent.change(getByLabelText(/API key/i), { target: { value: "sk-" } });
    fireEvent.change(getByLabelText(/API key/i), { target: { value: "sk-test" } });

    // Before 300ms passes, the effect hasn't fired.
    expect(discover).not.toHaveBeenCalled();

    // Advance 250ms — still not fired.
    vi.advanceTimersByTime(250);
    expect(discover).not.toHaveBeenCalled();

    // Cross the 300ms threshold — fires once.
    vi.advanceTimersByTime(100);
    await vi.waitFor(() => {
      expect(discover).toHaveBeenCalledTimes(1);
      expect(discover).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: "sk-test" })
      );
    });

    vi.useRealTimers();
  });

  it("clicking Switch on an inactive account calls activateModelAccount with that name", async () => {
    const activateModelAccount = vi.fn(async (name: string) => ({ name }));
    mount({
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
    const { ModelAccountsSection } = await import("./ModelAccountsSection");
    render(<ModelAccountsSection />);
    await waitFor(() => screen.getByText("OR Llama"));
    fireEvent.click(screen.getByRole("button", { name: /^switch$/i }));
    await waitFor(() => {
      expect(activateModelAccount).toHaveBeenCalledWith("OR Llama");
    });
  });
});
