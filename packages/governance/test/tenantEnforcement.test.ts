import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("policy engine tenant isolation enforcement (G8)", () => {
  it("denies cross-tenant resource access even for an owner", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    const { adminUserId } = governance.bootstrap();
    const decision = governance.decide({
      tenantId: "local-tenant",
      actor: { type: "user", id: adminUserId },
      action: "memory.read",
      resource: { type: "memory", id: "m_other", attributes: { tenantId: "tenant_b" } }
    });
    expect(decision.decision).toBe("deny");
    expect(decision.reason).toMatch(/tenant/i);
    expect(decision.matchedPolicies).toContain("tenant.isolation");
  });

  it("allows same-tenant resource access for an owner", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    const { adminUserId } = governance.bootstrap();
    const decision = governance.decide({
      tenantId: "local-tenant",
      actor: { type: "user", id: adminUserId },
      action: "memory.read",
      resource: { type: "memory", id: "m_mine", attributes: { tenantId: "local-tenant" } }
    });
    expect(decision.decision).not.toBe("deny");
  });

  it("is backward compatible: a resource with no tenantId attribute is unrestricted", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    const { adminUserId } = governance.bootstrap();
    const decision = governance.decide({
      actor: { type: "user", id: adminUserId },
      action: "memory.read",
      resource: { type: "memory", id: "m1" }
    });
    expect(decision.decision).not.toBe("deny");
  });
});
