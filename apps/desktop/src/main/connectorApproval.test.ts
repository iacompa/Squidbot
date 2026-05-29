import { describe, expect, it, vi } from "vitest";
import type { GovernanceEnforcer } from "@squidbot/governance";
import { checkConnectorApprovalGovernance } from "./connectorApproval";

function enforcer(assertAllowed: () => unknown): GovernanceEnforcer {
  return { assertAllowed } as unknown as GovernanceEnforcer;
}

describe("checkConnectorApprovalGovernance", () => {
  it("allows when the enforcer permits the connector operation", () => {
    const result = checkConnectorApprovalGovernance(
      enforcer(() => ({ decision: "allow" })),
      { connectorName: "github", operationId: "createIssue" }
    );
    expect(result.allowed).toBe(true);
  });

  it("blocks (without throwing) when the enforcer denies", () => {
    const result = checkConnectorApprovalGovernance(
      enforcer(() => {
        throw new Error("policy: write denied");
      }),
      { connectorName: "github", operationId: "deleteRepo" }
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toMatch(/denied/);
    }
  });

  it("gates the connector operation as a tool resource (consistent with the runtime gate)", () => {
    const assertAllowed = vi.fn((_input: { action: string; resource: { id: string } }) => ({ decision: "allow" }));
    checkConnectorApprovalGovernance(enforcer(assertAllowed as unknown as () => unknown), {
      connectorName: "github",
      operationId: "createIssue",
      sessionId: "s1"
    });
    const input = assertAllowed.mock.calls[0][0];
    expect(input.action).toBe("tool.invoke");
    expect(input.resource.id).toBe("connector.github.createIssue");
  });
});
