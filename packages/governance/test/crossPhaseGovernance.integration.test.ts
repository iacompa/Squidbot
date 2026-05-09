import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("cross-phase governance invariants", () => {
  it("requires approval for sandbox promotion, denies n8n high-risk approval, and allows eval runners to run evals", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const evalUser = governance.identities.createUser({ username: "eval", email: "eval@example.test" });
    governance.identities.assignRole({ principalType: "user", principalId: evalUser.id, roleName: "evalRunner" });
    expect(
      governance.decide({
        actor: { type: "user", id: "user_local_admin" },
        action: "sandbox.promote",
        resource: { type: "sandbox", id: "sandbox_test" },
        context: { riskLevel: "high" }
      }).decision
    ).toBe("requireApproval");
    expect(
      governance.decide({
        actor: { type: "serviceAccount", id: "service_n8n_local" },
        action: "sandbox.promote",
        resource: { type: "sandbox", id: "sandbox_test" },
        context: { source: "n8n", riskLevel: "high" }
      }).decision
    ).toBe("deny");
    expect(
      governance.decide({
        actor: { type: "user", id: evalUser.id },
        action: "eval.run",
        resource: { type: "eval", id: "coding-calculator-bugfix" }
      }).decision
    ).toBe("allow");
  });
});
