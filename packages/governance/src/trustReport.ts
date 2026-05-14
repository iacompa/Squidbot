import type { SquidDatabase } from "@squidbot/db";
import type { IdentityReport } from "@squidbot/core";
import { AuditLedger } from "./auditLedger.js";
import { policyPacks } from "./policyPacks.js";
import { SecretReferenceStore } from "./secretReferences.js";
import { RetentionEngine } from "./retention.js";
import { DEFAULT_TENANT_ID, type AuditEntryRecord } from "./types.js";
import { sha256, stableJson } from "./internal.js";

export const TRUST_REPORT_SCHEMA_VERSION = "1";

export type TrustAuditStats = {
  entryCount: number;
  last24hCount: number;
  latestSequence: number;
  latestEntryHash: string | null;
  latestEntryAt: string | null;
  chainValid: boolean;
  chainFailureSequence: number | null;
  chainFailureReason: string | null;
};

export type TrustPolicyStats = {
  policyPackCount: number;
  policyPacks: { id: string; name: string; description: string; ruleCount: number }[];
  abacRuleCount: number;
  decisionCount: number;
  denyDecisionCount: number;
  recentDenyDecisions: number;
};

export type TrustVaultStats = {
  secretReferenceCount: number;
  rotatedSecretCount: number;
  encryptedAtRest: boolean;
  algorithm: string;
};

export type TrustRetentionStats = {
  policyCount: number;
  enabledPolicyCount: number;
  legalHoldCount: number;
  activeLegalHoldCount: number;
};

export type TrustAffordanceStats = {
  openCount: number;
  resolvedCount: number;
  wontfixCount: number;
  highSeverityOpenCount: number;
};

export type TrustSandboxStats = {
  activeCount: number;
  promotedCount: number;
  rejectedCount: number;
};

export type TrustConnectorStats = {
  registeredCount: number;
  readOnlyDefault: boolean;
  fixtureMode: boolean;
};

export type TrustModelProviderSpend = {
  provider: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
  /** Most recent usage_date (YYYY-MM-DD) recorded for this provider. */
  lastUsedAt: string | null;
};

export type TrustModelCostStats = {
  /**
   * Sum of cost across every (provider, day) row in the model_usage table.
   * Values reflect upstream-reported cost when the provider gave us one
   * (e.g. OpenRouter's `usage.cost`); otherwise they come from the local
   * per-token heuristic. The trust digest is keyed off this number, so it
   * stays stable across reads.
   */
  totalCost: number;
  totalTokens: number;
  /** Number of distinct provider/day rows that have ever been recorded. */
  totalRows: number;
  byProvider: TrustModelProviderSpend[];
};

export type TrustReport = {
  schemaVersion: string;
  generatedAt: string;
  agentName: string;
  agentVersion: string;
  profile: {
    active: boolean;
    industry: string | null;
    displayName: string | null;
    sensitivity: string | null;
    readOnlyByDefault: boolean;
  };
  audit: TrustAuditStats;
  policy: TrustPolicyStats;
  vault: TrustVaultStats;
  retention: TrustRetentionStats;
  affordanceGaps: TrustAffordanceStats;
  sandbox: TrustSandboxStats;
  connectors: TrustConnectorStats;
  capabilities: {
    toolCount: number;
    permissionScopes: string[];
  };
  modelCost: TrustModelCostStats;
  zeroSpendDefault: boolean;
  redactionEnabled: boolean;
  // High-level scoring helpers
  healthScore: number; // 0–100 composite
  healthLabel: "excellent" | "strong" | "fair" | "needs_attention";
  warnings: string[];
};

export type TrustDigest = {
  schemaVersion: string;
  hash: string;
  generatedAt: string;
  agentName: string;
  agentVersion: string;
  profile: string | null;
  healthScore: number;
  healthLabel: TrustReport["healthLabel"];
  auditChainValid: boolean;
};

export type BuildTrustReportOptions = {
  database: SquidDatabase;
  identityReport: IdentityReport;
  tenantId?: string;
  generatedAt?: string;
};

