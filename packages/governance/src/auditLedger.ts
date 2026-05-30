import fs from "node:fs";
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
  /**
   * @param headAnchorPath Optional 0600 file (OUTSIDE the SQLite DB it protects,
   *   like the vault key) recording the latest entryHash per tenant. Lets
   *   `verify()` detect tail-truncation — deleting the most recent N entries
   *   leaves an internally-valid shorter chain that a hash-link check alone
   *   cannot catch. When omitted, verification falls back to chain-only.
   */
  constructor(private readonly database: SquidDatabase, private readonly headAnchorPath?: string) {}

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
    this.recordHead(tenantId, entryHash);
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

  verify(
    entries = this.all(),
    options: { tenantId?: string; checkAnchor?: boolean } = {}
  ): { ok: boolean; failedAt?: number; reason?: string } {
    // Derive the tenant from the entries when not given explicitly, so an
    // anchor lookup for `verify(all("tenant_b"))` checks tenant_b's head, not
    // the default tenant's.
    const tenantId = options.tenantId ?? (entries.length > 0 ? entries[entries.length - 1].tenantId : DEFAULT_TENANT_ID);
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

    // Tail-truncation / emptied-chain detection. The loop above is internally
    // consistent even after the most recent entries are deleted, so it cannot
    // see a truncation. The out-of-DB head anchor records the latest entryHash
    // per tenant; a mismatch (or a non-empty anchor against an empty chain)
    // means entries were removed. Skipped for snapshot verification of an
    // exported file (checkAnchor:false), which carries its own head.
    if (this.headAnchorPath && options.checkAnchor !== false) {
      const expectedHead = this.readAnchorMap()[tenantId] ?? null;
      const actualHead = entries.length ? entries[entries.length - 1].entryHash : null;
      // Only flag when an anchor was actually recorded for this tenant. A null
      // anchor means "no head recorded yet" (a chain written before the anchor
      // existed — e.g. an upgraded install), NOT a truncation; treating it as a
      // mismatch would false-positive on every pre-anchor history. Once any
      // entry is appended, recordHead populates the anchor and later truncation
      // (expectedHead non-null, actualHead differs/null) is detected.
      if (expectedHead !== null && expectedHead !== actualHead) {
        return { ok: false, reason: "audit head anchor mismatch — entries were truncated or removed" };
      }
    }
    return { ok: true };
  }

  /** Distinct tenants present in the ledger or recorded in the head anchor. */
  tenantIds(): string[] {
    const rows = this.database.db.prepare(`SELECT DISTINCT tenantId FROM audit_ledger`).all() as Array<{ tenantId: string }>;
    const ids = new Set<string>(rows.map((r) => r.tenantId));
    for (const t of Object.keys(this.readAnchorMap())) ids.add(t);
    return [...ids];
  }

  /** Verify EVERY tenant's chain (not just the default tenant). */
  verifyAll(): { ok: boolean; perTenant: Record<string, { ok: boolean; failedAt?: number; reason?: string }> } {
    const perTenant: Record<string, { ok: boolean; failedAt?: number; reason?: string }> = {};
    let ok = true;
    for (const tenantId of this.tenantIds()) {
      const result = this.verify(this.all(tenantId), { tenantId });
      perTenant[tenantId] = result;
      if (!result.ok) ok = false;
    }
    return { ok, perTenant };
  }

  /** All entries across all tenants (for a complete audit export). */
  allAcrossTenants(): AuditEntryRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM audit_ledger ORDER BY tenantId ASC, sequence ASC`).all() as AuditRow[];
    return rows.map(mapAudit);
  }

  private recordHead(tenantId: string, entryHash: string): void {
    if (!this.headAnchorPath) return;
    const map = this.readAnchorMap();
    map[tenantId] = entryHash;
    this.writeAnchorMap(map);
  }

  private readAnchorMap(): Record<string, string> {
    if (!this.headAnchorPath || !fs.existsSync(this.headAnchorPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.headAnchorPath, "utf8")) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private writeAnchorMap(map: Record<string, string>): void {
    if (!this.headAnchorPath) return;
    fs.writeFileSync(this.headAnchorPath, JSON.stringify(map), { encoding: "utf8", mode: 0o600 });
    try {
      fs.chmodSync(this.headAnchorPath, 0o600);
    } catch {
      /* best-effort on platforms without chmod */
    }
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
