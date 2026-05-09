import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("ABAC decisions", () => {
  it("blocks restricted data to external models and requires approval for high-risk actions", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    expect(
      governance.decide({
        actor: { type: "user", id: "user_local_admin" },
        action: "model.call",
        resource: { type: "model", id: "api" },
        context: { dataClassification: "restricted", modelProvider: "api" }
      }).decision
    ).toBe("deny");
    expect(
      governance.decide({
        actor: { type: "user", id: "user_local_admin" },
        action: "sandbox.promote",
        resource: { type: "sandbox", id: "sandbox_test" },
        context: { riskLevel: "high" }
      }).decision
    ).toBe("requireApproval");
  });
});
