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

type ResourceTableSpec = {
  table: string;
  dateColumn: string;
  tenantColumn?: string;
  archiveColumn?: string;
};

const resourceTables: Record<string, ResourceTableSpec> = {
  trace: { table: "traces", dateColumn: "created_at" },
  event: { table: "events", dateColumn: "timestamp" },
  memory: { table: "memories_nodes", dateColumn: "createdAt", archiveColumn: "archivedAt" },
  reflection: { table: "reflections", dateColumn: "createdAt" },
  gap: { table: "affordance_gaps", dateColumn: "createdAt" },
  message: { table: "messaging_events", dateColumn: "createdAt" },
  evalRun: { table: "eval_runs", dateColumn: "createdAt" },
  sandbox: { table: "sandboxes", dateColumn: "createdAt" },
  audit: { table: "audit_ledger", dateColumn: "createdAt" }
};

export type RetentionApplyResult = {
  applied: number;
  blockedByLegalHold: number;
  rowsAffected: number;
  confirmed: boolean;
  results: Array<{
    policyId: string;
    resourceType: string;
    action: string;
    matchedCount: number;
    legalHoldBlocked: boolean;
    rowsAffected: number;
  }>;
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
        matchedCount: this.countRowsOlderThan(policy),
        legalHoldBlocked: hasActiveHold && !policy.legalHoldOverride
      }));
  }

  apply(tenantIdOrOptions: string | { tenantId?: string; confirm?: boolean } = DEFAULT_TENANT_ID): RetentionApplyResult {
    const options =
      typeof tenantIdOrOptions === "string"
        ? { tenantId: tenantIdOrOptions, confirm: false }
        : { tenantId: tenantIdOrOptions.tenantId ?? DEFAULT_TENANT_ID, confirm: tenantIdOrOptions.confirm === true };
    const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
    const hasActiveHold = this.listLegalHolds(tenantId).some((hold) => hold.status === "active");
    const policies = this.listPolicies(tenantId).filter((policy) => policy.enabled);

    const results: RetentionApplyResult["results"] = [];
    let totalRowsAffected = 0;

    for (const policy of policies) {
      const legalHoldBlocked = hasActiveHold && !policy.legalHoldOverride;
      const matchedCount = this.countRowsOlderThan(policy);
      let rowsAffected = 0;

      if (!legalHoldBlocked && policy.action !== "keep" && options.confirm) {
        rowsAffected = this.executeRetentionAction(policy);
      }

      totalRowsAffected += rowsAffected;
      results.push({
        policyId: policy.id,
        resourceType: policy.resourceType,
        action: policy.action,
        matchedCount,
        legalHoldBlocked,
        rowsAffected
      });
    }

    const applied = results.filter((result) => !result.legalHoldBlocked && result.action !== "keep").length;
    const blockedByLegalHold = results.filter((result) => result.legalHoldBlocked).length;

    this.audit.append({
      tenantId,
      actorType: "user",
      actorId: DEFAULT_ADMIN_USER_ID,
      action: options.confirm ? "retention.apply" : "retention.dryRun",
      resourceType: "tenant",
      resourceId: tenantId,
      outcome: options.confirm ? "applied" : "dryRun",
      detail: { applied, blockedByLegalHold, rowsAffected: totalRowsAffected, confirmed: options.confirm, results }
    });

    return { applied, blockedByLegalHold, rowsAffected: totalRowsAffected, confirmed: options.confirm, results };
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

  private cutoffIsoForPolicy(policy: RetentionPolicyRecord): string {
    const cutoffMs = Date.now() - policy.retentionDays * 24 * 60 * 60 * 1000;
    return new Date(cutoffMs).toISOString();
  }

  private countRowsOlderThan(policy: RetentionPolicyRecord): number {
    const spec = resourceTables[policy.resourceType];
    if (!spec) {
      return 0;
    }
    const cutoff = this.cutoffIsoForPolicy(policy);
    try {
      return (this.database.db
        .prepare(`SELECT COUNT(*) AS count FROM ${spec.table} WHERE ${spec.dateColumn} < ?`)
        .get(cutoff) as { count: number }).count;
    } catch {
      return 0;
    }
  }

  private executeRetentionAction(policy: RetentionPolicyRecord): number {
    const spec = resourceTables[policy.resourceType];
    if (!spec) {
      return 0;
    }
    const cutoff = this.cutoffIsoForPolicy(policy);

    if (policy.action === "delete") {
      const result = this.database.db
        .prepare(`DELETE FROM ${spec.table} WHERE ${spec.dateColumn} < ?`)
        .run(cutoff);
      return result.changes;
    }
    if (policy.action === "archive") {
      if (spec.archiveColumn) {
        const result = this.database.db
          .prepare(`UPDATE ${spec.table} SET ${spec.archiveColumn} = ? WHERE ${spec.dateColumn} < ? AND (${spec.archiveColumn} IS NULL)`)
          .run(nowIso(), cutoff);
        return result.changes;
      }
      // Tables without a soft-archive column treat archive as delete to avoid silently doing nothing.
      const result = this.database.db
        .prepare(`DELETE FROM ${spec.table} WHERE ${spec.dateColumn} < ?`)
        .run(cutoff);
      return result.changes;
    }
    if (policy.action === "anonymize") {
      // Best-effort anonymize: only memory and reflection currently have free-text titles/bodies we can blank.
      if (policy.resourceType === "memory") {
        const result = this.database.db
          .prepare(`UPDATE memories_nodes SET title = '[REDACTED]', summary = '[REDACTED]' WHERE createdAt < ?`)
          .run(cutoff);
        return result.changes;
      }
      if (policy.resourceType === "reflection") {
        const result = this.database.db
          .prepare(`UPDATE reflections SET summary = '[REDACTED]' WHERE createdAt < ?`)
          .run(cutoff);
        return result.changes;
      }
      // Fall through to delete for resource types we don't know how to anonymize.
      const result = this.database.db
        .prepare(`DELETE FROM ${spec.table} WHERE ${spec.dateColumn} < ?`)
        .run(cutoff);
      return result.changes;
    }
    return 0;
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
