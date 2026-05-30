import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { ModelRouter, type ModelProvider, type ModelProviderRequest, type ModelResponse } from "@squidbot/models";
import { AgentRuntime } from "../src/index.js";
import { ToolRegistry } from "../src/toolRegistry.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-argval-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  return { dbPath: path.join(dir, "squidbot.sqlite"), workspacePath };
}

function response(content: string, toolCalls: ModelResponse["toolCalls"] = []): ModelResponse {
  return { provider: "fake", modelName: "fake", mode: "mock", costOwner: "local/free", content, toolCalls };
}

function makeProvider(generate: (request: ModelProviderRequest) => ModelResponse): ModelProvider {
  return {
    name: "fake",
    modelName: "fake",
    mode: "mock",
    maxTokens: 8000,
    supportsTools: true,
    costOwner: "local/free",
    async isAvailable() {
      return true;
    },
    async generate(request) {
      return generate(request);
    }
  };
}

describe("AgentRuntime tool-argument validation (3.6)", () => {
  it("rejects a call whose args violate the inputSchema, before the handler runs", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    let handlerRan = false;
    const registry = new ToolRegistry();
    registry.register({
      name: "demo.echo",
      description: "Echo text back.",
      inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
      permissionScopes: ["demo.echo"],
      riskLevel: "low",
      handler: (args) => {
        handlerRan = true;
        return { text: args.text };
      }
    });

    // Round 1: emit a malformed call (text must be a string, not a number).
    // Round 2 (after seeing the tool result): produce a final answer that
    // proves the validation error was fed back to the model.
    const provider = makeProvider((request) => {
      const toolMessage = request.messages.find((message) => message.role === "tool");
      if (!toolMessage) {
        return response("Echoing.", [{ id: "bad_1", name: "demo.echo", args: { text: 123 } }]);
      }
      return response(`Saw tool result: ${toolMessage.content}`);
    });

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      modelRouter: new ModelRouter(provider),
      toolRegistry: registry
    });

    const result = await runtime.sendMessage("echo please");

    const echo = result.toolResults.find((entry) => entry.toolName === "demo.echo");
    expect(echo?.ok).toBe(false);
    const error = (echo?.output as { error?: string }).error ?? "";
    expect(error).toMatch(/invalid arguments/i);
    expect(error).toMatch(/text/);
    // The handler must never have executed — validation gates it.
    expect(handlerRan).toBe(false);
    // And the model could react to the error on its next turn.
    expect(result.content).toContain("Saw tool result");
  });

  it("lets a well-formed call through to the handler", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    let received: unknown = null;
    const registry = new ToolRegistry();
    registry.register({
      name: "demo.echo",
      description: "Echo text back.",
      inputSchema: { type: "object", required: ["text"], properties: { text: { type: "string" } } },
      permissionScopes: ["demo.echo"],
      riskLevel: "low",
      handler: (args) => {
        received = args.text;
        return { text: args.text };
      }
    });

    const provider = makeProvider((request) => {
      const toolMessage = request.messages.find((message) => message.role === "tool");
      if (!toolMessage) {
        return response("Echoing.", [{ id: "ok_1", name: "demo.echo", args: { text: "hello" } }]);
      }
      return response("done");
    });

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      modelRouter: new ModelRouter(provider),
      toolRegistry: registry
    });

    const result = await runtime.sendMessage("echo please");
    const echo = result.toolResults.find((entry) => entry.toolName === "demo.echo");
    expect(echo?.ok).toBe(true);
    expect(received).toBe("hello");
  });
});
