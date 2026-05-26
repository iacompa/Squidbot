import { execFile } from "node:child_process";
import type { JsonObject } from "./types.js";
import { isAllowedExecCommand, isSandboxPath } from "./policyEngine.js";
import type { ToolContext, ToolRegistry } from "./toolRegistry.js";

function parseCommand(command: string): { binary: string; args: string[] } | null {
  if (!isAllowedExecCommand(command)) {
    return null;
  }
  const tokens = command.trim().split(/\s+/);
  if (tokens.length === 0) {
    return null;
  }
  return { binary: tokens[0], args: tokens.slice(1) };
}

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

  registry.register({
    name: "terminal.exec",
    description: "Execute an allowlisted command inside an approved sandbox.",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" },
        cwd: { type: "string" }
      }
    },
    permissionScopes: ["terminal.exec"],
    riskLevel: "high",
    handler: async (args: JsonObject, context: ToolContext) => {
      const command = typeof args.command === "string" ? args.command : "";
      if (!command.trim()) {
        throw new Error("Command is required.");
      }
      const cwd = typeof args.cwd === "string" ? args.cwd : context.workspacePath;
      if (!isSandboxPath(cwd)) {
        throw new Error("terminal.exec requires a staged sandbox working directory.");
      }

      const parsed = parseCommand(command);
      if (!parsed) {
        throw new Error("Command is not on the sandbox execution allowlist or contains shell metacharacters.");
      }

      return await new Promise((resolve) => {
        execFile(parsed.binary, parsed.args, { cwd, timeout: 30000 }, (error, stdout, stderr) => {
          resolve({
            command,
            cwd,
            executed: true,
            exitCode: error ? (error as { code?: number }).code ?? 1 : 0,
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? ""
          });
        });
      });
    }
  });
}
