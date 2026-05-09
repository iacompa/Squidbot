import type { AffordanceGapRecord, MemoryRecord, ReflectionRecord, SquidDatabase } from "@squidbot/db";
import { MemoryGraphStore, type MemoryNodeRecord } from "@squidbot/memory";
import { buildTrace } from "./trace.js";
import {
  createId,
  type AgentEvent,
  type ApprovedMemory,
  type JsonObject,
  type MemoryCandidate,
  type Reflection,
  type TaskPlan,
  type ToolResult,
  type WorkspaceSummary
} from "./types.js";

export type GenerateReflectionInput = {
  sessionId: string;
  runId: string;
  task: string;
  plan: TaskPlan;
  workspaceSummary: WorkspaceSummary;
  toolResults: ToolResult[];
  events: AgentEvent[];
};

export type MemoryApprovalResult = {
  reflection: ReflectionRecord;
  memory: ApprovedMemory;
};

export function getRecentApprovedMemories(database: SquidDatabase, limit = 5): ApprovedMemory[] {
  return database.listApprovedMemories(limit).map(toApprovedMemory);
}

export function getRelevantGraphMemories(database: SquidDatabase, query: string, limit = 5): ApprovedMemory[] {
  const store = new MemoryGraphStore(database);
  return store
    .hybridSearch(query, limit)
    .filter((result) => !result.node.affordanceId)
    .map((result) => graphNodeToApprovedMemory(result.node))
    .filter((memory) => memory.type !== "task" && memory.type !== "reflection");
}

export function combineMemorySources(primary: ApprovedMemory[], secondary: ApprovedMemory[], limit = 8): ApprovedMemory[] {
  const combined = new Map<string, ApprovedMemory>();
  for (const memory of [...primary, ...secondary]) {
    combined.set(memory.id, memory);
  }
  return [...combined.values()]
    .sort((left, right) => right.importance - left.importance || right.confidence - left.confidence)
    .slice(0, limit);
}

export function buildMemoryBulletin(memories: ApprovedMemory[]): string {
  if (memories.length === 0) {
    return "Memory Bulletin\n- No approved memories found for this run.";
  }

  const lines = ["Memory Bulletin"];
  for (const memory of memories) {
    lines.push(`- [${memory.type}] ${memory.title}: ${memory.body}`);
  }

  return lines.join("\n");
}

