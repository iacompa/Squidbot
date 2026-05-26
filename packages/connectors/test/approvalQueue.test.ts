import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  enqueueApproval,
  getApproval,
  listOpenApprovals,
  listResolvedSince,
  resolveApproval
} from "../src/approvalQueue.js";

let db: SquidDatabase;
const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-approval-queue-"));
  tempDirs.push(dir);
  return path.join(dir, "squidbot.sqlite");
}

beforeEach(() => {
  db = initializeDatabase(tempDbPath());
});

afterEach(() => {
  db.close();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("approvalQueue", () => {
  it("enqueues a connector-call approval and surfaces it in listOpenApprovals", () => {
    const id = enqueueApproval(db, {
      kind: "connector-call",
      title: "Allow github.createIssue?",
      summary: "Args: { title: 'Bug' }",
      riskLevel: "high",
      payload: { connectorName: "github", operationId: "createIssue", args: { title: "Bug" } },
      callerSessionId: "s1",
      callerRunId: "r1"
    });
    expect(id).toMatch(/^ap_/);
    const open = listOpenApprovals(db);
    expect(open).toHaveLength(1);
    expect(open[0].kind).toBe("connector-call");
    expect(open[0].title).toContain("github.createIssue");
  });

  it("resolveApproval('approved') sets resolvedAt + resolution + resultJson", () => {
    const id = enqueueApproval(db, {
      kind: "connector-call",
      title: "x",
      summary: "x",
      riskLevel: "low",
      payload: { connectorName: "github", operationId: "listBranches", args: {} }
    });
    const resolved = resolveApproval(db, id, { resolution: "approved", result: { number: 42 } });
    expect(resolved.resolution).toBe("approved");
    expect(resolved.resultJson).toBeTruthy();
    expect(JSON.parse(resolved.resultJson!)).toEqual({ number: 42 });
    expect(listOpenApprovals(db)).toHaveLength(0);
  });

  it("resolveApproval('rejected') with an optional reason", () => {
    const id = enqueueApproval(db, {
      kind: "connector-call",
      title: "x",
      summary: "x",
      riskLevel: "low",
      payload: { connectorName: "x", operationId: "x", args: {} }
    });
    const resolved = resolveApproval(db, id, { resolution: "rejected", reason: "no thanks" });
    expect(resolved.resolution).toBe("rejected");
    expect(JSON.parse(resolved.resultJson!)).toEqual({ rejected: true, reason: "no thanks" });
  });

  it("listResolvedSince filters by session and timestamp", () => {
    const id1 = enqueueApproval(db, {
      kind: "connector-call",
      title: "a",
      summary: "a",
      riskLevel: "low",
      payload: { connectorName: "x", operationId: "x", args: {} },
      callerSessionId: "s1"
    });
    enqueueApproval(db, {
      kind: "connector-call",
      title: "b",
      summary: "b",
      riskLevel: "low",
      payload: { connectorName: "x", operationId: "x", args: {} },
      callerSessionId: "s2"
    });
    resolveApproval(db, id1, { resolution: "approved", result: { ok: true } });
    const since = new Date(Date.now() - 60_000).toISOString();
    const resolved = listResolvedSince(db, { sessionId: "s1", since });
    expect(resolved).toHaveLength(1);
    expect(resolved[0].id).toBe(id1);
  });

  it("getApproval returns null for unknown id", () => {
    expect(getApproval(db, "ap_nonexistent")).toBeNull();
  });

  it("enqueueApproval accepts riskLevel='critical' (regression for Task 1.1 I1)", () => {
    expect(() =>
      enqueueApproval(db, {
        kind: "connector-call",
        title: "x",
        summary: "x",
        riskLevel: "critical",
        payload: { connectorName: "x", operationId: "x", args: {} }
      })
    ).not.toThrow();
  });
});
