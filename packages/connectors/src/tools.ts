import type { JsonObject, ToolRegistry } from "@squidbot/core";
import type { ToolContext } from "@squidbot/core";
import { getFixtureResponse } from "./fixture.js";
import type { ConnectorEndpoint, ConnectorManifest, ConnectorPermission } from "./manifest.js";
import type { ConnectorRegistry } from "./registry.js";

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

  const isWrite = manifest.readWrite.write.includes(endpoint.operationId) || !manifest.readWrite.read.includes(endpoint.operationId);
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
    args,
    mode,
    costOwner: manifest.costOwner,
    dataClassifications: endpoint.dataClassifications ?? manifest.dataClassifications
  });

  if (manifest.fixtureMode) {
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

  const baseUrl = context.getSetting?.<string>(`${manifest.name}.baseUrl`);
  if (!baseUrl) {
    const response = {
      connectorName: manifest.name,
      operationName: endpoint.operationId,
      mode: "dry-run",
      fixture: false,
      executed: false,
      reason: "No connector base URL is configured. Set one with settings before real calls."
    };
    emitDeveloperWorkflowEvent(manifest, endpoint, response, context);
    return response;
  }

  const response = {
    connectorName: manifest.name,
    operationName: endpoint.operationId,
    mode: "dry-run",
    fixture: false,
    executed: false,
    reason: "Real connector transport is intentionally dry-run in this phase unless a reviewed adapter is added.",
    baseUrl
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
