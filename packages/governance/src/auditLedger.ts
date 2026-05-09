import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_TENANT_ID, type AuditEntryInput, type AuditEntryRecord } from "./types.js";
import { createId, nowIso, parseJson, redactForStorage, sha256, stableJson } from "./internal.js";

type AuditRow = {
  id: string;
  tenantId: string;
  sequence: number;
  actorType: AuditEntryRecord["actorType"];
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: string;
  eventId: string | null;
  runId: string | null;
  traceId: string | null;
  policyDecisionId: string | null;
  source: string;
  dataClassification: string;
  redactedDetailJson: string;
  previousHash: string | null;
  entryHash: string;
  createdAt: string;
};

export class AuditLedger {
  constructor(private readonly database: SquidDatabase) {}

  append(input: AuditEntryInput): AuditEntryRecord {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const latest = this.latestRow(tenantId);
    const sequence = (latest?.sequence ?? 0) + 1;
    const createdAt = nowIso();
    const id = createId("audit");
    const redactedDetail = redactForStorage(input.detail ?? {});
    const previousHash = latest?.entryHash ?? null;
    const hashInput = {
      id,
      tenantId,
      sequence,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome,
      eventId: input.eventId ?? null,
      runId: input.runId ?? null,
      traceId: input.traceId ?? null,
      policyDecisionId: input.policyDecisionId ?? null,
      source: input.source ?? "cli",
      dataClassification: input.dataClassification ?? "internal",
      redactedDetail,
      previousHash,
      createdAt
    };
    const entryHash = sha256(stableJson(hashInput));
    this.database.db
      .prepare(
        `INSERT INTO audit_ledger (
          id, tenantId, sequence, actorType, actorId, action, resourceType, resourceId, outcome,
          eventId, runId, traceId, policyDecisionId, source, dataClassification,
          redactedDetailJson, previousHash, entryHash, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        tenantId,
        sequence,
        input.actorType,
        input.actorId,
        input.action,
        input.resourceType,
        input.resourceId,
        input.outcome,
        input.eventId ?? null,
        input.runId ?? null,
        input.traceId ?? null,
        input.policyDecisionId ?? null,
        input.source ?? "cli",
        input.dataClassification ?? "internal",
        JSON.stringify(redactedDetail),
        previousHash,
        entryHash,
        createdAt
      );
    return this.get(id)!;
  }

  latest(limit = 20, tenantId = DEFAULT_TENANT_ID): AuditEntryRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM audit_ledger WHERE tenantId = ? ORDER BY sequence DESC LIMIT ?`).all(tenantId, limit) as AuditRow[];
    return rows.map(mapAudit);
  }

  all(tenantId = DEFAULT_TENANT_ID): AuditEntryRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM audit_ledger WHERE tenantId = ? ORDER BY sequence ASC`).all(tenantId) as AuditRow[];
    return rows.map(mapAudit);
  }

  verify(entries = this.all()): { ok: boolean; failedAt?: number; reason?: string } {
    let previousHash: string | null = null;
    for (const entry of entries) {
      const hashInput = {
        id: entry.id,
        tenantId: entry.tenantId,
        sequence: entry.sequence,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        outcome: entry.outcome,
        eventId: entry.eventId ?? null,
        runId: entry.runId ?? null,
        traceId: entry.traceId ?? null,
        policyDecisionId: entry.policyDecisionId ?? null,
        source: entry.source ?? "cli",
        dataClassification: entry.dataClassification ?? "internal",
        redactedDetail: entry.redactedDetail,
        previousHash,
        createdAt: entry.createdAt
      };
      const expected = sha256(stableJson(hashInput));
      if (entry.previousHash !== previousHash) {
        return { ok: false, failedAt: entry.sequence, reason: "previous hash mismatch" };
      }
      if (entry.entryHash !== expected) {
        return { ok: false, failedAt: entry.sequence, reason: "entry hash mismatch" };
      }
      previousHash = entry.entryHash;
    }
    return { ok: true };
  }

  get(id: string): AuditEntryRecord | null {
    const row = this.database.db.prepare(`SELECT * FROM audit_ledger WHERE id = ?`).get(id) as AuditRow | undefined;
    return row ? mapAudit(row) : null;
  }

  private latestRow(tenantId: string): AuditRow | null {
    return (this.database.db.prepare(`SELECT * FROM audit_ledger WHERE tenantId = ? ORDER BY sequence DESC LIMIT 1`).get(tenantId) as AuditRow | undefined) ?? null;
  }
}

function mapAudit(row: AuditRow): AuditEntryRecord {
  return {
    ...row,
    redactedDetail: parseJson(row.redactedDetailJson, {}),
    detail: undefined
  };
}
