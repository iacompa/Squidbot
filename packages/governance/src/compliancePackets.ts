import { policyPacks } from "./policyPacks.js";
import { recentAuditEntries } from "./trustReport.js";
import type { TrustReport } from "./trustReport.js";
import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_TENANT_ID, type AuditEntryRecord } from "./types.js";
import { sha256, stableJson } from "./internal.js";

export const COMPLIANCE_PACKET_SCHEMA_VERSION = "1";

export type ComplianceFramework = "soc2" | "gdpr";

export type ComplianceControlEvidence = {
  controlId: string;
  controlTitle: string;
  status: "met" | "partial" | "manual";
  evidence: string[];
  notes?: string;
};

export type CompliancePacket = {
  schemaVersion: string;
  framework: ComplianceFramework;
  generatedAt: string;
  agentName: string;
  agentVersion: string;
  profile: string | null;
  trustReportHash: string;
  controls: ComplianceControlEvidence[];
  auditWindow: {
    from: string | null;
    to: string | null;
    entryCount: number;
    chainValid: boolean;
  };
  markdown: string;
  digest: string;
};

export type BuildCompliancePacketOptions = {
  database: SquidDatabase;
  trustReport: TrustReport;
  framework: ComplianceFramework;
  tenantId?: string;
  generatedAt?: string;
  recentEntries?: number;
};

type ControlTemplate = {
  id: string;
  title: string;
  trustField: (report: TrustReport) => boolean;
  evidenceBuilder: (report: TrustReport) => string[];
  fallbackNotes?: string;
};

