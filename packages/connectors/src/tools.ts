import type { JsonObject, ToolRegistry } from "@squidbot/core";
import type { ToolContext } from "@squidbot/core";
import { enqueueApproval } from "./approvalQueue.js";
import { getFixtureResponse } from "./fixture.js";
import { executeGithubReadRequest, executeRealHttpCall, isGithubReadOperation } from "./httpTransport.js";
import type { ConnectorEndpoint, ConnectorManifest, ConnectorPermission } from "./manifest.js";
import type { ConnectorRegistry } from "./registry.js";
import { decide as decideSensitivityPolicy, type ProfileSensitivity } from "./sensitivityPolicy.js";

export function registerConnectorTools(toolRegistry: ToolRegistry, connectorRegistry: ConnectorRegistry): void {
  for (const manifest of connectorRegistry.listConnectors()) {
    for (const endpoint of manifest.endpoints) {
      const permission = manifest.permissions.find((candidate) => candidate.name === endpoint.permission);
      if (!permission) {
        continue;
      }

      registerConnectorTool(toolRegistry, manifest, endpoint, permission);
    }
  }
}

function registerConnectorTool(
  toolRegistry: ToolRegistry,
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  permission: ConnectorPermission
): void {
  const toolName = connectorToolName(manifest.name, endpoint.operationId);
  if (toolRegistry.get(toolName)) {
    return;
  }

  const isReadOp = manifest.readWrite.read.includes(endpoint.operationId);
  const isWriteOp = manifest.readWrite.write.includes(endpoint.operationId);
  if (!isReadOp && !isWriteOp) {
    throw new Error(
      `Connector ${manifest.name} endpoint ${endpoint.operationId} is not listed in readWrite.read or readWrite.write. Classify it explicitly.`
    );
  }
  const isWrite = isWriteOp;
  toolRegistry.register({
    name: toolName,
    description: `${manifest.name}: ${endpoint.description ?? endpoint.operationId}`,
    inputSchema: endpoint.inputSchema,
    permissionScopes: [isWrite ? "connector.write" : "connector.read", `connector:${manifest.name}:${endpoint.permission}`],
    riskLevel: permission.riskLevel,
    metadata: {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      requiresApproval: permission.requiresApproval,
      fixtureMode: manifest.fixtureMode,
      costOwner: manifest.costOwner,
      dataClassifications: endpoint.dataClassifications ?? manifest.dataClassifications
    },
    handler: async (args: JsonObject, context: ToolContext) => executeConnectorOperation(manifest, endpoint, args, context)
  });
}

const SECRET_ARG_PATTERN = /^(.*(?:api[_-]?key|secret|token|password|passwd|authorization|auth|credentials?|bearer|private[_-]?key).*)$/i;

