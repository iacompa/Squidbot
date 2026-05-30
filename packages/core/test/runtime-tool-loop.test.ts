import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeDatabase, type SquidDatabase } from "@squidbot/db";
import { ModelRouter, type ModelProvider, type ModelProviderRequest, type ModelResponse } from "@squidbot/models";
import { AgentRuntime } from "../src/index.js";

let database: SquidDatabase | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

function createWorkspace(): { dbPath: string; workspacePath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-loop-"));
  const workspacePath = path.join(dir, "workspace");
  fs.mkdirSync(workspacePath);
  fs.writeFileSync(path.join(workspacePath, "README.md"), "# Fixture\n", "utf8");
  return { dbPath: path.join(dir, "squidbot.sqlite"), workspacePath };
}

function response(content: string, toolCalls: ModelResponse["toolCalls"] = []): ModelResponse {
  return {
    provider: "fake",
    modelName: "fake",
    mode: "mock",
    costOwner: "local/free",
    content,
    toolCalls
  };
}

/**
 * A scripted provider whose behavior depends on whether it can SEE prior tool
 * results in the message history. This is the whole point of the agentic loop:
 * the model must receive tool output and reason about it on a subsequent turn.
 */
function makeProvider(generate: (request: ModelProviderRequest, round: number) => ModelResponse): ModelProvider {
  let round = 0;
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
      const result = generate(request, round);
      round += 1;
      return result;
    }
  };
}

describe("AgentRuntime agentic tool loop", () => {
  it("feeds tool results back to the model so it can produce a final answer", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const provider = makeProvider((request) => {
      const toolMessage = request.messages.find((message) => message.role === "tool");
      if (!toolMessage) {
        // Round 1: ask to list files. No final answer yet.
        return response("Let me list the files first.", [
          { id: "call_1", name: "workspace.listFiles", args: {} }
        ]);
      }
      // Round 2: we received the tool output — prove we can read it.
      return response(`Done. The listFiles tool returned: ${toolMessage.content}`);
    });

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      modelRouter: new ModelRouter(provider)
    });

    const result = await runtime.sendMessage("list the files please");

    // The model's FINAL answer must reflect content it could only have seen by
    // receiving the tool result on a second round.
    expect(result.content).toContain("The listFiles tool returned");
    expect(result.content).toContain("README.md");
    // The tool ran exactly once and is reported in the aggregated results.
    expect(result.toolResults.map((entry) => entry.toolName)).toEqual(["workspace.listFiles"]);
    expect(result.toolResults[0].ok).toBe(true);
  });

  it("stops after a bounded number of iterations if the model keeps requesting NEW tool calls", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    // Pathological provider: every round asks for a brand-new (distinct) tool
    // call, so the dedup guard never trips. The iteration cap must stop it.
    const provider = makeProvider((_request, round) =>
      response(`round ${round}`, [
        { id: `call_${round}`, name: "workspace.listFiles", args: { marker: round } }
      ])
    );

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      modelRouter: new ModelRouter(provider)
    });

    const result = await runtime.sendMessage("loop forever");

    // Bounded: the loop must terminate well under a runaway. Cap is 8.
    expect(result.toolResults.length).toBeGreaterThan(0);
    expect(result.toolResults.length).toBeLessThanOrEqual(8);
  });

  it("stops when the model repeats an IDENTICAL tool call (no progress)", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    // Always the same tool call (same name + args). After executing it once,
    // the dedup guard should break the loop rather than re-running it forever.
    const provider = makeProvider(() =>
      response("calling again", [{ id: "same", name: "workspace.listFiles", args: {} }])
    );

    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      modelRouter: new ModelRouter(provider)
    });

    const result = await runtime.sendMessage("repeat");

    // Executed once, then stopped — not 8 times.
    expect(result.toolResults.length).toBe(1);
  });

  it("does not leave a dangling assistant tool_calls turn after a dedup break", async () => {
    const fixture = createWorkspace();
    database = initializeDatabase(fixture.dbPath);

    const seen: Array<Array<{ role: string; toolCalls?: unknown[] }>> = [];
    const provider = makeProvider((request, round) => {
      seen.push(request.messages.map((m) => ({ ...m })));
      if (round < 2) {
        // Turn 1 (rounds 0,1): repeat the SAME call to trip the dedup guard.
        return response("calling again", [{ id: "same", name: "workspace.listFiles", args: {} }]);
      }
      return response("final answer"); // Turn 2: a clean final answer.
    });

    // ONE long-lived runtime (the CLI REPL case — in-memory history is never
    // re-hydrated mid-session, unlike the desktop's per-IPC fresh runtime).
    const runtime = new AgentRuntime({
      database,
      workspacePath: fixture.workspacePath,
      modelRouter: new ModelRouter(provider)
    });

    await runtime.sendMessage("repeat"); // dedup break — must NOT leave a dangling tool_calls turn
    await runtime.sendMessage("and now?"); // turn 2 sees the full in-memory history

    // OpenAI invariant: an assistant message carrying tool_calls MUST be
    // immediately followed by tool messages for each call. A real API rejects a
    // dangling tool_calls turn on the next request.
    const lastSent = seen[seen.length - 1];
    for (let i = 0; i < lastSent.length; i++) {
      const m = lastSent[i];
      if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length > 0) {
        expect(lastSent[i + 1]?.role).toBe("tool");
      }
    }
  });
});
