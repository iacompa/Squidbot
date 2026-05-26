import { DEFAULT_TENANT_ID } from "./types.js";

export class TenantIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantIsolationError";
  }
}

export function assertTenantAccess(recordTenantId: string, actorTenantId: string): void {
  if (!recordTenantId || !actorTenantId) {
    throw new TenantIsolationError("Tenant id is required for isolated resources.");
  }
  if (recordTenantId !== actorTenantId) {
    throw new TenantIsolationError(`Cross-tenant access denied: ${actorTenantId} -> ${recordTenantId}`);
  }
}

export function filterByTenant<T>(
  items: T[],
  actorTenantId: string,
  getTenantId: (item: T) => string
): T[] {
  if (!actorTenantId) {
    throw new TenantIsolationError("actorTenantId is required for tenant filtering.");
  }
  return items.filter((item) => getTenantId(item) === actorTenantId);
}

export function tenantScopedQuery(tenantId: string = DEFAULT_TENANT_ID): { tenantId: string } {
  return { tenantId };
}
