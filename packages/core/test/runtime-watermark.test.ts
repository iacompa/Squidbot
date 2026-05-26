import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { AgentRuntime } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-watermark-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Fixture\n", "utf8");
  return {
    dbPath: path.join(dir, "squidbot.sqlite"),
    workspacePath
  };
}

function seedResolvedApproval(db: SquidDatabase, sessionId: string, approvalId: string): void {
  const now = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO pending_approvals
         (id, kind, title, summary, riskLevel, payloadJson, callerSessionId,
          createdAt, resolvedAt, resolution, resultJson)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      approvalId,
      "connector-call",
      "Test approval",
      "fixture",
      "medium",
      JSON.stringify({ connectorName: "github", operationId: "createIssue" }),
      sessionId,
      now,
      now,
      "approved",
      JSON.stringify({ status: 201 })
    );
}

describe("AgentRuntime — approval watermark persistence", () => {
  it("does not re-surface a resolved approval after runtime restart", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const sessionId = "watermark-session";

    seedResolvedApproval(database, sessionId, "appr-1");

    // First runtime surfaces the approval once in its trace.
    const r1 = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      sessionId
    });
    const first = await r1.sendMessage("hi");

    // The first turn either surfaces appr-1 (good) or none — both fine.
    // What matters: the watermark moves forward and persists.
    const watermarkAfterR1 = database.getSetting<string>(`chat.lastResolvedAt.${sessionId}`);
    expect(watermarkAfterR1).not.toBeNull();

    // Second runtime (simulates next IPC call). The approval must NOT be
    // surfaced again in this turn's events.
    const r2 = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      sessionId
    });
    const second = await r2.sendMessage("hi again");

    const noteEvents = database
      .listEvents(second.sessionId)
      .filter((e) => e.type === "model.request" || e.type === "model.response");
    // Re-surfacing would mean the approval id appears in this turn's
    // model events. It should NOT — the watermark blocks it.
    const stringified = JSON.stringify(noteEvents);
    void first;
    expect(stringified).not.toContain("appr-1");
  });

  it("stores the watermark in the settings table keyed by sessionId", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const sessionId = "watermark-key-test";

    seedResolvedApproval(database, sessionId, "appr-2");

    const r = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      sessionId
    });
    await r.sendMessage("trigger watermark");

    const stored = database.getSetting<string>(`chat.lastResolvedAt.${sessionId}`);
    expect(typeof stored).toBe("string");
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
