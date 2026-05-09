import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-db-"));
  return path.join(dir, "squidbot.sqlite");
}

describe("SquidDatabase", () => {
  it("runs migrations and stores events, traces, and settings", () => {
    database = initializeDatabase(tempDbPath());

    database.appendEvent({
      id: "evt_test",
      timestamp: "2026-04-30T12:00:00.000Z",
      sessionId: "session_test",
      type: "user.message",
      data: { content: "list files" }
    });

    database.saveTrace({
      id: "trace_test",
      sessionId: "session_test",
      createdAt: "2026-04-30T12:00:01.000Z",
      events: [{ id: "evt_test", type: "user.message" }]
    });

    database.setSetting("modelProvider", "mock");

    expect(database.listEvents("session_test")).toHaveLength(1);
    expect(database.getLatestTrace()?.id).toBe("trace_test");
    expect(database.getSetting("modelProvider")).toBe("mock");
    database.deleteSetting("modelProvider");
    expect(database.getSetting("modelProvider")).toBeNull();
  });

  it("stores reflections and approved memories", () => {
    database = initializeDatabase(tempDbPath());

    database.saveReflection({
      id: "reflection_test",
      sessionId: "session_test",
      runId: "run_test",
      task: "Fix calculator",
      summary: "Inspected the repository and drafted a patch.",
      outcome: "partially_succeeded",
      successFactors: ["read files"],
      failureModes: ["tests failed before patch approval"],
      missingTools: [],
      missingPermissions: ["filesystem.write"],
      missingContext: [],
      reusablePatterns: ["draft patch first"],
      failureTaxonomy: ["missingPermission"],
      affordanceIds: ["affordance_gap_test"],
      memoryCandidates: [
        {
          type: "observation",
          title: "Calculator add subtracts",
          body: "The add function subtracts.",
          sourceEventId: "evt_read",
          confidence: 0.9
        }
      ],
      createdAt: "2026-04-30T12:00:00.000Z"
    });

    const memory = database.insertMemory({
      id: "memory_test",
      type: "observation",
      title: "Calculator add subtracts",
      body: "The add function subtracts.",
      sourceRunId: "run_test",
      sourceReflectionId: "reflection_test",
      sourceEventId: "evt_read",
      confidence: 0.9,
      importance: 0.7,
      createdAt: "2026-04-30T12:00:01.000Z",
      approvedAt: "2026-04-30T12:00:01.000Z"
    });

    expect(database.listReflections()).toHaveLength(1);
    expect(database.getReflection("reflection_test")?.memoryCandidates).toHaveLength(1);
    expect(database.getReflection("reflection_test")?.failureTaxonomy).toEqual(["missingPermission"]);
    expect(database.getReflection("reflection_test")?.affordanceIds).toEqual(["affordance_gap_test"]);
    expect(memory.sourceReflectionId).toBe("reflection_test");
    expect(database.listApprovedMemories()).toHaveLength(1);
  });

  it("stores and resolves affordance gaps", () => {
    database = initializeDatabase(tempDbPath());

    const gap = database.insertAffordanceGap({
      id: "affordance_gap_test",
      runId: "run_test",
      reflectionId: "reflection_test",
      type: "missingTool",
      name: "workspace.applyPatch",
      severity: "medium",
      description: "Patch application is not available yet.",
      context: { task: "Fix calculator" },
      createdAt: "2026-04-30T12:00:00.000Z"
    });

    expect(gap.status).toBe("open");
    expect(database.listAffordanceGaps()).toHaveLength(1);
    expect(database.listAffordanceGapsForReflection("reflection_test")).toHaveLength(1);

    const resolved = database.resolveAffordanceGap("affordance_gap_test");

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolvedAt).toBeTruthy();
    expect(database.listAffordanceGaps()).toHaveLength(0);
    expect(database.listAffordanceGaps({ status: "resolved" })).toHaveLength(1);
  });

  it("stores sandbox staging records", () => {
    database = initializeDatabase(tempDbPath());

    const created = database.insertSandbox({
      id: "sandbox_test",
      sessionId: "session_test",
      runId: "run_test",
      workspacePath: "/tmp/squidbot-workspace",
      sandboxPath: "/tmp/squidbot-sandbox/workspace",
      backend: "local",
      resourceLimits: { cpu: 1, memoryMb: 512, diskMb: 512 },
      networkPolicy: "deny",
      diff: "",
      testResults: [],
      createdAt: "2026-04-30T12:00:00.000Z"
    });

    expect(created.status).toBe("active");
    expect(created.networkPolicy).toBe("deny");
    expect(created.resourceLimits).toMatchObject({ cpu: 1, memoryMb: 512, diskMb: 512 });
    expect(database.listSandboxes()).toHaveLength(1);

    const promoted = database.updateSandbox("sandbox_test", {
      status: "promoted",
      diff: "--- a/calculator.py\n+++ b/calculator.py\n",
      testResults: [{ command: "pytest", exitCode: 0 }],
      approvalId: "approval_test",
      promotedAt: "2026-04-30T12:00:01.000Z",
      destroyedAt: "2026-04-30T12:00:01.000Z"
    });

    expect(promoted.status).toBe("promoted");
    expect(promoted.approvalId).toBe("approval_test");
    expect(promoted.testResults).toHaveLength(1);
    expect(database.listSandboxes({ status: "active" })).toHaveLength(0);
    expect(database.listSandboxes({ status: "promoted" })).toHaveLength(1);
  });

  it("stores scheduled jobs and run history", () => {
    database = initializeDatabase(tempDbPath());

    const job = database.insertJob({
      id: "job_test",
      name: "Daily list files",
      type: "task",
      refId: "list files",
      version: null,
      schedule: "0 9 * * 1-5",
      scheduleKind: "recurring",
      nextRunAt: "2026-05-04T13:00:00.000Z",
      status: "active",
      lastOutcome: "never",
      workspacePath: "/tmp/workspace",
      testCommand: null,
      testMode: true,
      createdAt: "2026-05-02T12:00:00.000Z"
    });

    expect(job.status).toBe("active");
    expect(database.listDueJobs("2026-05-04T12:59:00.000Z")).toHaveLength(0);
    expect(database.listDueJobs("2026-05-04T13:00:00.000Z")).toHaveLength(1);

    const updated = database.updateJob("job_test", {
      status: "paused",
      lastOutcome: "success",
      lastRunAt: "2026-05-04T13:00:01.000Z"
    });
    expect(updated.status).toBe("paused");
    expect(database.listJobs({ status: "paused" })).toHaveLength(1);

    const run = database.insertJobRun({
      id: "job_run_test",
      jobId: "job_test",
      runId: "run_test",
      traceId: "trace_test",
      outcome: "success",
      startedAt: "2026-05-04T13:00:00.000Z",
      completedAt: "2026-05-04T13:00:01.000Z",
      durationMs: 1000,
      summary: "Task complete",
      error: null
    });
    expect(run.jobId).toBe("job_test");
    expect(database.listJobRuns("job_test")).toHaveLength(1);
  });

  it("stores installed connector manifests", () => {
    database = initializeDatabase(tempDbPath());

    const connector = database.saveConnector({
      id: "connector_test",
      name: "demoSales",
      manifest: {
        name: "demoSales",
        fixtureMode: true,
        endpoints: [{ operationId: "readSales" }]
      },
      createdAt: "2026-04-30T12:00:00.000Z"
    });

    expect(connector.name).toBe("demoSales");
    expect(database.listConnectors()).toHaveLength(1);
    expect(database.getConnector("demoSales")?.manifest).toMatchObject({
      name: "demoSales",
      fixtureMode: true
    });
  });

  it("tracks daily model usage", () => {
    database = initializeDatabase(tempDbPath());

    database.addModelUsage("api", "2026-04-30", 120, 0.0012);
    database.addModelUsage("api", "2026-04-30", 30, 0.0003);

    const usage = database.getModelUsage("api", "2026-04-30");

    expect(usage?.tokens).toBe(150);
    expect(usage?.cost).toBeCloseTo(0.0015);
    expect(database.listModelUsage()).toHaveLength(1);
  });

  it("creates structured memory graph tables", () => {
    database = initializeDatabase(tempDbPath());

    database.db
      .prepare(
        `INSERT INTO memories_nodes (
          id, type, title, body, confidence, importance, sensitivity, createdAt, updatedAt
        )
        VALUES (
          'memory_node_test', 'fact', 'Calculator fact', 'The add function subtracts.', 0.9, 0.7, 'public',
          '2026-04-30T12:00:00.000Z', '2026-04-30T12:00:00.000Z'
        )`
      )
      .run();

    const ftsRows = database.db
      .prepare("SELECT rowid, title FROM memories_nodes_fts WHERE memories_nodes_fts MATCH 'calculator'")
      .all() as Array<{ rowid: number; title: string }>;

    expect(ftsRows).toHaveLength(1);
    expect(ftsRows[0].title).toBe("Calculator fact");

    database.db
      .prepare(
        `INSERT INTO memories_nodes (
          id, type, title, body, confidence, importance, sensitivity, createdAt, updatedAt, affordanceId
        )
        VALUES (
          'memory_node_gap_test', 'risk', 'Missing tool', 'Patch application is missing.', 0.8, 0.7, 'public',
          '2026-04-30T12:00:00.000Z', '2026-04-30T12:00:00.000Z', 'affordance_gap_test'
        )`
      )
      .run();

    const gapNode = database.db
      .prepare("SELECT affordanceId FROM memories_nodes WHERE id = 'memory_node_gap_test'")
      .get() as { affordanceId: string };

    expect(gapNode.affordanceId).toBe("affordance_gap_test");
  });

  it("creates messaging gateway tables", () => {
    database = initializeDatabase(tempDbPath());

    const tables = [
      "messaging_adapters",
      "messaging_channels",
      "messaging_identities",
      "messaging_allowlist",
      "messaging_sessions",
      "messaging_events",
      "messaging_attachments",
      "messaging_delivery_rules",
      "messaging_approval_links"
    ];

    for (const table of tables) {
      const row = database.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { name: string } | undefined;
      expect(row?.name).toBe(table);
    }

    database.db
      .prepare(
        `INSERT INTO messaging_adapters (id, name, platform, status, manifestJson, createdAt, updatedAt)
         VALUES ('adapter_test', 'Slack Fixture', 'slack', 'installed', '{}', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:00.000Z')`
      )
      .run();
    database.db
      .prepare(
        `INSERT INTO messaging_channels (id, adapterId, platform, externalChannelId, displayName, channelType, status, configJson, createdAt, updatedAt)
         VALUES ('msg_channel_test', 'adapter_test', 'slack', 'C_TEST', '#test', 'channel', 'active', '{}', '2026-05-08T00:00:00.000Z', '2026-05-08T00:00:00.000Z')`
      )
      .run();

    const channel = database.db.prepare("SELECT platform, externalChannelId FROM messaging_channels WHERE id = 'msg_channel_test'").get() as {
      platform: string;
      externalChannelId: string;
    };
    expect(channel).toMatchObject({ platform: "slack", externalChannelId: "C_TEST" });
  });
});
