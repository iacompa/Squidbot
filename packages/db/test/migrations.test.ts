import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "../src/index.js";

let openDatabases: SquidDatabase[] = [];

afterEach(() => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
});

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-migrations-"));
  return path.join(dir, "squidbot.sqlite");
}

function freshDatabase(): Database.Database {
  const sqlite = initializeDatabase(tempDbPath());
  openDatabases.push(sqlite);
  return sqlite.db;
}

describe("pending_approvals migration", () => {
  it("creates the pending_approvals table with the expected columns", () => {
    const database = freshDatabase();
    const columns = database
      .prepare(`PRAGMA table_info(pending_approvals)`)
      .all() as Array<{ name: string; type: string; notnull: number }>;
    const names = columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "id",
        "kind",
        "title",
        "summary",
        "riskLevel",
        "payloadJson",
        "callerSessionId",
        "callerRunId",
        "createdAt",
        "resolvedAt",
        "resolution",
        "resultJson"
      ])
    );
  });

  it("enforces the kind CHECK constraint", () => {
    const database = freshDatabase();
    expect(() =>
      database
        .prepare(
          `INSERT INTO pending_approvals (id, kind, title, summary, riskLevel, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("ap_test", "bogus-kind", "title", "summary", "low", "{}", "now")
    ).toThrow();
  });

  it("enforces the riskLevel CHECK constraint", () => {
    const database = freshDatabase();
    expect(() =>
      database
        .prepare(
          `INSERT INTO pending_approvals (id, kind, title, summary, riskLevel, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("ap_test", "sandbox-promotion", "t", "s", "extreme", "{}", "now")
    ).toThrow();
  });

  it("enforces the resolution CHECK constraint", () => {
    const database = freshDatabase();
    expect(() =>
      database
        .prepare(
          `INSERT INTO pending_approvals (id, kind, title, summary, riskLevel, payloadJson, createdAt, resolvedAt, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("ap_test", "sandbox-promotion", "t", "s", "low", "{}", "now", "now", "maybe")
    ).toThrow();
  });

  it("accepts 'critical' as a valid riskLevel (regression for I1)", () => {
    const database = freshDatabase();
    expect(() =>
      database
        .prepare(
          `INSERT INTO pending_approvals (id, kind, title, summary, riskLevel, payloadJson, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("ap_test", "sandbox-promotion", "t", "s", "critical", "{}", "now")
    ).not.toThrow();
  });

  it("creates the unresolved and session indexes", () => {
    const database = freshDatabase();
    const indexes = database
      .prepare(`PRAGMA index_list(pending_approvals)`)
      .all() as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "idx_pending_approvals_unresolved",
        "idx_pending_approvals_session"
      ])
    );
  });

  it("enforces the resolvedAt/resolution correlation", () => {
    const database = freshDatabase();
    // resolvedAt without resolution → invalid
    expect(() =>
      database
        .prepare(
          `INSERT INTO pending_approvals (id, kind, title, summary, riskLevel, payloadJson, createdAt, resolvedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("ap_a", "sandbox-promotion", "t", "s", "low", "{}", "now", "now")
    ).toThrow();
    // resolution without resolvedAt → invalid
    expect(() =>
      database
        .prepare(
          `INSERT INTO pending_approvals (id, kind, title, summary, riskLevel, payloadJson, createdAt, resolution) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("ap_b", "sandbox-promotion", "t", "s", "low", "{}", "now", "approved")
    ).toThrow();
  });
});
