import type { SquidDatabase, StoredTrace } from "@squidbot/db";
import { redactValue } from "./redaction.js";
import { createId, type AgentEvent, type CostOwner, type Trace, type TraceStep } from "./types.js";

export type TraceRunSummary = {
  traceId: string;
  runId: string;
  sessionId: string;
  task: string;
  provider: string;
  costOwner: CostOwner | string;
  status: "success" | "partial" | "failed" | "running" | "unknown";
  createdAt: string;
  durationMs: number;
  eventCount: number;
  toolCallCount: number;
  totalCost: number;
  totalTokens: number;
};

export type TraceMetrics = {
  durationMs: number;
  meanStepDurationMs: number;
  maxStepDurationMs: number;
  totalCost: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  providerBreakdown: Array<{
    provider: string;
    costOwner: string;
    cost: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    calls: number;
  }>;
  eventTypeBreakdown: Array<{ type: string; count: number; durationMs: number }>;
  toolBreakdown: Array<{ name: string; count: number; durationMs: number }>;
  connectorBreakdown: Array<{ name: string; count: number; durationMs: number }>;
};

export type TraceSearchResult = {
  run: TraceRunSummary;
  event: TraceStep;
};

export type TraceListOptions = {
  limit?: number;
  offset?: number;
  sortBy?: "createdAt" | "duration" | "cost";
};

export type TraceSearchOptions = {
  runId?: string;
  type?: string;
  provider?: string;
  tool?: string;
  jobId?: string;
  teamRunId?: string;
  text?: string;
  limit?: number;
};

