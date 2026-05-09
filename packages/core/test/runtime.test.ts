import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { MemoryGraphStore } from "@squidbot/memory";
import { AgentRuntime, approveMemoryCandidate, getLatestTrace } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-core-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Fixture\n", "utf8");
  fs.writeFileSync(path.join(workspacePath, "calculator.py"), "def add(a, b):\n    return a - b\n", "utf8");
  return {
    dbPath: path.join(dir, "squidbot.sqlite"),
    workspacePath
  };
}

describe("AgentRuntime", () => {
  it("runs a deterministic mock tool call and stores a trace", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath
    });

    const result = await runtime.sendMessage("please list files");

    expect(result.toolCalls.map((call) => call.name)).toEqual(["workspace.listFiles"]);
    expect(result.content).toContain("Tool results");
    expect(database.listEvents(result.sessionId).map((event) => event.type)).toContain("tool.result");
    expect(getLatestTrace(database)?.summary.toolCallCount).toBe(1);
  });

  it("runs a repo-aware task flow and records a trace", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath
    });

    const result = await runtime.runTask("Fix calculator error", { testCommand: "node --test" });
    const eventTypes = database.listEvents(result.sessionId).map((event) => event.type);

    expect(result.plan.actions.map((action) => action.toolName)).toContain("workspace.searchFiles");
    expect(result.plan.actions.map((action) => action.toolName)).toContain("workspace.createPatch");
    expect(result.plan.actions.map((action) => action.toolName)).toContain("test.run");
    expect(eventTypes).toContain("user.task");
    expect(eventTypes).toContain("workspace.summary");
    expect(eventTypes).toContain("plan.generated");
    expect(eventTypes).toContain("task.complete");
    expect(eventTypes).toContain("memory.retrieved");
    expect(eventTypes).toContain("memory.graph");
    expect(eventTypes).toContain("sandbox.created");
    expect(eventTypes).toContain("sandbox.command");
    expect(eventTypes).toContain("sandbox.diff");
    expect(eventTypes).toContain("sandbox.approvalRequested");
    expect(eventTypes).toContain("reflection.created");
    expect(eventTypes).toContain("memory.candidate");
    expect(eventTypes).not.toContain("affordance.gap");
    expect(result.reflection.failureTaxonomy).toEqual([]);
    expect(result.reflection.affordanceIds).toEqual([]);
    expect(database.listAffordanceGaps({ reflectionId: result.reflection.id })).toHaveLength(0);
    const testOutput = result.toolResults.find((item) => item.toolName === "test.run")?.output as
      | { exitCode?: number; sandboxMode?: string; sandboxId?: string }
      | undefined;
    expect(testOutput).toMatchObject({
      exitCode: 0,
      sandboxMode: "staged-workspace"
    });
    expect(testOutput?.sandboxId).toBeTruthy();
    const sandboxes = database.listSandboxes({ status: "active" });
    expect(sandboxes).toHaveLength(1);
    expect(sandboxes[0].diff).toContain("+    return a + b");
    expect(result.reflection.memoryCandidates).toHaveLength(1);
    expect(result.reflection.memoryCandidates[0]).toMatchObject({
      title: "Calculator bug: add subtracts"
    });
    expect(result.reflection.memoryCandidates[0]).toHaveProperty("graphNodeId");
    expect(database.listReflections()).toHaveLength(1);
    expect(new MemoryGraphStore(database).hybridSearch("addition defect", 5).map((item) => item.node.title)).toContain(
      "Calculator bug: add subtracts"
    );
    expect(getLatestTrace(database)?.steps.map((step) => step.type)).toEqual(expect.arrayContaining(["sandbox.created", "task.complete"]));
    expect(fs.readFileSync(path.join(fixture.workspacePath, "calculator.py"), "utf8")).toContain("return a - b");
  });

  it("records missing tool affordance gaps for unsupported plan actions", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath
    });

    const result = await runtime.runTask("use nonexistentTool to do something");
    const gaps = database.listAffordanceGaps({ reflectionId: result.reflection.id });

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      toolName: "nonexistentTool",
      ok: false
    });
    expect(result.reflection.failureTaxonomy).toContain("missingTool");
    expect(gaps.map((gap) => gap.name)).toContain("nonexistentTool");
    expect(getLatestTrace(database)?.steps.map((step) => step.type)).toContain("affordance.gap");

    const missingToolGap = gaps.find((gap) => gap.name === "nonexistentTool");
    expect(missingToolGap).toBeDefined();

    const resolved = database.resolveAffordanceGap(missingToolGap!.id);
    expect(resolved.status).toBe("resolved");
    expect(database.listAffordanceGaps({ reflectionId: result.reflection.id }).map((gap) => gap.id)).not.toContain(
      missingToolGap!.id
    );
    expect(database.listAffordanceGaps({ reflectionId: result.reflection.id, status: "all" }).map((gap) => gap.id)).toContain(
      missingToolGap!.id
    );
  });

  it("approves memory candidates and retrieves approved memories on later runs", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const firstRuntime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath
    });

    const firstResult = await firstRuntime.runTask("Fix calculator error");
    const approval = approveMemoryCandidate(database, firstResult.reflection.id, 0);

    expect(approval.memory.title).toBe("Calculator bug: add subtracts");
    expect(database.listApprovedMemories()).toHaveLength(1);
    expect(database.listEvents(firstResult.sessionId).map((event) => event.type)).toContain("memory.approved");
    expect(database.listEvents(firstResult.sessionId).map((event) => event.type)).toContain("memory.graph");

    const secondRuntime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath
    });

    const secondResult = await secondRuntime.runTask("Fix calculator add again");
    const secondEventRows = database.listEvents(secondResult.sessionId);
    const memoryRetrievedEvent = secondEventRows.find((event) => event.type === "memory.retrieved");

    expect(secondResult.retrievedMemories.length).toBeGreaterThanOrEqual(1);
    expect(secondResult.retrievedMemories.map((memory) => memory.title)).toContain("Calculator bug: add subtracts");
    expect(memoryRetrievedEvent).toBeDefined();
    expect(memoryRetrievedEvent?.data).toContain("Calculator bug: add subtracts");
    expect(getLatestTrace(database)?.steps.map((step) => step.type)).toContain("memory.retrieved");
  });
});
