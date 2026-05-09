import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("RBAC decisions", () => {
  it("allows developer patch drafts but blocks viewer patch creation", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const viewer = governance.identities.createUser({ username: "viewer", email: "viewer@example.test" });
    governance.identities.assignRole({ principalType: "user", principalId: viewer.id, roleName: "viewer" });
    const dev = governance.identities.createUser({ username: "dev", email: "dev@example.test" });
    governance.identities.assignRole({ principalType: "user", principalId: dev.id, roleName: "developer" });

    expect(
      governance.decide({
        actor: { type: "user", id: viewer.id },
        action: "tool.workspace.createPatch",
        resource: { type: "tool", id: "workspace.createPatch" }
      }).decision
    ).toBe("deny");

    expect(
      governance.decide({
        actor: { type: "user", id: dev.id },
        action: "tool.workspace.createPatch",
        resource: { type: "tool", id: "workspace.createPatch" }
      }).decision
    ).toBe("allow");
  });
});