function countRows(database: SquidDatabase, sql: string, params: unknown[] = []): number {
  const row = database.db.prepare(sql).get(...params) as { count: number } | undefined;
  return row?.count ?? 0;
}

function tableExists(database: SquidDatabase, name: string): boolean {
  const row = database.db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name) as { name: string } | undefined;
  return Boolean(row);
}

function recent24hWindow(now: string): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString();
}

function buildAuditStats(database: SquidDatabase, tenantId: string, generatedAt: string): TrustAuditStats {
  if (!tableExists(database, "audit_ledger")) {
    return {
      entryCount: 0,
      last24hCount: 0,
      latestSequence: 0,
      latestEntryHash: null,
      latestEntryAt: null,
      chainValid: true,
      chainFailureSequence: null,
      chainFailureReason: null
    };
  }
  const entryCount = countRows(database, `SELECT COUNT(*) as count FROM audit_ledger WHERE tenantId = ?`, [tenantId]);
  const cutoff = recent24hWindow(generatedAt);
  const last24hCount = countRows(
    database,
    `SELECT COUNT(*) as count FROM audit_ledger WHERE tenantId = ? AND createdAt >= ?`,
    [tenantId, cutoff]
  );
  const latest = database.db
    .prepare(`SELECT sequence, entryHash, createdAt FROM audit_ledger WHERE tenantId = ? ORDER BY sequence DESC LIMIT 1`)
    .get(tenantId) as { sequence: number; entryHash: string; createdAt: string } | undefined;

  let chainValid = true;
  let chainFailureSequence: number | null = null;
  let chainFailureReason: string | null = null;
  if (entryCount > 0) {
    const ledger = new AuditLedger(database);
    const verify = ledger.verify(ledger.all(tenantId));
    chainValid = verify.ok;
    chainFailureSequence = verify.failedAt ?? null;
    chainFailureReason = verify.reason ?? null;
  }

  return {
    entryCount,
    last24hCount,
    latestSequence: latest?.sequence ?? 0,
    latestEntryHash: latest?.entryHash ?? null,
    latestEntryAt: latest?.createdAt ?? null,
    chainValid,
    chainFailureSequence,
    chainFailureReason
  };
}

function buildPolicyStats(database: SquidDatabase, tenantId: string): TrustPolicyStats {
  const abacRuleCount = tableExists(database, "abac_policies")
    ? countRows(database, `SELECT COUNT(*) as count FROM abac_policies WHERE tenantId = ? AND enabled = 1`, [tenantId])
    : 0;
  const decisionCount = tableExists(database, "policy_decisions")
    ? countRows(database, `SELECT COUNT(*) as count FROM policy_decisions WHERE tenantId = ?`, [tenantId])
    : 0;
  const denyDecisionCount = tableExists(database, "policy_decisions")
    ? countRows(database, `SELECT COUNT(*) as count FROM policy_decisions WHERE tenantId = ? AND decision = 'deny'`, [tenantId])
    : 0;
  const recentDenyDecisions = tableExists(database, "policy_decisions")
    ? countRows(
        database,
        `SELECT COUNT(*) as count FROM policy_decisions WHERE tenantId = ? AND decision = 'deny' AND createdAt >= ?`,
        [tenantId, recent24hWindow(new Date().toISOString())]
      )
    : 0;

  return {
    policyPackCount: policyPacks.length,
    policyPacks: policyPacks.map((pack) => ({
      id: pack.id,
      name: pack.name,
      description: pack.description,
      ruleCount: pack.rules.length
    })),
    abacRuleCount,
    decisionCount,
    denyDecisionCount,
    recentDenyDecisions
  };
}

function buildVaultStats(database: SquidDatabase, tenantId: string): TrustVaultStats {
  if (!tableExists(database, "secret_references")) {
    return {
      secretReferenceCount: 0,
      rotatedSecretCount: 0,
      encryptedAtRest: true,
      algorithm: "AES-256-GCM"
    };
  }
  const store = new SecretReferenceStore(database);
  const refs = store.list(tenantId);
  const rotated = refs.filter((ref) => ref.rotatedAt !== null && ref.rotatedAt !== undefined);
  return {
    secretReferenceCount: refs.length,
    rotatedSecretCount: rotated.length,
    encryptedAtRest: true,
    algorithm: "AES-256-GCM"
  };
}

