import type { SquidDatabase } from "@squidbot/db";
import { anyPermissionAllows, isHighRiskAction, isWriteLikeAction } from "./rbac.js";
import { requiresSandbox, violatesExternalModelRestriction, violatesZeroSpend } from "./abac.js";
import { DEFAULT_TENANT_ID, type GovernanceDecision, type GovernancePolicyInput } from "./types.js";
import { createId, nowIso, parseJson } from "./internal.js";
import { IdentityStore } from "./identity.js";
import { redactValue } from "./redaction.js";

type PolicyRow = {
  id: string;
  name: string;
  effect: GovernanceDecision["decision"];
  resourceType: string;
  actionPattern: string;
  conditionJson: string;
  priority: number;
  enabled: number;
};

export class GovernancePolicyEngine {
  private readonly identity: IdentityStore;

  constructor(private readonly database: SquidDatabase) {
    this.identity = new IdentityStore(database);
  }

  decide(input: GovernancePolicyInput, options: { persist?: boolean } = {}): GovernanceDecision {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const roles = this.identity.getActorRoleNames(input.actor.type, input.actor.id, tenantId);
    const permissions = this.permissionsForRoles(roles, tenantId);
    const matchedPolicies: string[] = [];
    const obligations: string[] = [];

    let decision: GovernanceDecision["decision"] = "deny";
    let reason = "No matching role permission.";

    // Tenant isolation (G8): a resource that declares an owning tenant
    // (`resource.attributes.tenantId`) can only be reached from within that
    // tenant. Enforced BEFORE any role grant, so even an owner cannot cross
    // tenants. Resources without a tenantId attribute are unrestricted — the
    // single-tenant / backward-compatible default.
    const resourceTenantId =
      typeof input.resource.attributes?.tenantId === "string" ? (input.resource.attributes.tenantId as string) : null;
    const crossTenant = resourceTenantId !== null && resourceTenantId !== tenantId;
    if (crossTenant) {
      reason = `Cross-tenant access denied: ${tenantId} → ${resourceTenantId}`;
      matchedPolicies.push("tenant.isolation");
    }

    if (!crossTenant) {
      if (violatesExternalModelRestriction(input)) {
        decision = "deny";
        reason = "Restricted or secret data cannot be sent to an external/paid model provider.";
        matchedPolicies.push("abac.restrictedDataNoExternalModel");
      } else if (violatesZeroSpend(input)) {
        decision = "deny";
        reason = "Zero-spend governance denies user-paid provider usage by default.";
        matchedPolicies.push("abac.zeroSpendDefault");
      } else if (roles.includes("owner") || anyPermissionAllows(permissions, input.action) || (input.action.endsWith(".read") && anyPermissionAllows(permissions, `${input.resource.type}.read`)) || (input.action.endsWith(".read") && anyPermissionAllows(permissions, "*.read"))) {
        decision = "allow";
        reason = "Allowed by assigned governance role.";
        matchedPolicies.push(`rbac.${roles.join("+") || "none"}`);
      }
    }

    for (const policy of this.matchingAbacPolicies(input, tenantId)) {
      matchedPolicies.push(`abac.${policy.name}`);
      if (policy.effect === "deny") {
        decision = "deny";
        reason = policy.name;
        break;
      }
      if (policy.effect === "requireApproval" && decision === "allow") {
        decision = "requireApproval";
        reason = policy.name;
        obligations.push("approval");
      }
      if (policy.effect === "requireSandbox" && decision === "allow") {
        decision = "requireSandbox";
        reason = policy.name;
        obligations.push("sandbox");
      }
      if (policy.effect === "redact") {
        obligations.push("redact");
      }
    }

    if (decision === "allow" && isWriteLikeAction(input.action) && requiresSandbox(input)) {
      decision = "requireSandbox";
      reason = "Write-like action requires sandbox staging.";
      obligations.push("sandbox");
      matchedPolicies.push("abac.sandboxForWrites");
    }

    if ((decision === "allow" || decision === "requireSandbox") && isHighRiskAction(input.action, input.context?.riskLevel)) {
      decision = "requireApproval";
      reason = "High-risk action requires approval.";
      obligations.push("approval");
      matchedPolicies.push("abac.highRiskApproval");
    }

    if ((input.actor.type === "serviceAccount" || input.actor.id.includes("n8n")) && isHighRiskAction(input.action, input.context?.riskLevel)) {
      decision = "deny";
      reason = "Service automation cannot perform high-risk governance actions by default.";
      matchedPolicies.push("abac.serviceAutomationLowRiskOnly");
    }

    const output: GovernanceDecision = {
      tenantId,
      decision,
      reason,
      matchedPolicies: [...new Set(matchedPolicies)],
      obligations: [...new Set(obligations)]
    };

    if (options.persist ?? true) {
      return this.persistDecision(input, output);
    }
    return output;
  }

