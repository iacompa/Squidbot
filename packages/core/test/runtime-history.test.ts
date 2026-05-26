import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { AgentRuntime } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-history-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Fixture\n", "utf8");
  return {
    dbPath: path.join(dir, "squidbot.sqlite"),
    workspacePath
  };
}

describe("AgentRuntime — chat history persistence", () => {
  it("persists user and assistant messages to chat_messages", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const runtime = new AgentRuntime({ database, workspacePath: fixture.workspacePath });
    await runtime.sendMessage("hello");

    const rows = database.listChatMessages(runtime.sessionId);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]).toMatchObject({ role: "user", content: "hello" });
    expect(rows[1].role).toBe("assistant");
  });

  it("does not bleed messages across different sessionIds", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const a = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      sessionId: "session-a"
    });
    await a.sendMessage("alpha");

    // Different sessionId should see zero messages.
    expect(database.listChatMessages("session-b").length).toBe(0);

    // And session-a's two rows are unaffected by reading session-b.
    expect(database.listChatMessages("session-a").length).toBeGreaterThanOrEqual(2);
  });

  it("a fresh runtime with the same sessionId continues the conversation", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const a = new AgentRuntime({ database, workspacePath: fixture.workspacePath });
    await a.sendMessage("first message");
    const beforeCount = database.listChatMessages(a.sessionId).length;

    // Simulate a new runtime instance (what happens on the next IPC call).
    const b = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      sessionId: a.sessionId
    });
    await b.sendMessage("second message");

    const after = database.listChatMessages(b.sessionId);
    // The fresh runtime hydrated the prior two messages and then appended
    // two more for the second turn — total grows by exactly two.
    expect(after.length).toBe(beforeCount + 2);
  });
});
