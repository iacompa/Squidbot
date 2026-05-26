import type { Trace } from "./types.js";

export type TracePromptInspectorEntry = {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  promptPreview: string;
  contextPreview: string;
};

export type TraceReplayPlan = {
  task: string;
  workspacePath: string | null;
  testCommand: string | null;
  runId: string;
  replayCommand: string;
};

export function extractPromptInspectorEntries(trace: Trace): TracePromptInspectorEntry[] {
  return trace.steps
    .filter((step) => step.type === "model.call" || step.type === "model.result")
    .map((step) => {
      const detail = step.detail;
      const prompt =
        typeof detail.prompt === "string"
          ? detail.prompt
          : typeof detail.input === "string"
            ? detail.input
            : typeof detail.messages === "string"
              ? detail.messages
              : JSON.stringify(detail.messages ?? detail, null, 2);
      const context =
        typeof detail.memoryBulletin === "string"
          ? detail.memoryBulletin
          : typeof detail.context === "string"
            ? detail.context
            : typeof detail.system === "string"
              ? detail.system
              : "";
      return {
        id: step.id,
        timestamp: step.timestamp,
        provider: String(detail.provider ?? detail.modelProvider ?? "unknown"),
        model: String(detail.model ?? detail.modelName ?? "unknown"),
        promptPreview: prompt.slice(0, 4000),
        contextPreview: context.slice(0, 4000)
      };
    });
}

const SHELL_SAFE_PATTERN = /^[a-zA-Z0-9_./@:+= -]+$/;

function shellQuote(value: string): string {
  if (SHELL_SAFE_PATTERN.test(value)) {
    return `"${value}"`;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildTraceReplayPlan(trace: Trace): TraceReplayPlan | null {
  const complete = trace.steps.find((step) => step.type === "task.complete");
  const workspace = trace.steps.find((step) => step.type === "workspace.summary");
  const userTask = trace.steps.find((step) => step.type === "user.task" || step.type === "user.message");
  const task =
    complete && typeof complete.detail.task === "string"
      ? String(complete.detail.task)
      : userTask && typeof userTask.detail.task === "string"
        ? String(userTask.detail.task)
        : userTask && typeof userTask.detail.message === "string"
          ? String(userTask.detail.message)
          : userTask && typeof userTask.detail.content === "string"
            ? String(userTask.detail.content)
            : "";

  if (!task.trim()) {
    return null;
  }

  const workspacePath =
    workspace && typeof workspace.detail.workspacePath === "string"
      ? String(workspace.detail.workspacePath)
      : null;

  const testStep = [...trace.steps].reverse().find((step) => {
    if (step.type === "test.run") {
      return typeof step.detail.command === "string";
    }
    if (step.type === "sandbox.command") {
      return typeof step.detail.command === "string" && step.detail.purpose !== "applyPatch";
    }
    return false;
  });
  const testCommand =
    testStep && typeof testStep.detail.command === "string"
      ? String(testStep.detail.command)
      : null;

  const parts = ["npm", "run", "run", "--"];
  if (workspacePath) {
    parts.push("--workspace", shellQuote(workspacePath));
  }
  parts.push(shellQuote(task));
  if (testCommand) {
    parts.push("--test-command", shellQuote(testCommand));
  }
  const replayCommand = parts.join(" ");

  return {
    task,
    workspacePath,
    testCommand,
    runId: trace.runId,
    replayCommand
  };
}
