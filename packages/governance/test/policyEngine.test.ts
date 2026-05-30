import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { GovernanceEngine } from "../src/index.js";
import { tempDb } from "./helpers.js";

let db: SquidDatabase | null = null;
afterEach(() => db?.close());

describe("policy decision persistence", () => {
  it("persists policy decisions and audits denied decisions", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const decision = governance.decide({
      actor: { type: "user", id: "unknown" },
      action: "connector.github.createPullRequest",
      resource: { type: "connector", id: "github" }
    });
    expect(decision.decision).toBe("deny");
    expect(governance.policies.listDecisions()).toHaveLength(1);
    expect(governance.audit.latest().some((entry) => entry.action === "connector.github.createPullRequest")).toBe(true);
  });
});

describe("policy engine role trust", () => {
  it("ignores caller-supplied roles and uses identity store as source of truth", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    // Caller tries to claim the owner role for an unknown user
    const decision = governance.decide({
      actor: {
        type: "user",
        id: "unknown_attacker",
        // @ts-expect-error — `roles` was removed from GovernanceActor; this test verifies it is ignored at runtime even if passed
        roles: ["owner"]
      },
      action: "secret.reveal",
      resource: { type: "secret", id: "any" }
    });
    expect(decision.decision).toBe("deny");
  });

  it("denies access to disabled users", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    const { adminUserId } = governance.bootstrap();
    governance.identities.disableUser(adminUserId);
    const decision = governance.decide({
      actor: { type: "user", id: adminUserId },
      action: "secret.reveal",
      resource: { type: "secret", id: "any" }
    });
    expect(decision.decision).toBe("deny");
  });

  it("ignores expired role assignments", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const userId = "user_test_expired";
    governance.identities.createUser({ id: userId, username: "expired", displayName: "Expired User" });
    governance.identities.assignRole({
      principalType: "user",
      principalId: userId,
      roleName: "owner",
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    });
    const roles = governance.identities.getActorRoleNames("user", userId);
    expect(roles).toEqual([]);
  });

  it("honors non-expired role assignments", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const userId = "user_test_valid";
    governance.identities.createUser({ id: userId, username: "valid", displayName: "Valid User" });
    governance.identities.assignRole({
      principalType: "user",
      principalId: userId,
      roleName: "developer",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    const roles = governance.identities.getActorRoleNames("user", userId);
    expect(roles).toContain("developer");
  });
});

describe("policy decision tenant scoping", () => {
  it("listDecisions is scoped to the tenant", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    // Persist a decision in default tenant
    governance.decide({
      actor: { type: "user", id: "u1" },
      action: "memory.read",
      resource: { type: "memory", id: "m1" }
    });
    // Persist a decision in another tenant
    governance.decide({
      tenantId: "tenant_other",
      actor: { type: "user", id: "u2" },
      action: "memory.read",
      resource: { type: "memory", id: "m2" }
    });
    const defaultDecisions = governance.policies.listDecisions(100);
    const otherDecisions = governance.policies.listDecisions(100, "tenant_other");
    expect(defaultDecisions.every((d) => d.tenantId === "local-tenant")).toBe(true);
    expect(otherDecisions.every((d) => d.tenantId === "tenant_other")).toBe(true);
    expect(otherDecisions.length).toBe(1);
  });
});

describe("trusted local system runtime authorization", () => {
  it("allows the local system runtime actor to invoke tools", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    // This is the EXACT input AgentRuntime.executeToolCall passes (runtime.ts).
    // Before the fix, the system actor had no role → deny → every tool blocked
    // in the desktop (which wires the real enforcer).
    const decision = governance.policies.decide(
      {
        actor: { type: "system", id: "runtime:sess_1" },
        action: "tool.invoke",
        resource: { type: "tool", id: "workspace.readFile" }
      },
      { persist: false }
    );
    expect(decision.decision).toBe("allow");
  });

  it("still requires approval for a high-risk system tool invocation", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const decision = governance.policies.decide(
      {
        actor: { type: "system", id: "runtime:sess_1" },
        action: "tool.invoke",
        resource: { type: "tool", id: "connector.github.merge" },
        context: { riskLevel: "critical" }
      },
      { persist: false }
    );
    // Base allow for the trusted runtime, but the high-risk ABAC obligation
    // must still upgrade it to requireApproval — granting base access must NOT
    // bypass the safety layer.
    expect(decision.decision).toBe("requireApproval");
  });

  it("still denies a system tool invocation that violates zero-spend", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const decision = governance.policies.decide(
      {
        actor: { type: "system", id: "runtime:sess_1" },
        action: "tool.invoke",
        resource: { type: "tool", id: "model.call" },
        context: { costOwner: "user-paid" }
      },
      { persist: false }
    );
    expect(decision.decision).toBe("deny");
  });

  it("does not grant base authorization to untrusted service accounts", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    const decision = governance.policies.decide(
      {
        actor: { type: "serviceAccount", id: "svc_untrusted" },
        action: "tool.invoke",
        resource: { type: "tool", id: "workspace.readFile" }
      },
      { persist: false }
    );
    expect(decision.decision).toBe("deny");
  });
});

describe("policy decision context redaction", () => {
  it("redacts secret-shaped values in persisted context", () => {
    db = tempDb();
    const governance = new GovernanceEngine(db);
    governance.bootstrap();
    governance.decide({
      actor: { type: "user", id: "u1" },
      action: "memory.read",
      resource: { type: "memory", id: "m1" },
      context: {
        source: "test",
        // These should be redacted by redactValue (sensitiveKeyPattern + secret detection)
        apiKey: "sk-1234567890abcdefghijklmnop",
        password: "supersecretpassword"
      } as never
    });
    const stored = db.db
      .prepare(`SELECT contextJson FROM policy_decisions ORDER BY createdAt DESC LIMIT 1`)
      .get() as { contextJson: string };
    expect(stored.contextJson).not.toContain("sk-1234567890abcdefghijklmnop");
    expect(stored.contextJson).not.toContain("supersecretpassword");
  });
});
