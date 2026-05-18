import { describe, expect, it } from "vitest";
import { ToolRegistry } from "@squidbot/core";
import { McpClientManager } from "../src/mcpManager.js";

const FAKE_SERVER = `
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf("\\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      let response = null;
      if (msg.method === "initialize") {
        response = { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", serverInfo: { name: "fake", version: "1" }, capabilities: { tools: {} } } };
      } else if (msg.method === "notifications/initialized") {
        // notification
      } else if (msg.method === "tools/list") {
        response = { jsonrpc: "2.0", id: msg.id, result: { tools: [
          { name: "ping", description: "Ping", inputSchema: { type: "object" } }
        ] } };
      } else if (msg.method === "tools/call") {
        response = { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "pong" }] } };
      } else {
        response = { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown" } };
      }
      if (response) process.stdout.write(JSON.stringify(response) + "\\n");
    }
  });
`;

const testConfig = {
  name: "fakesrv",
  transport: "stdio" as const,
  command: "node",
  args: ["-e", FAKE_SERVER],
  env: {},
  riskLevel: "low" as const
};

describe("McpClientManager", () => {
  it("spawns enabled servers and registers their tools with mcp.<server>.<tool> naming", async () => {
    const toolRegistry = new ToolRegistry();
    const manager = new McpClientManager(toolRegistry);
    await manager.spawnAll([testConfig]);

    const tool = toolRegistry.get("mcp.fakesrv.ping");
    expect(tool).toBeDefined();
    expect(tool?.riskLevel).toBe("low");
    expect(tool?.metadata?.mcpServer).toBe("fakesrv");
    expect(tool?.metadata?.mode).toBe("mcp");

    await manager.shutdown();
  });

  it("routes tool.handler calls through the MCP client and emits a connector.http_call event", async () => {
    const toolRegistry = new ToolRegistry();
    const manager = new McpClientManager(toolRegistry);
    await manager.spawnAll([testConfig]);

    const events: { type: string; data: unknown }[] = [];
    const result = await toolRegistry.execute("mcp.fakesrv.ping", {}, {
      workspacePath: "/tmp",
      sessionId: "s",
      runId: "r",
      emitEvent: (type, data) => events.push({ type, data })
    });
    expect(result).toBeTruthy();
    expect(events.some((e) => e.type === "connector.http_call")).toBe(true);
    await manager.shutdown();
  });

  it("shutdown disconnects all clients", async () => {
    const toolRegistry = new ToolRegistry();
    const manager = new McpClientManager(toolRegistry);
    await manager.spawnAll([testConfig]);
    expect(manager.clients()).toHaveLength(1);
    await manager.shutdown();
    expect(manager.clients()).toHaveLength(0);
  });

  it("does not crash when a server fails to spawn", async () => {
    const toolRegistry = new ToolRegistry();
    const manager = new McpClientManager(toolRegistry);
    await manager.spawnAll([{
      name: "broken",
      transport: "stdio",
      command: "/nonexistent/binary-12345",
      args: [],
      env: {},
      riskLevel: "low"
    }]);
    // No tool registered, no client tracked.
    expect(toolRegistry.get("mcp.broken.x")).toBeNull();
    expect(manager.clients()).toHaveLength(0);
    await manager.shutdown();
  });
});
