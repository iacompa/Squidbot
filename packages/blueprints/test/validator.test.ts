import { describe, expect, it } from "vitest";
import { validateManifest } from "../src/validator.js";

const minimal = {
  name: "Test",
  slug: "test",
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

describe("validateManifest", () => {
  it("accepts a minimal valid manifest", () => {
    const result = validateManifest(minimal);
    expect(result.ok).toBe(true);
  });

  it("rejects manifest missing required slug", () => {
    const bad = { ...minimal, slug: undefined };
    const result = validateManifest(bad as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("|")).toMatch(/slug/i);
  });

  it("rejects malformed semver version", () => {
    const bad = { ...minimal, version: "not-a-semver" };
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("|")).toMatch(/version/i);
  });

  it("rejects unknown rollout status", () => {
    const bad = { ...minimal, rollout: { status: "wat", haltOnFailure: true } };
    const result = validateManifest(bad as unknown);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("|")).toMatch(/rollout|status/i);
  });

  it("rejects slug with whitespace", () => {
    const bad = { ...minimal, slug: "test ai" };
    const result = validateManifest(bad);
    expect(result.ok).toBe(false);
  });
});
