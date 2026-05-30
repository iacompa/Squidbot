import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { collectMetrics, exportPrometheusMetrics } from "../src/metricsExporter.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function seed(): SquidDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-metrics-"));
  const db = initializeDatabase(path.join(dir, "squidbot.sqlite"));
  database = db;

  db.saveTrace({ id: "t1", sessionId: "s1", events: [], createdAt: "2026-05-29T00:00:00Z" });
  db.saveTrace({ id: "t2", sessionId: "s1", events: [], createdAt: "2026-05-29T00:01:00Z" });

  const ev = (id: string, type: string) =>
    db.appendEvent({ id, timestamp: "2026-05-29T00:00:00Z", sessionId: "s1", type, data: {} });
  ev("e1", "tool.call");
  ev("e2", "tool.call");
  ev("e3", "tool.denied");
  ev("e4", "error");

  db.addModelUsage("api", "2026-05-29", 1000, 0.05);
  db.addModelUsage("local", "2026-05-29", 500, 0);

  return db;
}

describe("metricsExporter", () => {
  it("aggregates runs, events by type, and per-provider model usage", () => {
    const m = collectMetrics(seed());
    expect(m.runsTotal).toBe(2);
    expect(m.toolCallsTotal).toBe(2);
    expect(m.toolDenialsTotal).toBe(1);
    expect(m.errorsTotal).toBe(1);
    expect(m.modelTokensByProvider.api).toBe(1000);
    expect(m.modelTokensByProvider.local).toBe(500);
    expect(m.modelCostByProvider.api).toBeCloseTo(0.05);
  });

  it("renders valid Prometheus text-exposition format with HELP/TYPE and labelled samples", () => {
    const text = exportPrometheusMetrics(seed());
    // Counter with HELP + TYPE preamble.
    expect(text).toMatch(/# HELP squidbot_runs_total/);
    expect(text).toMatch(/# TYPE squidbot_runs_total counter/);
    expect(text).toMatch(/^squidbot_runs_total 2$/m);
    expect(text).toMatch(/^squidbot_tool_calls_total 2$/m);
    expect(text).toMatch(/^squidbot_tool_denials_total 1$/m);
    // Labelled per-provider samples.
    expect(text).toMatch(/squidbot_model_tokens_total\{provider="api"\} 1000/);
    expect(text).toMatch(/squidbot_model_tokens_total\{provider="local"\} 500/);
    expect(text).toMatch(/squidbot_model_cost_total\{provider="api"\} 0\.05/);
  });

  it("escapes label values to stay valid when a provider name contains quotes/backslashes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-metrics-esc-"));
    database = initializeDatabase(path.join(dir, "squidbot.sqlite"));
    database.addModelUsage('weird"\\name', "2026-05-29", 7, 0);
    const text = exportPrometheusMetrics(database);
    // " -> \" and \ -> \\ per Prometheus exposition rules.
    expect(text).toContain('provider="weird\\"\\\\name"');
  });
});