function labelForEvent(event: AgentEvent): string {
  switch (event.type) {
    case "session.started":
      return "Session started";
    case "user.message":
      return "User message";
    case "user.task":
      return "User task";
    case "workspace.summary":
      return "Workspace summary";
    case "plan.generated":
      return "Plan generated";
    case "model.response":
      return "Model response";
    case "model.call":
      return `Model call: ${String(event.data.provider ?? "unknown")}`;
    case "model.result":
      return `Model result: ${String(event.data.provider ?? "unknown")}`;
    case "model.error":
      return `Model error: ${String(event.data.provider ?? "unknown")}`;
    case "model.budgetWarning":
      return `Model budget warning: ${String(event.data.provider ?? "unknown")}`;
    case "model.budgetExceeded":
      return `Model budget exceeded: ${String(event.data.provider ?? "unknown")}`;
    case "model.fallback":
      return `Model fallback: ${String(event.data.fromProvider ?? "unknown")} to ${String(event.data.toProvider ?? "unknown")}`;
    case "tool.call":
      return `Tool call: ${String(event.data.toolName ?? "unknown")}`;
    case "tool.result":
      return `Tool result: ${String(event.data.toolName ?? "unknown")}`;
    case "tool.denied":
      return `Tool denied: ${String(event.data.toolName ?? "unknown")}`;
    case "test.run":
      return "Test run";
    case "task.complete":
      return "Task complete";
    case "reflection.created":
      return "Reflection created";
    case "memory.candidate":
      return "Memory candidate";
    case "memory.approved":
      return "Memory approved";
    case "memory.retrieved":
      return "Memory retrieved";
    case "memory.graph":
      return `Memory graph: ${String(event.data.action ?? "updated")}`;
    case "affordance.gap":
      return `Affordance gap: ${String(event.data.type ?? event.data.gapType ?? "detected")}`;
    case "affordance.resolved":
      return `Affordance resolved: ${String(event.data.gapId ?? "gap")}`;
    case "sandbox.created":
      return `Sandbox created: ${String(event.data.sandboxId ?? "sandbox")}`;
    case "sandbox.command":
      return `Sandbox command: ${String(event.data.command ?? "command")}`;
    case "sandbox.diff":
      return `Sandbox diff: ${String(event.data.sandboxId ?? "sandbox")}`;
    case "sandbox.approvalRequested":
      return `Sandbox approval requested: ${String(event.data.sandboxId ?? "sandbox")}`;
    case "sandbox.promoted":
      return `Sandbox promoted: ${String(event.data.sandboxId ?? "sandbox")}`;
    case "sandbox.destroyed":
      return `Sandbox destroyed: ${String(event.data.sandboxId ?? "sandbox")}`;
    case "sandbox.resourceLimitExceeded":
      return `Sandbox resource limit exceeded: ${String(event.data.sandboxId ?? "sandbox")}`;
    case "skill.created":
      return `Skill created: ${String(event.data.skillId ?? "skill")}`;
    case "skill.promoted":
      return `Skill promoted: ${String(event.data.skillId ?? "skill")}@${String(event.data.version ?? "unknown")}`;
    case "skill.rolledBack":
      return `Skill rolled back: ${String(event.data.skillId ?? "skill")}@${String(event.data.version ?? "unknown")}`;
    case "skill.deleted":
      return `Skill archived: ${String(event.data.skillId ?? "skill")}`;
    case "skill.evaluated":
      return `Skill evaluated: ${String(event.data.skillId ?? "skill")}@${String(event.data.version ?? "unknown")}`;
    case "skill.run":
      return `Skill run: ${String(event.data.skillId ?? "skill")}@${String(event.data.version ?? "unknown")}`;
    case "skill.call":
      return `Skill call: ${String(event.data.skillId ?? "skill")}@${String(event.data.version ?? "unknown")}`;
    case "job.created":
      return `Job created: ${String(event.data.name ?? event.data.jobId ?? "job")}`;
    case "job.paused":
      return `Job paused: ${String(event.data.jobId ?? "job")}`;
    case "job.resumed":
      return `Job resumed: ${String(event.data.jobId ?? "job")}`;
    case "job.removed":
      return `Job removed: ${String(event.data.jobId ?? "job")}`;
    case "job.run":
      return `Job run: ${String(event.data.name ?? event.data.jobId ?? "job")}`;
    case "job.completed":
      return `Job completed: ${String(event.data.jobId ?? "job")}`;
    case "job.failed":
      return `Job failed: ${String(event.data.jobId ?? "job")}`;
    case "connector.call":
      return `Connector call: ${String(event.data.connectorName ?? "unknown")}.${String(event.data.operationName ?? "unknown")}`;
    case "connector.fixture":
      return `Connector fixture: ${String(event.data.connectorName ?? "unknown")}.${String(event.data.operationName ?? "unknown")}`;
    case "connector.approved":
      return `Connector approved: ${String(event.data.connectorName ?? "unknown")}.${String(event.data.operationName ?? "unknown")}`;
    case "connector.denied":
      return `Connector denied: ${String(event.data.connectorName ?? "unknown")}.${String(event.data.operationName ?? "unknown")}`;
    case "connector.prDrafted":
      return `Developer activity: PR drafted by ${String(event.data.connectorName ?? "connector")}`;
    case "connector.issueUpdated":
      return `Developer activity: issue updated by ${String(event.data.connectorName ?? "connector")}`;
    case "connector.ciTriggered":
      return `Developer activity: CI triggered by ${String(event.data.connectorName ?? "connector")}`;
    case "connector.ciStatus":
      return `Developer activity: CI status from ${String(event.data.connectorName ?? "connector")}`;
    case "team.created":
      return `Team created: ${String(event.data.teamName ?? event.data.teamId ?? "team")}`;
    case "team.updated":
      return `Team updated: ${String(event.data.teamId ?? "team")}`;
    case "team.role.installed":
      return `Team role installed: ${String(event.data.roleId ?? "role")}`;
    case "team.run.started":
      return `Team run started: ${String(event.data.teamRunId ?? "team run")}`;
    case "team.task.decomposed":
      return `Team task decomposed: ${String(event.data.teamRunId ?? "team run")}`;
    case "team.subtask.created":
      return `Team subtask created: ${String(event.data.title ?? event.data.subtaskId ?? "subtask")}`;
    case "team.subtask.assigned":
      return `Team subtask assigned: ${String(event.data.assignedRoleId ?? "role")}`;
    case "team.subtask.started":
      return `Team subtask started: ${String(event.data.subtaskId ?? "subtask")}`;
    case "team.subtask.completed":
      return `Team subtask completed: ${String(event.data.subtaskId ?? "subtask")}`;
    case "team.subtask.failed":
      return `Team subtask failed: ${String(event.data.subtaskId ?? "subtask")}`;
    case "team.agent.started":
      return `Team agent started: ${String(event.data.roleId ?? "role")}`;
    case "team.agent.completed":
      return `Team agent completed: ${String(event.data.roleId ?? "role")}`;
    case "team.agent.failed":
      return `Team agent failed: ${String(event.data.roleId ?? "role")}`;
    case "team.agent.message":
      return `Team message: ${String(event.data.messageType ?? "message")}`;
    case "team.agent.toolDenied":
      return `Team tool denied: ${String(event.data.toolName ?? "tool")}`;
    case "team.blackboard.entry":
      return `Team blackboard: ${String(event.data.entryType ?? event.data.type ?? "entry")}`;
    case "team.conflict.detected":
      return `Team conflict detected: ${String(event.data.conflictType ?? event.data.type ?? "conflict")}`;
    case "team.conflict.resolved":
      return `Team conflict resolved: ${String(event.data.conflictId ?? "conflict")}`;
    case "team.handoff.requested":
      return `Team handoff requested: ${String(event.data.handoffId ?? "handoff")}`;
    case "team.handoff.resolved":
      return `Team handoff resolved: ${String(event.data.handoffId ?? "handoff")}`;
    case "team.synthesis.created":
      return `Team synthesis: ${String(event.data.teamRunId ?? "team run")}`;
    case "team.run.completed":
      return `Team run completed: ${String(event.data.teamRunId ?? "team run")}`;
    case "team.run.failed":
      return `Team run failed: ${String(event.data.teamRunId ?? "team run")}`;
    case "team.run.canceled":
      return `Team run canceled: ${String(event.data.teamRunId ?? "team run")}`;
    case "eval.dataset.installed":
      return `Eval dataset installed: ${String(event.data.datasetId ?? "dataset")}`;
    case "eval.run.started":
      return `Eval run started: ${String(event.data.evalRunId ?? event.data.runId ?? "eval")}`;
    case "eval.task.started":
      return `Eval task started: ${String(event.data.name ?? event.data.evalTaskId ?? "task")}`;
    case "eval.task.completed":
      return `Eval task completed: ${String(event.data.evalTaskId ?? "task")}`;
    case "eval.task.failed":
      return `Eval task failed: ${String(event.data.evalTaskId ?? "task")}`;
    case "eval.run.completed":
      return `Eval run completed: ${String(event.data.evalRunId ?? event.data.runId ?? "eval")}`;
    case "eval.run.failed":
      return `Eval run failed: ${String(event.data.evalRunId ?? event.data.runId ?? "eval")}`;
    case "eval.comparison.created":
      return `Eval comparison: ${String(event.data.status ?? "created")}`;
    case "evolve.variant.created":
      return `Variant created: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.variant.stateChanged":
      return `Variant state changed: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.variant.rejected":
      return `Variant rejected: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.variant.archived":
      return `Variant archived: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.staticCheck.completed":
      return `Variant static check: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.canary.started":
      return `Canary started: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.canary.completed":
      return `Canary completed: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.canary.failed":
      return `Canary failed: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.promoted":
      return `Variant promoted: ${String(event.data.variantId ?? "variant")}`;
    case "evolve.rolledBack":
      return `Evolution rollback: ${String(event.data.skillId ?? "skill")}`;
    case "messaging.adapter.installed":
      return `Messaging adapter installed: ${String(event.data.platform ?? event.data.adapterId ?? "adapter")}`;
    case "messaging.adapter.configured":
      return `Messaging adapter configured: ${String(event.data.platform ?? event.data.adapterId ?? "adapter")}`;
    case "messaging.adapter.started":
      return `Messaging adapter started: ${String(event.data.adapterId ?? "adapter")}`;
    case "messaging.adapter.stopped":
      return `Messaging adapter stopped: ${String(event.data.adapterId ?? "adapter")}`;
    case "messaging.inbound":
      return `Messaging inbound: ${String(event.data.platform ?? "platform")}`;
    case "messaging.outbound":
      return `Messaging outbound: ${String(event.data.platform ?? "platform")}`;
    case "messaging.denied":
      return `Messaging denied: ${String(event.data.reason ?? "policy")}`;
    case "messaging.duplicate":
      return `Messaging duplicate: ${String(event.data.externalEventId ?? "event")}`;
    case "messaging.duplicate.ignored":
      return `Messaging duplicate ignored: ${String(event.data.externalEventId ?? "event")}`;
    case "messaging.session.created":
      return `Messaging session created: ${String(event.data.messagingSessionId ?? "session")}`;
    case "messaging.session.mapped":
      return `Messaging session mapped: ${String(event.data.messagingSessionId ?? "session")}`;
    case "messaging.identity.linked":
      return `Messaging identity linked: ${String(event.data.identityId ?? "identity")}`;
    case "messaging.attachment.received":
      return `Messaging attachment received: ${String(event.data.filename ?? "attachment")}`;
    case "messaging.attachment.stored":
      return `Messaging attachment stored: ${String(event.data.filename ?? "attachment")}`;
    case "messaging.attachment.blocked":
      return `Messaging attachment blocked: ${String(event.data.reason ?? "policy")}`;
    case "messaging.delivery.queued":
      return `Messaging delivery queued: ${String(event.data.triggerType ?? "delivery")}`;
    case "messaging.delivery.sent":
      return `Messaging delivery sent: ${String(event.data.triggerType ?? "delivery")}`;
    case "messaging.delivery.failed":
      return `Messaging delivery failed: ${String(event.data.error ?? "delivery")}`;
    case "messaging.approval.sent":
      return `Messaging approval sent: ${String(event.data.approvalId ?? "approval")}`;
    case "messaging.approval.received":
      return `Messaging approval received: ${String(event.data.approvalId ?? "approval")}`;
    case "messaging.approval.denied":
      return `Messaging approval denied: ${String(event.data.approvalId ?? "approval")}`;
    case "messaging.command.received":
      return `Messaging command received: ${String((event.data.command as { name?: unknown } | undefined)?.name ?? "command")}`;
    case "messaging.command.executed":
      return `Messaging command executed: ${String((event.data.command as { name?: unknown } | undefined)?.name ?? "command")}`;
    case "messaging.command.failed":
      return `Messaging command failed: ${String(event.data.reason ?? "command")}`;
    case "trace.created":
      return "Trace created";
    case "error":
      return "Runtime error";
    default:
      return event.type;
  }
}

