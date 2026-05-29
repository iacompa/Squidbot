import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { ModelRouter, type ModelProvider } from "@squidbot/models";
import { AgentRuntime, getLatestTrace } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-trace-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Fixture\n", "utf8");
  return { dbPath: path.join(dir, "squidbot.sqlite"), workspacePath };
}

const explodingProvider: ModelProvider = {
  name: "boom",
  modelName: "boom",
  mode: "mock",
  maxTokens: 1000,
  supportsTools: true,
  costOwner: "local/free",
  async isAvailable() {
    return true;
  },
  async generate() {
    throw new Error("provider exploded");
  }
};

describe("AgentRuntime trace integrity", () => {
  it("persists a trace even when the model call throws", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      modelRouter: new ModelRouter(explodingProvider)
    });

    await expect(runtime.sendMessage("hello")).rejects.toThrow();

    // A failed run must NOT silently vanish from the audit trail / History page.
    const trace = getLatestTrace(database);
    expect(trace).toBeTruthy();
    expect(trace!.steps.some((step) => step.type === "error")).toBe(true);
  });
});
