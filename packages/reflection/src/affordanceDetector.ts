import type {
  AffordanceGapInput,
  AffordanceGapRecord,
  AffordanceGapSeverity,
  AffordanceGapStatus,
  AffordanceGapType,
  SquidDatabase
} from "@squidbot/db";

export const affordanceGapTypes = [
  "missingTool",
  "missingSkill",
  "missingPermission",
  "missingConnector",
  "incorrectAssumption",
  "environmentError",
  "missingContext"
] as const;

export const affordanceGapSeverities = ["low", "medium", "high"] as const;
export const affordanceGapStatuses = ["open", "resolved", "wontfix"] as const;

export type DetectorEvent = {
  id: string;
  type: string;
  data: Record<string, unknown>;
};

export type DetectorToolResult = {
  callId: string;
  toolName: string;
  ok: boolean;
  output: unknown;
};

export type ReflectionLike = {
  id?: string;
  missingTools?: unknown[];
  missingPermissions?: unknown[];
  missingContext?: unknown[];
  failureModes?: unknown[];
};

export type AffordanceGapDraft = Omit<AffordanceGapInput, "id" | "createdAt"> & {
  context: Record<string, unknown>;
};

export type DetectAffordanceGapsInput = {
  runId: string;
  sessionId?: string;
  reflectionId?: string | null;
  task: string;
  events?: DetectorEvent[];
  toolResults?: DetectorToolResult[];
  reflection?: ReflectionLike;
};

export function assertAffordanceGapType(value: string): AffordanceGapType {
  if ((affordanceGapTypes as readonly string[]).includes(value)) {
    return value as AffordanceGapType;
  }
  throw new Error(`Invalid affordance gap type: ${value}`);
}

export function assertAffordanceGapSeverity(value: string): AffordanceGapSeverity {
  if ((affordanceGapSeverities as readonly string[]).includes(value)) {
    return value as AffordanceGapSeverity;
  }
  throw new Error(`Invalid affordance gap severity: ${value}`);
}

export function assertAffordanceGapStatus(value: string): AffordanceGapStatus {
  if ((affordanceGapStatuses as readonly string[]).includes(value)) {
    return value as AffordanceGapStatus;
  }
  throw new Error(`Invalid affordance gap status: ${value}`);
}

export function detectAffordanceGaps(input: DetectAffordanceGapsInput): AffordanceGapDraft[] {
  const drafts = new Map<string, AffordanceGapDraft>();

  const add = (draft: AffordanceGapDraft): void => {
    const type = assertAffordanceGapType(draft.type);
    const severity = assertAffordanceGapSeverity(draft.severity);
    const name = assertNonEmpty(draft.name, "name");
    const key = `${type}:${name}`;
    if (drafts.has(key)) {
      return;
    }

    drafts.set(key, {
      ...draft,
      type,
      severity,
      name,
      description: assertNonEmpty(draft.description, "description"),
      status: draft.status ?? "open",
      runId: input.runId,
      reflectionId: input.reflectionId ?? draft.reflectionId ?? null,
      context: {
        task: input.task,
        ...draft.context
      }
    });
  };

  for (const event of input.events ?? []) {
    const toolName = stringValue(event.data.toolName);
    const reason = stringValue(event.data.reason) ?? stringValue(event.data.message) ?? "";
    const connectorName = stringValue(event.data.connectorName);
    const operationName = stringValue(event.data.operationName);

    if (event.type === "tool.denied" && toolName) {
      add(classifyDeniedTool(input, toolName, reason, event));
    }

    if (event.type === "connector.denied") {
      add({
        runId: input.runId,
        reflectionId: input.reflectionId ?? null,
        type: "missingPermission",
        name: connectorName && operationName ? `${connectorName}.${operationName}` : toolName ?? "connector.write",
        severity: "medium",
        description: "A connector operation was blocked because it needs explicit approval or a broader connector policy.",
        context: {
          sourceEventId: event.id,
          connectorName,
          operationName,
          toolName,
          reason,
          args: event.data.args
        }
      });
    }
  }

  for (const result of input.toolResults ?? []) {
    if (result.ok) {
      continue;
    }

    const error = errorMessage(result.output);
    if (isMissingTool(error)) {
      add(missingToolDraft(input, result.toolName, "Tool result reported that the requested tool is not registered.", {
        callId: result.callId,
        error
      }));
      continue;
    }

    if (isMissingConnectorName(result.toolName, error)) {
      add({
        runId: input.runId,
        reflectionId: input.reflectionId ?? null,
        type: "missingConnector",
        name: connectorNameFromTool(result.toolName),
        severity: "medium",
        description: "A connector capability was requested but no matching connector tool was available.",
        context: {
          callId: result.callId,
          toolName: result.toolName,
          error
        }
      });
      continue;
    }

    if (isEnvironmentError(error)) {
      add({
        runId: input.runId,
        reflectionId: input.reflectionId ?? null,
        type: "environmentError",
        name: result.toolName,
        severity: "medium",
        description: "A tool failed because the local environment or referenced resource was unavailable.",
        context: {
          callId: result.callId,
          toolName: result.toolName,
          error
        }
      });
    }
  }

  for (const item of input.reflection?.missingTools ?? []) {
    const text = String(item);
    if (/patch application/i.test(text)) {
      add(missingToolDraft(input, "workspace.applyPatch", text, { reflectionField: "missingTools" }));
    } else {
      add(missingToolDraft(input, text, text, { reflectionField: "missingTools" }));
    }
  }

  for (const item of input.reflection?.missingPermissions ?? []) {
    const text = String(item);
    add({
      runId: input.runId,
      reflectionId: input.reflectionId ?? null,
      type: "missingPermission",
      name: /filesystem/i.test(text) ? "filesystem.write" : text,
      severity: "medium",
      description: text,
      context: {
        reflectionField: "missingPermissions"
      }
    });
  }

  for (const item of input.reflection?.missingContext ?? []) {
    const text = String(item);
    add({
      runId: input.runId,
      reflectionId: input.reflectionId ?? null,
      type: "missingContext",
      name: text.includes("test command") ? "testCommand" : "task.context",
      severity: "low",
      description: text,
      context: {
        reflectionField: "missingContext"
      }
    });
  }

  return [...drafts.values()];
}