export function buildTrace(events: AgentEvent[]): Trace {
  const first = events[0];
  const modelEvent = events.find((event) => event.type === "model.response");
  const modelResultEvent = [...events].reverse().find((event) => event.type === "model.result");
  const modelCallEvent = [...events].reverse().find((event) => event.type === "model.call");
  const planEvent = events.find((event) => event.type === "plan.generated");
  const toolCallCount = events.filter((event) => event.type === "tool.call").length;
  const provider = String(modelResultEvent?.data.provider ?? modelCallEvent?.data.provider ?? modelEvent?.data.provider ?? planEvent?.data.provider ?? "mock");
  const costOwner = (modelResultEvent?.data.costOwner ?? modelCallEvent?.data.costOwner ?? modelEvent?.data.costOwner ?? planEvent?.data.costOwner ?? "local/free") as CostOwner;

  const steps: TraceStep[] = events.map((event) => ({
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    label: labelForEvent(event),
    detail: event.data
  }));

  return {
    id: createId("trace"),
    sessionId: first?.sessionId ?? "",
    runId: first?.runId ?? "",
    createdAt: new Date().toISOString(),
    summary: {
      eventCount: events.length,
      toolCallCount,
      provider,
      costOwner
    },
    steps
  };
}

export function parseStoredTrace(stored: StoredTrace | null): Trace | null {
  if (!stored) {
    return null;
  }

  const events = JSON.parse(stored.events) as Trace;
  return {
    ...events,
    id: stored.id,
    sessionId: stored.session_id,
    createdAt: stored.created_at
  };
}