function buildRetentionStats(database: SquidDatabase, tenantId: string): TrustRetentionStats {
  if (!tableExists(database, "retention_policies") || !tableExists(database, "legal_holds")) {
    return {
      policyCount: 0,
      enabledPolicyCount: 0,
      legalHoldCount: 0,
      activeLegalHoldCount: 0
    };
  }
  const engine = new RetentionEngine(database);
  const policies = engine.listPolicies(tenantId);
  const legalHolds = engine.listLegalHolds(tenantId);
  return {
    policyCount: policies.length,
    enabledPolicyCount: policies.filter((policy) => policy.enabled).length,
    legalHoldCount: legalHolds.length,
    activeLegalHoldCount: legalHolds.filter((hold) => hold.status === "active").length
  };
}

type ModelUsageAggregateRow = {
  provider: string;
  totalCost: number;
  totalTokens: number;
  callCount: number;
  lastUsedAt: string | null;
};

function buildModelCostStats(database: SquidDatabase): TrustModelCostStats {
  if (!tableExists(database, "model_usage")) {
    return { totalCost: 0, totalTokens: 0, totalRows: 0, byProvider: [] };
  }

  // Aggregate per-provider over all recorded daily rows. We use SUM/MAX so the
  // numbers stay accurate even if the table has years of data — no need to
  // pull every row into memory.
  const rows = database.db
    .prepare(
      `SELECT provider,
              COALESCE(SUM(cost), 0) AS totalCost,
              COALESCE(SUM(tokens), 0) AS totalTokens,
              COUNT(*) AS callCount,
              MAX(usage_date) AS lastUsedAt
       FROM model_usage
       GROUP BY provider
       ORDER BY totalCost DESC, provider ASC`
    )
    .all() as ModelUsageAggregateRow[];

  const totalCost = rows.reduce((sum, row) => sum + (Number.isFinite(row.totalCost) ? row.totalCost : 0), 0);
  const totalTokens = rows.reduce((sum, row) => sum + (Number.isFinite(row.totalTokens) ? row.totalTokens : 0), 0);
  const totalRows = rows.reduce((sum, row) => sum + (Number.isFinite(row.callCount) ? row.callCount : 0), 0);

  return {
    totalCost,
    totalTokens,
    totalRows,
    byProvider: rows.map((row) => ({
      provider: row.provider,
      totalCost: Number.isFinite(row.totalCost) ? row.totalCost : 0,
      totalTokens: Number.isFinite(row.totalTokens) ? row.totalTokens : 0,
      callCount: Number.isFinite(row.callCount) ? row.callCount : 0,
      lastUsedAt: row.lastUsedAt ?? null
    }))
  };
}

function buildAffordanceStats(database: SquidDatabase): TrustAffordanceStats {
  if (!tableExists(database, "affordance_gaps")) {
    return { openCount: 0, resolvedCount: 0, wontfixCount: 0, highSeverityOpenCount: 0 };
  }
  return {
    openCount: countRows(database, `SELECT COUNT(*) as count FROM affordance_gaps WHERE status = 'open'`),
    resolvedCount: countRows(database, `SELECT COUNT(*) as count FROM affordance_gaps WHERE status = 'resolved'`),
    wontfixCount: countRows(database, `SELECT COUNT(*) as count FROM affordance_gaps WHERE status = 'wontfix'`),
    highSeverityOpenCount: countRows(
      database,
      `SELECT COUNT(*) as count FROM affordance_gaps WHERE status = 'open' AND severity = 'high'`
    )
  };
}

function buildSandboxStats(database: SquidDatabase): TrustSandboxStats {
  if (!tableExists(database, "sandboxes")) {
    return { activeCount: 0, promotedCount: 0, rejectedCount: 0 };
  }
  return {
    activeCount: countRows(database, `SELECT COUNT(*) as count FROM sandboxes WHERE status = 'active'`),
    promotedCount: countRows(database, `SELECT COUNT(*) as count FROM sandboxes WHERE status = 'promoted'`),
    rejectedCount: countRows(database, `SELECT COUNT(*) as count FROM sandboxes WHERE status = 'rejected'`)
  };
}

