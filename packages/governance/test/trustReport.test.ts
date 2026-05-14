import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import {
  activateProfile,
  buildIdentityReport,
  installSeedProfiles,
  ToolRegistry
} from "@squidbot/core";
import { tempDb } from "./helpers.js";
import {
  AuditLedger,
  buildCompliancePacket,
  buildTrustReport,
  COMPLIANCE_PACKET_SCHEMA_VERSION,
  digestTrustReport,
  formatTrustReportMarkdown,
  summarizeTrustReport,
  TRUST_REPORT_SCHEMA_VERSION
} from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("trust report", () => {
  it("builds an empty-state report with sensible defaults", () => {
    database = tempDb();
    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const report = buildTrustReport({ database, identityReport });

    expect(report.schemaVersion).toBe(TRUST_REPORT_SCHEMA_VERSION);
    expect(report.agentName).toBe("SquidBot");
    expect(report.audit.entryCount).toBe(0);
    expect(report.audit.chainValid).toBe(true);
    expect(report.policy.policyPackCount).toBeGreaterThan(0);
    expect(report.vault.encryptedAtRest).toBe(true);
    expect(report.zeroSpendDefault).toBe(true);
    expect(report.profile.active).toBe(false);
    // Empty model spend: no calls recorded yet.
    expect(report.modelCost.totalCost).toBe(0);
    expect(report.modelCost.totalTokens).toBe(0);
    expect(report.modelCost.byProvider).toEqual([]);
    expect(["excellent", "strong", "fair", "needs_attention"]).toContain(report.healthLabel);
  });

  it("aggregates real model spend from the model_usage table by provider", () => {
    database = tempDb();
    // Simulate two real OpenRouter calls (Gemini Flash) + one local/free call.
    database.addModelUsage("api", "2026-05-14", 4500, 0.000209);
    database.addModelUsage("api", "2026-05-13", 2390, 0.000080);
    database.addModelUsage("mock", "2026-05-14", 1200, 0);

    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const report = buildTrustReport({ database, identityReport });

    expect(report.modelCost.totalCost).toBeCloseTo(0.000289, 6);
    expect(report.modelCost.totalTokens).toBe(4500 + 2390 + 1200);
    expect(report.modelCost.byProvider).toHaveLength(2);

    // Highest-cost provider sorts first.
    const apiSpend = report.modelCost.byProvider.find((entry) => entry.provider === "api");
    expect(apiSpend).toBeDefined();
    expect(apiSpend?.totalCost).toBeCloseTo(0.000289, 6);
    expect(apiSpend?.totalTokens).toBe(6890);
    expect(apiSpend?.callCount).toBe(2);
    expect(apiSpend?.lastUsedAt).toBe("2026-05-14");

    const mockSpend = report.modelCost.byProvider.find((entry) => entry.provider === "mock");
    expect(mockSpend?.totalCost).toBe(0);

    // Markdown formatter mentions the model spend section.
    const markdown = formatTrustReportMarkdown(report);
    expect(markdown).toContain("## Model spend (BYOK)");
    expect(markdown).toContain("api");
    // formatUsd should print "$0.000289" (no trailing zeros) for sub-cent totals.
    expect(markdown).toContain("$0.000289");
  });

  it("reflects active enterprise profile in the report and markdown", () => {
    database = tempDb();
    installSeedProfiles(database);
    activateProfile(database, "profile_seed_law_firm");

    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const report = buildTrustReport({ database, identityReport });

    expect(report.profile.active).toBe(true);
    expect(report.profile.displayName).toBe("Law Firm");
    expect(report.profile.sensitivity).toBe("regulated");
    expect(report.profile.readOnlyByDefault).toBe(true);

    const markdown = formatTrustReportMarkdown(report);
    expect(markdown).toContain("# Trust & Security Report");
    expect(markdown).toContain("Law Firm");
    expect(markdown).toContain("Audit ledger");
    expect(markdown).toContain("Policy");
  });

  it("counts audit ledger entries and verifies chain integrity", () => {
    database = tempDb();
    const ledger = new AuditLedger(database);
    ledger.append({
      actorType: "user",
      actorId: "user_test",
      action: "test.action",
      resourceType: "test",
      resourceId: "abc",
      outcome: "ok"
    });
    ledger.append({
      actorType: "user",
      actorId: "user_test",
      action: "test.second",
      resourceType: "test",
      resourceId: "def",
      outcome: "ok"
    });

    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const report = buildTrustReport({ database, identityReport });

    expect(report.audit.entryCount).toBe(2);
    expect(report.audit.chainValid).toBe(true);
    expect(report.audit.latestEntryHash).toBeTruthy();
    expect(report.audit.latestSequence).toBe(2);
  });

  it("digest hash changes when material posture changes", () => {
    database = tempDb();
    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const reportA = buildTrustReport({ database, identityReport, generatedAt: "2026-05-11T00:00:00.000Z" });
    const digestA = digestTrustReport(reportA);

    const ledger = new AuditLedger(database);
    ledger.append({
      actorType: "user",
      actorId: "user_test",
      action: "test.action",
      resourceType: "test",
      resourceId: "abc",
      outcome: "ok"
    });

    const reportB = buildTrustReport({ database, identityReport, generatedAt: "2026-05-11T00:01:00.000Z" });
    const digestB = digestTrustReport(reportB);

    expect(digestA.hash).not.toBe(digestB.hash);
    expect(digestB.auditChainValid).toBe(true);
  });

  it("summarize trust report includes profile when active", () => {
    database = tempDb();
    installSeedProfiles(database);
    activateProfile(database, "profile_seed_engineering_shop");
    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const report = buildTrustReport({ database, identityReport });
    const summary = summarizeTrustReport(report);
    expect(summary).toContain("SquidBot");
    expect(summary).toContain("Engineering Shop");
  });
});