export function redactTrace(trace: Trace | null): Trace | null {
  if (!trace) {
    return null;
  }

  let redactionCount = 0;
  const steps = trace.steps.map((step) => {
    const redacted = redactValue(step.detail);
    redactionCount += redacted.count;
    return {
      ...step,
      detail: redacted.value
    };
  });

  return {
    ...trace,
    summary: {
      ...trace.summary,
      redactionCount
    },
    steps
  };
}

export function listRuns(database: SquidDatabase, options: TraceListOptions = {}): TraceRunSummary[] {
  const limit = normalizeLimit(options.limit, 50);
  const offset = Math.max(0, options.offset ?? 0);
  const rawTraces = database
    .listTraces(options.sortBy && options.sortBy !== "createdAt" ? 1000 : limit, options.sortBy && options.sortBy !== "createdAt" ? 0 : offset)
    .map((storedTrace) => redactTrace(parseStoredTrace(storedTrace)))
    .filter((trace): trace is Trace => Boolean(trace));
  const traces = newestTracePerRun(rawTraces).map((trace) => summarizeTrace(trace));

  if (options.sortBy === "duration") {
    traces.sort((left, right) => right.durationMs - left.durationMs);
  } else if (options.sortBy === "cost") {
    traces.sort((left, right) => right.totalCost - left.totalCost);
  }

  return traces.slice(options.sortBy && options.sortBy !== "createdAt" ? offset : 0, options.sortBy && options.sortBy !== "createdAt" ? offset + limit : traces.length);
}

