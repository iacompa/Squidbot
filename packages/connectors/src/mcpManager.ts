import type { JsonObject, RiskLevel, ToolContext, ToolRegistry } from "@squidbot/core";
import { McpClient, type McpClientConfig } from "./mcpClient.js";

export type McpServerConfig = McpClientConfig & {
  transport: "stdio";
  riskLevel: RiskLevel;
};

/**
 * Owns the pool of McpClient instances. On `spawnAll`, connects every
 * provided server, discovers its tools via `tools/list`, and registers
 * them in the ToolRegistry as `mcp.<serverName>.<toolName>` — so they
 * live alongside manifest connectors and pick up the same sensitivity
 * policy, approval queue, and trace event plumbing for free.
 *
 * Tools that fail to register (e.g. because a same-named manifest
 * connector already claimed the name) are skipped rather than throwing,
 * so a name collision doesn't crash startup.
 */
export class McpClientManager {
  private readonly registry = new Map<string, McpClient>();

  constructor(private readonly toolRegistry: ToolRegistry) {}

  async spawnAll(configs: readonly McpServerConfig[]): Promise<void> {
    await Promise.all(configs.map((config) => this.spawnOne(config)));
  }

  async spawnOne(config: McpServerConfig): Promise<void> {
    const client = new McpClient(config);
    try {
      await client.connect();
    } catch (err) {
      // Don't crash startup if one MCP server fails — log + skip.
      // The UI surfaces the failure via `getMcpServer().lastError`.
      console.error(`[mcp] failed to connect ${config.name}:`, err);
      return;
    }
    this.registry.set(config.name, client);

    for (const tool of client.tools()) {
      const toolName = `mcp.${config.name}.${tool.name}`;
      if (this.toolRegistry.get(toolName)) continue;
      this.toolRegistry.register({
        name: toolName,
        description: tool.description ?? `${config.name}.${tool.name}`,
        inputSchema: tool.inputSchema as JsonObject,
        permissionScopes: ["mcp.tool", `mcp:${config.name}`],
        riskLevel: config.riskLevel,
        metadata: {
          mcpServer: config.name,
          mcpTool: tool.name,
          mode: "mcp"
        },
        handler: async (args: JsonObject, context: ToolContext): Promise<JsonObject> => {
          context.emitEvent?.("connector.http_call", {
            connectorName: config.name,
            operationName: tool.name,
            method: "MCP",
            path: tool.name,
            args,
            mode: "mcp"
          });
          const result = await client.callTool(tool.name, args);
          return (result as JsonObject) ?? {};
        }
      });
    }
  }

  clients(): McpClient[] {
    return [...this.registry.values()];
  }

  async removeServer(name: string): Promise<void> {
    const client = this.registry.get(name);
    if (!client) return;
    try {
      await client.close();
    } finally {
      this.registry.delete(name);
      // We leave tools registered with the now-stale handler — the
      // ToolRegistry doesn't expose a public unregister. A subsequent
      // call would fail at client.callTool() with "not connected".
      // Practical mitigation: a fresh runtime construction re-registers
      // from scratch, skipping the removed server.
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.registry.values()].map((client) => client.close()));
    this.registry.clear();
  }
}
