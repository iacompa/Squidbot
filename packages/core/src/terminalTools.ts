import type { JsonObject } from "./types.js";
import type { ToolRegistry } from "./toolRegistry.js";

export function registerTerminalTools(registry: ToolRegistry): void {
  registry.register({
    name: "terminal.dryRun",
    description: "Record an intended shell command without executing it.",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" }
      }
    },
    permissionScopes: ["terminal.dryRun"],
    riskLevel: "medium",
    handler: (args: JsonObject) => {
      const command = typeof args.command === "string" ? args.command : "";
      if (!command.trim()) {
        throw new Error("Command is required.");
      }

      return {
        command,
        executed: false,
        message: "Dry-run only: command was recorded but not executed."
      };
    }
  });
}
