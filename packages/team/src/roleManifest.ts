import type { AgentRoleManifest, TeamManifest, TeamRiskLevel } from "./types.js";

const riskOrder: Record<TeamRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2
};

const workspaceWriteTools = [
  "workspace.writeFile",
  "workspace.applyPatch",
  "workspace.createPatch",
  "sandbox.promote",
  "git.push",
  "github.createPullRequest",
  "github.updateIssue",
  "gitlab.createMergeRequest",
  "jira.updateIssue"
];

export function validateRoleManifest(input: unknown): AgentRoleManifest {
  const value = requireRecord(input, "Role manifest");
  const id = requireString(value.id, "id");
  const name = requireString(value.name, "name");
  const description = requireString(value.description, "description");
  const allowedTools = requireStringArray(value.allowedTools, "allowedTools");
  if (allowedTools.length === 0) {
    throw new Error("Role manifest allowedTools must be explicit and non-empty.");
  }

  const deniedTools = optionalStringArray(value.deniedTools, "deniedTools");
  const capabilities = requireStringArray(value.capabilities, "capabilities");
  const responsibilities = requireStringArray(value.responsibilities, "responsibilities");
  const memoryDomains = requireRecord(value.memoryDomains, "memoryDomains");
  const sandboxPolicy = requireRecord(value.sandboxPolicy, "sandboxPolicy");
  const promptTemplates = requireRecord(value.promptTemplates, "promptTemplates");
  const riskLimits = requireRecord(value.riskLimits, "riskLimits");
  const requiredApprovals = value.requiredApprovals === undefined ? undefined : requireRecord(value.requiredApprovals, "requiredApprovals");
  const modelHints = value.modelHints === undefined ? undefined : requireRecord(value.modelHints, "modelHints");
  const defaultModelProvider = normalizeProvider(value.defaultModelProvider);
  const maxToolRisk = normalizeRisk(riskLimits.maxToolRisk, "riskLimits.maxToolRisk");
  const canModifyWorkspace = requireBoolean(riskLimits.canModifyWorkspace, "riskLimits.canModifyWorkspace");
  const canCallConnectors = requireBoolean(riskLimits.canCallConnectors, "riskLimits.canCallConnectors");

  if (!canModifyWorkspace && allowedTools.some((tool) => matchesAny(tool, workspaceWriteTools))) {
    throw new Error(`Role ${id} cannot allow workspace write tools while canModifyWorkspace=false.`);
  }
  if (canModifyWorkspace && !hasApprovalRequirement(requiredApprovals)) {
    throw new Error(`Role ${id} can modify workspace and must declare approval requirements.`);
  }

  const connectorWrites = allowedTools.filter((tool) => isConnectorWriteTool(tool));
  if (connectorWrites.length > 0) {
    if (!canCallConnectors) {
      throw new Error(`Role ${id} cannot allow connector tools while canCallConnectors=false.`);
    }
    const connectorPatterns = optionalStringArray(requiredApprovals?.connectorPatterns, "requiredApprovals.connectorPatterns");
    const toolPatterns = optionalStringArray(requiredApprovals?.toolPatterns, "requiredApprovals.toolPatterns");
    if (connectorPatterns.length === 0 && toolPatterns.length === 0) {
      throw new Error(`Role ${id} has connector write tools and must require approval.`);
    }
  }

  if (modelHints && modelHints.allowPaid !== true && value.defaultModelProvider === "api") {
    throw new Error(`Role ${id} cannot default to api provider unless paid models are explicitly allowed.`);
  }

  return {
    id,
    name,
    description,
    defaultModelProvider,
    modelHints: modelHints
      ? {
          preferredProvider: typeof modelHints.preferredProvider === "string" ? modelHints.preferredProvider : undefined,
          maxContextTokens: typeof modelHints.maxContextTokens === "number" ? modelHints.maxContextTokens : undefined,
          allowByok: modelHints.allowByok === true,
          allowPaid: modelHints.allowPaid === true
        }
      : {
          allowPaid: false
        },
    capabilities,
    responsibilities,
    allowedTools,
    deniedTools,
    requiredApprovals: requiredApprovals
      ? {
          toolPatterns: optionalStringArray(requiredApprovals.toolPatterns, "requiredApprovals.toolPatterns"),
          connectorPatterns: optionalStringArray(requiredApprovals.connectorPatterns, "requiredApprovals.connectorPatterns"),
          riskLevels: optionalRiskArray(requiredApprovals.riskLevels)
        }
      : undefined,
    memoryDomains: {
      read: requireStringArray(memoryDomains.read, "memoryDomains.read"),
      write: requireStringArray(memoryDomains.write, "memoryDomains.write")
    },
    sandboxPolicy: {
      requiredForWrites: requireBoolean(sandboxPolicy.requiredForWrites, "sandboxPolicy.requiredForWrites"),
      networkPolicy: normalizeNetworkPolicy(sandboxPolicy.networkPolicy),
      maxRuntimeMs: typeof sandboxPolicy.maxRuntimeMs === "number" ? sandboxPolicy.maxRuntimeMs : undefined
    },
    promptTemplates: {
      system: requireString(promptTemplates.system, "promptTemplates.system"),
      task: typeof promptTemplates.task === "string" ? promptTemplates.task : undefined,
      reflection: typeof promptTemplates.reflection === "string" ? promptTemplates.reflection : undefined,
      handoff: typeof promptTemplates.handoff === "string" ? promptTemplates.handoff : undefined
    },
    outputSchema: value.outputSchema && typeof value.outputSchema === "object" ? (value.outputSchema as Record<string, unknown>) : undefined,
    riskLimits: {
      maxToolRisk,
      canRequestHumanApproval: requireBoolean(riskLimits.canRequestHumanApproval, "riskLimits.canRequestHumanApproval"),
      canModifyWorkspace,
      canCallConnectors,
      canWriteMemory: requireBoolean(riskLimits.canWriteMemory, "riskLimits.canWriteMemory")
    },
    createdAt: typeof value.createdAt === "string" ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined
  };
}