export function generateReflection(input: GenerateReflectionInput): Reflection {
  const testResult = input.toolResults.find((result) => result.toolName === "test.run")?.output as
    | { exitCode?: number | null; dryRun?: boolean; timedOut?: boolean; executed?: boolean }
    | undefined;
  const failedToolNames = input.toolResults.filter((result) => !result.ok).map((result) => result.toolName);
  const patchResult = input.toolResults.find(
    (result) => result.ok && (result.toolName === "workspace.createPatch" || result.toolName === "workspace.proposePatch")
  );
  const patchCreated = Boolean(patchResult);
  const patchStaged = Boolean((patchResult?.output as { staged?: boolean } | undefined)?.staged);
  const connectorCalls = input.toolResults.filter((result) => result.toolName.startsWith("connector."));
  const connectorFixtureUsed = input.events.some((event) => event.type === "connector.fixture");
  const searchUsed = input.toolResults.some((result) => result.toolName === "workspace.searchFiles");
  const readUsed = input.toolResults.some((result) => result.toolName === "workspace.readFile");

  const outcome = describeOutcome({ failedToolNames, testResult, patchCreated });
  const memoryCandidates = extractMemoryCandidates(input.events);
  if (memoryCandidates.length === 0) {
    const sourceEvent = input.events.find((event) => event.type === "task.complete") ?? input.events[input.events.length - 1];
    memoryCandidates.push({
      type: "observation",
      title: connectorCalls.length > 0 ? "Connector task used fixture workflow" : "Repo task used draft-only workflow",
      body:
        connectorCalls.length > 0
          ? `The task "${input.task}" called a registered connector through policy checks and fixture mode.`
          : `The task "${input.task}" inspected the workspace, generated a plan, and kept workspace writes as draft-only artifacts.`,
      sourceEventId: sourceEvent.id,
      confidence: 0.72,
      importance: 0.45
    });
  }

  const missingContext: string[] = [];
  if (!testResult && connectorCalls.length === 0) {
    missingContext.push("No test command was provided, so verification was limited to inspection and patch drafting.");
  }

  return {
    id: createId("reflection"),
    sessionId: input.sessionId,
    runId: input.runId,
    task: input.task,
    summary: `SquidBot inspected ${input.workspaceSummary.topLevelEntries.length} top-level workspace entries, generated a mock plan with ${input.plan.actions.length} actions, and executed safe tools for the task.`,
    outcome,
    successFactors: [
      ...(readUsed ? ["Relevant files were read through the read-only workspace tool."] : []),
      ...(searchUsed ? ["The workspace search tool found candidate symbols or files."] : []),
      ...(patchStaged
        ? ["A draft patch was applied and verified in an isolated staging sandbox."]
        : patchCreated
          ? ["A draft patch was produced without modifying the workspace."]
          : []),
      ...(testResult ? ["The requested test command was captured through the test.run tool."] : []),
      ...(connectorCalls.length > 0 ? ["Connector operations were routed through the policy engine."] : []),
      ...(connectorFixtureUsed ? ["Fixture mode returned a connector response without network access."] : [])
    ],
    failureModes: [
      ...failedToolNames.map((toolName) => `Tool failed: ${toolName}.`),
      ...(testResult && !testResult.dryRun && testResult.exitCode !== 0
        ? [`Tests did not pass in the sandboxed workspace copy (exit ${testResult.exitCode ?? "unknown"}).`]
        : []),
      ...(testResult?.timedOut ? ["The test command timed out before completion."] : [])
    ],
    missingTools: patchCreated && !patchStaged ? ["Patch application remains intentionally deferred to a future approval workflow."] : [],
    missingPermissions: patchCreated && !patchStaged ? ["Filesystem write approval is required before a draft patch can be applied."] : [],
    missingContext,
    reusablePatterns:
      connectorCalls.length > 0
        ? [
            "Route connector operations through manifest permissions and the policy engine.",
            "Use fixture responses for connector development before enabling real transport.",
            "Record connector calls and fixture responses in the trace before surfacing results."
          ]
        : [
            "Inspect tests before implementation files when debugging a failing fixture.",
            patchStaged
              ? "Apply proposed diffs in a staged workspace and promote only after approval."
              : "Draft a unified diff and verify it without changing the selected workspace.",
            patchStaged
              ? "Run verification commands against the staged workspace before approval."
              : "Run tests in a copied workspace sandbox when the command is allowlisted."
          ],
    memoryCandidates,
    failureTaxonomy: [],
    affordanceIds: [],
    createdAt: new Date().toISOString()
  };
}

export function saveReflection(database: SquidDatabase, reflection: Reflection): void {
  database.saveReflection({
    id: reflection.id,
    sessionId: reflection.sessionId,
    runId: reflection.runId,
    task: reflection.task,
    summary: reflection.summary,
    outcome: reflection.outcome,
    successFactors: reflection.successFactors,
    failureModes: reflection.failureModes,
    missingTools: reflection.missingTools,
    missingPermissions: reflection.missingPermissions,
    missingContext: reflection.missingContext,
    reusablePatterns: reflection.reusablePatterns,
    memoryCandidates: reflection.memoryCandidates,
    failureTaxonomy: reflection.failureTaxonomy,
    affordanceIds: reflection.affordanceIds,
    createdAt: reflection.createdAt
  });
}

export function persistAffordanceGapMemoryGraph(
  database: SquidDatabase,
  reflection: Pick<ReflectionRecord | Reflection, "id" | "runId" | "task" | "summary" | "outcome" | "createdAt">,
  gaps: AffordanceGapRecord[]
): { gapNodeIds: string[]; edgeIds: string[] } {
  if (gaps.length === 0) {
    return { gapNodeIds: [], edgeIds: [] };
  }

  const store = new MemoryGraphStore(database);
  const task = upsertGraphNode(store, {
    id: taskNodeId(reflection.runId),
    type: "task",
    title: reflection.task,
    body: `Task run ${reflection.runId}: ${reflection.task}`,
    confidence: 0.8,
    importance: 0.55,
    sensitivity: "public",
    createdAt: reflection.createdAt
  });
  const reflectionNode = upsertGraphNode(store, {
    id: reflectionNodeId(reflection.id),
    type: "reflection",
    title: `Reflection for ${reflection.task}`,
    body: `${reflection.summary}\n\nOutcome: ${reflection.outcome}`,
    confidence: 0.85,
    importance: 0.6,
    sensitivity: "public",
    createdAt: reflection.createdAt
  });
  const gapNodeIds: string[] = [];
  const edgeIds: string[] = [];

  for (const gap of gaps) {
    const node = upsertGraphNode(store, {
      id: affordanceGapNodeId(gap.id),
      type: "risk",
      title: `${gap.type}: ${gap.name}`,
      body: gap.description,
      confidence: 0.82,
      importance: gap.severity === "high" ? 0.9 : gap.severity === "medium" ? 0.68 : 0.42,
      sensitivity: "public",
      createdAt: gap.createdAt,
      affordanceId: gap.id
    });
    gapNodeIds.push(node.id);
    edgeIds.push(ensureGraphEdge(store, node.id, reflectionNode.id, "caused_by"));
    edgeIds.push(ensureGraphEdge(store, task.id, node.id, "depends_on"));
  }

  return {
    gapNodeIds,
    edgeIds: edgeIds.filter(Boolean)
  };
}

