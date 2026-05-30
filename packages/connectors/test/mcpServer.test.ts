import { describe, expect, it } from "vitest";
import { PolicyEngine, ToolRegistry } from "@squidbot/core";
import { SquidbotMcpServer } from "../src/mcpServer.js";

function buildRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    name: "demo.echo",
    description: "Echo the provided text back.",
    inputSchema: { type: "object", properties: { text: { type: "string" } } },
    permissionScopes: [],
    riskLevel: "low",
    handler: async (args) => ({ echoed: args.text })
  });
  registry.register({
    name: "demo.write",
    description: "Write a file (high-risk, policy-denied).",
    inputSchema: { type: "object", properties: { path: { type: "string" } } },
    permissionScopes: ["filesystem.write"],
    riskLevel: "high",
    handler: async () => ({ wrote: true })
  });
  return registry;
}

function makeServer(): SquidbotMcpServer {
  return new SquidbotMcpServer(buildRegistry(), {
    policyEngine: new PolicyEngine(),
    workspacePath: "/tmp"
  });
}

describe("SquidbotMcpServer", () => {
  it("lists registered tools with their input schemas", () => {
    const tools = makeServer().listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("demo.echo");
    expect(names).toContain("demo.write");
    const echo = tools.find((tool) => tool.name === "demo.echo");
    expect(echo?.inputSchema).toMatchObject({ type: "object" });
  });

  it("executes an allowed read-only tool and returns its output", async () => {
    const result = await makeServer().callTool("demo.echo", { text: "hello-mcp" });
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("hello-mcp");
  });

  it("blocks a policy-denied tool and does NOT execute it", async () => {
    const result = await makeServer().callTool("demo.write", { path: "/etc/passwd" });
    expect(result.isError).toBe(true);
    // The handler returns { wrote: true } — it must NOT appear, proving the
    // call was blocked BEFORE execution.
    expect(JSON.stringify(result.content)).not.toContain("wrote");
    expect(JSON.stringify(result.content)).toMatch(/polic|block|denied|write/i);
  });

  it("returns an error result for an unknown tool", async () => {
    const result = await makeServer().callTool("does.not.exist", {});
    expect(result.isError).toBe(true);
  });

  it("rejects args that violate the tool's inputSchema before executing (untrusted MCP input)", async () => {
    // demo.echo declares text:string — an external client sending a number
    // must be rejected at the boundary, not silently handed to the handler.
    const result = await makeServer().callTool("demo.echo", { text: 123 });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/invalid arguments/i);
    // Handler never ran — { echoed: 123 } must not appear.
    expect(JSON.stringify(result.content)).not.toContain("echoed");
  });
});
