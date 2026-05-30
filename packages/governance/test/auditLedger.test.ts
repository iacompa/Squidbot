import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { AuditLedger, GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

function appendN(ledger: AuditLedger, n: number, tenantId?: string): void {
  for (let i = 0; i < n; i++) {
    ledger.append({ tenantId, actorType: "user", actorId: "u", action: "a", resourceType: "r", resourceId: String(i), outcome: "ok" });
  }
}

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

  it("detects tail-truncation via the out-of-DB head anchor", () => {
    db = tempDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-anchor-"));
    const anchorPath = path.join(dir, "audit.head.json");
    const ledger = new AuditLedger(db, anchorPath);
    appendN(ledger, 3);
    expect(ledger.verify().ok).toBe(true);

    // Attacker with DB write deletes the most recent entry — the remaining
    // chain is still internally valid, so chain-only verification misses it.
    // The anchored head (stored outside the DB) no longer matches → detected.
    db.db.prepare("DELETE FROM audit_ledger WHERE sequence = (SELECT MAX(sequence) FROM audit_ledger)").run();
    expect(ledger.verify().ok).toBe(false);
  });

  it("does not false-positive on a chain written before the anchor existed (upgrade)", () => {
    db = tempDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-anchor-"));
    const anchorPath = path.join(dir, "audit.head.json");
    // Entries written with NO anchor (a pre-upgrade install).
    appendN(new AuditLedger(db), 3);
    // A post-upgrade anchored ledger must verify the intact chain as OK — an
    // empty anchor means "no record yet", NOT "truncated".
    const anchored = new AuditLedger(db, anchorPath);
    expect(anchored.verify().ok).toBe(true);
  });

  it("verifyAll covers every tenant's chain, not just the default tenant", () => {
    db = tempDb();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-anchor-"));
    const ledger = new AuditLedger(db, path.join(dir, "audit.head.json"));
    appendN(ledger, 2); // default tenant
    appendN(ledger, 2, "tenant_b");
    expect(ledger.verifyAll().ok).toBe(true);

    // Truncate tenant_b only — default-tenant verify() would still say "ok".
    db.db.prepare("DELETE FROM audit_ledger WHERE tenantId = 'tenant_b' AND sequence = (SELECT MAX(sequence) FROM audit_ledger WHERE tenantId = 'tenant_b')").run();
    expect(ledger.verifyAll().ok).toBe(false);
  });
});