describe("compliance packet", () => {
  it("generates a SOC2 packet with control evidence", () => {
    database = tempDb();
    installSeedProfiles(database);
    activateProfile(database, "profile_seed_engineering_shop");
    const ledger = new AuditLedger(database);
    ledger.append({
      actorType: "user",
      actorId: "user_test",
      action: "test.action",
      resourceType: "test",
      resourceId: "abc",
      outcome: "ok"
    });
    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const trustReport = buildTrustReport({ database, identityReport });

    const packet = buildCompliancePacket({ database, trustReport, framework: "soc2" });

    expect(packet.schemaVersion).toBe(COMPLIANCE_PACKET_SCHEMA_VERSION);
    expect(packet.framework).toBe("soc2");
    expect(packet.controls.length).toBeGreaterThan(0);
    expect(packet.controls.find((control) => control.controlId.startsWith("SOC2-CC4."))).toBeDefined();
    expect(packet.controls.find((control) => control.controlId.startsWith("SOC2-CC6."))).toBeDefined();
    expect(packet.markdown).toContain("SOC 2 Type II");
    expect(packet.markdown).toContain("Audit window");
    expect(packet.trustReportHash).toMatch(/^[a-f0-9]{64}$/);
    expect(packet.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("generates a GDPR packet that flags partial control when retention is empty", () => {
    database = tempDb();
    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const trustReport = buildTrustReport({ database, identityReport });

    const packet = buildCompliancePacket({ database, trustReport, framework: "gdpr" });

    expect(packet.framework).toBe("gdpr");
    const art30 = packet.controls.find((control) => control.controlId === "GDPR-Art30");
    expect(art30).toBeDefined();
    expect(art30?.status).toBe("partial");
    expect(packet.markdown).toContain("GDPR Article-Level Evidence");
  });

  it("two packets generated at the same instant from same state produce same digest", () => {
    database = tempDb();
    const identityReport = buildIdentityReport(database, new ToolRegistry());
    const trustReport = buildTrustReport({ database, identityReport, generatedAt: "2026-05-11T12:00:00.000Z" });
    const packetA = buildCompliancePacket({
      database,
      trustReport,
      framework: "soc2",
      generatedAt: "2026-05-11T12:00:00.000Z"
    });
    const packetB = buildCompliancePacket({
      database,
      trustReport,
      framework: "soc2",
      generatedAt: "2026-05-11T12:00:00.000Z"
    });
    expect(packetA.digest).toBe(packetB.digest);
    expect(packetA.trustReportHash).toBe(packetB.trustReportHash);
  });
});
