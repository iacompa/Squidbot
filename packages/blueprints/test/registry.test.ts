import { describe, expect, it, vi } from "vitest";
import { BlueprintRegistry } from "../src/registry.js";
import type { BlueprintManifest } from "../src/types.js";

function makeManifest(overrides: Partial<BlueprintManifest> = {}): BlueprintManifest {
  return {
    name: "Test",
    slug: "test-bp",
    version: "1.0.0",
    description: "smoke",
    owner: "system",
    tags: [],
    graph: { nodes: [], edges: [] },
    agentRoles: [],
    tools: [],
    connectors: [],
    policies: [],
    datasets: [],
    benchmarks: [],
    kpis: [],
    rollout: { status: "draft", haltOnFailure: true },
    scope: {},
    createdAt: "2026-05-21T00:00:00Z",
    createdBy: "system",
    updatedAt: "2026-05-21T00:00:00Z",
    updatedBy: "system",
    auditTrail: [],
    ...overrides
  };
}

const makeMockDb = () => {
  const rows: Array<{
    id: string;
    slug: string;
    name: string;
    manifest_json: string;
    status: string;
    current_version: string;
  }> = [];
  return {
    saveBlueprint: vi.fn(
      (
        input: {
          slug: string;
          name: string;
          manifest_json: string;
          status: string;
          current_version: string;
        },
        _actor: string
      ) => {
        const existing = rows.find((r) => r.slug === input.slug);
        if (existing) {
          existing.name = input.name;
          existing.manifest_json = input.manifest_json;
          existing.status = input.status;
          existing.current_version = input.current_version;
          return existing.id;
        }
        const id = `bp-${rows.length + 1}`;
        rows.push({ id, ...input });
        return id;
      }
    ),
    getBlueprint: vi.fn((slug: string) => rows.find((r) => r.slug === slug) ?? null),
    listBlueprints: vi.fn(() => rows.slice()),
    deleteBlueprint: vi.fn((id: string) => {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    }),
    listBlueprintVersions: vi.fn(() => [])
  };
};

describe("BlueprintRegistry", () => {
  it("install persists a valid manifest", () => {
    const db = makeMockDb();
    const reg = new BlueprintRegistry(db as never);
    const result = reg.install(makeManifest(), "user-1");
    expect(result.ok).toBe(true);
    expect(db.saveBlueprint).toHaveBeenCalled();
  });

  it("install rejects an invalid manifest", () => {
    const db = makeMockDb();
    const reg = new BlueprintRegistry(db as never);
    const result = reg.install(makeManifest({ slug: "BAD SLUG" }), "user-1");
    expect(result.ok).toBe(false);
  });

  it("uninstall removes the blueprint", () => {
    const db = makeMockDb();
    const reg = new BlueprintRegistry(db as never);
    reg.install(makeManifest(), "user-1");
    reg.uninstall("test-bp", "user-1");
    expect(db.deleteBlueprint).toHaveBeenCalled();
  });

  it("list returns installed Blueprints", () => {
    const db = makeMockDb();
    const reg = new BlueprintRegistry(db as never);
    reg.install(makeManifest(), "user-1");
    reg.install(makeManifest({ slug: "second", name: "Second" }), "user-1");
    const installed = reg.list();
    expect(installed).toHaveLength(2);
    const slugs = installed.map((m) => m.slug).sort();
    expect(slugs).toEqual(["second", "test-bp"]);
  });
});
