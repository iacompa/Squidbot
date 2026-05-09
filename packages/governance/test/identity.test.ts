import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("governance identity bootstrap", () => {
  it("creates local tenant, admin, service account, and default roles", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    const result = governance.bootstrap();
    expect(result.tenantId).toBe("local-tenant");
    expect(governance.identities.listUsers()).toHaveLength(2);
    expect(governance.identities.listRoles().map((role) => role.name)).toContain("developer");
    expect(governance.identities.getActorRoleNames("user", "user_local_admin")).toContain("owner");
  });
});
