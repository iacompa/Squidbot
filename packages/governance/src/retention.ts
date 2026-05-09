import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_ADMIN_USER_ID, DEFAULT_TENANT_ID, type LegalHoldRecord, type RetentionPolicyRecord } from "./types.js";
import { createId, nowIso, parseJson } from "./internal.js";
import { AuditLedger } from "./auditLedger.js";

type RetentionPolicyRow = Omit<RetentionPolicyRecord, "legalHoldOverride" | "enabled"> & {
  legalHoldOverride: number;
  enabled: number;
};

type LegalHoldRow = Omit<LegalHoldRecord, "resourceSelector"> & {
  resourceSelectorJson: string;
};

export class RetentionEngine {
  private readonly audit: AuditLedger;

  constructor(private readonly database: SquidDatabase) {
    this.audit = new AuditLedger(database);
  }

  createPolicy(input: { tenantId?: string; name: string; resourceType: string; dataClassification?: string; retentionDays: number; action: RetentionPolicyRecord["action"]; legalHoldOverride?: boolean }): RetentionPolicyRecord {
    const now = nowIso();
    const id = createId("retention_policy");
    this.database.db
      .prepare(
        `INSERT INTO retention_policies (id, tenantId, name, resourceType, dataClassification, retentionDays, action, legalHoldOverride, enabled, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      )
      .run(id, input.tenantId ?? DEFAULT_TENANT_ID, input.name, input.resourceType, input.dataClassification ?? "internal", input.retentionDays, input.action, input.legalHoldOverride ? 1 : 0, now, now);
    this.audit.append({
      tenantId: input.tenantId,
      actorType: "user",
      actorId: DEFAULT_ADMIN_USER_ID,
      action: "retention.policy.create",
      resourceType: "retentionPolicy",
      resourceId: id,
      outcome: "created",
      detail: input
    });
    return this.listPolicies(input.tenantId)[0];
  }

  listPolicies(tenantId = DEFAULT_TENANT_ID): RetentionPolicyRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM retention_policies WHERE tenantId = ? ORDER BY createdAt DESC`).all(tenantId) as RetentionPolicyRow[];
    return rows.map(mapPolicy);
  }

  dryRun(tenantId = DEFAULT_TENANT_ID): Array<{ policyId: string; resourceType: string; action: string; matchedCount: number; legalHoldBlocked: boolean }> {
    const hasActiveHold = this.listLegalHolds(tenantId).some((hold) => hold.status === "active");
    return this.listPolicies(tenantId)
      .filter((policy) => policy.enabled)
      .map((policy) => ({
        policyId: policy.id,
        resourceType: policy.resourceType,
        action: policy.action,
        matchedCount: this.estimateResourceCount(policy.resourceType),
        legalHoldBlocked: hasActiveHold && !policy.legalHoldOverride
      }));
  }

  apply(tenantId = DEFAULT_TENANT_ID): { applied: number; blockedByLegalHold: number; results: ReturnType<RetentionEngine["dryRun"]> } {
    const results = this.dryRun(tenantId);
    const applied = results.filter((result) => !result.legalHoldBlocked && result.action !== "keep").length;
    const blockedByLegalHold = results.filter((result) => result.legalHoldBlocked).length;
    this.audit.append({
      tenantId,
      actorType: "user",
      actorId: DEFAULT_ADMIN_USER_ID,
      action: "retention.apply",
      resourceType: "tenant",
      resourceId: tenantId,
      outcome: "completed",
      detail: { applied, blockedByLegalHold, results }
    });
    return { applied, blockedByLegalHold, results };
  }

  createLegalHold(input: { tenantId?: string; name: string; description?: string; selector?: Record<string, unknown>; createdBy?: string }): LegalHoldRecord {
    const now = nowIso();
    const id = createId("legal_hold");
    this.database.db
      .prepare(
        `INSERT INTO legal_holds (id, tenantId, name, description, resourceSelectorJson, status, createdBy, createdAt)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(id, input.tenantId ?? DEFAULT_TENANT_ID, input.name, input.description ?? null, JSON.stringify(input.selector ?? {}), input.createdBy ?? DEFAULT_ADMIN_USER_ID, now);
    return this.listLegalHolds(input.tenantId)[0];
  }

  releaseLegalHold(id: string): LegalHoldRecord {
    const now = nowIso();
    this.database.db.prepare(`UPDATE legal_holds SET status = 'released', releasedAt = ? WHERE id = ?`).run(now, id);
    const hold = this.database.db.prepare(`SELECT * FROM legal_holds WHERE id = ?`).get(id) as LegalHoldRow | undefined;
    if (!hold) {
      throw new Error(`Legal hold not found: ${id}`);
    }
    return mapLegalHold(hold);
  }

  listLegalHolds(tenantId = DEFAULT_TENANT_ID): LegalHoldRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM legal_holds WHERE tenantId = ? ORDER BY createdAt DESC`).all(tenantId) as LegalHoldRow[];
    return rows.map(mapLegalHold);
  }

  private estimateResourceCount(resourceType: string): number {
    const tableByType: Record<string, string> = {
      trace: "traces",
      event: "events",
      memory: "memories_nodes",
      reflection: "reflections",
      gap: "affordance_gaps",
      message: "messaging_events",
      evalRun: "eval_runs",
      sandbox: "sandboxes",
      audit: "audit_ledger"
    };
    const table = tableByType[resourceType];
    if (!table) {
      return 0;
    }
    return (this.database.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
  }
}

function mapPolicy(row: RetentionPolicyRow): RetentionPolicyRecord {
  return {
    ...row,
    legalHoldOverride: Boolean(row.legalHoldOverride),
    enabled: Boolean(row.enabled)
  };
}

function mapLegalHold(row: LegalHoldRow): LegalHoldRecord {
  return {
    ...row,
    resourceSelector: parseJson(row.resourceSelectorJson, {})
  };
}
