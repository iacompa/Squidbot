import type { ConnectorEndpoint, ConnectorManifest, ConnectorPermission } from "./manifest.js";

export type ProfileSensitivity = "standard" | "sensitive" | "regulated" | "air-gapped";

export type PolicyDecision =
  | { mode: "execute" }
  | { mode: "queue"; reason: string; riskLevel: "low" | "medium" | "high" | "critical" }
  | { mode: "deny"; reason: string };

function findPermission(manifest: ConnectorManifest, name: string): ConnectorPermission | undefined {
  return manifest.permissions.find((p) => p.name === name);
}

function isWriteOperation(manifest: ConnectorManifest, operationId: string): boolean {
  return manifest.readWrite?.write?.includes(operationId) ?? false;
}

/**
 * Decides whether a connector operation should execute, queue for human
 * approval, or be denied outright. The decision is a function of three
 * inputs: the active profile's sensitivity setting, the operation's
 * read/write classification (from manifest.readWrite), and whether the
 * operation's permission is flagged requiresApproval=true.
 *
 * The matrix:
 *   sensitivity        reads     writes    requiresApproval=true
 *   ─────────────────────────────────────────────────────────────
 *   standard           execute   execute   queue
 *   sensitive          execute   queue     queue
 *   regulated          queue     queue     queue
 *   air-gapped         deny      deny      deny
 *
 * Air-gapped is the hard wall — fixture mode is still allowed but real HTTP
 * is forbidden regardless of key. Tools.ts gates the entire real-call path
 * behind this decision and never reaches the transport layer for "deny".
 */
export function decide(
  manifest: ConnectorManifest,
  endpoint: ConnectorEndpoint,
  sensitivity: ProfileSensitivity
): PolicyDecision {
  if (sensitivity === "air-gapped") {
    return {
      mode: "deny",
      reason: "Real HTTP is disabled by the active profile's air-gapped sensitivity."
    };
  }

  const permission = findPermission(manifest, endpoint.permission ?? "");
  const riskLevel = permission?.riskLevel ?? "medium";

  // requiresApproval is always a queue override regardless of profile.
  if (permission?.requiresApproval) {
    return {
      mode: "queue",
      reason: `Operation requires approval (permission "${endpoint.permission}").`,
      riskLevel
    };
  }

  const isWrite = isWriteOperation(manifest, endpoint.operationId);

  if (sensitivity === "regulated") {
    return {
      mode: "queue",
      reason: "Regulated sensitivity queues all operations for approval.",
      riskLevel
    };
  }
  if (sensitivity === "sensitive" && isWrite) {
    return {
      mode: "queue",
      reason: "Sensitive sensitivity queues write operations for approval.",
      riskLevel
    };
  }
  return { mode: "execute" };
}
