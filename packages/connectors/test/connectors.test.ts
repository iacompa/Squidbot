import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentRuntime, getLatestTrace, ModelRouter, ToolRegistry } from "@squidbot/core";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import {
  ConnectorRegistry,
  executeConnectorOperation,
  getFixtureResponse,
  importOpenApi,
  installDeveloperWorkflowConnectors,
  loadConnectorManifestFile,
  registerConnectorTools,
  validateConnectorManifest,
  type ConnectorManifest
} from "../src/index.js";

let database: SquidDatabase | null = null;
const tempDirs: string[] = [];

afterEach(() => {
  database?.close();
  database = null;
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function createTempDir(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-connectors-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const tempDir = createTempDir();
  const workspacePath = path.join(tempDir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Connector fixture\n", "utf8");
  return {
    dbPath: path.join(tempDir, "squidbot.sqlite"),
    workspacePath
  };
}

function demoManifest(fixtureData: ConnectorManifest["fixtureData"] = { readSales: [{ id: "sale_001" }] }): ConnectorManifest {
  return validateConnectorManifest({
    name: "demoSales",
    systemType: "crm",
    description: "Local fixture connector for sales data.",
    protocol: "file",
    auth: { type: "none", scopes: [] },
    permissions: [
      { name: "readSales", riskLevel: "low", requiresApproval: false },
      { name: "writeSales", riskLevel: "medium", requiresApproval: true }
    ],
    endpoints: [
      {
        operationId: "readSales",
        method: "GET",
        path: "/sales",
        permission: "readSales",
        inputSchema: { type: "object", properties: {} },
        outputSchema: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" }
            }
          }
        },
        dataClassifications: ["public"]
      },
      {
        operationId: "createSale",
        method: "POST",
        path: "/sales",
        permission: "writeSales",
        inputSchema: { type: "object", properties: { id: { type: "string" } } },
        outputSchema: { type: "object", properties: { id: { type: "string" } } },
        dataClassifications: ["public"]
      }
    ],
    dataClassifications: ["public"],
    rateLimits: { callsPerMinute: 60 },
    costOwner: "free",
    fixtureMode: true,
    fixtureData,
    readWrite: {
      read: ["readSales"],
      write: ["createSale"]
    }
  });
}

describe("connector manifests", () => {
  it("loads valid manifests and reports schema errors", () => {
    const tempDir = createTempDir();
    const fixturePath = path.join(tempDir, "sales.json");
    const manifestPath = path.join(tempDir, "salesConnector.json");

    fs.writeFileSync(fixturePath, JSON.stringify({ readSales: [{ id: "sale_file" }] }), "utf8");
    fs.writeFileSync(manifestPath, JSON.stringify({ ...demoManifest("sales.json") }), "utf8");

    const loaded = loadConnectorManifestFile(manifestPath);

    expect(loaded.name).toBe("demoSales");
    expect(loaded.fixtureData).toBe(fixturePath);
    expect(() => validateConnectorManifest({ name: "bad" })).toThrow(/Invalid connector manifest/);
  });
});

describe("fixture mode", () => {
  it("returns fixture data or generated dummy payloads", () => {
    const manifest = demoManifest({ readSales: [{ id: "sale_fixture" }] });
    const endpoint = manifest.endpoints.find((candidate) => candidate.operationId === "readSales");

    expect(endpoint).toBeDefined();
    expect(getFixtureResponse(manifest, endpoint!)).toEqual([{ id: "sale_fixture" }]);
    expect(getFixtureResponse({ ...manifest, fixtureData: undefined }, endpoint!)).toEqual([{ id: "" }]);
  });
});

