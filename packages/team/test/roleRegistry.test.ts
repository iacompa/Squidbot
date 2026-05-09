import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, tempDb } from "./helpers.js";
import { defaultRoleManifests, RoleRegistry, validateRoleManifest } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("role manifests and registry", () => {
  it("validates default roles and installs them", () => {
    const db = tempDb();
    const registry = new RoleRegistry(db);
    const roles = registry.installDefaults();
    expect(roles.map((role) => role.id)).toContain("coordinator");
    expect(roles.map((role) => role.id)).toContain("implementer");
    expect(defaultRoleManifests.every((role) => validateRoleManifest(role).id === role.id)).toBe(true);
    db.close();
  });

  it("rejects missing fields and unsafe write roles without approvals", () => {
    expect(() => validateRoleManifest({ name: "No ID" })).toThrow(/id/);
    expect(() =>
      validateRoleManifest({
        ...defaultRoleManifests.find((role) => role.id === "implementer"),
        requiredApprovals: undefined
      })
    ).toThrow(/approval/);
  });

  it("archives roles without deleting their manifest history", () => {
    const db = tempDb();
    const registry = new RoleRegistry(db);
    registry.installDefaults();
    const archived = registry.archive("reviewer");
    expect(archived.archivedAt).toBeTruthy();
    expect(registry.list().some((role) => role.id === "reviewer")).toBe(false);
    expect(registry.list({ includeArchived: true }).some((role) => role.id === "reviewer")).toBe(true);
    db.close();
  });
});
