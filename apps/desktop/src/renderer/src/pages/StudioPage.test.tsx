// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const sampleBlueprint = {
  slug: "ai-ceo-operations",
  name: "AI CEO Operations",
  version: "1.0.0",
  description: "Email triage, calendar management, and a daily briefing.",
  owner: "founder",
  tags: ["operations", "exec"],
  rollout: { status: "pilot" },
  agentRoles: [{ id: "triager" }, { id: "briefer" }],
  tools: [{ id: "workspace.readFile" }],
  connectors: [{ name: "gmail" }],
  policies: [{ id: "no-send-without-approval" }],
  datasets: [{ id: "inbox-fixture", source: "fixture" }],
  benchmarks: [{ datasetId: "inbox-fixture", metric: "triage-accuracy", threshold: 0.85 }],
  kpis: [{ name: "hours saved", target: 5, unit: "hrs/week" }],
  graph: { nodes: [{ id: "n1" }, { id: "n2" }], edges: [{ id: "e1" }] },
  auditTrail: []
};

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("StudioPage", () => {
  it("renders the AI Studio surface without requiring live IPC during initial render", async () => {
    vi.resetModules();
    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        listBlueprints: vi.fn(async () => ({ blueprints: [] })),
        exportBlueprint: vi.fn(async () => ({ json: "{}" }))
      }
    });

    const { StudioPage } = await import("./StudioPage");
    const markup = renderToStaticMarkup(<StudioPage />);

    expect(markup).toContain("AI Studio");
    expect(markup).toContain("Blueprint Catalog");
    expect(markup).toContain("Installed blueprints");
  });

  it("lists installed blueprints, shows composition, and exports a manifest", async () => {
    vi.resetModules();
    const listBlueprints = vi.fn(async () => ({ blueprints: [sampleBlueprint] }));
    const exportBlueprint = vi.fn(async (slug: string) => ({ json: `{"slug":"${slug}","exported":true}` }));

    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: { listBlueprints, exportBlueprint }
    });

    const { StudioPage } = await import("./StudioPage");
    render(<StudioPage />);

    // The blueprint appears in the catalog with its composition counts.
    expect(await screen.findByText("AI CEO Operations")).toBeTruthy();
    // "pilot" renders in both the list status pill and the detail heading.
    expect(screen.getAllByText("pilot").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/2 agents · 1 tools · 1 connectors/)).toBeTruthy();
    expect(screen.getByText(/1 benchmarks · 1 KPIs/)).toBeTruthy();

    // Export calls the real IPC and surfaces the manifest JSON.
    fireEvent.click(screen.getByRole("button", { name: /Export JSON/i }));
    await waitFor(() => {
      expect(exportBlueprint).toHaveBeenCalledWith("ai-ceo-operations");
    });
    expect(await screen.findByText(/"exported":true/)).toBeTruthy();
  });
});
