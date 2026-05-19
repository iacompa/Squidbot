// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function mountApi(overrides: {
  approvals?: unknown[];
  jobs?: { items: unknown[]; total: number };
} = {}) {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listPendingApprovals: vi.fn(async () => overrides.approvals ?? []),
      listJobs: vi.fn(async () => overrides.jobs ?? { items: [], total: 0 })
    }
  });
}

beforeEach(() => vi.resetModules());
afterEach(() => cleanup());

describe("BriefingPage", () => {
  it("renders three-column briefing layout", async () => {
    mountApi();
    const { BriefingPage } = await import("./BriefingPage");
    const { container } = render(<BriefingPage onNavigate={() => {}} />);
    expect(container.querySelector(".briefing-grid")).not.toBeNull();
    expect(screen.getByText(/Overnight/i)).toBeTruthy();
    expect(screen.getByText(/Needs you/i)).toBeTruthy();
    expect(screen.getByText(/Today's plan/i)).toBeTruthy();
  });

  it("shows pending approvals count from listPendingApprovals", async () => {
    mountApi({ approvals: [{ id: "1" }, { id: "2" }, { id: "3" }] });
    const { BriefingPage } = await import("./BriefingPage");
    render(<BriefingPage onNavigate={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText("3")).toBeTruthy();
    });
  });

  it("shows running jobs count from listJobs", async () => {
    mountApi({ jobs: { items: [{ id: "j1" }, { id: "j2" }], total: 2 } });
    const { BriefingPage } = await import("./BriefingPage");
    render(<BriefingPage onNavigate={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Running jobs \(2\)/i)).toBeTruthy();
    });
  });

  it("renders placeholders for Phase 2 sections", async () => {
    mountApi();
    const { BriefingPage } = await import("./BriefingPage");
    render(<BriefingPage onNavigate={() => {}} />);
    await waitFor(() => {
      // Phase 2 wires email/calendar; for now show em-dash placeholders.
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });
  });
});
