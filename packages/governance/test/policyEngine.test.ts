import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("policy decision persistence", () => {
  it("persists policy decisions and audits denied decisions", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const decision = governance.decide({
      actor: { type: "user", id: "unknown" },
      action: "connector.github.createPullRequest",
      resource: { type: "connector", id: "github" }
    });
    expect(decision.decision).toBe("deny");
    expect(governance.policies.listDecisions()).toHaveLength(1);
    expect(governance.audit.latest().some((entry) => entry.action === "connector.github.createPullRequest")).toBe(true);
  });
});