function buildConnectorStats(database: SquidDatabase, profileReadOnly: boolean): TrustConnectorStats {
  const registeredCount = tableExists(database, "connectors")
    ? countRows(database, `SELECT COUNT(*) as count FROM connectors`)
    : 0;
  return {
    registeredCount,
    readOnlyDefault: profileReadOnly,
    fixtureMode: true
  };
}

function computeHealthScore(input: {
  audit: TrustAuditStats;
  policy: TrustPolicyStats;
  vault: TrustVaultStats;
  retention: TrustRetentionStats;
  affordanceGaps: TrustAffordanceStats;
}): { score: number; warnings: string[] } {
  let score = 100;
  const warnings: string[] = [];

  if (!input.audit.chainValid) {
    score -= 35;
    warnings.push(`Audit chain failed at sequence ${input.audit.chainFailureSequence}: ${input.audit.chainFailureReason}`);
  }
  if (input.audit.entryCount === 0) {
    score -= 5;
    warnings.push("Audit ledger is empty. The first operation will start the chain.");
  }
  if (input.policy.policyPackCount === 0) {
    score -= 10;
    warnings.push("No policy packs are installed.");
  }
  if (!input.vault.encryptedAtRest) {
    score -= 25;
    warnings.push("Secret vault is not encrypted at rest.");
  }
  if (input.retention.enabledPolicyCount === 0) {
    score -= 5;
    warnings.push("No retention policies are enabled.");
  }
  if (input.affordanceGaps.highSeverityOpenCount > 0) {
    score -= Math.min(10, input.affordanceGaps.highSeverityOpenCount * 2);
    warnings.push(
      `${input.affordanceGaps.highSeverityOpenCount} high-severity affordance gap${input.affordanceGaps.highSeverityOpenCount === 1 ? " is" : "s are"} open.`
    );
  }
  return { score: Math.max(0, score), warnings };
}

function healthLabel(score: number): TrustReport["healthLabel"] {
  if (score >= 90) return "excellent";
  if (score >= 75) return "strong";
  if (score >= 55) return "fair";
  return "needs_attention";
}

export function buildTrustReport(options: BuildTrustReportOptions): TrustReport {
  const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const profile = options.identityReport.profile;

  const audit = buildAuditStats(options.database, tenantId, generatedAt);
  const policy = buildPolicyStats(options.database, tenantId);
  const vault = buildVaultStats(options.database, tenantId);
  const retention = buildRetentionStats(options.database, tenantId);
  const affordanceGaps = buildAffordanceStats(options.database);
  const sandbox = buildSandboxStats(options.database);
  const connectors = buildConnectorStats(options.database, profile?.readOnlyByDefault === true);
  const modelCost = buildModelCostStats(options.database);
  const { score, warnings } = computeHealthScore({ audit, policy, vault, retention, affordanceGaps });

  return {
    schemaVersion: TRUST_REPORT_SCHEMA_VERSION,
    generatedAt,
    agentName: options.identityReport.card.agentName,
    agentVersion: options.identityReport.card.agentVersion,
    profile: {
      active: profile !== null,
      industry: profile?.industry ?? null,
      displayName: profile?.displayName ?? null,
      sensitivity: profile?.sensitivity ?? null,
      readOnlyByDefault: profile?.readOnlyByDefault ?? false
    },
    audit,
    policy,
    vault,
    retention,
    affordanceGaps,
    sandbox,
    connectors,
    capabilities: {
      toolCount: options.identityReport.capabilities.toolCount,
      permissionScopes: options.identityReport.capabilities.permissionScopes
    },
    modelCost,
    zeroSpendDefault: true,
    redactionEnabled: true,
    healthScore: score,
    healthLabel: healthLabel(score),
    warnings
  };
}

