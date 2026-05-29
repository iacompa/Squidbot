import type { GovernanceEnforcer } from "@squidbot/governance";

export type ConnectorApprovalGateResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Governance gate for the connector-approval execution path.
 *
 * An operator approving a queued connector call must not bypass governance:
 * the same ABAC/RBAC policy the AgentRuntime applies to a `connector.*` tool
 * call is re-checked here before the HTTP call fires. We mirror the runtime's
 * gate exactly — `action: "tool.invoke"`, `resource: connector.<name>.<op>` —
 * so a policy that denies the connector tool denies it on both paths, and one
 * that allows it stays consistent.
 */
export function checkConnectorApprovalGovernance(
  enforcer: GovernanceEnforcer,
  input: { connectorName: string; operationId: string; sessionId?: string }
): ConnectorApprovalGateResult {
  try {
    enforcer.assertAllowed({
      actor: { type: "system", id: `approval:${input.sessionId ?? "operator"}` },
      action: "tool.invoke",
      resource: { type: "tool", id: `connector.${input.connectorName}.${input.operationId}` }
    });
    return { allowed: true };
  } catch (err) {
    return { allowed: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