function redactArgs(args: JsonObject): JsonObject {
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(args)) {
    if (SECRET_ARG_PATTERN.test(key)) {
      out[key] = "[redacted]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactArgs(value as JsonObject);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export async function executeConnectorOperation(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  args: JsonObject,
  context: ToolContext
): Promise<JsonObject> {
  const mode = manifest.fixtureMode ? "fixture" : "real";
  context.emitEvent?.("connector.call", {
    connectorName: manifest.name,
    operationName: endpoint.operationId,
    method: endpoint.method,
    path: endpoint.path,
    args: redactArgs(args),
    mode,
    costOwner: manifest.costOwner,
    dataClassifications: endpoint.dataClassifications ?? manifest.dataClassifications
  });

  if (manifest.fixtureMode) {
    const token = context.getSetting?.<string>("github.apiToken") ?? context.getSetting?.<string>("github.token");
    if (isGithubReadOperation(manifest, endpoint) && token?.trim()) {
      const real = await executeGithubReadRequest(manifest, endpoint, args, context);
      emitDeveloperWorkflowEvent(manifest, endpoint, real.response ?? real, context);
      return real;
    }

    const response = getFixtureResponse(manifest, endpoint);
    context.emitEvent?.("connector.fixture", {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      fixtureSource: typeof manifest.fixtureData === "string" ? manifest.fixtureData : "manifest.fixtureData",
      response
    });
    emitDeveloperWorkflowEvent(manifest, endpoint, response, context);

    return {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode,
      fixture: true,
      response
    };
  }

  const profileSensitivity: ProfileSensitivity =
    context.getActiveProfileSensitivity?.() ?? "standard";
  const decision = decideSensitivityPolicy(manifest, endpoint, profileSensitivity);

  if (decision.mode === "deny") {
    const response = {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "denied",
      fixture: false,
      executed: false,
      reason: decision.reason
    };
    emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
    return response;
  }

  if (decision.mode === "queue") {
    if (!context.database) {
      // Defensive — once the runtime threads `database` into ToolContext
      // this branch is unreachable for production callers. Legacy code
      // paths (some tests, the dev integration helper) construct a bare
      // ToolContext without a database and would otherwise crash inside
      // enqueueApproval. Return a safe, observable response instead.
      const response = {
        connectorName: manifest.name,
        operationName: endpoint.operationId,
        mode: "queue-unavailable",
        executed: false,
        reason: "Approval queue is unavailable in this context."
      };
      emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
      return response;
    }
    const approvalId = enqueueApproval(context.database, {
      kind: "connector-call",
      title: `Allow ${manifest.name}.${endpoint.operationId}?`,
      summary: summarizeArgsForApproval(args),
      riskLevel: decision.riskLevel,
      payload: {
        connectorName: manifest.name,
        operationId: endpoint.operationId,
        args
      },
      callerSessionId: context.sessionId,
      callerRunId: context.runId
    });
    const response = {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "pending-approval",
      pending: true,
      approvalId,
      reason: decision.reason
    };
    context.emitEvent?.("connector.approval-requested", {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      approvalId,
      riskLevel: decision.riskLevel
    });
    emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
    return response;
  }

  // decision.mode === "execute"
  const baseUrl = context.getSetting?.<string>(`${manifest.name}.baseUrl`);
  const apiKey = context.getSetting?.<string>(`${manifest.name}.apiKey`) ?? null;
  if (!baseUrl) {
    const response = {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "not-configured",
      executed: false,
      reason: "No connector base URL is configured. Set one in Integrations → Connectors."
    };
    emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
    return response;
  }

  const result = await executeRealHttpCall(manifest, endpoint, args, { baseUrl, apiKey });
  context.emitEvent?.("connector.http_call", {
    connectorName: manifest.name,
    operationName: endpoint.operationId,
    method: endpoint.method,
    path: endpoint.path,
    status: result.ok ? result.status : (result.status ?? null),
    durationMs: result.durationMs,
    ok: result.ok,
    mode: "real"
  });
  const response: JsonObject = result.ok
    ? {
        connectorName: manifest.name,
        operationName: endpoint.operationId,
        mode: "real",
        executed: true,
        response: result.body as JsonObject[keyof JsonObject],
        status: result.status
      }
    : {
        connectorName: manifest.name,
        operationName: endpoint.operationId,
        mode: "real",
        executed: false,
        error: result.code,
        status: result.status ?? null,
        message: result.message
      };
  emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
  return response;
}

export function connectorToolName(connectorName: string, operationId: string): string {
  return `connector.${connectorName}.${operationId}`;
}

function emitDeveloperWorkflowEvent(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  response: unknown,
  context: ToolContext
): void {
  const operation = endpoint.operationId;
  const base = {
    connectorName: manifest.name,
    operationName: operation,
    method: endpoint.method,
    path: endpoint.path,
    response
  };

  if (isPullRequestOperation(operation)) {
    context.emitEvent?.("connector.prDrafted", {
      ...base,
      action: operation,
      prId: extractString(response, ["id", "pullRequest", "mergeRequest"]) ?? null,
      branch: extractString(response, ["branch", "sourceBranch", "head"]) ?? null,
      baseBranch: extractString(response, ["base", "targetBranch"]) ?? null,
      diffSummary: summarizeResponse(response)
    });
    return;
  }

  if (isIssueOperation(operation)) {
    context.emitEvent?.("connector.issueUpdated", {
      ...base,
      action: operation,
      issueId: extractString(response, ["id", "key", "issue"]) ?? null,
      status: extractString(response, ["status", "state"]) ?? null,
      commentSummary: operation.toLowerCase().includes("comment") ? summarizeResponse(response) : null
    });
    return;
  }

  if (isCiTriggerOperation(operation)) {
    context.emitEvent?.("connector.ciTriggered", {
      ...base,
      action: operation,
      jobId: extractString(response, ["id", "job", "workflow"]) ?? null,
      status: extractString(response, ["status", "conclusion"]) ?? null
    });
    return;
  }

  if (isCiStatusOperation(operation)) {
    context.emitEvent?.("connector.ciStatus", {
      ...base,
      action: operation,
      jobId: extractString(response, ["id", "job", "workflow"]) ?? null,
      status: extractString(response, ["status", "conclusion"]) ?? null,
      logs: extractString(response, ["logs"]) ?? null
    });
  }
}

function isPullRequestOperation(operation: string): boolean {
  const lowered = operation.toLowerCase();
  return lowered.includes("pullrequest") || lowered.includes("mergerequest") || lowered.includes("pull") || lowered.includes("merge");
}

function isIssueOperation(operation: string): boolean {
  const lowered = operation.toLowerCase();
  return !lowered.startsWith("list") && (lowered.includes("issue") || lowered.includes("label") || lowered.includes("comment"));
}

function isCiTriggerOperation(operation: string): boolean {
  const lowered = operation.toLowerCase();
  return lowered.startsWith("trigger") || lowered.startsWith("cancel");
}

function isCiStatusOperation(operation: string): boolean {
  const lowered = operation.toLowerCase();
  return lowered.includes("status") || lowered.includes("logs");
}

function extractString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const item = record[key];
    if (typeof item === "string" || typeof item === "number") {
      return String(item);
    }
  }
  return null;
}

function summarizeResponse(value: unknown): string {
  const raw = JSON.stringify(value);
  return raw.length > 240 ? `${raw.slice(0, 237)}...` : raw;
}

function summarizeArgsForApproval(args: Record<string, unknown>): string {
  const json = JSON.stringify(args);
  if (json.length <= 140) return `Args: ${json}`;
  return `Args (truncated): ${json.slice(0, 140)}…`;
}