export function persistSandboxDiffMemoryGraph(
  database: SquidDatabase,
  input: {
    runId: string;
    task: string;
    sandboxId: string;
    diff: string;
    createdAt: string;
  }
): { diffNodeId: string; edgeIds: string[] } {
  const store = new MemoryGraphStore(database);
  const task = upsertGraphNode(store, {
    id: taskNodeId(input.runId),
    type: "task",
    title: input.task,
    body: `Task run ${input.runId}: ${input.task}`,
    confidence: 0.8,
    importance: 0.55,
    sensitivity: "public",
    createdAt: input.createdAt
  });
  const changedFiles = [...input.diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
  const node = upsertGraphNode(store, {
    id: sandboxDiffNodeId(input.sandboxId),
    type: "fact",
    title: `Sandbox diff ${input.sandboxId}`,
    body: [
      `Sandbox ${input.sandboxId} staged ${changedFiles.length} changed file(s).`,
      changedFiles.length > 0 ? `Files: ${changedFiles.slice(0, 12).join(", ")}` : "No changed files.",
      "",
      input.diff.slice(0, 6000)
    ].join("\n"),
    confidence: 0.82,
    importance: 0.62,
    sensitivity: "public",
    createdAt: input.createdAt
  });

  return {
    diffNodeId: node.id,
    edgeIds: [ensureGraphEdge(store, node.id, task.id, "part_of")].filter(Boolean)
  };
}

export function persistReflectionMemoryGraph(database: SquidDatabase, reflection: Reflection): {
  taskNodeId: string;
  reflectionNodeId: string;
  candidateNodeIds: string[];
  edgeIds: string[];
} {
  const store = new MemoryGraphStore(database);
  const taskNode = upsertGraphNode(store, {
    id: taskNodeId(reflection.runId),
    type: "task",
    title: reflection.task,
    body: `Task run ${reflection.runId}: ${reflection.task}`,
    confidence: 0.8,
    importance: 0.55,
    sensitivity: "public",
    createdAt: reflection.createdAt
  });
  const reflectionNode = upsertGraphNode(store, {
    id: reflectionNodeId(reflection.id),
    type: "reflection",
    title: `Reflection for ${reflection.task}`,
    body: `${reflection.summary}\n\nOutcome: ${reflection.outcome}`,
    confidence: 0.85,
    importance: 0.6,
    sensitivity: "public",
    createdAt: reflection.createdAt
  });
  const edgeIds: string[] = [];
  edgeIds.push(ensureGraphEdge(store, reflectionNode.id, taskNode.id, "caused_by"));

  const candidateNodeIds: string[] = [];
  reflection.memoryCandidates = reflection.memoryCandidates.map((candidate, index) => {
    const node = upsertGraphNode(store, {
      id: candidateNodeId(reflection.id, index),
      type: candidateToNodeType(candidate.type),
      title: candidate.title,
      body: candidate.body,
      confidence: candidate.confidence,
      importance: candidate.importance ?? 0.5,
      sensitivity: "public",
      createdAt: reflection.createdAt
    });
    candidateNodeIds.push(node.id);
    edgeIds.push(ensureGraphEdge(store, node.id, reflectionNode.id, "caused_by"));
    edgeIds.push(ensureGraphEdge(store, node.id, taskNode.id, "part_of"));
    return {
      ...candidate,
      graphNodeId: node.id
    };
  });
  database.updateReflectionMemoryCandidates(reflection.id, reflection.memoryCandidates);

  return {
    taskNodeId: taskNode.id,
    reflectionNodeId: reflectionNode.id,
    candidateNodeIds,
    edgeIds: edgeIds.filter(Boolean)
  };
}

export function approveMemoryCandidate(
  database: SquidDatabase,
  reflectionId: string,
  candidateIndex: number
): MemoryApprovalResult {
  const reflection = database.getReflection(reflectionId);
  if (!reflection) {
    throw new Error(`Reflection not found: ${reflectionId}`);
  }

  const candidate = parseMemoryCandidate(reflection.memoryCandidates[candidateIndex], candidateIndex);
  if (candidate.approvedMemoryId) {
    const existing = database.getMemory(candidate.approvedMemoryId);
    if (!existing) {
      throw new Error(`Approved memory is missing: ${candidate.approvedMemoryId}`);
    }

    return {
      reflection,
      memory: toApprovedMemory(existing)
    };
  }

  const approvedAt = new Date().toISOString();
  const memory = database.insertMemory({
    id: createId("memory"),
    type: candidate.type,
    title: candidate.title,
    body: candidate.body,
    sourceRunId: reflection.runId,
    sourceReflectionId: reflection.id,
    sourceEventId: candidate.sourceEventId,
    confidence: candidate.confidence,
    importance: candidate.importance ?? 0.5,
    createdAt: approvedAt,
    approvedAt,
    archivedAt: null
  });

  const graph = ensureApprovedMemoryGraph(database, reflection, candidate, memory, candidateIndex);

  const updatedCandidates = reflection.memoryCandidates.map((item, index) => {
    if (index !== candidateIndex || !item || typeof item !== "object") {
      return item;
    }

    return {
      ...(item as Record<string, unknown>),
      approvedAt,
      approvedMemoryId: memory.id,
      graphNodeId: graph.nodeId
    };
  });

  database.updateReflectionMemoryCandidates(reflection.id, updatedCandidates);
  appendMemoryGraphEvent(database, reflection, {
    action: "approved",
    nodeIds: [graph.nodeId],
    edgeIds: graph.edgeIds,
    legacyMemoryId: memory.id
  });
  appendMemoryApprovedEvent(database, reflection, memory);
  refreshTraceForRun(database, reflection.sessionId, reflection.runId);

  const updatedReflection = database.getReflection(reflection.id);
  return {
    reflection: updatedReflection ?? reflection,
    memory: toApprovedMemory(memory)
  };
}

function ensureApprovedMemoryGraph(
  database: SquidDatabase,
  reflection: ReflectionRecord,
  candidate: MemoryCandidate,
  memory: MemoryRecord,
  candidateIndex: number
): { nodeId: string; edgeIds: string[] } {
  const store = new MemoryGraphStore(database);
  const graphNodeId =
    typeof (reflection.memoryCandidates[candidateIndex] as Record<string, unknown> | undefined)?.graphNodeId === "string"
      ? ((reflection.memoryCandidates[candidateIndex] as Record<string, unknown>).graphNodeId as string)
      : candidateNodeId(reflection.id, candidateIndex);
  const node = upsertGraphNode(store, {
    id: graphNodeId,
    type: candidateToNodeType(memory.type),
    title: memory.title,
    body: memory.body,
    confidence: memory.confidence,
    importance: memory.importance,
    sensitivity: "public",
    createdAt: memory.createdAt
  });
  const task = upsertGraphNode(store, {
    id: taskNodeId(reflection.runId),
    type: "task",
    title: reflection.task,
    body: `Task run ${reflection.runId}: ${reflection.task}`,
    confidence: 0.8,
    importance: 0.55,
    sensitivity: "public",
    createdAt: memory.createdAt
  });
  const reflectionNode = upsertGraphNode(store, {
    id: reflectionNodeId(reflection.id),
    type: "reflection",
    title: `Reflection for ${reflection.task}`,
    body: `${reflection.summary}\n\nOutcome: ${reflection.outcome}`,
    confidence: 0.85,
    importance: 0.6,
    sensitivity: "public",
    createdAt: memory.createdAt
  });
  return {
    nodeId: node.id,
    edgeIds: [
      ensureGraphEdge(store, node.id, reflectionNode.id, "caused_by"),
      ensureGraphEdge(store, node.id, task.id, "part_of"),
      ensureGraphEdge(store, node.id, task.id, "updates")
    ].filter(Boolean)
  };
}

function describeOutcome(input: {
  failedToolNames: string[];
  testResult?: { exitCode?: number | null; dryRun?: boolean; timedOut?: boolean; executed?: boolean };
  patchCreated: boolean;
}): string {
  if (input.failedToolNames.length > 0) {
    return `failed: ${input.failedToolNames.length} tool call(s) failed.`;
  }

  if (input.testResult?.timedOut) {
    return "partially_succeeded: the plan ran, but verification timed out.";
  }

  if (input.testResult?.dryRun) {
    return "partially_succeeded: the plan ran, but the test command was recorded as a dry run.";
  }

  if (input.testResult && input.testResult.exitCode !== 0) {
    return `partially_succeeded: a draft patch was produced, but tests still failed before approval (exit ${input.testResult.exitCode ?? "unknown"}).`;
  }

  if (input.testResult?.exitCode === 0) {
    return input.patchCreated
      ? "succeeded: a draft patch was produced and sandboxed tests passed."
      : "succeeded: sandboxed tests passed.";
  }

  return input.patchCreated
    ? "partially_succeeded: a draft patch was produced without test verification."
    : "succeeded: the run completed without failed tool calls.";
}

function extractMemoryCandidates(events: AgentEvent[]): MemoryCandidate[] {
  const candidates: MemoryCandidate[] = [];
  const seen = new Set<string>();
  const readEvents = events.filter((event) => event.type === "tool.result" && event.data.toolName === "workspace.readFile");

  for (const event of readEvents) {
    const output = event.data.output;
    if (!output || typeof output !== "object") {
      continue;
    }

    const record = output as Record<string, unknown>;
    const filePath = typeof record.path === "string" ? record.path : "";
    const content = typeof record.content === "string" ? record.content : "";

    if (filePath.endsWith("calculator.py") && /def\s+add\([^)]*\):\s*\r?\n\s*return\s+a\s*-\s*b/.test(content)) {
      const key = "calculator-add-subtracts";
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push({
        type: "observation",
        title: "Calculator bug: add subtracts",
        body: "In calculator.py, the add function subtracts instead of adding.",
        sourceEventId: event.id,
        confidence: 0.9,
        importance: 0.7
      });
    }
  }

  return candidates;
}

