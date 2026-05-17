import { describe, expect, it } from "vitest";
import { validateConnectorManifest } from "../src/manifest.js";

describe("ConnectorManifest — testEndpoint field", () => {
  function minimalManifest(overrides: Record<string, unknown> = {}) {
    return {
      name: "testConnector",
      systemType: "test",
      description: "test connector",
      protocol: "rest",
      auth: { type: "bearer" },
      permissions: [
        { name: "readUser", riskLevel: "low", requiresApproval: false }
      ],
      endpoints: [
        {
          operationId: "readUser",
          method: "GET",
          path: "/user",
          permission: "readUser",
          inputSchema: { type: "object", properties: {} },
          outputSchema: { type: "object", properties: {} }
        }
      ],
      dataClassifications: ["public"],
      fixtureMode: true,
      costOwner: "free",
      readWrite: { read: ["readUser"], write: [] },
      ...overrides
    };
  }

  it("accepts a valid testEndpoint", () => {
    const result = validateConnectorManifest(
      minimalManifest({ testEndpoint: { method: "GET", path: "/user" } })
    );
    expect(result.testEndpoint).toEqual({ method: "GET", path: "/user" });
  });

  it("accepts manifest without a testEndpoint (field is optional)", () => {
    const result = validateConnectorManifest(minimalManifest());
    expect(result.testEndpoint).toBeUndefined();
  });

  it("rejects a malformed testEndpoint (missing method)", () => {
    expect(() =>
      validateConnectorManifest(minimalManifest({ testEndpoint: { path: "/user" } }))
    ).toThrow(/testEndpoint/i);
  });

  it("rejects testEndpoint with non-string method", () => {
    expect(() =>
      validateConnectorManifest(minimalManifest({ testEndpoint: { method: 123, path: "/x" } }))
    ).toThrow(/method/i);
  });

  it("normalizes method to uppercase (regression for I4)", () => {
    const result = validateConnectorManifest(
      minimalManifest({ testEndpoint: { method: "get", path: "/user" } })
    );
    expect(result.testEndpoint).toEqual({ method: "GET", path: "/user" });
  });
});
