import type { PluginHost, PluginToolDefinition } from "@squidbot/productization";
import { ToolRegistry, type ToolContext } from "./toolRegistry.js";
import type { JsonObject, RiskLevel } from "./types.js";

/**
 * Adapt a runtime `ToolRegistry` into the SDK's abstract `PluginHost`, so
 * `loadPlugin(plugin, createToolRegistryHost(registry))` registers a plugin's
 * (manifest-declared, governed) tools into the registry the AgentRuntime
 * actually executes. The SDK enforces the manifest contract before any tool
 * reaches here; the registry + policy/governance still gate execution at call
 * time — a plugin tool is not privileged just because it loaded.
 */
export function createToolRegistryHost(registry: ToolRegistry): PluginHost {
  return {
    registerTool(tool: PluginToolDefinition): void {
      registry.register({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as JsonObject,
        permissionScopes: tool.permissionScopes ?? [],
        riskLevel: (tool.riskLevel ?? "low") as RiskLevel,
        handler: (args: JsonObject, context: ToolContext) => tool.handler(args, context)
      });
    }
  };
}
