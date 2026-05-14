// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      getTrustReport: vi.fn(async () => ({
        schemaVersion: "1",
        generatedAt: "2026-05-14T00:00:00.000Z",
        agentName: "SquidBot",
        agentVersion: "0.1.0",
        profile: {
          active: true,
          industry: "saas",
          displayName: "Acme Corp",
          sensitivity: "sensitive",
          readOnlyByDefault: false
        },
        audit: {
          entryCount: 12,
          last24hCount: 3,
          latestSequence: 12,
          latestEntryHash: "abc123def456abc123def456abc123def456abc123def456abc123def456",
          latestEntryAt: "2026-05-14T00:00:00.000Z",
          chainValid: true,
          chainFailureSequence: null,
          chainFailureReason: null
        },
        policy: {
          policyPackCount: 8,
          policyPacks: [],
          abacRuleCount: 2,
          decisionCount: 5,
          denyDecisionCount: 1,
          recentDenyDecisions: 0
        },
        vault: {
          secretReferenceCount: 0,
          rotatedSecretCount: 0,
          encryptedAtRest: true,
          algorithm: "AES-256-GCM"
        },
        retention: { policyCount: 0, enabledPolicyCount: 0, legalHoldCount: 0, activeLegalHoldCount: 0 },
        affordanceGaps: { openCount: 0, resolvedCount: 0, wontfixCount: 0, highSeverityOpenCount: 0 },
        sandbox: { activeCount: 0, promotedCount: 0, rejectedCount: 0 },
        connectors: { registeredCount: 0, readOnlyDefault: false, fixtureMode: true },
        capabilities: { toolCount: 7, permissionScopes: ["filesystem.read"] },
        zeroSpendDefault: true,
        redactionEnabled: true,
        healthScore: 95,
        healthLabel: "excellent",
        warnings: []
      })),
      getTrustDigest: vi.fn(async () => ({
        schemaVersion: "1",
        hash: "deadbeef".repeat(8),
        generatedAt: "2026-05-14T00:00:00.000Z",
        agentName: "SquidBot",
        agentVersion: "0.1.0",
        profile: "Acme Corp",
        healthScore: 95,
        healthLabel: "excellent",
        auditChainValid: true
      })),
      buildCompliancePacket: vi.fn(),
      listSquidbotCommands: vi.fn(async () => [
        { id: "trust.summary", label: "trust summary", description: "Summary", displayCommand: "npm run trust -- summary", outputIsMarkdown: false },
        { id: "trust.digest", label: "trust digest", description: "Digest", displayCommand: "npm run trust -- digest", outputIsMarkdown: false }
      ]),
      runSquidbotCommand: vi.fn()
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("TrustPage", () => {
  it("renders health score, audit stats, vault state, and trust digest", async () => {
    const { TrustPage } = await import("./TrustPage");
    render(<TrustPage />);

    await waitFor(() => {
      expect(screen.getByText("95")).toBeTruthy(); // health score
    });
    expect(screen.getByText("excellent")).toBeTruthy();
    expect(screen.getByText("AES-256-GCM")).toBeTruthy();
    // "yes" appears in multiple cells (chain valid + encrypted at rest), so
    // we settle for "there is at least one yes" rather than exactly one.
    expect(screen.getAllByText("yes").length).toBeGreaterThan(0);
    // Digest hash visible (truncated form may appear; check substring)
    expect(screen.getByText(/deadbeef/)).toBeTruthy();
    // Compliance generator surface
    expect(screen.getByLabelText("Compliance framework")).toBeTruthy();
  });
});