export function getTrace(database: SquidDatabase, runId: string): Trace | null {
  return redactTrace(parseStoredTrace(database.getTraceByRunId(runId)));
}

export function searchEvents(database: SquidDatabase, options: TraceSearchOptions = {}): TraceSearchResult[] {
  const text = options.text?.trim().toLowerCase();
  const limit = normalizeLimit(options.limit, 100);
  const rawTraces = options.runId
    ? [getTrace(database, options.runId)].filter((trace): trace is Trace => Boolean(trace))
    : database
        .listTraces(1000)
        .map((storedTrace) => redactTrace(parseStoredTrace(storedTrace)))
        .filter((trace): trace is Trace => Boolean(trace));
  const traces = options.runId ? rawTraces : newestTracePerRun(rawTraces);
  const results: TraceSearchResult[] = [];

  for (const trace of traces) {
    const run = summarizeTrace(trace);
    for (const event of trace.steps) {
      if (options.type && event.type !== options.type) {
        continue;
      }
      if (options.provider && String(event.detail.provider ?? event.detail.fromProvider ?? "").toLowerCase() !== options.provider.toLowerCase()) {
        continue;
      }
      if (options.tool && String(event.detail.toolName ?? event.detail.command ?? event.detail.name ?? "").toLowerCase() !== options.tool.toLowerCase()) {
        continue;
      }
      if (options.jobId && String(event.detail.jobId ?? "").toLowerCase() !== options.jobId.toLowerCase()) {
        continue;
      }
      if (options.teamRunId && String(event.detail.teamRunId ?? "").toLowerCase() !== options.teamRunId.toLowerCase()) {
        continue;
      }
      if (text && !JSON.stringify(event).toLowerCase().includes(text)) {
        continue;
      }
      results.push({ run, event });
      if (results.length >= limit) {
        return results;
      }
    }
  }

  return results;
}