describe("OpenAPI importer", () => {
  it("generates a manifest and TypeScript tool stubs", () => {
    const tempDir = createTempDir();
    const specPath = path.join(tempDir, "petstore.json");
    const manifestPath = path.join(tempDir, "petstoreConnector.json");
    const generatedRoot = path.join(tempDir, "generated");

    fs.writeFileSync(
      specPath,
      JSON.stringify({
        openapi: "3.0.3",
        info: { title: "Petstore", description: "Fixture pet store" },
        paths: {
          "/pets": {
            get: {
              operationId: "listPets",
              tags: ["pets"],
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": {
                      schema: {
                        type: "array",
                        items: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }),
      "utf8"
    );

    const result = importOpenApi({
      specPath,
      name: "petstore",
      manifestOutputPath: manifestPath,
      generatedRoot
    });

    expect(result.manifest.name).toBe("petstore");
    expect(result.manifest.endpoints.map((endpoint) => endpoint.operationId)).toEqual(["listPets"]);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.readFileSync(path.join(generatedRoot, "index.ts"), "utf8")).toContain("export async function listPets");
  });
});

describe("connector runtime integration", () => {
  it("calls a fixture connector and records connector events in traces", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const registry = new ConnectorRegistry(database);
    registry.registerConnector(demoManifest({ readSales: [{ id: "sale_runtime" }] }));

    const toolRegistry = new ToolRegistry();
    registerConnectorTools(toolRegistry, new ConnectorRegistry(database));
    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      toolRegistry
    });

    const result = await runtime.runTask("Call the demoSales connector to list sales");
    const eventTypes = database.listEvents(result.sessionId).map((event) => event.type);
    const traceSteps = getLatestTrace(database)?.steps.map((step) => step.type) ?? [];

    expect(result.toolResults.map((toolResult) => toolResult.toolName)).toEqual(["connector.demoSales.readSales"]);
    expect(result.toolResults[0]?.output).toMatchObject({ fixture: true, response: [{ id: "sale_runtime" }] });
    expect(eventTypes).toContain("connector.call");
    expect(eventTypes).toContain("connector.fixture");
    expect(traceSteps).toContain("connector.call");
    expect(traceSteps).toContain("connector.fixture");
  });

  it("denies approval-gated connector writes and records the denial", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const registry = new ConnectorRegistry(database);
    registry.registerConnector(demoManifest());

    const toolRegistry = new ToolRegistry();
    registerConnectorTools(toolRegistry, new ConnectorRegistry(database));
    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      toolRegistry,
      modelRouter: new ModelRouter({
        name: "write-test",
        modelName: "write-test",
        mode: "mock",
        maxTokens: 16_000,
        supportsTools: true,
        costOwner: "local/free",
        generate: async () => ({
          provider: "write-test",
          modelName: "write-test",
          mode: "mock",
          costOwner: "local/free",
          content: "No chat response.",
          toolCalls: []
        }),
        generateTaskPlan: async () => ({
          id: "plan_connector_write",
          problem: "Attempt an approval-gated connector write.",
          riskLevel: "medium",
          actions: [
            {
              id: "action_connector_write",
              description: "Attempt to create a sale through the connector.",
              toolName: "connector.demoSales.createSale",
              args: { id: "sale_write" }
            }
          ]
        })
      })
    });

    const result = await runtime.runTask("Create a sale through the demo connector");
    const eventTypes = database.listEvents(result.sessionId).map((event) => event.type);

    expect(result.toolResults[0]).toMatchObject({
      toolName: "connector.demoSales.createSale",
      ok: false
    });
    expect(eventTypes).toContain("connector.denied");
    expect(eventTypes).not.toContain("connector.call");
  });
});

describe("developer workflow connectors", () => {
  it("installs bundled GitHub, GitLab, Jira, and Jenkins connectors in fixture mode", () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const registry = new ConnectorRegistry(database);
    const installed = installDeveloperWorkflowConnectors(registry);

    expect(installed.map((connector) => connector.name).sort()).toEqual(["github", "gitlab", "jenkins", "jira"]);
    expect(registry.getConnector("github")?.fixtureMode).toBe(true);
    expect(registry.getConnector("jira")?.endpoints.map((endpoint) => endpoint.operationId)).toContain("addComment");
  });

  it("records developer workflow trace events for fixture CI and approved-style operations", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const registry = new ConnectorRegistry(database);
    installDeveloperWorkflowConnectors(registry);
    const github = registry.getConnector("github");
    expect(github).toBeDefined();

    const events: Array<{ type: string; data: unknown }> = [];
    const context = {
      workspacePath: fixture.workspacePath,
      emitEvent: (type: string, data: unknown) => events.push({ type, data })
    };
    const statusEndpoint = github!.endpoints.find((endpoint) => endpoint.operationId === "getWorkflowRunStatus")!;
    const prEndpoint = github!.endpoints.find((endpoint) => endpoint.operationId === "openDraftPullRequest")!;
    const issueEndpoint = github!.endpoints.find((endpoint) => endpoint.operationId === "addIssueComment")!;

    await executeConnectorOperation(github!, statusEndpoint, {}, context as never);
    await executeConnectorOperation(github!, prEndpoint, {}, context as never);
    await executeConnectorOperation(github!, issueEndpoint, {}, context as never);

    expect(events.map((event) => event.type)).toContain("connector.ciStatus");
    expect(events.map((event) => event.type)).toContain("connector.prDrafted");
    expect(events.map((event) => event.type)).toContain("connector.issueUpdated");
  });

  it("keeps developer write operations approval-gated in the runtime", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const registry = new ConnectorRegistry(database);
    installDeveloperWorkflowConnectors(registry);

    const toolRegistry = new ToolRegistry();
    registerConnectorTools(toolRegistry, new ConnectorRegistry(database));
    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      toolRegistry,
      modelRouter: new ModelRouter({
        name: "dev-write-test",
        modelName: "dev-write-test",
        mode: "mock",
        maxTokens: 16_000,
        supportsTools: true,
        costOwner: "local/free",
        generate: async () => ({
          provider: "dev-write-test",
          modelName: "dev-write-test",
          mode: "mock",
          costOwner: "local/free",
          content: "No chat response.",
          toolCalls: []
        }),
        generateTaskPlan: async () => ({
          id: "plan_pr_write",
          problem: "Attempt an approval-gated developer workflow write.",
          riskLevel: "high",
          actions: [
            {
              id: "action_pr_write",
              description: "Attempt to open a draft pull request.",
              toolName: "connector.github.openDraftPullRequest",
              args: { title: "Fixture PR" }
            }
          ]
        })
      })
    });

    const result = await runtime.runTask("Open a draft PR through GitHub");
    const eventTypes = database.listEvents(result.sessionId).map((event) => event.type);

    expect(result.toolResults[0]).toMatchObject({
      toolName: "connector.github.openDraftPullRequest",
      ok: false
    });
    expect(eventTypes).toContain("connector.denied");
    expect(eventTypes).not.toContain("connector.prDrafted");
  });
});