function parseMemoryCandidate(value: unknown, index: number): MemoryCandidate {
  if (!value || typeof value !== "object") {
    throw new Error(`Memory candidate ${index} is not valid.`);
  }

  const candidate = value as Partial<MemoryCandidate>;
  if (!candidate.title || !candidate.body || !candidate.type || !candidate.sourceEventId) {
    throw new Error(`Memory candidate ${index} is missing required fields.`);
  }

  return {
    type: String(candidate.type),
    title: String(candidate.title),
    body: String(candidate.body),
    sourceEventId: String(candidate.sourceEventId),
    confidence: typeof candidate.confidence === "number" ? candidate.confidence : 0.5,
    importance: typeof candidate.importance === "number" ? candidate.importance : 0.5,
    approvedAt: typeof candidate.approvedAt === "string" ? candidate.approvedAt : undefined,
    approvedMemoryId: typeof candidate.approvedMemoryId === "string" ? candidate.approvedMemoryId : undefined
  };
}

function appendMemoryApprovedEvent(database: SquidDatabase, reflection: ReflectionRecord, memory: MemoryRecord): void {
  database.appendEvent({
    id: createId("evt"),
    timestamp: new Date().toISOString(),
    sessionId: reflection.sessionId,
    type: "memory.approved",
    data: {
      runId: reflection.runId,
      reflectionId: reflection.id,
      memoryId: memory.id,
      candidate: {
        type: memory.type,
        title: memory.title,
        body: memory.body,
        confidence: memory.confidence,
        importance: memory.importance,
        sourceEventId: memory.sourceEventId
      }
    }
  });
}

