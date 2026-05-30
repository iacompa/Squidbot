import { describe, expect, it } from "vitest";
import { checkRoleToolPermission, defaultRoleManifests, defaultTeamManifest } from "../src/index.js";

describe("team permission enforcement", () => {
  it("blocks read-only roles from patch creation", () => {
    const researcher = defaultRoleManifests.find((role) => role.id === "researcher");
    expect(researcher).toBeTruthy();
    const result = checkRoleToolPermission({
      role: researcher!,
      team: defaultTeamManifest,
      toolName: "workspace.createPatch",
      riskLevel: "medium"
    });
    expect(result.allowed).toBe(false);
  });

  it("allows implementer patch drafting but keeps promotion approval-gated", () => {
    const implementer = defaultRoleManifests.find((role) => role.id === "implementer")!;
    expect(checkRoleToolPermission({ role: implementer, team: defaultTeamManifest, toolName: "workspace.createPatch", riskLevel: "medium" })).toMatchObject({
      allowed: true,
      requiresApproval: true
    });
    expect(checkRoleToolPermission({ role: implementer, team: defaultTeamManifest, toolName: "sandbox.promote", riskLevel: "high" })).toMatchObject({
      allowed: false
    });
  });

  it("requires approval for release connector writes", () => {
    const release = defaultRoleManifests.find((role) => role.id === "releaseCoordinator")!;
    expect(
      checkRoleToolPermission({
        role: release,
        team: defaultTeamManifest,
        toolName: "connector.github.openDraftPullRequest",
        riskLevel: "high",
        realConnectorWrite: true
      })
    ).toMatchObject({ allowed: true, requiresApproval: true });
  });
});

describe("team permission — denied/wildcard/connector enforcement branches", () => {
  const base = defaultRoleManifests.find((role) => role.id === "implementer")!;
  function roleWith(
    overrides: Partial<Omit<typeof base, "riskLimits">> & { riskLimits?: Partial<typeof base.riskLimits> }
  ) {
    return {
      ...base,
      ...overrides,
      riskLimits: { ...base.riskLimits, ...(overrides.riskLimits ?? {}) }
    };
  }

  it("an explicit deniedTools entry overrides a wildcard allow (deny wins)", () => {
    const role = roleWith({
      allowedTools: ["workspace.*"],
      deniedTools: ["workspace.writeFile"],
      riskLimits: { maxToolRisk: "high", canModifyWorkspace: true, canCallConnectors: true }
    });
    // The wildcard would allow writeFile, but the explicit deny must win.
    expect(checkRoleToolPermission({ role, toolName: "workspace.writeFile", riskLevel: "low" }).allowed).toBe(false);
    // A sibling tool still matched by the wildcard remains allowed.
    expect(checkRoleToolPermission({ role, toolName: "workspace.readFile", riskLevel: "low" }).allowed).toBe(true);
  });

  it("blocks connector tools when the role cannot call connectors", () => {
    const role = roleWith({
      allowedTools: ["connector.*"],
      deniedTools: [],
      riskLimits: { maxToolRisk: "high", canModifyWorkspace: true, canCallConnectors: false }
    });
    const result = checkRoleToolPermission({ role, toolName: "connector.github.listIssues", riskLevel: "low" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/connector/i);
  });

  it("matches a wildcard allow pattern positively", () => {
    const role = roleWith({
      allowedTools: ["test.*"],
      deniedTools: [],
      riskLimits: { maxToolRisk: "high", canModifyWorkspace: true, canCallConnectors: true }
    });
    expect(checkRoleToolPermission({ role, toolName: "test.run", riskLevel: "low" }).allowed).toBe(true);
    // A tool outside the allow set is rejected.
    expect(checkRoleToolPermission({ role, toolName: "workspace.writeFile", riskLevel: "low" }).allowed).toBe(false);
  });
});
