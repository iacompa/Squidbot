// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dataset = {
  id: "coding-calculator-bugfix",
  name: "Calculator Bug Fix",
  domain: "coding",
  version: "0.1.0",
  description: "Fix add bug.",
  manifest: {},
  sourcePath: "/benchmarks/coding/calculator-bugfix",
  status: "active" as const,
  createdAt: "2026-05-08T12:00:00.000Z",
  updatedAt: "2026-05-08T12:00:00.000Z",
  archivedAt: null
};

const evalRun = {
  id: "eval_run_test",
  datasetId: dataset.id,
  targetType: "skillVersion",
  targetId: "skill_eval_fix_add@0.1.0",
  baselineTargetId: null,
  status: "completed" as const,
  mode: "offline",
  startedAt: "2026-05-08T12:00:00.000Z",
  completedAt: "2026-05-08T12:00:01.000Z",
  summary: {},
  metrics: { compositeScore: 0.91, taskSuccessRate: 1, testPassRate: 1 },
  report: {},
  createdAt: "2026-05-08T12:00:00.000Z",
  updatedAt: "2026-05-08T12:00:01.000Z"
};

const variant = {
  id: "skill_variant_test",
  skillId: "skill_eval_fix_add",
  baseVersion: "0.1.0",
  variantVersion: null,
  state: "canary",
  name: "Verification variant",
  description: "Adds sandbox verification.",
  mutationType: "additional_verification",
  sourceType: "evalFailure",
  sourceId: evalRun.id,
  patch: {},
  manifest: {},
  prompts: null,
  policy: null,
  createdAt: "2026-05-08T12:00:00.000Z",
  updatedAt: "2026-05-08T12:00:00.000Z",
  archivedAt: null
};

beforeEach(() => {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listEvalDatasets: vi.fn(async () => [dataset]),
      listEvalRuns: vi.fn(async () => [evalRun]),
      listSkillVariants: vi.fn(async () => [variant]),
      getEvalRunDetail: vi.fn(async () => ({
        evalRun,
        taskResults: [{ id: "result_test", evalRunId: evalRun.id, evalTaskId: "fix-add", status: "passed", score: 0.91, metrics: [], traceId: "trace_test" }],
        comparisons: []
      })),
      listEvalLeaderboard: vi.fn(async () => [
        { id: "leaderboard_test", datasetId: dataset.id, targetType: "skillVersion", targetId: evalRun.targetId, evalRunId: evalRun.id, compositeScore: 0.91, metrics: {}, rank: 1, createdAt: evalRun.createdAt }
      ])
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("EvaluationLabPage", () => {
  it("renders datasets, eval runs, variants, and leaderboard evidence", async () => {
    const { EvaluationLabPage } = await import("./EvaluationLabPage");
    render(<EvaluationLabPage />);

    await waitFor(() => expect(screen.getByText("Calculator Bug Fix")).toBeTruthy());
    expect(screen.getAllByText("skill_eval_fix_add@0.1.0").length).toBeGreaterThan(0);
    expect(screen.getByText("Verification variant")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
    expect(screen.getByText("Metrics")).toBeTruthy();
  });
});
