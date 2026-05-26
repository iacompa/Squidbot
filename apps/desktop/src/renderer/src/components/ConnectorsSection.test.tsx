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

describe("ConnectorsSection — Test button and status indicator", () => {
  const connectorWithKey: SettingsDto = {
    ...emptySettings,
    connectors: [
      {
        name: "github",
        systemType: "scm",
        description: "Git hosting",
        protocol: "rest",
        fixtureMode: false,
        costOwner: "user-paid",
        operations: ["createIssue"]
      }
    ],
    connectorSettings: { github: { baseUrl: "https://api.github.com", apiKeyConfigured: true } }
  };

  it("renders Test button when key is configured and not in fixture mode", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    render(<ConnectorsSection settings={connectorWithKey} onSettingsChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^test$/i })).toBeTruthy();
  });

  it("does not render Test button when fixtureMode is true", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    const fixtureSettings: SettingsDto = {
      ...emptySettings,
      connectors: [
        {
          name: "github",
          systemType: "scm",
          description: "Git hosting",
          protocol: "rest",
          fixtureMode: true,
          costOwner: "user-paid",
          operations: ["createIssue"]
        }
      ],
      connectorSettings: { github: { baseUrl: undefined, apiKeyConfigured: true } }
    };
    render(<ConnectorsSection settings={fixtureSettings} onSettingsChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^test$/i })).toBeNull();
    // Fixture state chip text.
    expect(screen.getByText(/mock data/i)).toBeTruthy();
  });

  it("does not render Test button when no api key is configured", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    const noKeySettings: SettingsDto = {
      ...emptySettings,
      connectors: [
        {
          name: "github",
          systemType: "scm",
          description: "Git hosting",
          protocol: "rest",
          fixtureMode: false,
          costOwner: "user-paid",
          operations: ["createIssue"]
        }
      ],
      connectorSettings: { github: { baseUrl: undefined, apiKeyConfigured: false } }
    };
    render(<ConnectorsSection settings={noKeySettings} onSettingsChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /^test$/i })).toBeNull();
    // not-configured chip text.
    expect(screen.getByText(/add a key/i)).toBeTruthy();
  });

  it("hides Test button when profile sensitivity is air-gapped", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    render(
      <ConnectorsSection
        settings={connectorWithKey}
        onSettingsChange={vi.fn()}
        activeProfileSensitivity="air-gapped"
      />
    );
    expect(screen.queryByRole("button", { name: /^test$/i })).toBeNull();
    expect(screen.getByText(/real calls disabled/i)).toBeTruthy();
  });

  it("clicking Test calls testConnector and refreshes settings", async () => {
    const testConnectorMock = vi.fn(async () => ({ ok: true, durationMs: 12 }));
    const refreshedSettings = { ...connectorWithKey };
    const getSettingsMock = vi.fn(async () => refreshedSettings);
    const onSettingsChange = vi.fn();
    Reflect.deleteProperty(window, "squidbot");
    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        saveConnectorSetting: vi.fn(),
        testConnector: testConnectorMock,
        getSettings: getSettingsMock
      }
    });
    const { ConnectorsSection } = await import("./ConnectorsSection");
    render(<ConnectorsSection settings={connectorWithKey} onSettingsChange={onSettingsChange} />);
    fireEvent.click(screen.getByRole("button", { name: /^test$/i }));
    await waitFor(() => expect(testConnectorMock).toHaveBeenCalledWith("github"));
    await waitFor(() => expect(getSettingsMock).toHaveBeenCalled());
    await waitFor(() => expect(onSettingsChange).toHaveBeenCalledWith(refreshedSettings));
  });

  it("shows green tested-recently chip when lastTest is ok and fresh", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    const recentSettings: SettingsDto = {
      ...connectorWithKey,
      connectorSettings: {
        github: {
          baseUrl: "https://api.github.com",
          apiKeyConfigured: true,
          lastTest: { status: "ok", at: new Date().toISOString() }
        }
      }
    };
    render(<ConnectorsSection settings={recentSettings} onSettingsChange={vi.fn()} />);
    expect(screen.getByText(/tested/i)).toBeTruthy();
  });

  it("shows red auth-failed chip when lastTest.status is 'auth'", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    const authFailedSettings: SettingsDto = {
      ...connectorWithKey,
      connectorSettings: {
        github: {
          baseUrl: "https://api.github.com",
          apiKeyConfigured: true,
          lastTest: { status: "auth", at: new Date().toISOString(), message: "401" }
        }
      }
    };
    render(<ConnectorsSection settings={authFailedSettings} onSettingsChange={vi.fn()} />);
    expect(screen.getByText(/key rejected/i)).toBeTruthy();
  });

  it("shows amber re-test recommended chip when lastTest is ok but stale", async () => {
    const { ConnectorsSection } = await import("./ConnectorsSection");
    const staleSettings: SettingsDto = {
      ...connectorWithKey,
      connectorSettings: {
        github: {
          baseUrl: "https://api.github.com",
          apiKeyConfigured: true,
          lastTest: {
            status: "ok",
            at: new Date(Date.now() - 2 * 86_400_000).toISOString()
          }
        }
      }
    };
    render(<ConnectorsSection settings={staleSettings} onSettingsChange={vi.fn()} />);
    expect(screen.getByText(/re-test recommended/i)).toBeTruthy();
  });
});
