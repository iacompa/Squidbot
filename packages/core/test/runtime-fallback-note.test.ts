import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { ModelRouter, type ModelProvider, type ModelResponse } from "@squidbot/models";
import { AgentRuntime } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-fb-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Fixture\n", "utf8");
  return { dbPath: path.join(dir, "squidbot.sqlite"), workspacePath };
}

describe("AgentRuntime paid→free fallback transparency", () => {
  it("tells the user when the paid model was unavailable and a free one answered", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const failingPaid: ModelProvider = {
      name: "api",
      modelName: "paid-model",
      mode: "byok",
      maxTokens: 1000,
      supportsTools: true,
      costOwner: "user-paid",
      async isAvailable() {
        return true;
      },
      async generate() {
        throw new Error("paid model is down");
      }
    };
    const workingFree: ModelProvider = {
      name: "mock",
      modelName: "free-model",
      mode: "mock",
      maxTokens: 1000,
      supportsTools: true,
      costOwner: "local/free",
      async isAvailable() {
        return true;
      },
      async generate(): Promise<ModelResponse> {
        return {
          provider: "mock",
          modelName: "free-model",
          mode: "mock",
          costOwner: "local/free",
          content: "answer text",
          toolCalls: []
        };
      }
    };

    const router = new ModelRouter({ settings: { provider: "api" }, providers: [failingPaid, workingFree] });
    const runtime = new AgentRuntime({ database, workspacePath: fixture.workspacePath, modelRouter: router });

    const result = await runtime.sendMessage("hi");
    // The reply must carry a clear note that a paid→free fallback happened —
    // the user should never silently believe their paid model answered.
    expect(result.content).toMatch(/fell back/i);
  });
});
