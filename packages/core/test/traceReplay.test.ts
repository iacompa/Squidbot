import { describe, expect, it } from "vitest";
import { buildTraceReplayPlan, extractPromptInspectorEntries } from "../src/traceReplay.js";
import type { Trace } from "../src/types.js";

const trace: Trace = {
  id: "trace_1",
  sessionId: "session_1",
  runId: "run_1",
  createdAt: "2026-05-02T20:00:00.000Z",
  summary: {
    eventCount: 3,
    toolCallCount: 0,
    provider: "mock",
    costOwner: "local/free",
    redactionCount: 0
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
      timestamp: "2026-05-02T20:00:00.040Z",
      type: "model.call",
      label: "Model call",
      detail: { provider: "mock", model: "mock-1", prompt: "Fix the add bug", system: "You are a coding agent." }
    },
    {
      id: "evt_3",
      timestamp: "2026-05-02T20:00:00.080Z",
      type: "test.run",
      label: "Test run",
      detail: { command: "pytest" }
    }
  ]
};

describe("traceReplay", () => {
  it("extracts prompt inspector entries from model steps", () => {
    const entries = extractPromptInspectorEntries(trace);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.provider).toBe("mock");
    expect(entries[0]?.promptPreview).toContain("Fix the add bug");
    expect(entries[0]?.contextPreview).toContain("coding agent");
  });

  it("builds a replay command from trace metadata", () => {
    const plan = buildTraceReplayPlan(trace);
    expect(plan?.task).toBe("Fix calculator add function");
    expect(plan?.testCommand).toBe("pytest");
    expect(plan?.replayCommand).toContain("Fix calculator add function");
    expect(plan?.replayCommand).toContain("pytest");
  });

  it("builds a replay plan from a chat user.message that only has content", () => {
    const chatTrace: Trace = {
      ...trace,
      steps: [
        {
          id: "evt_chat_1",
          timestamp: "2026-05-02T20:00:00.000Z",
          type: "user.message",
          label: "User chat",
          detail: { content: "How do I fix this bug?" }
        }
      ]
    };
    const plan = buildTraceReplayPlan(chatTrace);
    expect(plan?.task).toBe("How do I fix this bug?");
  });

  it("ignores sandbox.command steps emitted for applyPatch when choosing testCommand", () => {
    const traceWithApplyPatch: Trace = {
      ...trace,
      steps: [
        {
          id: "evt_1",
          timestamp: "2026-05-02T20:00:00.000Z",
          type: "user.task",
          label: "User task",
          detail: { task: "Refactor" }
        },
        {
          id: "evt_2",
          timestamp: "2026-05-02T20:00:00.040Z",
          type: "sandbox.command",
          label: "Apply patch",
          detail: { command: "git apply --whitespace=nowarn patch.diff", purpose: "applyPatch" }
        },
        {
          id: "evt_3",
          timestamp: "2026-05-02T20:00:00.080Z",
          type: "test.run",
          label: "Test run",
          detail: { command: "pytest -q" }
        }
      ]
    };
    const plan = buildTraceReplayPlan(traceWithApplyPatch);
    expect(plan?.testCommand).toBe("pytest -q");
    expect(plan?.testCommand).not.toContain("git apply");
  });

  it("prefers the most recent test.run command when multiple exist", () => {
    const traceWithMultiple: Trace = {
      ...trace,
      steps: [
        {
          id: "evt_1",
          timestamp: "2026-05-02T20:00:00.000Z",
          type: "user.task",
          label: "User task",
          detail: { task: "Iterate" }
        },
        {
          id: "evt_2",
          timestamp: "2026-05-02T20:00:00.040Z",
          type: "test.run",
          label: "First",
          detail: { command: "pytest -x tests/first.py" }
        },
        {
          id: "evt_3",
          timestamp: "2026-05-02T20:00:00.080Z",
          type: "test.run",
          label: "Second",
          detail: { command: "pytest -x tests/second.py" }
        }
      ]
    };
    const plan = buildTraceReplayPlan(traceWithMultiple);
    expect(plan?.testCommand).toBe("pytest -x tests/second.py");
  });
});
