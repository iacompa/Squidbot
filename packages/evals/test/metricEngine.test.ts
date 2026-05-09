import { describe, expect, it } from "vitest";
import { buildTrace, type AgentEvent } from "@squidbot/core";
import { datasetManifest } from "./helpers.js";
import { scoreTask, summarizeRunMetrics, type EvalTaskManifest } from "../src/index.js";

function traceWith(types: string[]): ReturnType<typeof buildTrace> {
  const events = types.map((type, index) => ({
    id: `evt_${index}`,
    timestamp: `2026-05-08T00:00:0${index}.000Z`,
    sessionId: "session_eval_metric",
    runId: "run_eval_metric",
    type,
    data: type === "tool.call" ? { toolName: "workspace.createPatch" } : { runId: "run_eval_metric" }
  })) as AgentEvent[];
  return buildTrace(events);
}

describe("Metric engine", () => {
  it("computes deterministic weighted scores and pass/fail status", () => {
    const task = (datasetManifest().tasks as EvalTaskManifest[])[0];
    const result = scoreTask(
      {
        task,
        trace: traceWith(["model.call", "sandbox.created", "sandbox.command", "sandbox.approvalRequested", "test.run"]),
        finalSummary: "Tool results include workspace.createPatch",
        testExitCode: 0,
        variantImpact: { verificationCompleteness: 0.05, taskSuccessRate: 0.02 }
      },
      task.scoringOverrides?.weights ?? {}
    );
    expect(result.status).toBe("passed");
    expect(result.score).toBeGreaterThan(0.7);
  });

  it("forces safety failures for forbidden events", () => {
    const task = (datasetManifest().tasks as EvalTaskManifest[])[0];
    const result = scoreTask(
      {
        task,
        trace: traceWith(["model.call", "sandbox.promoted", "test.run"]),
        finalSummary: "workspace.createPatch",
        testExitCode: 0
      },
      task.scoringOverrides?.weights ?? {}
    );
    expect(result.status).toBe("failed");
    expect(result.score).toBe(0);
  });

  it("does not require a test command for workflow tasks without mustPassTests", () => {
    const task: EvalTaskManifest = {
      id: "workflow-fixture",
      name: "Workflow fixture",
      description: "Review a fixture pull request",
      task: "Review fixture pull request",
      fixture: {},
      target: { type: "workflow" },
      expected: {
        expectedOutputContains: ["fixture", "review"],
        expectedEvents: ["model.call", "reflection.created"]
      }
    };
    const result = scoreTask(
      {
        task,
        trace: traceWith(["model.call", "connector.call", "connector.fixture", "reflection.created"]),
        finalSummary: "Fixture review completed without posting comments"
      },
      { taskSuccessRate: 0.35, connectorFixtureCompliance: 0.3, safetyIncidentRate: 0.25, traceCompleteness: 0.1 }
    );
    expect(result.status).toBe("passed");
    expect(result.score).toBeGreaterThanOrEqual(0.7);
  });

  it("summarizes run metrics across task results", () => {
    const metrics = summarizeRunMetrics([
      { status: "passed", score: 0.9, cost: 0, durationMs: 10, metrics: [{ name: "verificationCompleteness", value: 1, passed: true, weight: 1, evidence: [] }] },
      { status: "failed", score: 0.3, cost: 0, durationMs: 20, metrics: [{ name: "verificationCompleteness", value: 0.2, passed: false, weight: 1, evidence: [] }] }
    ]);
    expect(metrics.taskCount).toBe(2);
    expect(metrics.passedTaskCount).toBe(1);
    expect(metrics.compositeScore).toBe(0.6);
  });
});
