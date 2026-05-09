// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      bootstrapGovernance: vi.fn(async () => ({ organizationId: "local-org", tenantId: "local-tenant", adminUserId: "user_local_admin", rolesCreated: 1 })),
      getGovernanceStatus: vi.fn(async () => ({
        tenantId: "local-tenant",
        users: 1,
        roles: 2,
        decisions: 0,
        auditEntries: 1,
        secrets: 0,
        retentionPolicies: 0,
        legalHolds: 0,
        n8nIntegrations: 1,
        policyPacks: 8
      })),
      listGovernanceUsers: vi.fn(async () => [
        { id: "user_local_admin", tenantId: "local-tenant", email: "local@example.test", username: "local-admin", displayName: "Local Admin", status: "active", authType: "local", createdAt: "now", updatedAt: "now", disabledAt: null }
      ]),
      listGovernanceRoles: vi.fn(async () => [{ id: "role_owner", name: "owner", description: "Owner", permissions: ["*"] }]),
      listGovernancePolicyDecisions: vi.fn(async () => []),
      listGovernanceSecrets: vi.fn(async () => []),
      listGovernanceAudit: vi.fn(async () => [{ id: "audit_1", tenantId: "local-tenant", sequence: 1, actorType: "system", actorId: "system", action: "governance.bootstrap", resourceType: "tenant", resourceId: "local-tenant", outcome: "completed", previousHash: null, entryHash: "hash", createdAt: "now" }]),
      listGovernanceRetentionPolicies: vi.fn(async () => []),
      listGovernanceN8nIntegrations: vi.fn(async () => [{ id: "n8n_1", name: "Compliance Alerts", direction: "inbound", authMode: "hmac", allowedEventTypes: ["policy.violation"], allowedActions: ["audit.request"], enabled: true }]),
      simulateGovernancePolicy: vi.fn(async () => ({ tenantId: "local-tenant", decision: "requireApproval", reason: "High-risk action requires approval.", matchedPolicies: ["abac.highRiskApproval"], obligations: ["approval"] }))
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("GovernancePage", () => {
  it("renders governance state and policy simulation", async () => {
    const { GovernancePage } = await import("./GovernancePage");
    render(<GovernancePage />);
    expect(await screen.findByText("Security Control Plane")).toBeTruthy();
    expect(await screen.findByText("local-admin")).toBeTruthy();
    fireEvent.click(screen.getByText("Simulate"));
    await waitFor(() => expect(screen.getAllByText("requireApproval").length).toBeGreaterThan(0));
  });
});
