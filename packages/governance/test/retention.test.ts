import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("retention and legal hold", () => {
  it("dry-runs retention and blocks apply under legal hold", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    governance.retention.createPolicy({ name: "Trace retention", resourceType: "trace", retentionDays: 180, action: "archive" });
    governance.retention.createLegalHold({ name: "Test hold", selector: { runId: "run_test" } });
    const dryRun = governance.retention.dryRun();
    expect(dryRun[0].legalHoldBlocked).toBe(true);
    expect(governance.retention.apply().blockedByLegalHold).toBe(1);
  });
});
