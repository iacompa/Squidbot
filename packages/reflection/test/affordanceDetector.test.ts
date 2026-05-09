import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  assertAffordanceGapSeverity,
  assertAffordanceGapType,
  createAffordanceGap,
  detectAffordanceGaps,
  persistDetectedAffordanceGaps,
  resolveAffordanceGap
} from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-reflection-"));
  return path.join(dir, "squidbot.sqlite");
}

describe("affordance detector", () => {
  it("classifies missing tools, denied permissions, connector gaps, and environment errors", () => {
    const gaps = detectAffordanceGaps({
      runId: "run_test",
      reflectionId: "reflection_test",
      task: "Use nonexistentTool and call connector write",
      events: [
        {
          id: "evt_missing",
          type: "tool.denied",
          data: {
            toolName: "nonexistentTool",
            reason: "Tool is not registered."
          }
        },
        {
          id: "evt_denied",
          type: "tool.denied",
          data: {
            toolName: "workspace.writeFile",
            reason: "Direct filesystem writes are blocked in this phase."
          }
        },
        {
          id: "evt_connector",
          type: "connector.denied",
          data: {
            connectorName: "demoSales",
            operationName: "createSale",
            toolName: "connector.demoSales.createSale",
            reason: "Connector write or approval-gated operations require explicit user approval before execution."
          }
        }
      ],
      toolResults: [
        {
          callId: "call_missing_file",
          toolName: "workspace.readFile",
          ok: false,
          output: { error: "ENOENT: no such file or directory" }
        }
      ]
    });

    expect(gaps.map((gap) => gap.type)).toEqual(
      expect.arrayContaining(["missingTool", "missingPermission", "environmentError"])
    );
    expect(gaps.map((gap) => gap.name)).toEqual(
      expect.arrayContaining(["nonexistentTool", "filesystem.write", "demoSales.createSale", "workspace.readFile"])
    );
  });

  it("validates affordance gap type and severity", () => {
    expect(() => assertAffordanceGapType("badType")).toThrow("Invalid affordance gap type");
    expect(() => assertAffordanceGapSeverity("urgent")).toThrow("Invalid affordance gap severity");
  });

  it("persists gaps, logs events, and resolves them", () => {
    database = initializeDatabase(tempDbPath());
    const createdAt = new Date().toISOString();
    database.saveReflection({
      id: "reflection_test",
      sessionId: "session_test",
      runId: "run_test",
      task: "Use nonexistentTool",
      summary: "Missing tool test",
      outcome: "failed",
      successFactors: [],
      failureModes: ["Tool failed: nonexistentTool."],
      missingTools: [],
      missingPermissions: [],
      missingContext: [],
      reusablePatterns: [],
      memoryCandidates: [],
      createdAt
    });

    const gaps = persistDetectedAffordanceGaps(database, {
      sessionId: "session_test",
      runId: "run_test",
      reflectionId: "reflection_test",
      task: "Use nonexistentTool",
      events: [
        {
          id: "evt_missing",
          type: "tool.denied",
          data: {
            toolName: "nonexistentTool",
            reason: "Tool is not registered."
          }
        }
      ]
    });

    expect(gaps).toHaveLength(1);
    expect(database.listAffordanceGaps()).toHaveLength(1);
    expect(database.getReflection("reflection_test")?.failureTaxonomy).toEqual(["missingTool"]);
    expect(database.getReflection("reflection_test")?.affordanceIds).toEqual([gaps[0].id]);
    expect(database.listEvents("session_test").map((event) => event.type)).toContain("affordance.gap");

    const resolved = resolveAffordanceGap(database, gaps[0].id);
    expect(resolved.status).toBe("resolved");
    expect(database.listAffordanceGaps()).toHaveLength(0);
    expect(database.listAffordanceGaps({ status: "resolved" })).toHaveLength(1);
  });

  it("rejects invalid persisted gaps", () => {
    database = initializeDatabase(tempDbPath());

    expect(() =>
      createAffordanceGap(database!, {
        id: "gap_bad",
        runId: "run_test",
        type: "notAType",
        name: "bad",
        severity: "medium",
        description: "bad",
        createdAt: new Date().toISOString()
      } as Parameters<typeof createAffordanceGap>[1])
    ).toThrow("Invalid affordance gap type");
  });
});