export function computeTraceMetrics(trace: Trace): TraceMetrics {
  const eventDurations = trace.steps.map((step, index) => {
    const explicitDuration = typeof step.detail.durationMs === "number" ? step.detail.durationMs : null;
    if (explicitDuration !== null) {
      return Math.max(0, explicitDuration);
    }
    const current = new Date(step.timestamp).getTime();
    const next = trace.steps[index + 1] ? new Date(trace.steps[index + 1].timestamp).getTime() : current;
    return Math.max(0, next - current);
  });
  const durationMs = traceDurationMs(trace);
  const providerMap = new Map<string, { provider: string; costOwner: string; cost: number; promptTokens: number; completionTokens: number; totalTokens: number; calls: number }>();
  const typeMap = new Map<string, { type: string; count: number; durationMs: number }>();
  const toolMap = new Map<string, { name: string; count: number; durationMs: number }>();
  const connectorMap = new Map<string, { name: string; count: number; durationMs: number }>();

  trace.steps.forEach((step, index) => {
    const eventDuration = eventDurations[index] ?? 0;
    incrementBreakdown(typeMap, step.type, eventDuration);

    if (step.type === "model.result" || step.type === "model.call") {
      const provider = String(step.detail.provider ?? "unknown");
      const costOwner = String(step.detail.costOwner ?? "unknown");
      const tokenUsage = getRecord(step.detail.tokenUsage);
      const promptTokens = numberValue(tokenUsage?.promptTokens);
      const completionTokens = numberValue(tokenUsage?.completionTokens);
      const totalTokens = numberValue(tokenUsage?.totalTokens) || numberValue(step.detail.tokenEstimate);
      const cost = numberValue(step.detail.costEstimate);
      const key = `${provider}:${costOwner}`;
      const current = providerMap.get(key) ?? {
        provider,
        costOwner,
        cost: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        calls: 0
      };
      current.cost += cost;
      current.promptTokens += promptTokens;
      current.completionTokens += completionTokens;
      current.totalTokens += totalTokens;
      current.calls += step.type === "model.call" ? 1 : 0;
      providerMap.set(key, current);
    }

    const toolName = typeof step.detail.toolName === "string" ? step.detail.toolName : null;
    if (toolName && (step.type === "tool.call" || step.type === "tool.result" || step.type === "tool.denied")) {
      incrementBreakdown(toolMap, toolName, eventDuration);
    }

    const commandName = typeof step.detail.command === "string" ? step.detail.command : null;
    if (commandName && step.type === "sandbox.command") {
      incrementBreakdown(toolMap, `sandbox:${commandName}`, eventDuration);
    }

    if (step.type.startsWith("connector.")) {
      const connectorName = `${String(step.detail.connectorName ?? "unknown")}.${String(step.detail.operationName ?? "unknown")}`;
      incrementBreakdown(connectorMap, connectorName, eventDuration);
    }
  });

  const providerBreakdown = [...providerMap.values()];
  const totalCost = providerBreakdown.reduce((total, item) => total + item.cost, 0);
  const promptTokens = providerBreakdown.reduce((total, item) => total + item.promptTokens, 0);
  const completionTokens = providerBreakdown.reduce((total, item) => total + item.completionTokens, 0);
  const totalTokens = providerBreakdown.reduce((total, item) => total + item.totalTokens, 0);
  const maxStepDurationMs = eventDurations.reduce((max, duration) => Math.max(max, duration), 0);
  const meanStepDurationMs = eventDurations.length
    ? Math.round(eventDurations.reduce((total, duration) => total + duration, 0) / eventDurations.length)
    : 0;

  return {
    durationMs,
    meanStepDurationMs,
    maxStepDurationMs,
    totalCost,
    totalTokens,
    promptTokens,
    completionTokens,
    providerBreakdown,
    eventTypeBreakdown: [...typeMap.values()],
    toolBreakdown: [...toolMap.values()],
    connectorBreakdown: [...connectorMap.values()]
  };
}

export function summarizeTrace(trace: Trace): TraceRunSummary {
  const metrics = computeTraceMetrics(trace);
  return {
    traceId: trace.id,
    runId: trace.runId,
    sessionId: trace.sessionId,
    task: traceTitle(trace),
    provider: trace.summary.provider,
    costOwner: trace.summary.costOwner,
    status: traceStatus(trace),
    createdAt: trace.createdAt,
    durationMs: metrics.durationMs,
    eventCount: trace.summary.eventCount,
    toolCallCount: trace.summary.toolCallCount,
    totalCost: metrics.totalCost,
    totalTokens: metrics.totalTokens
  };
}

