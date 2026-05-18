import { describe, expect, it } from "vitest";
import { McpClient } from "../src/mcpClient.js";

// A minimal inline node script that speaks just enough MCP JSON-RPC for
// us to test the client: initialize + tools/list + tools/call. Wraps each
// message as a line-delimited JSON-RPC response. Real MCP servers use the
// same line-delimited stdio framing.
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
        // notification — no response expected
      } else if (msg.method === "tools/list") {
        response = { jsonrpc: "2.0", id: msg.id, result: { tools: [
          { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
          { name: "write_file", description: "Write a file", inputSchema: { type: "object" } }
        ] } };
      } else if (msg.method === "tools/call") {
        response = { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ok" }] } };
      } else {
        response = { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown" } };
      }
      if (response) process.stdout.write(JSON.stringify(response) + "\\n");
    }
  });
`;

describe("McpClient", () => {
  it("connects to a minimal stdio MCP server and lists tools", async () => {
    const client = new McpClient({
      name: "fake",
      command: "node",
      args: ["-e", FAKE_SERVER],
      env: {}
    });
    await client.connect();
    const tools = client.tools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(["read_file", "write_file"]);
    await client.close();
  });

  it("can call a tool on the server", async () => {
    const client = new McpClient({
      name: "fake",
      command: "node",
      args: ["-e", FAKE_SERVER],
      env: {}
    });
    await client.connect();
    const result = (await client.callTool("read_file", { path: "/tmp/x" })) as { content: unknown[] };
    expect(result.content).toBeDefined();
    await client.close();
  });

  it("surfaces a spawn error when the command does not exist", async () => {
    const client = new McpClient({
      name: "bogus",
      command: "/nonexistent/binary-12345",
      args: [],
      env: {}
    });
    await expect(client.connect()).rejects.toThrow();
  });
});