export function createAffordanceGap(database: SquidDatabase, input: AffordanceGapInput): AffordanceGapRecord {
  return database.insertAffordanceGap({
    ...input,
    type: assertAffordanceGapType(input.type),
    severity: assertAffordanceGapSeverity(input.severity),
    status: input.status ? assertAffordanceGapStatus(input.status) : "open",
    name: assertNonEmpty(input.name, "name"),
    description: assertNonEmpty(input.description, "description")
  });
}

export function persistDetectedAffordanceGaps(
  database: SquidDatabase,
  input: DetectAffordanceGapsInput
): AffordanceGapRecord[] {
  const now = new Date().toISOString();
  const gaps = detectAffordanceGaps(input).map((draft) =>
    createAffordanceGap(database, {
      ...draft,
      id: affordanceGapId(input.runId, draft.type, draft.name),
      createdAt: now
    })
  );

  if (input.reflectionId) {
    database.updateReflectionAffordances(input.reflectionId, unique(gaps.map((gap) => gap.type)), gaps.map((gap) => gap.id));
  }

  for (const gap of gaps) {
    if (input.sessionId) {
      database.appendEvent({
        id: eventIdFromGap(gap.id),
        timestamp: gap.createdAt,
        sessionId: input.sessionId,
        type: "affordance.gap",
        data: {
          runId: input.runId,
          reflectionId: input.reflectionId ?? null,
          gap
        }
      });
    }
  }

  return gaps;
}

export function resolveAffordanceGap(
  database: SquidDatabase,
  gapId: string,
  status: Exclude<AffordanceGapStatus, "open"> = "resolved"
): AffordanceGapRecord {
  return database.resolveAffordanceGap(gapId, status);
}

function classifyDeniedTool(input: DetectAffordanceGapsInput, toolName: string, reason: string, event: DetectorEvent): AffordanceGapDraft {
  if (isMissingTool(reason)) {
    if (toolName.startsWith("connector.")) {
      return {
        runId: input.runId,
        reflectionId: input.reflectionId ?? null,
        type: "missingConnector",
        name: connectorNameFromTool(toolName),
        severity: "medium",
        description: `Connector tool ${toolName} was requested but is not registered.`,
        context: {
          sourceEventId: event.id,
          toolName,
          reason
        }
      };
    }

    return missingToolDraft(input, toolName, `Tool ${toolName} was requested but is not registered.`, {
      sourceEventId: event.id,
      reason
    });
  }

  return {
    runId: input.runId,
    reflectionId: input.reflectionId ?? null,
    type: "missingPermission",
    name: permissionName(toolName, reason),
    severity: "medium",
    description: reason || `Tool ${toolName} was blocked by policy.`,
    context: {
      sourceEventId: event.id,
      toolName,
      reason,
      args: event.data.args
    }
  };
}

function missingToolDraft(
  input: DetectAffordanceGapsInput,
  name: string,
  description: string,
  context: Record<string, unknown>
): AffordanceGapDraft {
  return {
    runId: input.runId,
    reflectionId: input.reflectionId ?? null,
    type: "missingTool",
    name,
    severity: "medium",
    description,
    context
  };
}

export function affordanceGapId(runId: string, type: string, name: string): string {
  return `affordance_gap_${safeId(runId)}_${safeId(type)}_${safeId(name)}`.slice(0, 220);
}

function eventIdFromGap(gapId: string): string {
  return `evt_${safeId(gapId)}`.slice(0, 220);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function assertNonEmpty(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error(`Affordance gap ${field} must be non-empty.`);
  }
  return value.trim();
}

function errorMessage(output: unknown): string {
  if (!output || typeof output !== "object") {
    return "";
  }
  const record = output as Record<string, unknown>;
  return typeof record.error === "string" ? record.error : "";
}

function isMissingTool(message: string): boolean {
  return /not registered|unknown tool|tool not found/i.test(message);
}

function isMissingConnectorName(toolName: string, error: string): boolean {
  return toolName.startsWith("connector.") && isMissingTool(error);
}

function isEnvironmentError(message: string): boolean {
  return /enoent|no such file|not found|unavailable|timed out|network|econnrefused/i.test(message);
}

function connectorNameFromTool(toolName: string): string {
  const [, connectorName, operationName] = toolName.split(".");
  return connectorName && operationName ? `${connectorName}.${operationName}` : connectorName ?? toolName;
}

function permissionName(toolName: string, reason: string): string {
  if (/filesystem|write/i.test(reason)) {
    return "filesystem.write";
  }
  if (/connector/i.test(reason)) {
    return toolName.startsWith("connector.") ? connectorNameFromTool(toolName) : "connector.write";
  }
  return toolName;
}