  listDecisions(
    limit = 20,
    tenantId: string = DEFAULT_TENANT_ID
  ): Array<GovernanceDecision & { actorId: string; action: string; resourceType: string; resourceId: string; createdAt: string }> {
    return this.database.db
      .prepare(
        `SELECT id, tenantId, actorId, action, resourceType, resourceId, decision, reason, matchedPoliciesJson, contextJson, createdAt
         FROM policy_decisions
         WHERE tenantId = ?
         ORDER BY createdAt DESC
         LIMIT ?`
      )
      .all(tenantId, limit)
      .map((row) => {
        const typed = row as {
          id: string;
          tenantId: string;
          actorId: string;
          action: string;
          resourceType: string;
          resourceId: string;
          decision: GovernanceDecision["decision"];
          reason: string;
          matchedPoliciesJson: string;
          contextJson: string;
          createdAt: string;
        };
        const context = parseJson<{ obligations?: string[] }>(typed.contextJson, {});
        return {
          id: typed.id,
          tenantId: typed.tenantId,
          actorId: typed.actorId,
          action: typed.action,
          resourceType: typed.resourceType,
          resourceId: typed.resourceId,
          decision: typed.decision,
          reason: typed.reason,
          matchedPolicies: parseJson(typed.matchedPoliciesJson, []),
          obligations: Array.isArray(context.obligations) ? context.obligations : [],
          createdAt: typed.createdAt
        };
      });
  }

  private permissionsForRoles(roleNames: string[], tenantId: string): string[] {
    const permissions = new Set<string>();
    for (const roleName of roleNames) {
      const role = this.identity.getRole(roleName, tenantId);
      for (const permission of role?.permissions ?? []) {
        permissions.add(permission);
      }
    }
    return [...permissions];
  }

  private matchingAbacPolicies(input: GovernancePolicyInput, tenantId: string): PolicyRow[] {
    const rows = this.database.db
      .prepare(`SELECT * FROM abac_policies WHERE tenantId = ? AND enabled = 1 ORDER BY priority ASC, createdAt ASC`)
      .all(tenantId) as PolicyRow[];
    return rows.filter((row) => {
      if (row.resourceType !== "*" && row.resourceType !== input.resource.type) {
        return false;
      }
      const regex = new RegExp(`^${row.actionPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
      if (!regex.test(input.action)) {
        return false;
      }
      const condition = parseJson<Record<string, unknown>>(row.conditionJson, {});
      if (condition.riskLevel && condition.riskLevel !== input.context?.riskLevel) {
        return false;
      }
      if (condition.source && condition.source !== input.context?.source) {
        return false;
      }
      return true;
    });
  }

  private persistDecision(input: GovernancePolicyInput, decision: GovernanceDecision): GovernanceDecision {
    const id = createId("policy_decision");
    const createdAt = nowIso();
    const redactedContext = redactValue({ ...(input.context ?? {}), obligations: decision.obligations });
    this.database.db
      .prepare(
        `INSERT INTO policy_decisions (
          id, tenantId, actorType, actorId, action, resourceType, resourceId, decision,
          reason, matchedPoliciesJson, contextJson, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        decision.tenantId,
        input.actor.type,
        input.actor.id,
        input.action,
        input.resource.type,
        input.resource.id,
        decision.decision,
        decision.reason,
        JSON.stringify(decision.matchedPolicies),
        JSON.stringify(redactedContext.value),
        createdAt
      );
    return { ...decision, id, createdAt };
  }
}
