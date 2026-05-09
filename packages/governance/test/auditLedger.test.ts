import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { AuditLedger, GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("audit ledger", () => {
  it("appends tamper-evident entries and redacts secrets", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const ledger = new AuditLedger(db);
    ledger.append({
      actorType: "user",
      actorId: "user_local_admin",
      action: "secret.set",
      resourceType: "secret",
      resourceId: "demo",
      outcome: "created",
      detail: { value: "sk-test-1234567890abcdef" }
    });
    expect(ledger.verify().ok).toBe(true);
    expect(JSON.stringify(ledger.latest()[0])).not.toContain("sk-test-1234567890abcdef");
    const entries = ledger.all();
    entries[0].action = "tampered";
    expect(ledger.verify(entries).ok).toBe(false);
  });
});