function controlsForFramework(framework: ComplianceFramework): ControlTemplate[] {
  if (framework === "soc2") {
    return [
      {
        id: "SOC2-CC1.1",
        title: "Control environment — security responsibilities are formally assigned.",
        trustField: () => true,
        evidenceBuilder: () => [
          "SquidBot defines a single agent identity card with mission and version, and tracks tool/permission scopes per registered tool.",
          "An identity card row is required before any operation; tampering breaks the singleton check."
        ]
      },
      {
        id: "SOC2-CC4.1",
        title: "Monitoring activities — events are logged for review.",
        trustField: (report) => report.audit.entryCount > 0,
        evidenceBuilder: (report) => [
          `Append-only audit ledger contains ${report.audit.entryCount} entries (latest hash: ${report.audit.latestEntryHash ?? "n/a"}).`,
          `Hash-chained — chain verification ${report.audit.chainValid ? "passed" : "FAILED"} at generation time.`,
          `Last 24h volume: ${report.audit.last24hCount} entries.`
        ],
        fallbackNotes: "Audit ledger is empty; the first SquidBot operation will start the chain."
      },
      {
        id: "SOC2-CC5.2",
        title: "Logical access — role-based access governs sensitive actions.",
        trustField: () => true,
        evidenceBuilder: (report) =>
          [
            `RBAC + ABAC enforcement is active. ${report.policy.abacRuleCount} ABAC rule(s) are enabled.`,
            `${report.policy.denyDecisionCount} policy decisions have produced a deny verdict in the lifetime of the ledger.`,
            `Policy packs available out of the box: ${report.policy.policyPacks.map((pack) => pack.id).join(", ")}.`
          ]
      },
      {
        id: "SOC2-CC6.1",
        title: "Logical access — credentials are protected at rest.",
        trustField: (report) => report.vault.encryptedAtRest,
        evidenceBuilder: (report) => [
          `Local encrypted vault uses ${report.vault.algorithm} for at-rest encryption.`,
          `${report.vault.secretReferenceCount} secret reference(s) registered; ${report.vault.rotatedSecretCount} have rotation history.`,
          "Plaintext secrets are never stored in audit details — redaction occurs before persistence."
        ]
      },
      {
        id: "SOC2-CC7.2",
        title: "System operations — incidents and gaps are tracked.",
        trustField: () => true,
        evidenceBuilder: (report) => [
          `Affordance gap log captures unmet capability requirements with severity and resolution state.`,
          `Open: ${report.affordanceGaps.openCount}, resolved: ${report.affordanceGaps.resolvedCount}, won't-fix: ${report.affordanceGaps.wontfixCount}.`,
          `High-severity open gaps: ${report.affordanceGaps.highSeverityOpenCount}.`
        ]
      },
      {
        id: "SOC2-CC8.1",
        title: "Change management — risky changes are staged before promotion.",
        trustField: () => true,
        evidenceBuilder: (report) => [
          "All write operations are routed through the SandboxManager: copy-on-write workspace, resource limits, network deny by default.",
          `Sandbox activity: ${report.sandbox.activeCount} active, ${report.sandbox.promotedCount} promoted, ${report.sandbox.rejectedCount} rejected.`,
          "Promotion to the real workspace requires an approval gate event linked to the run trace."
        ]
      },
      {
        id: "SOC2-A1.1",
        title: "Availability — local-first deployment removes external single points of failure.",
        trustField: () => true,
        evidenceBuilder: () => [
          "SquidBot runs entirely on the operator's hardware by default. No project-side cloud dependency.",
          "All persistent state lives in a local SQLite database (WAL mode); operators control backups and DR."
        ]
      }
    ];
  }

  return [
    {
      id: "GDPR-Art5",
      title: "Principles relating to processing of personal data.",
      trustField: () => true,
      evidenceBuilder: (report) => [
        "Data minimization — SquidBot stores only what's needed for traces, memory, and audit. Redaction patterns strip emails, secrets, and PII before persistence.",
        `Storage limitation — ${report.retention.enabledPolicyCount} retention policy/policies enabled across resource types.`,
        "Accountability — every action is logged with actor, resource, and policy decision in the audit ledger."
      ]
    },
    {
      id: "GDPR-Art17",
      title: "Right to erasure.",
      trustField: (report) => report.retention.policyCount > 0 || report.retention.legalHoldCount === 0,
      evidenceBuilder: (report) => [
        `Retention policies support deletion actions per resource type (currently ${report.retention.policyCount} configured).`,
        `Legal holds: ${report.retention.activeLegalHoldCount} active; deletion is blocked for held resources unless legalHoldOverride is set.`,
        "Memory graph supports archive and soft-delete with provenance preserved for audit."
      ],
      fallbackNotes:
        "No retention policies configured yet. Configure at least one retention policy with action='delete' for personal data tables."
    },
    {
      id: "GDPR-Art25",
      title: "Data protection by design and by default.",
      trustField: (report) => report.vault.encryptedAtRest,
      evidenceBuilder: (report) => [
        `Vault encrypts secrets at rest with ${report.vault.algorithm}.`,
        `Read-only-by-default for connectors when the enterprise profile is regulated (currently: ${report.profile.readOnlyByDefault ? "ON" : "off"}).`,
        "System prompt + identity card make boundaries explicit to operators and auditors."
      ]
    },
    {
      id: "GDPR-Art30",
      title: "Records of processing activities.",
      trustField: (report) => report.audit.entryCount > 0,
      evidenceBuilder: (report) => [
        `Append-only audit ledger contains ${report.audit.entryCount} entries; hash-chained verification ${report.audit.chainValid ? "passed" : "FAILED"}.`,
        `Latest entry at ${report.audit.latestEntryAt ?? "n/a"} with hash ${report.audit.latestEntryHash ?? "n/a"}.`,
        "Each entry records actor, action, resource, outcome, classification, and a hash linking it to the previous entry."
      ],
      fallbackNotes: "Audit ledger is empty. The first SquidBot operation will populate it."
    },
    {
      id: "GDPR-Art32",
      title: "Security of processing.",
      trustField: () => true,
      evidenceBuilder: (report) => [
        `Encryption at rest: ${report.vault.encryptedAtRest ? "yes" : "no"} (${report.vault.algorithm}).`,
        `Pseudonymisation — secrets are referenced by name; raw values are encrypted by the LocalEncryptedVault.`,
        `Resilience — sandbox isolation, network deny defaults, redaction, and hash-chain integrity checks.`,
        `Regular review — ${report.policy.policyPacks.length} default policy packs and ${report.policy.abacRuleCount} ABAC rules govern access.`
      ]
    },
    {
      id: "GDPR-Art33",
      title: "Notification of a personal data breach.",
      trustField: () => true,
      evidenceBuilder: () => [
        "Operators can export the audit ledger for incident review via `squidbot governance audit export`.",
        "The hash chain provides tamper-evidence: any modification breaks `audit.verify()` and surfaces in the trust report."
      ],
      fallbackNotes: "Notification workflow itself is the operator's responsibility; SquidBot supplies the audit evidence."
    }
  ];
}

function frameworkTitle(framework: ComplianceFramework): string {
  if (framework === "soc2") return "SOC 2 Type II — Common Criteria Evidence";
  return "GDPR Article-Level Evidence";
}

