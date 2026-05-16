// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  // Reset the module cache so each test gets a fresh import of `lib/api`,
  // which captures `window.squidbot` at module load time. Without this, the
  // first test's `squidbotApi` would be reused for every subsequent test
  // (matching the pattern used by SettingsPage.test.tsx).
  vi.resetModules();
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: { saveConnectorSetting: vi.fn(async () => ({ ...emptySettings })) }
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

  it("calls saveConnectorSetting when the Save button is clicked", async () => {
    const onSettingsChange = vi.fn();
    const saveMock = vi.fn(async (name: string, key: string, value: string) => ({ ...emptySettings }));
    Reflect.deleteProperty(window, "squidbot");
    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: { saveConnectorSetting: saveMock }
    });
    const { ConnectorsSection } = await import("./ConnectorsSection");
    const settings: SettingsDto = {
      ...emptySettings,
      connectors: [
        { name: "stripe", systemType: "payments", description: "Charges", protocol: "rest", fixtureMode: false, costOwner: "user-paid", operations: ["createCharge"] }
      ],
      connectorSettings: { stripe: { baseUrl: undefined, apiKeyConfigured: false } }
    };
    render(<ConnectorsSection settings={settings} onSettingsChange={onSettingsChange} />);
    // Click the first Save button — should call saveConnectorSetting with the stripe baseUrl
    const saveButtons = screen.getAllByRole("button", { name: /save/i });
    fireEvent.click(saveButtons[0]);
    // We don't assert the exact key because depending on form ordering it
    // could be "baseUrl" or "apiKey" — the contract being tested is "Save
    // triggers the IPC at all."
    // Wait microtask for the async handler.
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
  });

  it("re-syncs drafts when the settings prop changes", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    const initialSettings: SettingsDto = {
      ...emptySettings,
      connectors: [
        {
          name: "stripe",
          systemType: "payments",
          description: "Charges",
          protocol: "rest",
          fixtureMode: false,
          costOwner: "user-paid",
          operations: ["createCharge"]
        }
      ],
      connectorSettings: { stripe: { baseUrl: "https://old.example", apiKeyConfigured: false } }
    };
    const { rerender } = render(
      <ConnectorsSection settings={initialSettings} onSettingsChange={vi.fn()} />
    );
    // Initial draft pulls baseUrl from settings.
    expect((screen.getByDisplayValue("https://old.example") as HTMLInputElement).value).toBe(
      "https://old.example"
    );
    // Rerender with a new baseUrl on the same connector.
    rerender(
      <ConnectorsSection
        settings={{
          ...initialSettings,
          connectorSettings: { stripe: { baseUrl: "https://new.example", apiKeyConfigured: false } }
        }}
        onSettingsChange={vi.fn()}
      />
    );
    // The useEffect must have repopulated drafts from the new settings.
    expect((screen.getByDisplayValue("https://new.example") as HTMLInputElement).value).toBe(
      "https://new.example"
    );
  });
});
