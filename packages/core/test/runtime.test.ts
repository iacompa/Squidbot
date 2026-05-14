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

  it("chat path retrieves approved memories and renders them in the system prompt", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    // Simulate the four memories an onboarding run typically writes, in
    // varied importance order. The runtime's combineMemorySources should
    // sort them by importance DESC, so the guardrail (0.95) lands first.
    const baseTime = new Date().toISOString();
    database.insertMemory({
      id: "memory_seed_business",
      type: "business_summary",
      title: "Business summary — Acme",
      body: "Acme is a small SaaS that helps online retailers detect fulfillment errors.",
      sourceRunId: "run_onboarding_test_1",
      sourceReflectionId: null,
      sourceEventId: null,
      confidence: 0.95,
      importance: 0.8,
      createdAt: baseTime,
      approvedAt: baseTime,
      archivedAt: null
    });
    database.insertMemory({
      id: "memory_seed_founder",
      type: "founder_note",
      title: "Top time-waster (founder note)",
      body: "Triage of customer support tickets across Slack, email, and Intercom.",
      sourceRunId: "run_onboarding_test_1",
      sourceReflectionId: null,
      sourceEventId: null,
      confidence: 0.95,
      importance: 0.9,
      createdAt: baseTime,
      approvedAt: baseTime,
      archivedAt: null
    });
    database.insertMemory({
      id: "memory_seed_guardrail",
      type: "guardrail",
      title: "Permanent guardrail (operator policy)",
      body: "Never message a customer directly without my explicit approval.",
      sourceRunId: "run_onboarding_test_1",
      sourceReflectionId: null,
      sourceEventId: null,
      confidence: 0.95,
      importance: 0.95,
      createdAt: baseTime,
      approvedAt: baseTime,
      archivedAt: null
    });
    database.insertMemory({
      id: "memory_seed_inventory",
      type: "system_inventory",
      title: "Systems inventory",
      body: "Primary systems: github, linear, stripe, shopify",
      sourceRunId: "run_onboarding_test_1",
      sourceReflectionId: null,
      sourceEventId: null,
      confidence: 0.9,
      importance: 0.7,
      createdAt: baseTime,
      approvedAt: baseTime,
      archivedAt: null
    });

    const runtime = new AgentRuntime({ database, workspacePath: fixture.workspacePath });
    const result = await runtime.sendMessage("what should I focus on today?");

    const memoryRetrieved = database.listEvents(result.sessionId).find((event) => event.type === "memory.retrieved");
    expect(memoryRetrieved).toBeDefined();

    const detail = JSON.parse(memoryRetrieved!.data) as {
      count: number;
      memories: Array<{ title: string; importance: number; type: string }>;
      bulletin: string;
    };

    // All four onboarding memories should come back (count >= 4).
    expect(detail.count).toBeGreaterThanOrEqual(4);
    // Sorted by importance DESC, so the guardrail lands first.
    expect(detail.memories[0].type).toBe("guardrail");
    expect(detail.memories[0].importance).toBeCloseTo(0.95, 6);
    // Bulletin is non-empty and includes the guardrail body.
    expect(detail.bulletin).toContain("Never message a customer directly");
    // The bulletin must also surface the founder note so future chat turns
    // can cite the operator's top time-waster.
    expect(detail.bulletin).toContain("Triage of customer support tickets");

    // The system prompt sent into the model must include the new
    // "Relevant memories" section (with the guardrail body), proving the
    // bulletin reached the LLM and isn't only persisted to the trace.
    const modelCallEvent = database.listEvents(result.sessionId).find((event) => event.type === "model.call");
    expect(modelCallEvent).toBeDefined();
    const modelCallDetail = JSON.parse(modelCallEvent!.data) as {
      promptSnapshot?: { messages: Array<{ role: string; content: string }> };
    };
    const systemMessage = modelCallDetail.promptSnapshot?.messages.find((message) => message.role === "system");
    expect(systemMessage).toBeDefined();
    expect(systemMessage!.content).toContain("Relevant memories");
    expect(systemMessage!.content).toContain("Never message a customer directly");
  });

  it("chat path emits memory.retrieved with count=0 and omits the memory section when no memories exist", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const runtime = new AgentRuntime({ database, workspacePath: fixture.workspacePath });
    const result = await runtime.sendMessage("hello");

    const memoryRetrieved = database.listEvents(result.sessionId).find((event) => event.type === "memory.retrieved");
    expect(memoryRetrieved).toBeDefined();
    const detail = JSON.parse(memoryRetrieved!.data) as { count: number };
    expect(detail.count).toBe(0);

    // System prompt must NOT include the "Relevant memories" header when
    // there's nothing to cite — keep the prompt clean.
    const modelCallEvent = database.listEvents(result.sessionId).find((event) => event.type === "model.call");
    const modelCallDetail = JSON.parse(modelCallEvent!.data) as {
      promptSnapshot?: { messages: Array<{ role: string; content: string }> };
    };
    const systemMessage = modelCallDetail.promptSnapshot?.messages.find((message) => message.role === "system");
    expect(systemMessage!.content).not.toContain("Relevant memories");
  });
});
