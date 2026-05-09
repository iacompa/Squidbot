import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JsonObject } from "./types.js";
import type { ToolContext, ToolRegistry } from "./toolRegistry.js";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);
const allowedDirectCommands = new Set(["pytest", "py.test", "vitest", "jest"]);
const allowedPackageManagers = new Set(["npm", "pnpm", "yarn"]);

type ParsedCommand = {
  command: string;
  args: string[];
};

function parseCommandLine(commandLine: string): ParsedCommand {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index];
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      continue;
    }

    if (quote === char) {
      quote = null;
      continue;
    }

    if (!quote && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  const [command = "", ...args] = tokens;
  return { command, args };
}

function isAllowedTestCommand(parsed: ParsedCommand): boolean {
  const executable = path.basename(parsed.command);

  if (allowedDirectCommands.has(executable)) {
    return true;
  }

  if ((executable === "python" || executable === "python3") && parsed.args[0] === "-m" && parsed.args[1] === "pytest") {
    return true;
  }

  if (executable === "node" && parsed.args[0] === "--test") {
    return true;
  }

  if (allowedPackageManagers.has(executable)) {
    return parsed.args[0] === "test" || (parsed.args[0] === "run" && parsed.args[1] === "test");
  }

  return false;
}

function copyWorkspaceToSandbox(workspacePath: string): string {
  const root = fs.realpathSync(workspacePath);
  const sandboxParent = fs.mkdtempSync(path.join(os.tmpdir(), "squidbot-test-run-"));
  const sandboxPath = path.join(sandboxParent, "workspace");

  fs.cpSync(root, sandboxPath, {
    recursive: true,
    filter: (source) => {
      const name = path.basename(source);
      return !ignoredDirectories.has(name);
    }
  });

  return sandboxPath;
}

async function runCommandInSandbox(commandLine: string, workspacePath: string, timeoutMs: number): Promise<JsonObject> {
  const parsed = parseCommandLine(commandLine);
  if (!parsed.command) {
    throw new Error("Test command is required.");
  }

  if (!isAllowedTestCommand(parsed)) {
    return {
      command: commandLine,
      executed: false,
      dryRun: true,
      reason: "Command is not in the safe test-runner allowlist, so it was recorded as a dry run.",
      stdout: "",
      stderr: "",
      exitCode: null
    };
  }

  const sandboxPath = copyWorkspaceToSandbox(workspacePath);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(parsed.command, parsed.args, {
      cwd: sandboxPath,
      shell: false,
      env: {
        ...process.env,
        CI: "1",
        SQUIDBOT_SANDBOX: "copied-workspace"
      },
      windowsHide: true
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      fs.rmSync(path.dirname(sandboxPath), { recursive: true, force: true });
      resolve({
        command: commandLine,
        executed: true,
        dryRun: false,
        sandboxMode: "copied-workspace",
        stdout,
        stderr: `${stderr}${error.message}`,
        exitCode: 127,
        durationMs: Date.now() - startedAt,
        timedOut
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      fs.rmSync(path.dirname(sandboxPath), { recursive: true, force: true });
      resolve({
        command: commandLine,
        executed: true,
        dryRun: false,
        sandboxMode: "copied-workspace",
        stdout: stdout.slice(0, 20_000),
        stderr: stderr.slice(0, 20_000),
        exitCode,
        durationMs: Date.now() - startedAt,
        timedOut
      });
    });
  });
}

export function registerTestTools(registry: ToolRegistry): void {
  registry.register({
    name: "test.run",
    description: "Run an allowlisted test command in a temporary copy of the workspace and capture output.",
    inputSchema: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" },
        timeoutMs: { type: "number", default: 15000 }
      }
    },
    permissionScopes: ["test.run"],
    riskLevel: "medium",
    handler: async (args: JsonObject, context: ToolContext) => {
      const command = typeof args.command === "string" ? args.command : "";
      const timeoutMs = typeof args.timeoutMs === "number" ? Math.min(Math.max(args.timeoutMs, 1000), 60_000) : 15_000;
      return runCommandInSandbox(command, context.workspacePath, timeoutMs);
    }
  });
}
