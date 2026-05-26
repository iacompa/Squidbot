export type JsonObject = Record<string, unknown>;

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type CostOwner = "local/free" | "user-paid" | "user-paid BYOK" | "org-paid" | "organization-paid BYOK" | "disabled";

export type AgentEvent = {
  id: string;
  timestamp: string;
  sessionId: string;
  runId: string;
  type:
    | "session.started"
    | "user.message"
    | "user.task"
    | "workspace.summary"
    | "plan.generated"
    | "model.response"
    | "tool.call"
    | "tool.result"
    | "tool.denied"
    | "test.run"
    | "task.complete"
    | "reflection.created"
    | "memory.candidate"
    | "memory.approved"
    | "memory.retrieved"
    | "memory.graph"
    | "affordance.gap"
    | "affordance.resolved"
    | "sandbox.created"
    | "sandbox.command"
    | "sandbox.diff"
    | "sandbox.approvalRequested"
    | "sandbox.promoted"
    | "sandbox.destroyed"
    | "sandbox.resourceLimitExceeded"
    | "skill.created"
    | "skill.promoted"
    | "skill.rolledBack"
    | "skill.deleted"
    | "skill.evaluated"
    | "skill.run"
    | "skill.call"
    | "job.created"
    | "job.paused"
    | "job.resumed"
    | "job.removed"
    | "job.run"
    | "job.completed"
    | "job.failed"
    | "model.call"
    | "model.result"
    | "model.error"
    | "model.budgetWarning"
    | "model.budgetExceeded"
    | "model.fallback"
    | "connector.call"
    | "connector.fixture"
    | "connector.approved"
    | "connector.denied"
    | "connector.http_call"
    | "connector.approval-requested"
    | "connector.prDrafted"
    | "connector.issueUpdated"
    | "connector.ciTriggered"
    | "connector.ciStatus"
    | "team.created"
    | "team.updated"
    | "team.role.installed"
    | "team.run.started"
    | "team.task.decomposed"
    | "team.subtask.created"
    | "team.subtask.assigned"
    | "team.subtask.started"
    | "team.subtask.completed"
    | "team.subtask.failed"
    | "team.agent.started"
    | "team.agent.completed"
    | "team.agent.failed"
    | "team.agent.message"
    | "team.agent.toolDenied"
    | "team.blackboard.entry"
    | "team.conflict.detected"
    | "team.conflict.resolved"
    | "team.handoff.requested"
    | "team.handoff.resolved"
    | "team.synthesis.created"
    | "team.run.completed"
    | "team.run.failed"
    | "team.run.canceled"
    | "team.run.paused"
    | "eval.dataset.installed"
    | "eval.run.started"
    | "eval.task.started"
    | "eval.task.completed"
    | "eval.task.failed"
    | "eval.run.completed"
    | "eval.run.failed"
    | "eval.comparison.created"
    | "evolve.variant.created"
    | "evolve.variant.stateChanged"
    | "evolve.variant.rejected"
    | "evolve.variant.archived"
    | "evolve.staticCheck.completed"
    | "evolve.canary.started"
    | "evolve.canary.completed"
    | "evolve.canary.failed"
    | "evolve.promoted"
    | "evolve.rolledBack"
    | "messaging.adapter.installed"
    | "messaging.adapter.configured"
    | "messaging.adapter.started"
    | "messaging.adapter.stopped"
    | "messaging.inbound"
    | "messaging.outbound"
    | "messaging.denied"
    | "messaging.duplicate"
    | "messaging.duplicate.ignored"
    | "messaging.session.created"
    | "messaging.session.mapped"
    | "messaging.identity.linked"
    | "messaging.attachment.received"
    | "messaging.attachment.stored"
    | "messaging.attachment.blocked"
    | "messaging.delivery.queued"
    | "messaging.delivery.sent"
    | "messaging.delivery.failed"
    | "messaging.approval.sent"
    | "messaging.approval.received"
    | "messaging.approval.denied"
    | "messaging.command.received"
    | "messaging.command.executed"
    | "messaging.command.failed"
    | "trace.created"
    | "error";
  data: JsonObject;
};

export type ToolCall = {
  id: string;
  name: string;
  args: JsonObject;
};

export type ToolResult = {
  callId: string;
  toolName: string;
  ok: boolean;
  output: unknown;
};

export type ChatMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
};

export type AgentResponse = {
  sessionId: string;
  runId: string;
  content: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  trace: Trace;
};

export type WorkspaceSummaryFile = {
  path: string;
  firstLines: string[];
};

export type WorkspaceSummary = {
  workspacePath: string;
  topLevelEntries: string[];
  keyFiles: WorkspaceSummaryFile[];
};

export type TaskPlanAction = {
  id: string;
  description: string;
  toolName: string;
  args: JsonObject;
};

export type TaskPlan = {
  id: string;
  problem: string;
  riskLevel: RiskLevel;
  actions: TaskPlanAction[];
};

export type MemoryCandidate = {
  type: "fact" | "observation" | "decision" | "procedure" | string;
  title: string;
  body: string;
  sourceEventId: string;
  confidence: number;
  importance?: number;
  approvedAt?: string;
  approvedMemoryId?: string;
};

export type Reflection = {
  id: string;
  sessionId: string;
  runId: string;
  task: string;
  summary: string;
  outcome: string;
  successFactors: string[];
  failureModes: string[];
  missingTools: string[];
  missingPermissions: string[];
  missingContext: string[];
  reusablePatterns: string[];
  memoryCandidates: MemoryCandidate[];
  failureTaxonomy: string[];
  affordanceIds: string[];
  createdAt: string;
};

export type ApprovedMemory = {
  id: string;
  type: string;
  title: string;
  body: string;
  sourceRunId: string;
  sourceReflectionId: string | null;
  sourceEventId: string | null;
  confidence: number;
  importance: number;
  createdAt: string;
  approvedAt: string | null;
  archivedAt: string | null;
};

export type RepoTaskResult = {
  sessionId: string;
  runId: string;
  task: string;
  plan: TaskPlan;
  workspaceSummary: WorkspaceSummary;
  toolResults: ToolResult[];
  finalSummary: string;
  retrievedMemories: ApprovedMemory[];
  reflection: Reflection;
  trace: Trace;
};

export type TraceStep = {
  id: string;
  timestamp: string;
  type: AgentEvent["type"] | string;
  label: string;
  detail: JsonObject;
};

export type Trace = {
  id: string;
  sessionId: string;
  runId: string;
  createdAt: string;
  summary: {
    eventCount: number;
    toolCallCount: number;
    provider: string;
    costOwner: CostOwner;
    redactionCount?: number;
  };
  steps: TraceStep[];
};

export function createId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}`;
}
