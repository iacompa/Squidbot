export type TeamRunStatus = "queued" | "running" | "waiting_for_human" | "completed" | "failed" | "canceled";
export type TeamSubtaskStatus = "queued" | "assigned" | "running" | "blocked" | "waiting_for_human" | "completed" | "failed" | "canceled";
export type TeamRiskLevel = "low" | "medium" | "high";
export type TeamSensitivity = "public" | "restricted" | "secret";

export type TeamManifest = {
  id: string;
  name: string;
  description: string;
  roles: string[];
  coordinatorRoleId: string;
  defaultPolicy: {
    maxConcurrentAgents: number;
    requireHumanForHighRisk: boolean;
    requireSandboxForWrites: boolean;
    allowPaidModels: boolean;
    allowRealConnectorWrites: boolean;
  };
  taskRoutingRules?: Array<{
    match: string;
    preferredRoleId: string;
    requiredCapabilities?: string[];
  }>;
};

export type TeamRecord = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  manifest: TeamManifest;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type AgentRoleManifest = {
  id: string;
  name: string;
  description: string;
  defaultModelProvider?: "mock" | "local" | "api";
  modelHints?: {
    preferredProvider?: string;
    maxContextTokens?: number;
    allowByok?: boolean;
    allowPaid?: boolean;
  };
  capabilities: string[];
  responsibilities: string[];
  allowedTools: string[];
  deniedTools?: string[];
  requiredApprovals?: {
    toolPatterns?: string[];
    connectorPatterns?: string[];
    riskLevels?: TeamRiskLevel[];
  };
  memoryDomains: {
    read: string[];
    write: string[];
  };
  sandboxPolicy: {
    requiredForWrites: boolean;
    networkPolicy: "deny" | "allow" | "custom";
    maxRuntimeMs?: number;
  };
  promptTemplates: {
    system: string;
    task?: string;
    reflection?: string;
    handoff?: string;
  };
  outputSchema?: Record<string, unknown>;
  riskLimits: {
    maxToolRisk: TeamRiskLevel;
    canRequestHumanApproval: boolean;
    canModifyWorkspace: boolean;
    canCallConnectors: boolean;
    canWriteMemory: boolean;
  };
  createdAt?: string;
  updatedAt?: string;
};

export type AgentRoleRecord = {
  id: string;
  name: string;
  description: string;
  manifest: AgentRoleManifest;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type TeamSubtask = {
  id: string;
  teamRunId: string;
  parentSubtaskId: string | null;
  assignedRoleId: string | null;
  title: string;
  description: string;
  status: TeamSubtaskStatus;
  priority: number;
  riskLevel: TeamRiskLevel;
  requiredCapabilities: string[];
  requiredTools: string[];
  dependsOn: string[];
  result: unknown | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type TeamRun = {
  id: string;
  teamId: string;
  parentRunId: string | null;
  task: string;
  status: TeamRunStatus;
  coordinatorRoleId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  finalResult: TeamSynthesis | null;
};

export type BlackboardEntryType =
  | "observation"
  | "evidence"
  | "plan"
  | "patch"
  | "testResult"
  | "decision"
  | "risk"
  | "blocker"
  | "question"
  | "answer"
  | "summary"
  | "conflict"
  | "handoff"
  | "finalSynthesis";

export type BlackboardEntry = {
  id: string;
  teamRunId: string;
  subtaskId: string | null;
  authorRoleId: string | null;
  type: BlackboardEntryType;
  title: string;
  body: string;
  data: unknown;
  confidence: number;
  importance: number;
  sensitivity: TeamSensitivity;
  sourceEventId: string | null;
  sourceRunId: string | null;
  sourceMemoryNodeId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AgentMessageType = "request" | "response" | "handoff" | "clarification" | "status" | "warning" | "conflictNotice";

export type AgentMessage = {
  id: string;
  teamRunId: string;
  fromRoleId: string | null;
  toRoleId: string | null;
  messageType: AgentMessageType;
  content: string;
  data: unknown;
  createdAt: string;
};

export type TeamConflictType = "memoryConflict" | "patchConflict" | "decisionConflict" | "toolPermissionConflict" | "evidenceConflict";
export type TeamConflictStatus = "open" | "resolved" | "dismissed";

export type TeamConflict = {
  id: string;
  teamRunId: string;
  type: TeamConflictType;
  severity: TeamRiskLevel;
  status: TeamConflictStatus;
  description: string;
  involvedEntryIds: string[];
  involvedRoleIds: string[];
  resolution: unknown | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type HumanHandoff = {
  id: string;
  teamRunId: string;
  subtaskId: string | null;
  requestedByRoleId: string | null;
  reason: string;
  question: string;
  options: string[];
  status: "open" | "answered" | "canceled";
  responseText: string | null;
  response: unknown | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type TeamSynthesis = {
  teamRunId: string;
  status: "completed" | "blocked" | "failed";
  finalAnswer: string;
  roleSummaries: Array<{
    roleId: string;
    summary: string;
    evidenceEntryIds: string[];
  }>;
  decisions: string[];
  risks: string[];
  blockers: string[];
  patchSummary?: string;
  testSummary?: string;
  approvalRequests?: string[];
  traceIds: string[];
  memoryNodeIds: string[];
};

export type TeamRunResult = {
  team: TeamRecord;
  run: TeamRun;
  subtasks: TeamSubtask[];
  blackboardEntries: BlackboardEntry[];
  conflicts: TeamConflict[];
  handoffs: HumanHandoff[];
  /** Null when the run was canceled or paused before reaching the synthesis stage. */
  synthesis: TeamSynthesis | null;
  traceId: string;
};
