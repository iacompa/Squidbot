// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      // Mock everything RunListPage / MemoryPage might call on mount.
      listRuns: vi.fn(async () => []),
      getTrace: vi.fn(async () => null),
      getTraceMetrics: vi.fn(async () => null),
      listTraces: vi.fn(async () => []),
      listMemories: vi.fn(async () => []),
      listReflections: vi.fn(async () => []),
      listMemoryGraphNodes: vi.fn(async () => []),
      searchMemoryGraph: vi.fn(async () => []),
      getMemoryGraphNode: vi.fn(async () => null),
      createMemoryGraphNode: vi.fn(),
      updateMemoryGraphNode: vi.fn(),
      archiveMemoryGraphNode: vi.fn(),
      deleteMemoryGraphNode: vi.fn(),
      mergeMemoryGraphNodes: vi.fn(),
      approveMemoryCandidate: vi.fn()
    }
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

describe("HistoryPage", () => {
  it("renders both Activity and Memory tabs", async () => {
    const { HistoryPage } = await import("./HistoryPage");
    render(<HistoryPage />);
    expect(screen.getByRole("tab", { name: /activity/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /memory/i })).toBeTruthy();
  });

  it("defaults to the Activity tab", async () => {
    const { HistoryPage } = await import("./HistoryPage");
    render(<HistoryPage />);
    expect(screen.getByRole("tab", { name: /activity/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /memory/i }).getAttribute("aria-selected")).toBe("false");
  });

  it("switches to Memory when its tab is clicked", async () => {
    const { HistoryPage } = await import("./HistoryPage");
    render(<HistoryPage />);
    fireEvent.click(screen.getByRole("tab", { name: /memory/i }));
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /memory/i }).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("respects initialTab prop", async () => {
    const { HistoryPage } = await import("./HistoryPage");
    render(<HistoryPage initialTab="memory" />);
    expect(screen.getByRole("tab", { name: /memory/i }).getAttribute("aria-selected")).toBe("true");
  });
});
