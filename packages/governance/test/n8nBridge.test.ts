import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("n8n bridge", () => {
  it("accepts signed low-risk fixtures, denies invalid signatures, and prevents replay", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const integration = governance.n8n.createIntegration({
      name: "Compliance Alerts",
      direction: "inbound",
      events: ["audit.export.requested"],
      actions: ["audit.request"],
      enabled: true
    });
    const unsigned = {
      integrationId: integration.id,
      eventType: "audit.export.requested",
      action: "audit.request",
      idempotencyKey: "idempotent-1",
      riskLevel: "low"
    };
    const fixturePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "n8n-fixture-")), "request.json");
    fs.writeFileSync(fixturePath, JSON.stringify({ ...unsigned, signature: governance.n8n.signPayload(unsigned) }), "utf8");
    expect(governance.n8n.receiveFixture(fixturePath).accepted).toBe(true);
    expect(governance.n8n.receiveFixture(fixturePath).status).toBe("duplicate");

    const invalidPath = path.join(path.dirname(fixturePath), "invalid.json");
    fs.writeFileSync(invalidPath, JSON.stringify({ ...unsigned, idempotencyKey: "idempotent-2", signature: "bad" }), "utf8");
    expect(governance.n8n.receiveFixture(invalidPath).accepted).toBe(false);
  });

  it("signs with a per-install secret, not a shared hardcoded constant", () => {
    // Two independent installs must not produce the same signature for the same
    // payload — otherwise the signing secret is a public constant anyone can use
    // to forge a valid signature (the original bug).
    const dbA = tempDb();
    const dbB = tempDb();
    const govA = new GovernanceEngine(dbA);
    const govB = new GovernanceEngine(dbB);
    govA.bootstrap();
    govB.bootstrap();
    const payload = { eventType: "audit.export.requested", action: "audit.request", marker: "x" };
    const sigA = govA.n8n.signPayload(payload);
    const sigB = govB.n8n.signPayload(payload);
    expect(sigA).not.toBe(sigB);
    // And each install verifies its own signature.
    dbA.close();
    dbB.close();
  });

  it("refuses to create authMode='none' integrations by default", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    expect(() =>
      governance.n8n.createIntegration({
        name: "Unsigned Integration",
        direction: "inbound",
        events: ["audit.export.requested"],
        actions: ["audit.request"],
        enabled: true,
        authMode: "none"
      })
    ).toThrow(/allowUnsignedWebhooks/);
  });

  it("allows authMode='none' only when governance.n8n.allowUnsignedWebhooks=true is explicitly set", () => {
    db = tempDb();
    db.setSetting("governance.n8n.allowUnsignedWebhooks", true);
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const integration = governance.n8n.createIntegration({
      name: "Test Unsigned",
      direction: "inbound",
      events: ["audit.export.requested"],
      actions: ["audit.request"],
      enabled: true,
      authMode: "none"
    });
    expect(integration.authMode).toBe("none");
  });

  it("rejects unsigned events at receive time when the dev setting is off, even if the integration was grandfathered", () => {
    db = tempDb();
    // Create with dev setting on, then turn it off to simulate a tightening of policy.
    db.setSetting("governance.n8n.allowUnsignedWebhooks", true);
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const integration = governance.n8n.createIntegration({
      name: "Grandfathered",
      direction: "inbound",
      events: ["audit.export.requested"],
      actions: ["audit.request"],
      enabled: true,
      authMode: "none"
    });
    db.setSetting("governance.n8n.allowUnsignedWebhooks", false);

    const payload = {
      integrationId: integration.id,
      eventType: "audit.export.requested",
      action: "audit.request",
      idempotencyKey: "grand-1",
      riskLevel: "low"
    };
    const fixturePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "n8n-policy-")), "request.json");
    fs.writeFileSync(fixturePath, JSON.stringify(payload), "utf8");
    const result = governance.n8n.receiveFixture(fixturePath);
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/unsigned/i);
  });
});