export function validateTeamManifest(input: unknown, knownRoleIds: string[] = []): TeamManifest {
  const value = requireRecord(input, "Team manifest");
  const roles = requireStringArray(value.roles, "roles");
  const coordinatorRoleId = requireString(value.coordinatorRoleId, "coordinatorRoleId");
  if (!roles.includes(coordinatorRoleId)) {
    throw new Error("Team manifest coordinatorRoleId must be included in roles.");
  }
  for (const role of roles) {
    if (knownRoleIds.length > 0 && !knownRoleIds.includes(role)) {
      throw new Error(`Team manifest references unknown role: ${role}`);
    }
  }
  const defaultPolicy = requireRecord(value.defaultPolicy, "defaultPolicy");
  const maxConcurrentAgents = Number(defaultPolicy.maxConcurrentAgents);
  if (!Number.isInteger(maxConcurrentAgents) || maxConcurrentAgents < 1 || maxConcurrentAgents > 8) {
    throw new Error("Team manifest defaultPolicy.maxConcurrentAgents must be between 1 and 8.");
  }

  return {
    id: requireString(value.id, "id"),
    name: requireString(value.name, "name"),
    description: requireString(value.description, "description"),
    roles,
    coordinatorRoleId,
    defaultPolicy: {
      maxConcurrentAgents,
      requireHumanForHighRisk: requireBoolean(defaultPolicy.requireHumanForHighRisk, "defaultPolicy.requireHumanForHighRisk"),
      requireSandboxForWrites: requireBoolean(defaultPolicy.requireSandboxForWrites, "defaultPolicy.requireSandboxForWrites"),
      allowPaidModels: defaultPolicy.allowPaidModels === true,
      allowRealConnectorWrites: defaultPolicy.allowRealConnectorWrites === true
    },
    taskRoutingRules: Array.isArray(value.taskRoutingRules)
      ? value.taskRoutingRules.map((rule, index) => {
          const record = requireRecord(rule, `taskRoutingRules.${index}`);
          return {
            match: requireString(record.match, `taskRoutingRules.${index}.match`),
            preferredRoleId: requireString(record.preferredRoleId, `taskRoutingRules.${index}.preferredRoleId`),
            requiredCapabilities: optionalStringArray(record.requiredCapabilities, `taskRoutingRules.${index}.requiredCapabilities`)
          };
        })
      : undefined
  };
}

export function roleAllowsRisk(role: AgentRoleManifest, risk: TeamRiskLevel): boolean {
  return riskOrder[risk] <= riskOrder[role.riskLimits.maxToolRisk];
}

export function isConnectorWriteTool(toolName: string): boolean {
  const lowered = toolName.toLowerCase();
  return (
    lowered.includes("create") ||
    lowered.includes("open") ||
    lowered.includes("update") ||
    lowered.includes("close") ||
    lowered.includes("merge") ||
    lowered.includes("push") ||
    lowered.includes("comment") ||
    lowered.includes("trigger") ||
    lowered.includes("cancel")
  ) && /github|gitlab|jira|linear|jenkins|connector/.test(lowered);
}

function matchesAny(value: string, patterns: string[]): boolean {
  return patterns.some((pattern) => value === pattern || value.startsWith(pattern) || wildcardMatch(value, pattern));
}

function hasApprovalRequirement(requiredApprovals: Record<string, unknown> | undefined): boolean {
  if (!requiredApprovals) {
    return false;
  }
  return (
    optionalStringArray(requiredApprovals.toolPatterns, "requiredApprovals.toolPatterns").length > 0 ||
    optionalStringArray(requiredApprovals.connectorPatterns, "requiredApprovals.connectorPatterns").length > 0 ||
    optionalRiskArray(requiredApprovals.riskLevels).length > 0
  );
}

function wildcardMatch(value: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return false;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Role/team manifest ${label} is required.`);
  }
  return value.trim();
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Role/team manifest ${label} must be boolean.`);
  }
  return value;
}

function requireStringArray(value: unknown, label: string): string[] {
  const values = optionalStringArray(value, label);
  if (!Array.isArray(value)) {
    throw new Error(`Role/team manifest ${label} must be an array.`);
  }
  return values;
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`Role/team manifest ${label} must be an array of strings.`);
  }
  return value.map((item) => item.trim());
}

function optionalRiskArray(value: unknown): TeamRiskLevel[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("requiredApprovals.riskLevels must be an array.");
  }
  return value.map((item) => normalizeRisk(item, "requiredApprovals.riskLevels"));
}

function normalizeRisk(value: unknown, label: string): TeamRiskLevel {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error(`${label} must be low, medium, or high.`);
}

function normalizeProvider(value: unknown): "mock" | "local" | "api" {
  if (value === "local" || value === "api") {
    return value;
  }
  return "mock";
}

function normalizeNetworkPolicy(value: unknown): "deny" | "allow" | "custom" {
  if (value === "allow" || value === "custom") {
    return value;
  }
  return "deny";
}
