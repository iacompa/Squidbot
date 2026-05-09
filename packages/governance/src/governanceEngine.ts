import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_ADMIN_USER_ID, DEFAULT_TENANT_ID, type GovernancePolicyInput } from "./types.js";
import { IdentityStore } from "./identity.js";
import { GovernancePolicyEngine } from "./policyEngine.js";
import { GovernanceEnforcer } from "./enforcement.js";
import { SecretVault } from "./secretVault.js";
import { AuditLedger } from "./auditLedger.js";
import { RetentionEngine } from "./retention.js";
import { LineageRecorder } from "./lineage.js";
import { N8nGovernanceBridge } from "./n8nBridge.js";
import { policyPacks } from "./policyPacks.js";

export class GovernanceEngine {
  readonly identities: IdentityStore;
  readonly policies: GovernancePolicyEngine;
  readonly enforcer: GovernanceEnforcer;
  readonly secrets: SecretVault;
  readonly audit: AuditLedger;
  readonly retention: RetentionEngine;
  readonly lineage: LineageRecorder;
  readonly n8n: N8nGovernanceBridge;

  constructor(private readonly database: SquidDatabase, masterKey?: string) {
    this.identities = new IdentityStore(database);
    this.policies = new GovernancePolicyEngine(database);
    this.enforcer = new GovernanceEnforcer(this.policies);
    this.secrets = new SecretVault(database, masterKey);
    this.audit = new AuditLedger(database);
    this.retention = new RetentionEngine(database);
    this.lineage = new LineageRecorder(database);
    this.n8n = new N8nGovernanceBridge(database);
  }

  bootstrap(): ReturnType<IdentityStore["bootstrap"]> {
    const result = this.identities.bootstrap();
    if (!this.n8n.listIntegrations(result.tenantId).some((integration) => integration.id === "n8n_integration_compliance_alerts")) {
      this.n8n.createIntegration({
        id: "n8n_integration_compliance_alerts",
        tenantId: result.tenantId,
        name: "Compliance Alerts",
        direction: "inbound",
        events: ["audit.export.requested", "policy.violation", "approval.requested", "budget.alert"],
        actions: ["audit.request", "n8n.receive"],
        enabled: true
      });
    }
    this.audit.append({
      tenantId: result.tenantId,
      actorType: "system",
      actorId: "system",
      action: "governance.bootstrap",
      resourceType: "tenant",
      resourceId: result.tenantId,
      outcome: "completed",
      source: "bootstrap",
      detail: result
    });
    return result;
  }

  status(tenantId = DEFAULT_TENANT_ID): {
    tenantId: string;
    users: number;
    roles: number;
    decisions: number;
    auditEntries: number;
    secrets: number;
    retentionPolicies: number;
    legalHolds: number;
    n8nIntegrations: number;
    policyPacks: number;
  } {
    return {
      tenantId,
      users: this.identities.listUsers(tenantId).length,
      roles: this.identities.listRoles(tenantId).length,
      decisions: this.policies.listDecisions(1000).length,
      auditEntries: this.audit.latest(1000, tenantId).length,
      secrets: this.secrets.listSecrets(tenantId).length,
      retentionPolicies: this.retention.listPolicies(tenantId).length,
      legalHolds: this.retention.listLegalHolds(tenantId).length,
      n8nIntegrations: this.n8n.listIntegrations(tenantId).length,
      policyPacks: policyPacks.length
    };
  }

  decide(input: GovernancePolicyInput): ReturnType<GovernancePolicyEngine["decide"]> {
    const decision = this.policies.decide(input);
    if (decision.decision !== "allow") {
      this.audit.append({
        tenantId: decision.tenantId,
        actorType: input.actor.type,
        actorId: input.actor.id,
        action: input.action,
        resourceType: input.resource.type,
        resourceId: input.resource.id,
        outcome: decision.decision,
        policyDecisionId: decision.id ?? null,
        source: input.context?.source ?? "governance",
        dataClassification: input.context?.dataClassification ?? "internal",
        detail: { reason: decision.reason, matchedPolicies: decision.matchedPolicies, obligations: decision.obligations }
      });
    }
    return decision;
  }

  seedExampleLineage(runId: string, tenantId = DEFAULT_TENANT_ID): void {
    this.lineage.record({ tenantId, sourceType: "userMessage", sourceId: runId, targetType: "modelCall", targetId: `${runId}:model`, relationship: "prompted", metadata: { runId } });
    this.lineage.record({ tenantId, sourceType: "modelCall", sourceId: `${runId}:model`, targetType: "toolCall", targetId: `${runId}:tool`, relationship: "proposed", metadata: { runId } });
    this.lineage.record({ tenantId, sourceType: "toolCall", sourceId: `${runId}:tool`, targetType: "trace", targetId: runId, relationship: "recorded_in", metadata: { runId } });
  }

  auditSecretRead(secretName: string, reveal: boolean): void {
    this.audit.append({
      actorType: "user",
      actorId: DEFAULT_ADMIN_USER_ID,
      action: reveal ? "secret.reveal" : "secret.read",
      resourceType: "secret",
      resourceId: secretName,
      outcome: reveal ? "revealed" : "redacted",
      detail: { secretName, reveal }
    });
  }
}
