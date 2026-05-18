import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase } from "@squidbot/db";
import { ConnectorRegistry, installDeveloperWorkflowConnectors } from "../src/index.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-devint-"));
  tempDirs.push(dir);
  return initializeDatabase(path.join(dir, "test.sqlite"));
}

describe("installDeveloperWorkflowConnectors", () => {
  it("refreshes the cached manifest from disk on every install", () => {
    const database = tempDb();
    const registry = new ConnectorRegistry(database);

    // Pre-seed a stale manifest for "github" with fixtureMode: true.
    // The validator requires non-empty permissions/endpoints, so use a
    // single-endpoint stub — well below the disk manifest's count.
    database.saveConnector({
      id: "connector-stale",
      name: "github",
      manifest: {
        name: "github",
        systemType: "version_control",
        description: "Stale.",
        protocol: "rest",
        auth: { type: "bearer" },
        permissions: [{ name: "stale", riskLevel: "low", requiresApproval: false }],
        endpoints: [
          {
            operationId: "stale",
            method: "GET",
            path: "/stale",
            permission: "stale",
            inputSchema: { type: "object", properties: {} },
            outputSchema: { type: "object", properties: {} },
            dataClassifications: ["public"]
          }
        ],
        dataClassifications: ["public"],
        costOwner: "free",
        fixtureMode: true,
        readWrite: { read: ["stale"], write: [] }
      },
      createdAt: new Date().toISOString()
    });

    // Construct a fresh registry that reads the stale row into memory…
    const stale = new ConnectorRegistry(database);
    expect(stale.getConnector("github")?.fixtureMode).toBe(true);

    // …then run install. The disk manifest's current value must overwrite.
    const refreshed = installDeveloperWorkflowConnectors(stale);
    const github = refreshed.find((c) => c.name === "github");
    expect(github).toBeDefined();
    // After Task A.2 lands the file flip, this will be `false`. Until then,
    // the test only proves that the manifest was re-read from disk by
    // checking that endpoints (the real manifest has 22) replaced the empty
    // stub above:
    expect((github?.endpoints.length ?? 0)).toBeGreaterThan(5);
    database.close();
  });
});