function refreshTraceForRun(database: SquidDatabase, sessionId: string, runId: string): void {
  const events = loadRunEvents(database, sessionId, runId);
  if (events.length === 0) {
    return;
  }

  const trace = buildTrace(events);
  database.saveTrace({
    id: trace.id,
    sessionId: trace.sessionId,
    events: trace,
    createdAt: trace.createdAt
  });
}

function loadRunEvents(database: SquidDatabase, sessionId: string, runId: string): AgentEvent[] {
  return database
    .listEvents(sessionId)
    .map((storedEvent) => {
      const rawData = JSON.parse(storedEvent.data) as JsonObject;
      if (rawData.runId !== runId) {
        return null;
      }

      const { runId: _storedRunId, ...data } = rawData;
      return {
        id: storedEvent.id,
        timestamp: storedEvent.timestamp,
        sessionId: storedEvent.session_id,
        runId,
        type: storedEvent.type as AgentEvent["type"],
        data
      } satisfies AgentEvent;
    })
    .filter((event): event is AgentEvent => event !== null);
}

function toApprovedMemory(memory: MemoryRecord): ApprovedMemory {
  return {
    id: memory.id,
    type: memory.type,
    title: memory.title,
    body: memory.body,
    sourceRunId: memory.sourceRunId,
    sourceReflectionId: memory.sourceReflectionId,
    sourceEventId: memory.sourceEventId,
    confidence: memory.confidence,
    importance: memory.importance,
    createdAt: memory.createdAt,
    approvedAt: memory.approvedAt,
    archivedAt: memory.archivedAt
  };
}