export function digestTrustReport(report: TrustReport): TrustDigest {
  // Hash a stable subset so the digest changes when material posture changes,
  // but doesn't churn on cosmetic fields.
  const hashable = {
    schemaVersion: report.schemaVersion,
    agentName: report.agentName,
    agentVersion: report.agentVersion,
    profile: report.profile,
    audit: {
      entryCount: report.audit.entryCount,
      latestEntryHash: report.audit.latestEntryHash,
      chainValid: report.audit.chainValid
    },
    policy: {
      policyPackCount: report.policy.policyPackCount,
      abacRuleCount: report.policy.abacRuleCount,
      denyDecisionCount: report.policy.denyDecisionCount
    },
    vault: report.vault,
    retention: report.retention,
    affordanceGaps: report.affordanceGaps,
    capabilities: report.capabilities,
    modelCost: {
      totalCost: report.modelCost.totalCost,
      totalTokens: report.modelCost.totalTokens,
      providerCount: report.modelCost.byProvider.length
    },
    zeroSpendDefault: report.zeroSpendDefault,
    redactionEnabled: report.redactionEnabled,
    healthScore: report.healthScore,
    healthLabel: report.healthLabel
  };
  return {
    schemaVersion: TRUST_REPORT_SCHEMA_VERSION,
    hash: sha256(stableJson(hashable)),
    generatedAt: report.generatedAt,
    agentName: report.agentName,
    agentVersion: report.agentVersion,
    profile: report.profile.displayName,
    healthScore: report.healthScore,
    healthLabel: report.healthLabel,
    auditChainValid: report.audit.chainValid
  };
}