export function buildCompliancePacket(options: BuildCompliancePacketOptions): CompliancePacket {
  const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const recentLimit = options.recentEntries ?? 25;
  const controlsTemplate = controlsForFramework(options.framework);

  const controls: ComplianceControlEvidence[] = controlsTemplate.map((template) => {
    const status: ComplianceControlEvidence["status"] = template.trustField(options.trustReport) ? "met" : "partial";
    return {
      controlId: template.id,
      controlTitle: template.title,
      status,
      evidence: template.evidenceBuilder(options.trustReport),
      notes: status === "partial" ? template.fallbackNotes : undefined
    };
  });

  const recent = recentAuditEntries(options.database, recentLimit, tenantId);
  const auditWindow = {
    from: recent.length > 0 ? recent[recent.length - 1].createdAt : null,
    to: recent.length > 0 ? recent[0].createdAt : null,
    entryCount: options.trustReport.audit.entryCount,
    chainValid: options.trustReport.audit.chainValid
  };

  const trustReportHash = sha256(stableJson(options.trustReport));
  const markdown = formatPacketMarkdown({
    framework: options.framework,
    trustReport: options.trustReport,
    controls,
    recent,
    auditWindow,
    generatedAt,
    trustReportHash
  });

  const digest = sha256(
    stableJson({
      schemaVersion: COMPLIANCE_PACKET_SCHEMA_VERSION,
      framework: options.framework,
      generatedAt,
      trustReportHash,
      controls: controls.map((control) => ({ id: control.controlId, status: control.status }))
    })
  );

  return {
    schemaVersion: COMPLIANCE_PACKET_SCHEMA_VERSION,
    framework: options.framework,
    generatedAt,
    agentName: options.trustReport.agentName,
    agentVersion: options.trustReport.agentVersion,
    profile: options.trustReport.profile.displayName,
    trustReportHash,
    controls,
    auditWindow,
    markdown,
    digest
  };
}

function formatPacketMarkdown(input: {
  framework: ComplianceFramework;
  trustReport: TrustReport;
  controls: ComplianceControlEvidence[];
  recent: AuditEntryRecord[];
  auditWindow: CompliancePacket["auditWindow"];
  generatedAt: string;
  trustReportHash: string;
}): string {
  const lines: string[] = [];
  lines.push(`# ${frameworkTitle(input.framework)}`);
  lines.push("");
  lines.push(`**Agent**: ${input.trustReport.agentName} v${input.trustReport.agentVersion}`);
  lines.push(`**Generated**: ${input.generatedAt}`);
  if (input.trustReport.profile.active) {
    lines.push(
      `**Profile**: ${input.trustReport.profile.displayName} (${input.trustReport.profile.industry}, sensitivity=${input.trustReport.profile.sensitivity})`
    );
  } else {
    lines.push(`**Profile**: none`);
  }
  lines.push(`**Trust report hash**: \`${input.trustReportHash}\``);
  lines.push(`**Health score**: ${input.trustReport.healthScore}/100 (${input.trustReport.healthLabel.replace("_", " ")})`);
  lines.push("");
  lines.push("## Scope");
  lines.push("This packet summarizes the automated controls SquidBot provides for the listed framework. Manual operational and organizational controls remain the responsibility of the operating entity.");
  lines.push("");
  lines.push(`## Audit window`);
  lines.push(`- From: ${input.auditWindow.from ?? "n/a"}`);
  lines.push(`- To: ${input.auditWindow.to ?? "n/a"}`);
  lines.push(`- Entries (total): ${input.auditWindow.entryCount}`);
  lines.push(`- Hash chain valid: ${input.auditWindow.chainValid ? "yes" : "NO"}`);
  lines.push("");

  if (input.trustReport.warnings.length > 0) {
    lines.push("## Open warnings");
    for (const warning of input.trustReport.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push("");
  }

  lines.push("## Controls");
  for (const control of input.controls) {
    lines.push("");
    lines.push(`### ${control.controlId} — ${control.controlTitle}`);
    lines.push(`**Status**: ${control.status === "met" ? "MET (automated)" : control.status === "partial" ? "PARTIAL" : "MANUAL"}`);
    lines.push("");
    lines.push("Evidence:");
    for (const item of control.evidence) {
      lines.push(`- ${item}`);
    }
    if (control.notes) {
      lines.push("");
      lines.push(`Notes: ${control.notes}`);
    }
  }
  lines.push("");

  if (input.recent.length > 0) {
    lines.push("## Sample audit entries (most recent)");
    for (const entry of input.recent.slice(0, 10)) {
      lines.push(
        `- seq=${entry.sequence} ${entry.action} on ${entry.resourceType}:${entry.resourceId} outcome=${entry.outcome} actor=${entry.actorType}:${entry.actorId} at ${entry.createdAt}`
      );
    }
    lines.push("");
  }

  lines.push("## Built-in policy packs in scope");
  for (const pack of policyPacks) {
    lines.push(`- **${pack.name}** (${pack.id}) — ${pack.description}`);
  }

  return lines.join("\n");
}
