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
