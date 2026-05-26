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

  it("apply() without confirm is a dry-run — no rows are touched", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    // Insert a trace older than the retention window
    const oldCreatedAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    db.db
      .prepare(
        `INSERT INTO traces (id, session_id, events, created_at) VALUES (?, ?, ?, ?)`
      )
      .run("trace_old", "session_old", "{}", oldCreatedAt);

    governance.retention.createPolicy({
      name: "Trace retention",
      resourceType: "trace",
      retentionDays: 30,
      action: "delete"
    });

    const result = governance.retention.apply({ confirm: false });
    expect(result.confirmed).toBe(false);
    expect(result.rowsAffected).toBe(0);
    expect(result.results[0].matchedCount).toBe(1);
    // Trace should STILL be there
    const remaining = db.db.prepare(`SELECT COUNT(*) AS count FROM traces WHERE id = 'trace_old'`).get() as { count: number };
    expect(remaining.count).toBe(1);
  });

  it("apply({ confirm: true }) actually deletes rows older than retention window", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const oldCreatedAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    const recentCreatedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    db.db
      .prepare(`INSERT INTO traces (id, session_id, events, created_at) VALUES (?, ?, ?, ?)`)
      .run("trace_old", "session_old", "{}", oldCreatedAt);
    db.db
      .prepare(`INSERT INTO traces (id, session_id, events, created_at) VALUES (?, ?, ?, ?)`)
      .run("trace_recent", "session_recent", "{}", recentCreatedAt);

    governance.retention.createPolicy({
      name: "Trace retention",
      resourceType: "trace",
      retentionDays: 30,
      action: "delete"
    });

    const result = governance.retention.apply({ confirm: true });
    expect(result.confirmed).toBe(true);
    expect(result.rowsAffected).toBe(1);
    const remaining = db.db.prepare(`SELECT id FROM traces ORDER BY id`).all() as Array<{ id: string }>;
    expect(remaining.map((r) => r.id)).toEqual(["trace_recent"]);
  });

  it("apply({ confirm: true }) is blocked by an active legal hold", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const oldCreatedAt = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    db.db
      .prepare(`INSERT INTO traces (id, session_id, events, created_at) VALUES (?, ?, ?, ?)`)
      .run("trace_held", "session_held", "{}", oldCreatedAt);
    governance.retention.createPolicy({
      name: "Trace retention",
      resourceType: "trace",
      retentionDays: 30,
      action: "delete"
    });
    governance.retention.createLegalHold({ name: "Litigation hold", selector: {} });

    const result = governance.retention.apply({ confirm: true });
    expect(result.blockedByLegalHold).toBe(1);
    expect(result.rowsAffected).toBe(0);
    const remaining = db.db.prepare(`SELECT COUNT(*) AS count FROM traces WHERE id = 'trace_held'`).get() as { count: number };
    expect(remaining.count).toBe(1);
  });
});
