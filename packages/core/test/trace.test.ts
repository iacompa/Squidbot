import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  buildTrace,
  computeTraceMetrics,
  exportTraceMarkdown,
  getTrace,
  listRuns,
  redactSecrets,
  searchEvents,
  type AgentEvent
} from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createDatabase(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trace-api-"));
  return initializeDatabase(path.join(dir, "squidbot.sqlite"));
}

function event(index: number, type: AgentEvent["type"], data: Record<string, unknown>): AgentEvent {
  return {
    id: `evt_${index}`,
    timestamp: new Date(Date.UTC(2026, 4, 2, 12, 0, 0, index * 25)).toISOString(),
    sessionId: "session_trace_test",
    runId: "run_trace_test",
    type,
    data: {
      runId: "run_trace_test",
      ...data
    }
  };
}

describe("trace query and redaction API", () => {
  it("lists, searches, redacts, and computes metrics for traces", () => {
    database = createDatabase();
    const trace = buildTrace([
      event(0, "session.started", { workspacePath: "/tmp/workspace" }),
      event(1, "user.task", {
        task: "Send this secret: API_KEY=sk-abcdef1234567890 to user@example.com"
      }),
      event(2, "model.call", {
        provider: "mock",
        costOwner: "local/free",
        tokenEstimate: 12,
        prompt: "Contact user@example.com with API_KEY=sk-abcdef1234567890"
      }),
      event(3, "model.result", {
        provider: "mock",
        costOwner: "local/free",
        tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        costEstimate: 0.001
      }),
      event(4, "tool.call", {
        toolName: "workspace.createPatch",
        args: { apiKey: "sk-abcdef1234567890", email: "user@example.com" }
      }),
      event(5, "sandbox.diff", {
        sandboxId: "sandbox_trace_test",
        diff: "--- a/file.txt\n+++ b/file.txt\n@@\n-old\n+new\n"
      }),
      event(6, "task.complete", {
        finalSummary: "done"
      })
    ]);

    database.saveTrace({
      id: trace.id,
      sessionId: trace.sessionId,
      events: trace,
      createdAt: trace.createdAt
    });

    expect(redactSecrets("API_KEY=sk-abcdef1234567890 email user@example.com")).toContain("API_KEY=[REDACTED]");
    const redactedTrace = getTrace(database, "run_trace_test");
    expect(redactedTrace).toBeTruthy();
    expect(JSON.stringify(redactedTrace)).toContain("[REDACTED]");
    expect(JSON.stringify(redactedTrace)).not.toContain("sk-abcdef1234567890");
    expect(JSON.stringify(redactedTrace)).not.toContain("user@example.com");

    const runs = listRuns(database);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: "run_trace_test",
      provider: "mock",
      status: "success",
      totalTokens: 27
    });

    const metrics = computeTraceMetrics(redactedTrace!);
    expect(metrics.totalCost).toBe(0.001);
    expect(metrics.providerBreakdown[0]).toMatchObject({ provider: "mock", totalTokens: 27 });
    expect(metrics.toolBreakdown.map((item) => item.name)).toContain("workspace.createPatch");

    expect(searchEvents(database, { type: "sandbox.diff", text: "file.txt" })).toHaveLength(1);
    expect(searchEvents(database, { provider: "mock" }).length).toBeGreaterThanOrEqual(2);
    expect(exportTraceMarkdown(redactedTrace!)).toContain("# Trace run_trace_test");
  });

  it("does not mark successful fallback runs as failed", () => {
    database = createDatabase();
    const trace = buildTrace([
      event(0, "session.started", { workspacePath: "/tmp/workspace" }),
      event(1, "user.message", { content: "list files" }),
      event(2, "model.error", {
        provider: "local",
        modelName: "ollama-local",
        costOwner: "local/free",
        message: "Provider is not available."
      }),
      event(3, "model.fallback", {
        fromProvider: "local",
        toProvider: "mock",
        reason: "local unavailable or budget blocked"
      }),
      event(4, "model.call", {
        provider: "mock",
        costOwner: "local/free",
        tokenEstimate: 12
      }),
      event(5, "model.result", {
        provider: "mock",
        costOwner: "local/free",
        tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        costEstimate: 0
      }),
      event(6, "model.response", {
        provider: "mock",
        costOwner: "local/free",
        content: "I will list the selected workspace files.",
        toolCalls: [{ id: "call_list_files", name: "workspace.listFiles", args: {} }]
      }),
      event(7, "tool.call", {
        toolName: "workspace.listFiles",
        callId: "call_list_files",
        args: {}
      }),
      event(8, "tool.result", {
        toolName: "workspace.listFiles",
        callId: "call_list_files",
        output: { files: ["README.md"] }
      })
    ]);

    database.saveTrace({
      id: trace.id,
      sessionId: trace.sessionId,
      events: trace,
      createdAt: trace.createdAt
    });

    expect(listRuns(database)[0]).toMatchObject({
      runId: "run_trace_test",
      status: "success"
    });
  });

  it("listRuns returns the newest trace per runId when multiple traces share a runId", () => {
    database = createDatabase();
    const olderEvents = [
      event(0, "session.started", { workspacePath: "/tmp/workspace" }),
      event(1, "user.task", { task: "first run summary" }),
      event(2, "task.complete", { task: "first run summary", finalSummary: "OLDER" })
    ];
    const newerEvents = [
      event(0, "session.started", { workspacePath: "/tmp/workspace" }),
      event(1, "user.task", { task: "second run summary" }),
      event(2, "task.complete", { task: "second run summary", finalSummary: "NEWER" })
    ];

    const older = buildTrace(olderEvents);
    const olderCreatedAt = new Date(Date.UTC(2026, 4, 2, 12, 0, 0)).toISOString();
    database.saveTrace({
      id: `${older.id}_older`,
      sessionId: older.sessionId,
      events: { ...older, createdAt: olderCreatedAt },
      createdAt: olderCreatedAt
    });

    const newer = buildTrace(newerEvents);
    const newerCreatedAt = new Date(Date.UTC(2026, 4, 3, 12, 0, 0)).toISOString();
    database.saveTrace({
      id: `${newer.id}_newer`,
      sessionId: newer.sessionId,
      events: { ...newer, createdAt: newerCreatedAt },
      createdAt: newerCreatedAt
    });

    const runs = listRuns(database);
    expect(runs).toHaveLength(1);
    expect(runs[0].runId).toBe("run_trace_test");
    expect(runs[0].createdAt).toBe(newerCreatedAt);
  });

  it("labels developer workflow connector events for trace filtering", () => {
    const trace = buildTrace([
      event(0, "session.started", { workspacePath: "/tmp/workspace" }),
      event(1, "connector.prDrafted", {
        connectorName: "github",
        operationName: "openDraftPullRequest",
        prId: "PR-42"
      }),
      event(2, "connector.issueUpdated", {
        connectorName: "jira",
        operationName: "addComment",
        issueId: "SQUID-301"
      }),
      event(3, "connector.ciStatus", {
        connectorName: "jenkins",
        operationName: "getBuildStatus",
        jobId: "jenkins_9001",
        status: "success"
      })
    ]);

    expect(trace.steps.map((step) => step.label)).toEqual([
      "Session started",
      "Developer activity: PR drafted by github",
      "Developer activity: issue updated by jira",
      "Developer activity: CI status from jenkins"
    ]);
  });
});
