import { describe, expect, it } from "vitest";
import { assertTenantAccess, filterByTenant, TenantIsolationError } from "../src/tenantIsolation.js";
import { DEFAULT_TENANT_ID } from "../src/types.js";

describe("tenantIsolation", () => {
  it("allows access within the same tenant", () => {
    expect(() => assertTenantAccess(DEFAULT_TENANT_ID, DEFAULT_TENANT_ID)).not.toThrow();
  });

  it("denies cross-tenant access", () => {
    expect(() => assertTenantAccess("tenant_a", "tenant_b")).toThrow(TenantIsolationError);
  });

  it("filters items by tenant id", () => {
    const items = [
      { id: "1", tenantId: "tenant_a" },
      { id: "2", tenantId: "tenant_b" },
      { id: "3", tenantId: "tenant_a" }
    ];
    const filtered = filterByTenant(items, "tenant_a", (item) => item.tenantId);
    expect(filtered.map((item) => item.id)).toEqual(["1", "3"]);
  });
});
