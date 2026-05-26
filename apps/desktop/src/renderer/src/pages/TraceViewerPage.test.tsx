// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceDto, TraceMetricsDto, TraceRunSummaryDto } from "../types";
import { TraceViewerPage } from "./TraceViewerPage";

const trace: TraceDto = {
  id: "trace_test",
  sessionId: "session_test",
  runId: "run_test",
  createdAt: "2026-05-02T20:00:00.000Z",
  summary: {
    eventCount: 7,
    toolCallCount: 1,
    provider: "mock",
    costOwner: "local/free",
    redactionCount: 2
  },
  steps: [
    {
      id: "evt_1",
      timestamp: "2026-05-02T20:00:00.000Z",
      type: "user.task",
      label: "User task",
      detail: { task: "Fix calculator add function" }
    },
    {
      id: "evt_2",
      timestamp: "2026-05-02T20:00:00.020Z",
      type: "memory.retrieved",
      label: "Memory retrieved",
      detail: { bulletin: "Memory Bulletin\n- API_KEY=[REDACTED]" }
    },
    {
      id: "evt_3",
      timestamp: "2026-05-02T20:00:00.040Z",
      type: "model.call",
      label: "Model call: mock",
      detail: { provider: "mock", costOwner: "local/free", prompt: "Email [REDACTED_EMAIL]", tokenEstimate: 12 }
    },
    {
      id: "evt_4",
      timestamp: "2026-05-02T20:00:00.080Z",
      type: "model.result",
      label: "Model result: mock",
      detail: {
        provider: "mock",
        costOwner: "local/free",
        tokenUsage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        costEstimate: 0
      }
    },
    {
      id: "evt_5",
      timestamp: "2026-05-02T20:00:00.100Z",
      type: "tool.call",
      label: "Tool call: workspace.createPatch",
      detail: { toolName: "workspace.createPatch", args: { path: "calculator.py" } }
    },
    {
      id: "evt_6",
      timestamp: "2026-05-02T20:00:00.150Z",
      type: "sandbox.diff",
      label: "Sandbox diff: sandbox_test",
      detail: { sandboxId: "sandbox_test", diff: "--- a/calculator.py\n+++ b/calculator.py\n-return a - b\n+return a + b\n" }
    },
    {
      id: "evt_7",
      timestamp: "2026-05-02T20:00:00.190Z",
      type: "task.complete",
      label: "Task complete",
      detail: { finalSummary: "Sandbox staged: sandbox_test" }
    }
  ]
};

const metrics: TraceMetricsDto = {
  durationMs: 190,
  meanStepDurationMs: 27,
  maxStepDurationMs: 50,
  totalCost: 0,
  totalTokens: 27,
  promptTokens: 10,
  completionTokens: 5,
  providerBreakdown: [
    { provider: "mock", costOwner: "local/free", cost: 0, promptTokens: 10, completionTokens: 5, totalTokens: 27, calls: 1 }
  ],
  eventTypeBreakdown: [
    { type: "model.call", count: 1, durationMs: 40 },
    { type: "tool.call", count: 1, durationMs: 50 },
    { type: "sandbox.diff", count: 1, durationMs: 40 }
  ],
  toolBreakdown: [{ name: "workspace.createPatch", count: 1, durationMs: 50 }],
  connectorBreakdown: []
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "squidbot");
});

describe("TraceViewerPage", () => {
  it("renders the timeline, cost waterfall, diff, and redaction indicators", () => {
    const { container } = render(<TraceViewerPage metrics={metrics} trace={trace} />);

    expect(screen.getByLabelText("Trace timeline")).toBeTruthy();
    expect(screen.getByText("Cost waterfall")).toBeTruthy();
    expect(screen.getByText("Duration breakdown")).toBeTruthy();
    expect(screen.getByText("Prompt inspector")).toBeTruthy();
    expect(screen.getByText("Trace replay")).toBeTruthy();
    expect(screen.getByText("Redactions")).toBeTruthy();

    fireEvent.click(screen.getByText("Sandbox diff: sandbox_test"));
    expect(screen.getAllByText(/return a \+ b/).length).toBeGreaterThanOrEqual(1);
    expect(container).toMatchSnapshot();
  });
});

describe("RunListPage", () => {
  it("loads runs and opens the selected trace", async () => {
    vi.resetModules();
    const runs: TraceRunSummaryDto[] = [
      {
        traceId: "trace_test",
        runId: "run_test",
        sessionId: "session_test",
        task: "Fix calculator add function",
        provider: "mock",
        costOwner: "local/free",
        status: "success",
        createdAt: "2026-05-02T20:00:00.000Z",
        durationMs: 190,
        eventCount: 7,
        toolCallCount: 1,
        totalCost: 0,
        totalTokens: 27
      }
    ];

    Object.defineProperty(window, "squidbot", {
      configurable: true,
      value: {
        listRuns: vi.fn(async () => runs),
        getTrace: vi.fn(async () => trace),
        getTraceMetrics: vi.fn(async () => metrics)
      }
    });

    const { RunListPage } = await import("./RunListPage");
    const { container } = render(<RunListPage />);

    expect(await screen.findByText("Fix calculator add function")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText("Cost waterfall").length).toBeGreaterThanOrEqual(1);
    });
    fireEvent.change(screen.getByLabelText("Search runs"), { target: { value: "calculator" } });
    expect(screen.getByText("run_test")).toBeTruthy();
    expect(container).toMatchSnapshot();
  });
});
