import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

describe("MemoryGraphPage", () => {
  it("renders the inspector surface without loading graph data during initial render", async () => {
    vi.resetModules();
    vi.stubGlobal("window", {
      squidbot: {
        listMemoryGraphNodes: vi.fn(async () => []),
        listMemories: vi.fn(async () => []),
        listReflections: vi.fn(async () => []),
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

    const { MemoryGraphPage } = await import("./MemoryGraphPage");
    const markup = renderToStaticMarkup(<MemoryGraphPage />);

    expect(markup).toContain("Semantic graph");
    expect(markup).toContain("Search facts, decisions, risks, preferences");
    expect(markup).toContain("Create node");
  });
});