export function formatTrustReportMarkdown(report: TrustReport): string {
  const lines: string[] = [];
  const labelEmoji: Record<TrustReport["healthLabel"], string> = {
    excellent: "✓",
    strong: "✓",
    fair: "!",
    needs_attention: "!!"
  };

  lines.push(`# Trust & Security Report`);
  lines.push("");
  lines.push(`**Agent**: ${report.agentName} v${report.agentVersion}`);
  lines.push(`**Generated**: ${report.generatedAt}`);
  lines.push(`**Health**: ${labelEmoji[report.healthLabel]} ${report.healthLabel.replace("_", " ")} — score ${report.healthScore}/100`);
  if (report.profile.active) {
    lines.push(
      `**Active profile**: ${report.profile.displayName} (${report.profile.industry}, sensitivity=${report.profile.sensitivity}, read-only-by-default=${report.profile.readOnlyByDefault ? "yes" : "no"})`
    );
  } else {
    lines.push(`**Active profile**: none`);
  }
  lines.push("");

  if (report.warnings.length > 0) {
    lines.push("## Warnings");
    for (const warning of report.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Audit ledger");
  lines.push(`- Entries: ${report.audit.entryCount}`);
  lines.push(`- Last 24h: ${report.audit.last24hCount}`);
  lines.push(`- Latest sequence: ${report.audit.latestSequence}`);
  lines.push(`- Latest hash: ${report.audit.latestEntryHash ?? "(none)"}`);
  lines.push(`- Chain valid: ${report.audit.chainValid ? "yes" : "NO"}`);
  if (!report.audit.chainValid) {
    lines.push(`- Chain failure: sequence=${report.audit.chainFailureSequence} reason=${report.audit.chainFailureReason}`);
  }
  lines.push("");

  lines.push("## Policy");
  lines.push(`- Built-in policy packs: ${report.policy.policyPackCount}`);
  for (const pack of report.policy.policyPacks) {
    lines.push(`  - **${pack.name}** (${pack.id}) — ${pack.description}`);
  }
  lines.push(`- ABAC rules enabled: ${report.policy.abacRuleCount}`);
  lines.push(`- Total policy decisions recorded: ${report.policy.decisionCount}`);
  lines.push(`- Deny decisions: ${report.policy.denyDecisionCount} (${report.policy.recentDenyDecisions} in last 24h)`);
  lines.push("");

  lines.push("## Vault");
  lines.push(`- Secret references: ${report.vault.secretReferenceCount}`);
  lines.push(`- Rotated secrets: ${report.vault.rotatedSecretCount}`);
  lines.push(`- Encrypted at rest: ${report.vault.encryptedAtRest ? "yes" : "no"} (${report.vault.algorithm})`);
  lines.push("");

  lines.push("## Retention");
  lines.push(`- Retention policies: ${report.retention.policyCount} (${report.retention.enabledPolicyCount} enabled)`);
  lines.push(`- Legal holds: ${report.retention.legalHoldCount} total (${report.retention.activeLegalHoldCount} active)`);
  lines.push("");

  lines.push("## Affordance gaps");
  lines.push(`- Open: ${report.affordanceGaps.openCount} (${report.affordanceGaps.highSeverityOpenCount} high-severity)`);
  lines.push(`- Resolved: ${report.affordanceGaps.resolvedCount}`);
  lines.push(`- Won't fix: ${report.affordanceGaps.wontfixCount}`);
  lines.push("");

  lines.push("## Sandboxes");
  lines.push(`- Active: ${report.sandbox.activeCount}`);
  lines.push(`- Promoted: ${report.sandbox.promotedCount}`);
  lines.push(`- Rejected: ${report.sandbox.rejectedCount}`);
  lines.push("");

  lines.push("## Connectors");
  lines.push(`- Registered: ${report.connectors.registeredCount}`);
  lines.push(`- Read-only by default: ${report.connectors.readOnlyDefault ? "yes" : "no"}`);
  lines.push(`- Fixture mode available: ${report.connectors.fixtureMode ? "yes" : "no"}`);
  lines.push("");

  lines.push("## Model spend (BYOK)");
  if (report.modelCost.byProvider.length === 0) {
    lines.push("- No paid model calls recorded yet.");
  } else {
    lines.push(`- Total spend: ${formatUsd(report.modelCost.totalCost)} across ${report.modelCost.totalTokens.toLocaleString()} tokens`);
    for (const entry of report.modelCost.byProvider) {
      const provider = entry.provider === "api" ? "BYOK API (api)" : entry.provider;
      lines.push(
        `  - ${provider}: ${formatUsd(entry.totalCost)} · ${entry.totalTokens.toLocaleString()} tokens · ${entry.callCount} usage row${entry.callCount === 1 ? "" : "s"}${entry.lastUsedAt ? ` · last used ${entry.lastUsedAt}` : ""}`
      );
    }
  }
  lines.push("");

  lines.push("## Capabilities");
  lines.push(`- Registered tools: ${report.capabilities.toolCount}`);
  lines.push(`- Permission scopes: ${report.capabilities.permissionScopes.join(", ") || "(none)"}`);
  lines.push(`- Zero-spend default: ${report.zeroSpendDefault ? "yes" : "no"}`);
  lines.push(`- Redaction enabled: ${report.redactionEnabled ? "yes" : "no"}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Format a USD amount with adaptive precision so tiny fractions of a cent
 * (typical of Gemini / cheap models) still read as a real number, while
 * larger totals look like normal dollars.
 *
 *   0           → "$0.00"
 *   0.00000046  → "$0.00000046"
 *   0.0046      → "$0.0046"
 *   12.5        → "$12.50"
 */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function summarizeTrustReport(report: TrustReport): string {
  const profileBit = report.profile.active ? ` profile=${report.profile.displayName}` : "";
  const spendBit = report.modelCost.totalCost > 0 ? `, spent ${formatUsd(report.modelCost.totalCost)}` : "";
  return `${report.agentName} v${report.agentVersion}${profileBit} — health ${report.healthLabel} (${report.healthScore}/100), audit ${report.audit.entryCount} entries chain=${report.audit.chainValid ? "ok" : "BROKEN"}, ${report.policy.policyPackCount} policy packs, ${report.vault.secretReferenceCount} secrets, ${report.affordanceGaps.openCount} open gaps${spendBit}.`;
}

export function recentAuditEntries(database: SquidDatabase, limit = 10, tenantId = DEFAULT_TENANT_ID): AuditEntryRecord[] {
  if (!tableExists(database, "audit_ledger")) {
    return [];
  }
  return new AuditLedger(database).latest(limit, tenantId);
}
