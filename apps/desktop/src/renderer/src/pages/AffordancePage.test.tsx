// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AffordanceGapDto } from "../types";

const openGap: AffordanceGapDto = {
  id: "affordance_gap_run_123_missingTool_nonexistentTool",
  runId: "run_123",
  reflectionId: "reflection_123",
  type: "missingTool",
  name: "nonexistentTool",
  severity: "medium",
  description: "Tool nonexistentTool was requested but is not registered.",
  context: {
    task: "use nonexistentTool to do something"
  },
  status: "open",
  createdAt: "2026-05-02T19:49:39.448Z",
  resolvedAt: null
};

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("AffordancePage", () => {
  it("renders the gaps surface without requiring live IPC during initial render", async () => {
    vi.resetModules();
    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        listAffordanceGaps: vi.fn(async () => []),
        getAffordanceGap: vi.fn(async () => null),
        resolveAffordanceGap: vi.fn()
      }
    });

    const { AffordancePage } = await import("./AffordancePage");
    const markup = renderToStaticMarkup(<AffordancePage />);

    expect(markup).toContain("Affordances");
    expect(markup).toContain("Detected gaps");
    expect(markup).toContain("Resolve");
  });

  it("loads gaps, shows context, and resolves the selected gap", async () => {
    vi.resetModules();
    const gaps = [openGap];
    const listAffordanceGaps = vi.fn(async ({ status }: { status?: string } = {}) => {
      if (!status || status === "open") {
        return gaps.filter((gap) => gap.status === "open");
      }
      if (status === "all") {
        return gaps;
      }
      return gaps.filter((gap) => gap.status === status);
    });
    const resolveAffordanceGap = vi.fn(async (gapId: string) => {
      const gap = gaps.find((candidate) => candidate.id === gapId);
      if (!gap) {
        throw new Error("Gap not found");
      }
      gap.status = "resolved";
      gap.resolvedAt = "2026-05-02T20:01:00.000Z";
      return gap;
    });

    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        listAffordanceGaps,
        getAffordanceGap: vi.fn(async () => null),
        resolveAffordanceGap
      }
    });

    const { AffordancePage } = await import("./AffordancePage");
    render(<AffordancePage />);

    expect(await screen.findByText("nonexistentTool")).toBeTruthy();
    expect(screen.getByText("Tool nonexistentTool was requested but is not registered.")).toBeTruthy();
    expect(screen.getByText(/use nonexistentTool to do something/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Resolve/i }));

    await waitFor(() => {
      expect(resolveAffordanceGap).toHaveBeenCalledWith(openGap.id, "resolved");
    });
    await waitFor(() => {
      expect(screen.getByText("No gaps in this view")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "all" } });

    expect(await screen.findByText("nonexistentTool")).toBeTruthy();
    expect(screen.getByText("resolved")).toBeTruthy();
  });
});
