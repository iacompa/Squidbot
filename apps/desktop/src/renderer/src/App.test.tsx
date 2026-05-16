// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
      listTraces: vi.fn(async () => [])
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
