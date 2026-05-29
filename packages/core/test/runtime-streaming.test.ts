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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-stream-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Fixture\n", "utf8");
  return { dbPath: path.join(dir, "squidbot.sqlite"), workspacePath };
}

describe("AgentRuntime streaming + cancellation", () => {
  it("streams the final answer to onToken in chunks that reassemble to the content", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const runtime = new AgentRuntime({ database, workspacePath: fixture.workspacePath });

    const chunks: string[] = [];
    const result = await runtime.sendMessage("please list files", { onToken: (delta) => chunks.push(delta) });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(result.content);
  });

  it("returns a cancelled response without calling the model when the signal is already aborted", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);
    const runtime = new AgentRuntime({ database, workspacePath: fixture.workspacePath });

    const controller = new AbortController();
    controller.abort();
    const result = await runtime.sendMessage("hello", { signal: controller.signal });

    expect(result.toolResults).toEqual([]);
    expect(result.content).toMatch(/cancel/i);
  });
});
