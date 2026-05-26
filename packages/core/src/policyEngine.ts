import os from "node:os";
import path from "node:path";
import type { JsonObject, RiskLevel } from "./types.js";
import type { ToolManifest } from "./toolRegistry.js";

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
  riskLevel: RiskLevel;
};

const SANDBOX_DIR_PATTERN = /^sandbox_[a-z0-9]+_[a-z0-9]+$/;

export function isSandboxPath(candidate: string): boolean {
  if (!candidate) {
    return false;
  }
  const resolved = path.resolve(candidate);
  const tmpRoot = path.resolve(os.tmpdir());
  const relative = path.relative(tmpRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const segments = relative.split(path.sep);
  if (segments.length < 2) {
    return false;
  }
  if (!SANDBOX_DIR_PATTERN.test(segments[0])) {
    return false;
  }
  if (segments[1] !== "workspace") {
    return false;
  }
  return true;
}

const ALLOWED_EXEC_COMMANDS = new Set([
  "pytest", "python", "python3", "node", "npm", "pnpm", "yarn", "tsx", "tsc",
  "vitest", "jest", "mocha", "go", "cargo", "rustc", "ruby", "rake", "bundle",
  "make", "ls", "cat", "head", "tail", "wc", "grep", "find", "git"
]);

export function isAllowedExecCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }
  if (/[;&|`$<>\\\n\r]/.test(trimmed)) {
    return false;
  }
  const firstToken = trimmed.split(/\s+/)[0];
  if (!firstToken) {
    return false;
  }
  return ALLOWED_EXEC_COMMANDS.has(firstToken);
}

export class PolicyEngine {
  evaluateTool(manifest: ToolManifest, args: JsonObject): PolicyDecision {
    if (manifest.permissionScopes.some((scope) => scope.startsWith("connector."))) {
      const requiresApproval = manifest.metadata?.requiresApproval === true;
      const isWrite = manifest.permissionScopes.includes("connector.write");
      if (requiresApproval || isWrite) {
        return {
          allowed: false,
          reason: "Connector write or approval-gated operations require explicit user approval before execution.",
          riskLevel: manifest.riskLevel
        };
      }

      return {
        allowed: true,
        reason: "Connector read operation is allowed under the registered manifest policy.",
        riskLevel: manifest.riskLevel
      };
    }

    if (manifest.name === "workspace.proposePatch" || manifest.name === "workspace.createPatch") {
      return {
        allowed: true,
        reason: "Draft-only patch proposals are allowed; no files are modified.",
        riskLevel: manifest.riskLevel
      };
    }

    if (manifest.name === "terminal.dryRun") {
      return {
        allowed: true,
        reason: "Terminal commands are recorded as dry runs and are not executed.",
        riskLevel: manifest.riskLevel
      };
    }

    if (manifest.name === "terminal.exec") {
      const cwd = typeof args.cwd === "string" ? args.cwd : "";
      if (!isSandboxPath(cwd)) {
        return {
          allowed: false,
          reason: "Shell execution requires an approved sandbox working directory.",
          riskLevel: "high"
        };
      }
      const command = typeof args.command === "string" ? args.command : "";
      if (!isAllowedExecCommand(command)) {
        return {
          allowed: false,
          reason: "Command is not on the sandbox execution allowlist or contains shell metacharacters.",
          riskLevel: "high"
        };
      }
      return {
        allowed: true,
        reason: "Shell command is allowed inside the staged sandbox workspace.",
        riskLevel: manifest.riskLevel
      };
    }

    if (manifest.name === "test.run") {
      return {
        allowed: true,
        reason: "Test commands run without shell expansion in a temporary copy of the workspace when allowed; unsafe commands are converted to dry runs.",
        riskLevel: manifest.riskLevel
      };
    }

    if (manifest.permissionScopes.includes("filesystem.write")) {
      return {
        allowed: false,
        reason: "Direct filesystem writes are blocked in this phase.",
        riskLevel: manifest.riskLevel
      };
    }

    if (args.command && manifest.name !== "terminal.dryRun") {
      return {
        allowed: false,
        reason: "Shell command execution is not available to this tool.",
        riskLevel: "high"
      };
    }

    return {
      allowed: true,
      reason: "Read-only local operation is allowed.",
      riskLevel: manifest.riskLevel
    };
  }
}
