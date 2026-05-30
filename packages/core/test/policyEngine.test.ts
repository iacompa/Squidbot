import { describe, expect, it } from "vitest";
import { PolicyEngine } from "../src/policyEngine.js";
import type { ToolManifest } from "../src/toolRegistry.js";

const engine = new PolicyEngine();

function manifest(over: Partial<ToolManifest>): ToolManifest {
  return {
    name: "x",
    description: "",
    inputSchema: { type: "object" },
    permissionScopes: [],
    riskLevel: "low",
    ...over
  };
}

describe("PolicyEngine.evaluateTool default-deny for high-risk tools", () => {
  it("denies an unmatched critical-risk tool (e.g. an MCP-proxied tool exposed via the MCP server)", () => {
    // Before the fix this fell through to allowed:true — an external MCP client
    // could invoke a critical-risk proxied tool with no explicit allow policy.
    const decision = engine.evaluateTool(manifest({ name: "mcp.dangerous", permissionScopes: ["mcp.tool"], riskLevel: "critical" }), {
      cmd: "rm -rf /"
    });
    expect(decision.allowed).toBe(false);
  });

  it("denies an unmatched high-risk tool", () => {
    const decision = engine.evaluateTool(manifest({ name: "mcp.write", permissionScopes: ["mcp.tool"], riskLevel: "high" }), {});
    expect(decision.allowed).toBe(false);
  });

  it("still allows a low-risk read-only local tool", () => {
    const decision = engine.evaluateTool(manifest({ name: "workspace.readFile", permissionScopes: ["filesystem.read"], riskLevel: "low" }), {});
    expect(decision.allowed).toBe(true);
  });

  it("still allows a medium-risk unmatched local tool (no behavior change for the existing safe default)", () => {
    const decision = engine.evaluateTool(manifest({ name: "model.listAccounts", permissionScopes: ["model.read"], riskLevel: "medium" }), {});
    expect(decision.allowed).toBe(true);
  });
});
