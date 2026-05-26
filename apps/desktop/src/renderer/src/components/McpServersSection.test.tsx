// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom's about:blank origin doesn't allow localStorage access on Node 25.
// The lib/api.ts module captures `window.squidbot` at load time, so we shim
// localStorage to a Storage-compatible in-memory map before mounting.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(k: string) { return this.store.get(k) ?? null; }
  key(i: number) { return Array.from(this.store.keys())[i] ?? null; }
  removeItem(k: string) { this.store.delete(k); }
  setItem(k: string, v: string) { this.store.set(k, v); }
}

function mount(overrides: {
  servers?: unknown[];
  addMcpServer?: (input: unknown) => Promise<unknown>;
  removeMcpServer?: (name: string) => Promise<void>;
} = {}) {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage()
  });
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listMcpServers: vi.fn(async () => overrides.servers ?? []),
      addMcpServer: overrides.addMcpServer ?? vi.fn(async (input: unknown) => input),
      updateMcpServer: vi.fn(async (_n: string, i: unknown) => i),
      removeMcpServer: overrides.removeMcpServer ?? vi.fn(async () => undefined),
      testMcpServer: vi.fn(async () => ({ ok: true, toolCount: 3, durationMs: 100 }))
    }
  });
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: vi.fn(() => true)
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("McpServersSection", () => {
  it("renders empty state when there are no servers", async () => {
    mount();
    const { McpServersSection } = await import("./McpServersSection");
    render(<McpServersSection />);
    await waitFor(() => {
      expect(screen.getByText(/No MCP servers configured/i)).toBeTruthy();
    });
  });

  it("renders a row per configured server", async () => {
    mount({
      servers: [
        {
          id: "1",
          name: "fs-home",
          command: "npx",
          args: [],
          env: {},
          riskLevel: "medium",
          enabled: true,
          lastConnectedAt: null,
          lastError: null,
          toolCount: 8
        }
      ]
    });
    const { McpServersSection } = await import("./McpServersSection");
    render(<McpServersSection />);
    await waitFor(() => {
      expect(screen.getByText("fs-home")).toBeTruthy();
      expect(screen.getByText(/8 tools/)).toBeTruthy();
    });
  });

  it("calls addMcpServer when the form is submitted", async () => {
    const addFn = vi.fn(async (input: unknown) => input);
    mount({ addMcpServer: addFn });
    const { McpServersSection } = await import("./McpServersSection");
    render(<McpServersSection />);
    await waitFor(() => expect(screen.getByText(/Add MCP server/i)).toBeTruthy());

    fireEvent.click(screen.getByText(/Add MCP server/i));

    fireEvent.change(screen.getByLabelText(/Server name/i), {
      target: { value: "filesystem-home" }
    });
    fireEvent.change(screen.getByLabelText(/Command/i), { target: { value: "npx" } });
    fireEvent.change(screen.getByLabelText(/Arguments/i), {
      target: { value: "-y @modelcontextprotocol/server-filesystem /Users/me" }
    });
    fireEvent.click(screen.getByRole("button", { name: /^\s*Save/i }));

    await waitFor(() => {
      expect(addFn).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "filesystem-home",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/me"]
        })
      );
    });
  });

  it("calls removeMcpServer when the trash button is clicked and confirmed", async () => {
    const removeFn = vi.fn(async () => undefined);
    mount({
      servers: [
        {
          id: "1",
          name: "fs-home",
          command: "npx",
          args: [],
          env: {},
          riskLevel: "low",
          enabled: true,
          lastConnectedAt: null,
          lastError: null,
          toolCount: 4
        }
      ],
      removeMcpServer: removeFn
    });
    const { McpServersSection } = await import("./McpServersSection");
    render(<McpServersSection />);
    await waitFor(() => expect(screen.getByText("fs-home")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /Remove fs-home/i }));

    await waitFor(() => {
      expect(removeFn).toHaveBeenCalledWith("fs-home");
    });
  });
});
