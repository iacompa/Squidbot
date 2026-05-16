// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      // ModelAccountsSection's mount calls these.
      listModelAccounts: vi.fn(async () => ({ activeAccountName: null, accounts: [] })),
      getProviderPresets: vi.fn(async () => []),
      // ConnectorsSection's mount-via-getSettings call.
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
      saveConnectorSetting: vi.fn(),
      // MessagingSection's mount calls (best-effort stubs — adapt if the real
      // page needs more).
      listMessagingAdapters: vi.fn(async () => []),
      listMessagingChannels: vi.fn(async () => []),
      listMessagingAllowlistRules: vi.fn(async () => []),
      listMessagingDeliveryRules: vi.fn(async () => []),
      listMessagingSessions: vi.fn(async () => []),
      listMessagingEvents: vi.fn(async () => []),
      listMessagingIdentities: vi.fn(async () => []),
      listPlatformMatrix: vi.fn(async () => [])
    }
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

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
    expect(screen.getByRole("tab", { name: /ai models/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("switches to Connectors when its tab is clicked", async () => {
    const { IntegrationsPage } = await import("./IntegrationsPage");
    render(<IntegrationsPage />);
    fireEvent.click(screen.getByRole("tab", { name: /connectors/i }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /connectors/i }).getAttribute("aria-selected")).toBe("true");
    });
    // ConnectorsSection's empty-state heading should be visible.
    await waitFor(() => {
      expect(screen.getByText(/no connectors installed/i)).toBeTruthy();
    });
  });

  it("respects initialTab prop", async () => {
    const { IntegrationsPage } = await import("./IntegrationsPage");
    render(<IntegrationsPage initialTab="messaging" />);
    expect(screen.getByRole("tab", { name: /messaging/i }).getAttribute("aria-selected")).toBe("true");
  });
});