export function exportTraceMarkdown(trace: Trace): string {
  const run = summarizeTrace(trace);
  const metrics = computeTraceMetrics(trace);
  const lines = [
    `# Trace ${trace.runId}`,
    "",
    `- Task: ${run.task}`,
    `- Status: ${run.status}`,
    `- Provider: ${run.provider}`,
    `- Cost owner: ${run.costOwner}`,
    `- Duration: ${metrics.durationMs}ms`,
    `- Cost estimate: ${metrics.totalCost}`,
    `- Tokens: ${metrics.totalTokens}`,
    "",
    "## Events"
  ];

  for (const [index, step] of trace.steps.entries()) {
    lines.push("", `### ${index + 1}. ${step.label}`, "", `- Type: ${step.type}`, `- Timestamp: ${step.timestamp}`, "", "```json", JSON.stringify(step.detail, null, 2), "```");
  }

  return `${lines.join("\n")}\n`;
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(1000, Math.floor(value))) : fallback;
}

function newestTracePerRun(traces: Trace[]): Trace[] {
  const seen = new Set<string>();
  const unique: Trace[] = [];
  for (const trace of traces) {
    if (seen.has(trace.runId)) {
      continue;
    }
    seen.add(trace.runId);
    unique.push(trace);
  }
  return unique;
}

function traceTitle(trace: Trace): string {
  const userStep = trace.steps.find((step) => step.type === "user.task" || step.type === "user.message");
  const jobStep = trace.steps.find((step) => step.type === "job.run" || step.type === "job.created");
  const teamStep = trace.steps.find((step) => step.type === "team.run.started" || step.type === "team.created");
  return String(
    userStep?.detail.task ??
      userStep?.detail.content ??
      teamStep?.detail.task ??
      teamStep?.detail.teamName ??
      jobStep?.detail.name ??
      jobStep?.detail.refId ??
      `Run ${trace.runId}`
  );
}

function traceDurationMs(trace: Trace): number {
  if (trace.steps.length < 2) {
    return 0;
  }
  const first = new Date(trace.steps[0].timestamp).getTime();
  const last = new Date(trace.steps[trace.steps.length - 1].timestamp).getTime();
  return Math.max(0, last - first);
}

function traceStatus(trace: Trace): TraceRunSummary["status"] {
  const reflection = [...trace.steps].reverse().find((step) => step.type === "reflection.created");
  const outcome = typeof reflection?.detail.outcome === "string" ? reflection.detail.outcome : "";
  if (
    outcome.startsWith("failed") ||
    trace.steps.some(
      (step) =>
        step.type === "error" ||
        step.type === "tool.denied" ||
        step.type === "connector.denied" ||
        step.type === "sandbox.resourceLimitExceeded" ||
        step.type === "job.failed" ||
        step.type === "team.run.failed"
    )
  ) {
    return "failed";
  }
  if (outcome.startsWith("partially_succeeded")) {
    return "partial";
  }
  if (
    trace.steps.some(
      (step) =>
        step.type === "task.complete" ||
        step.type === "model.response" ||
        step.type === "model.result" ||
        step.type === "job.completed" ||
        step.type === "team.run.completed" ||
        step.type === "team.created" ||
        step.type === "job.created" ||
        step.type === "job.paused" ||
        step.type === "job.resumed" ||
        step.type === "job.removed"
    )
  ) {
    return "success";
  }
  return "unknown";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function incrementBreakdown<T extends { count: number; durationMs: number }>(
  map: Map<string, T & { type?: string; name?: string }>,
  key: string,
  durationMs: number
): void {
  const current = map.get(key) ?? ({ type: key, name: key, count: 0, durationMs: 0 } as T & { type?: string; name?: string });
  current.count += 1;
  current.durationMs += durationMs;
  map.set(key, current);
}
