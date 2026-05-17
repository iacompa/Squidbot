import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@squidbot/core";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { listOpenApprovals } from "../src/approvalQueue.js";
import type { ConnectorManifest } from "../src/manifest.js";
import { executeConnectorOperation } from "../src/tools.js";

let db: SquidDatabase;
const tempDirs: string[] = [];

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-tools-"));
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

function manifestWithRealMode(overrides: Partial<ConnectorManifest> = {}): ConnectorManifest {
  return {
    name: "github",
    systemType: "version_control",
    description: "test",
    protocol: "rest",
    auth: { type: "bearer" },
    permissions: [
      { name: "low", riskLevel: "low", requiresApproval: false },
      { name: "high", riskLevel: "high", requiresApproval: true }
    ],
    endpoints: [
      {
        operationId: "listIssues",
        method: "GET",
        path: "/x",
        description: "x",
        permission: "low",
        inputSchema: {},
        outputSchema: {},
        dataClassifications: []
      },
      {
        operationId: "createIssue",
        method: "POST",
        path: "/x",
        description: "x",
        permission: "low",
        inputSchema: {},
        outputSchema: {},
        dataClassifications: []
      },
      {
        operationId: "mergePR",
        method: "PUT",
        path: "/x",
        description: "x",
        permission: "high",
        inputSchema: {},
        outputSchema: {},
        dataClassifications: []
      }
    ],
    dataClassifications: [],
    fixtureMode: false,
    costOwner: "free",
    readWrite: { read: ["listIssues"], write: ["createIssue", "mergePR"] },
    ...overrides
  } as ConnectorManifest;
}

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workspacePath: "/tmp",
    sessionId: "s1",
    runId: "r1",
    getSetting: <T = unknown>(k: string) =>
      (k.endsWith(".baseUrl") ? "https://api.example" : "tok") as unknown as T,
    getActiveProfileSensitivity: () => "standard",
    emitEvent: vi.fn(),
    database: db,
    ...overrides
  };
}

describe("executeConnectorOperation — sensitivity policy integration", () => {
  it("executes real HTTP for a read on standard sensitivity", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    ) as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const context = makeContext();
      const result = await executeConnectorOperation(manifest, manifest.endpoints[0], {}, context);
      expect((result as { mode: string }).mode).toBe("real");
      expect((result as { executed: boolean }).executed).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("queues a write on sensitive sensitivity without calling fetch", async () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const context = makeContext({ getActiveProfileSensitivity: () => "sensitive" });
      const result = await executeConnectorOperation(manifest, manifest.endpoints[1], { title: "Bug" }, context);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect((result as { mode: string }).mode).toBe("pending-approval");
      expect((result as { approvalId?: string }).approvalId).toMatch(/^ap_/);
      expect((result as { pending: boolean }).pending).toBe(true);
      expect(listOpenApprovals(db)).toHaveLength(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("denies all calls on air-gapped sensitivity", async () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const context = makeContext({ getActiveProfileSensitivity: () => "air-gapped" });
      const result = await executeConnectorOperation(manifest, manifest.endpoints[0], {}, context);
      expect((result as { mode: string }).mode).toBe("denied");
      expect((result as { reason: string }).reason).toMatch(/air-gapped/i);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(listOpenApprovals(db)).toHaveLength(0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("queues a requiresApproval=true op regardless of standard profile", async () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const context = makeContext(); // standard sensitivity
      const result = await executeConnectorOperation(manifest, manifest.endpoints[2], {}, context);
      expect((result as { mode: string }).mode).toBe("pending-approval");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(listOpenApprovals(db)).toHaveLength(1);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("fixture-mode calls bypass the policy entirely (regression check)", async () => {
    const manifest = manifestWithRealMode({
      fixtureMode: true,
      fixtureData: { listIssues: [{ id: 1 }] }
    });
    const context = makeContext({
      getActiveProfileSensitivity: () => "air-gapped",
      getSetting: <T = unknown>(_k: string) => undefined as unknown as T
    });
    const result = await executeConnectorOperation(manifest, manifest.endpoints[0], {}, context);
    expect((result as { fixture?: boolean }).fixture).toBe(true);
    expect((result as { mode: string }).mode).toBe("fixture");
    expect(listOpenApprovals(db)).toHaveLength(0);
  });

  it("emits connector.http_call event with status/duration/ok for successful executes", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    ) as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const emitEvent = vi.fn();
      const context = makeContext({ emitEvent });
      await executeConnectorOperation(manifest, manifest.endpoints[0], {}, context);
      const httpCallEvents = emitEvent.mock.calls.filter((call) => call[0] === "connector.http_call");
      expect(httpCallEvents).toHaveLength(1);
      expect(httpCallEvents[0][1]).toMatchObject({
        connectorName: "github",
        operationName: "listIssues",
        method: "GET",
        path: "/x",
        ok: true,
        mode: "real",
        status: 200
      });
      // No request/response body leakage
      expect(httpCallEvents[0][1]).not.toHaveProperty("body");
      expect(httpCallEvents[0][1]).not.toHaveProperty("response");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("emits connector.approval-requested event when queuing", async () => {
    const manifest = manifestWithRealMode();
    const emitEvent = vi.fn();
    const context = makeContext({
      emitEvent,
      getActiveProfileSensitivity: () => "sensitive"
    });
    await executeConnectorOperation(manifest, manifest.endpoints[1], { title: "Bug" }, context);
    const requestedEvents = emitEvent.mock.calls.filter((call) => call[0] === "connector.approval-requested");
    expect(requestedEvents).toHaveLength(1);
    expect(requestedEvents[0][1]).toMatchObject({
      connectorName: "github",
      operationName: "createIssue",
      riskLevel: "low"
    });
    expect((requestedEvents[0][1] as { approvalId: string }).approvalId).toMatch(/^ap_/);
  });

  it("returns not-configured when baseUrl is missing on execute", async () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const context = makeContext({
        getSetting: <T = unknown>(_k: string) => null as unknown as T
      });
      const result = await executeConnectorOperation(manifest, manifest.endpoints[0], {}, context);
      expect((result as { mode: string }).mode).toBe("not-configured");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("maps an http failure into a real mode response with executed=false and error code", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 401 })) as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const context = makeContext();
      const result = await executeConnectorOperation(manifest, manifest.endpoints[0], {}, context);
      expect((result as { mode: string }).mode).toBe("real");
      expect((result as { executed: boolean }).executed).toBe(false);
      expect((result as { error: string }).error).toBe("auth");
      expect((result as { status: number }).status).toBe(401);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("returns queue-unavailable when policy decides queue but no database is provided", async () => {
    const origFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const context = makeContext({
        database: undefined,
        getActiveProfileSensitivity: () => "sensitive"
      });
      const result = await executeConnectorOperation(manifest, manifest.endpoints[1], { title: "Bug" }, context);
      expect((result as { mode: string }).mode).toBe("queue-unavailable");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("defaults to standard sensitivity when getActiveProfileSensitivity is undefined", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    ) as typeof fetch;
    try {
      const manifest = manifestWithRealMode();
      const context = makeContext({ getActiveProfileSensitivity: undefined });
      // listIssues is a read; on standard a read executes.
      const result = await executeConnectorOperation(manifest, manifest.endpoints[0], {}, context);
      expect((result as { mode: string }).mode).toBe("real");
      expect((result as { executed: boolean }).executed).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
