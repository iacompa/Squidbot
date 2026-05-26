import { describe, expect, it } from "vitest";
import { GovernanceEngine } from "../src/governanceEngine.js";
import { SsoManager } from "../src/sso.js";
import { tempDb } from "./helpers.js";

describe("SsoManager", () => {
  it("lists local SSO by default and reports OIDC as unconfigured", () => {
    const database = tempDb();
    const manager = new SsoManager(database);
    const providers = manager.listProviders();
    expect(providers.find((provider) => provider.id === "local")?.available).toBe(true);
    expect(providers.find((provider) => provider.id === "oidc")?.configured).toBe(false);
  });

  it("reports OIDC configured when issuer and client id are set, but available stays false until implemented", () => {
    const database = tempDb();
    database.setSetting("sso.oidc.issuer", "https://issuer.example.test");
    database.setSetting("sso.oidc.clientId", "client-id");
    const manager = new SsoManager(database);
    const oidc = manager.listProviders().find((provider) => provider.id === "oidc");
    expect(oidc?.configured).toBe(true);
    expect(oidc?.available).toBe(false);
  });

  it("rejects login with an arbitrary token", async () => {
    const database = tempDb();
    const manager = new SsoManager(database);
    const result = await manager.login("local", { token: "anything-random" });
    expect(result.ok).toBe(false);
  });

  it("accepts login with a registered token and returns the registered subject", async () => {
    const database = tempDb();
    const manager = new SsoManager(database);
    manager.registerLocalToken("secret-token-abc", "user_local_admin");
    const result = await manager.login("local", { token: "secret-token-abc" });
    expect(result.ok).toBe(true);
    expect(result.subject).toBe("user_local_admin");
  });

  it("rejects token with wrong subject claim", async () => {
    const database = tempDb();
    const manager = new SsoManager(database);
    manager.registerLocalToken("secret-token-abc", "user_local_admin");
    const result = await manager.login("local", { token: "different-token" });
    expect(result.ok).toBe(false);
  });

  it("allows anonymous login by default and returns local admin", async () => {
    const database = tempDb();
    const manager = new SsoManager(database);
    const result = await manager.login("local", {});
    expect(result.ok).toBe(true);
    expect(result.subject).toBe("user_local_admin");
  });

  it("denies anonymous login when sso.local.allowAnonymous is false", async () => {
    const database = tempDb();
    database.setSetting("sso.local.allowAnonymous", false);
    const manager = new SsoManager(database);
    const result = await manager.login("local", {});
    expect(result.ok).toBe(false);
  });
});

describe("GovernanceEngine SSO status", () => {
  it("includes tenant isolation and SSO providers in status", () => {
    const database = tempDb();
    const governance = new GovernanceEngine(database);
    governance.bootstrap();
    const status = governance.status();
    expect(status.tenantIsolation.enabled).toBe(true);
    expect(status.ssoProviders.length).toBeGreaterThanOrEqual(3);
  });
});
