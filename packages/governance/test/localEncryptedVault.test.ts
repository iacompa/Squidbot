import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("local encrypted vault", () => {
  it("stores ciphertext, redacts by default, reveals with explicit request, and rotates", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db, "test-master-key");
    governance.bootstrap();
    governance.secrets.setSecret("demoToken", "sk-test-1234567890abcdef");
    const row = db.db.prepare("SELECT ciphertext FROM local_encrypted_secrets").get() as { ciphertext: string };
    expect(row.ciphertext).not.toContain("sk-test");
    expect(governance.secrets.getSecret("demoToken").value).toBe("[REDACTED]");
    expect(governance.secrets.getSecret("demoToken", { reveal: true }).value).toBe("sk-test-1234567890abcdef");
    const rotated = governance.secrets.setSecret("demoToken", "new-secret-value", { rotate: true });
    expect(rotated.version).toBe("2");
  });
});
