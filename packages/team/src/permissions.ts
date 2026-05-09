import { isConnectorWriteTool, roleAllowsRisk } from "./roleManifest.js";
import type { AgentRoleManifest, TeamManifest, TeamRiskLevel } from "./types.js";

export type TeamToolPermissionResult =
  | { allowed: true; requiresApproval: boolean; reason: string }
  | { allowed: false; requiresApproval: false; reason: string };

const writeToolPatterns = ["workspace.writeFile", "workspace.applyPatch", "workspace.createPatch", "sandbox.promote", "git.push"];

export function checkRoleToolPermission(input: {
  role: AgentRoleManifest;
  team?: TeamManifest;
  toolName: string;
  riskLevel?: TeamRiskLevel;
  realConnectorWrite?: boolean;
}): TeamToolPermissionResult {
  const riskLevel = input.riskLevel ?? "low";
  const role = input.role;
  if (role.deniedTools?.some((pattern) => matchesTool(input.toolName, pattern))) {
    return { allowed: false, requiresApproval: false, reason: `${role.id} explicitly denies ${input.toolName}.` };
  }
  if (!role.allowedTools.some((pattern) => matchesTool(input.toolName, pattern))) {
    return { allowed: false, requiresApproval: false, reason: `${role.id} is not allowed to use ${input.toolName}.` };
  }
  if (!roleAllowsRisk(role, riskLevel)) {
    return { allowed: false, requiresApproval: false, reason: `${role.id} max tool risk is ${role.riskLimits.maxToolRisk}, but ${input.toolName} is ${riskLevel}.` };
  }
  if (!role.riskLimits.canModifyWorkspace && writeToolPatterns.some((pattern) => matchesTool(input.toolName, pattern))) {
    return { allowed: false, requiresApproval: false, reason: `${role.id} cannot modify workspace state.` };
  }
  if (!role.riskLimits.canCallConnectors && input.toolName.startsWith("connector.")) {
    return { allowed: false, requiresApproval: false, reason: `${role.id} cannot call connectors.` };
  }
  if (input.realConnectorWrite && (input.team?.defaultPolicy.allowRealConnectorWrites !== true || isConnectorWriteTool(input.toolName))) {
    return { allowed: true, requiresApproval: true, reason: `${input.toolName} is a connector write and requires approval.` };
  }
  const approvalPatterns = [
    ...(role.requiredApprovals?.toolPatterns ?? []),
    ...(role.requiredApprovals?.connectorPatterns ?? [])
  ];
  const approvalRisks = role.requiredApprovals?.riskLevels ?? [];
  if (approvalPatterns.some((pattern) => matchesTool(input.toolName, pattern)) || approvalRisks.includes(riskLevel)) {
    return { allowed: true, requiresApproval: true, reason: `${input.toolName} requires approval for ${role.id}.` };
  }
  return { allowed: true, requiresApproval: false, reason: `${role.id} may use ${input.toolName}.` };
}

export function assertRoleToolAllowed(input: Parameters<typeof checkRoleToolPermission>[0]): TeamToolPermissionResult & { allowed: true } {
  const result = checkRoleToolPermission(input);
  if (!result.allowed) {
    throw new Error(result.reason);
  }
  return result;
}

function matchesTool(toolName: string, pattern: string): boolean {
  if (pattern === toolName || toolName.startsWith(pattern)) {
    return true;
  }
  if (!pattern.includes("*")) {
    return false;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(toolName);
}
