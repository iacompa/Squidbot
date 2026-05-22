import { describe, expect, it } from "vitest";
import type {
  BlueprintManifest,
  GraphNode,
  GraphEdge,
  AgentRoleRef,
  ToolRef,
  BenchmarkTarget,
  KpiTarget,
  BlueprintAuditEntry
} from "../src/types.js";

describe("BlueprintManifest types", () => {
  it("compiles a minimal manifest", () => {
    const manifest: BlueprintManifest = {
      name: "Test Blueprint",
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
      auditTrail: []
    };
    expect(manifest.slug).toBe("test-bp");
  });

  it("rollout status is bounded to allowed values", () => {
    // type-only test: this assignment must be a compile error
    // @ts-expect-error — "deployed" is not a valid status
    const bad: BlueprintManifest["rollout"] = { status: "deployed", haltOnFailure: true };
    expect(bad).toBeDefined();
  });
});
