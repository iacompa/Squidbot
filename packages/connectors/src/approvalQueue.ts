import type { SquidDatabase } from "@squidbot/db";
import { createId, type RiskLevel } from "@squidbot/core";

export type { RiskLevel };

export type ApprovalKind = "sandbox-promotion" | "connector-call";

export type ApprovalInput = {
  kind: ApprovalKind;
  title: string;
  summary: string;
  riskLevel: RiskLevel;
  payload: Record<string, unknown>;
  callerSessionId?: string;
  callerRunId?: string;
};

export type ApprovalRow = {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  riskLevel: RiskLevel;
  payload: Record<string, unknown>;
  callerSessionId: string | null;
  callerRunId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: "approved" | "rejected" | null;
  resultJson: string | null;
};

/**
 * Inserts a new pending approval row. Returns the generated id (prefixed
 * "ap_") so callers can correlate the row with their downstream actions
 * (e.g. the tool's return value to the agent, so the runtime can match
 * the resolved row back to the in-flight tool call).
 */
export function enqueueApproval(db: SquidDatabase, input: ApprovalInput): string {
  const id = createId("ap");
  const createdAt = new Date().toISOString();
  db.db
    .prepare(
      `INSERT INTO pending_approvals
         (id, kind, title, summary, riskLevel, payloadJson, callerSessionId, callerRunId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.kind,
      input.title,
      input.summary,
      input.riskLevel,
      JSON.stringify(input.payload),
      input.callerSessionId ?? null,
      input.callerRunId ?? null,
      createdAt
    );
  return id;
}

/**
 * Returns unresolved approvals (resolvedAt IS NULL), most-recent first.
 * Backs the Approvals page's queue view.
 */
export function listOpenApprovals(db: SquidDatabase): ApprovalRow[] {
  const rows = db.db
    .prepare(`SELECT * FROM pending_approvals WHERE resolvedAt IS NULL ORDER BY createdAt DESC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToApproval);
}

/**
 * Fetch a single approval by id. Returns null when not found.
 */
export function getApproval(db: SquidDatabase, id: string): ApprovalRow | null {
  const row = db.db
    .prepare(`SELECT * FROM pending_approvals WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToApproval(row) : null;
}

/**
 * Marks an approval row resolved (approved + result, or rejected + optional reason).
 * The result payload is JSON-serialized into resultJson — for approved rows
 * this is whatever the deferred call returned; for rejected rows we store
 * { rejected: true, reason } so downstream consumers can show the reason.
 *
 * Throws if the approval doesn't exist after the update (shouldn't happen
 * unless the row was deleted concurrently).
 */
export function resolveApproval(
  db: SquidDatabase,
  id: string,
  outcome:
    | { resolution: "approved"; result: unknown }
    | { resolution: "rejected"; reason?: string }
): ApprovalRow {
  const resolvedAt = new Date().toISOString();
  const resultPayload =
    outcome.resolution === "approved"
      ? outcome.result
      : { rejected: true, reason: outcome.reason ?? null };
  db.db
    .prepare(
      `UPDATE pending_approvals SET resolvedAt = ?, resolution = ?, resultJson = ? WHERE id = ?`
    )
    .run(resolvedAt, outcome.resolution, JSON.stringify(resultPayload), id);
  const row = getApproval(db, id);
  if (!row) throw new Error(`Approval not found after resolve: ${id}`);
  return row;
}

/**
 * Returns approvals for a given session that were resolved at or after
 * `since`. Used by the runtime to surface resolved approvals as a system
 * note at the start of the next chat turn.
 */
export function listResolvedSince(
  db: SquidDatabase,
  options: { sessionId: string; since: string }
): ApprovalRow[] {
  const rows = db.db
    .prepare(
      `SELECT * FROM pending_approvals
        WHERE callerSessionId = ?
          AND resolvedAt IS NOT NULL
          AND resolvedAt >= ?
        ORDER BY resolvedAt ASC`
    )
    .all(options.sessionId, options.since) as Array<Record<string, unknown>>;
  return rows.map(rowToApproval);
}

function rowToApproval(row: Record<string, unknown>): ApprovalRow {
  return {
    id: row.id as string,
    kind: row.kind as ApprovalKind,
    title: row.title as string,
    summary: row.summary as string,
    riskLevel: row.riskLevel as RiskLevel,
    payload: JSON.parse(row.payloadJson as string) as Record<string, unknown>,
    callerSessionId: (row.callerSessionId as string | null) ?? null,
    callerRunId: (row.callerRunId as string | null) ?? null,
    createdAt: row.createdAt as string,
    resolvedAt: (row.resolvedAt as string | null) ?? null,
    resolution: (row.resolution as "approved" | "rejected" | null) ?? null,
    resultJson: (row.resultJson as string | null) ?? null
  };
}
