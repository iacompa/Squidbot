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
});
