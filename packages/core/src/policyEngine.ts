import type { JsonObject, RiskLevel } from "./types.js";
import type { ToolManifest } from "./toolRegistry.js";

export type PolicyDecision = {
  allowed: boolean;
  reason: string;
  riskLevel: RiskLevel;
};

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