function graphNodeToApprovedMemory(node: MemoryNodeRecord): ApprovedMemory {
  return {
    id: node.id,
    type: node.type,
    title: node.title,
    body: node.body,
    sourceRunId: "memory_graph",
    sourceReflectionId: null,
    sourceEventId: null,
    confidence: node.confidence,
    importance: node.importance,
    createdAt: node.createdAt,
    approvedAt: node.createdAt,
    archivedAt: node.archivedAt
  };
}

function upsertGraphNode(store: MemoryGraphStore, input: Parameters<MemoryGraphStore["createNode"]>[0]): MemoryNodeRecord {
  const existing = input.id ? store.getNode(input.id, { includeArchived: true }) : null;
  if (existing) {
    return store.updateNode(existing.id, {
      type: input.type,
      title: input.title,
      body: input.body,
      confidence: input.confidence,
      importance: input.importance,
      sensitivity: input.sensitivity
    });
  }

  return store.createNode(input);
}

function ensureGraphEdge(store: MemoryGraphStore, fromNodeId: string, toNodeId: string, type: Parameters<MemoryGraphStore["createEdge"]>[0]["type"]): string {
  const id = graphEdgeId(fromNodeId, toNodeId, String(type));
  const existing = store.getEdge(id);
  if (existing && !existing.deletedAt) {
    return existing.id;
  }

  try {
    return store.createEdge({ id, fromNodeId, toNodeId, type }).id;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      return id;
    }
    throw error;
  }
}

function appendMemoryGraphEvent(
  database: SquidDatabase,
  reflection: Pick<ReflectionRecord, "sessionId" | "runId" | "id">,
  detail: JsonObject
): void {
  database.appendEvent({
    id: createId("evt"),
    timestamp: new Date().toISOString(),
    sessionId: reflection.sessionId,
    type: "memory.graph",
    data: {
      runId: reflection.runId,
      reflectionId: reflection.id,
      ...detail
    }
  });
}

function candidateToNodeType(type: string): "fact" | "decision" | "skill" | "preference" | "risk" {
  if (type === "decision") {
    return "decision";
  }
  if (type === "procedure" || type === "skill") {
    return "skill";
  }
  if (type === "preference") {
    return "preference";
  }
  if (type === "risk") {
    return "risk";
  }
  return "fact";
}

function taskNodeId(runId: string): string {
  return `memory_node_task_${safeId(runId)}`;
}

function reflectionNodeId(reflectionId: string): string {
  return `memory_node_reflection_${safeId(reflectionId)}`;
}

function candidateNodeId(reflectionId: string, index: number): string {
  return `memory_node_candidate_${safeId(reflectionId)}_${index}`;
}

function affordanceGapNodeId(gapId: string): string {
  return `memory_node_affordance_${safeId(gapId)}`.slice(0, 220);
}

function sandboxDiffNodeId(sandboxId: string): string {
  return `memory_node_sandbox_diff_${safeId(sandboxId)}`.slice(0, 220);
}

function graphEdgeId(fromNodeId: string, toNodeId: string, type: string): string {
  return `memory_edge_${safeId(fromNodeId)}_${safeId(type)}_${safeId(toNodeId)}`.slice(0, 220);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}
