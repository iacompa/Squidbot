import { describe, expect, it } from "vitest";
import { decide, type PolicyDecision } from "../src/sensitivityPolicy.js";
import type { ConnectorEndpoint, ConnectorManifest } from "../src/manifest.js";

function manifestWith(overrides: Partial<ConnectorManifest> = {}): ConnectorManifest {
  return {
    name: "test", systemType: "test", description: "test", protocol: "rest",
    auth: { type: "bearer" }, permissions: [],
    endpoints: [], dataClassifications: [], fixtureMode: false,
    costOwner: "free", readWrite: { read: ["listFoo"], write: ["createFoo"] },
    ...overrides
  } as ConnectorManifest;
}

function endpoint(operationId: string, opts: Partial<ConnectorEndpoint> = {}): ConnectorEndpoint {
  return {
    operationId, method: "GET", path: "/x", description: "x",
    permission: "low", inputSchema: {}, outputSchema: {}, dataClassifications: [],
    ...opts
  } as ConnectorEndpoint;
}

describe("sensitivityPolicy.decide", () => {
  const m = manifestWith({
    permissions: [
      { name: "low", riskLevel: "low", requiresApproval: false },
      { name: "high", riskLevel: "high", requiresApproval: true }
    ]
  });
  const readEp = endpoint("listFoo", { permission: "low" });
  const writeEp = endpoint("createFoo", { permission: "low" });
  const approvalReqEp = endpoint("createFoo", { permission: "high" });

  it("standard: reads and writes both execute; approval-required still queues", () => {
    expect(decide(m, readEp, "standard").mode).toBe("execute");
    expect(decide(m, writeEp, "standard").mode).toBe("execute");
    expect(decide(m, approvalReqEp, "standard").mode).toBe("queue");
  });

  it("sensitive: reads execute, writes queue, approval-required queues", () => {
    expect(decide(m, readEp, "sensitive").mode).toBe("execute");
    expect(decide(m, writeEp, "sensitive").mode).toBe("queue");
    expect(decide(m, approvalReqEp, "sensitive").mode).toBe("queue");
  });

  it("regulated: everything queues", () => {
    expect(decide(m, readEp, "regulated").mode).toBe("queue");
    expect(decide(m, writeEp, "regulated").mode).toBe("queue");
    expect(decide(m, approvalReqEp, "regulated").mode).toBe("queue");
  });

  it("air-gapped: everything denied with a clear reason", () => {
    expect(decide(m, readEp, "air-gapped").mode).toBe("deny");
    expect(decide(m, writeEp, "air-gapped").mode).toBe("deny");
    const result = decide(m, approvalReqEp, "air-gapped") as Extract<PolicyDecision, { mode: "deny" }>;
    expect(result.reason).toMatch(/air-gapped/i);
  });

  it("queue decision carries the operation's risk level", () => {
    const result = decide(m, approvalReqEp, "standard") as Extract<PolicyDecision, { mode: "queue" }>;
    expect(result.riskLevel).toBe("high");
  });
});
