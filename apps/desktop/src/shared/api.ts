export type TraceStepDto = {
  id: string;
  timestamp: string;
  type: string;
  label: string;
  detail: Record<string, unknown>;
};

export type TraceDto = {
  id: string;
  sessionId: string;
  runId: string;
  createdAt: string;
  summary: {
    eventCount: number;
    toolCallCount: number;
    provider: string;
    costOwner: string;
    redactionCount?: number;
  };
  steps: TraceStepDto[];
};

export type TraceRunSummaryDto = {
  traceId: string;
  runId: string;
  sessionId: string;
  task: string;
  provider: string;
  costOwner: string;
  status: "success" | "partial" | "failed" | "running" | "unknown";
  createdAt: string;
  durationMs: number;
  eventCount: number;
  toolCallCount: number;
  totalCost: number;
  totalTokens: number;
};

export type TraceMetricsDto = {
  durationMs: number;
  meanStepDurationMs: number;
  maxStepDurationMs: number;
  totalCost: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  providerBreakdown: Array<{
    provider: string;
    costOwner: string;
    cost: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    calls: number;
  }>;
  eventTypeBreakdown: Array<{ type: string; count: number; durationMs: number }>;
  toolBreakdown: Array<{ name: string; count: number; durationMs: number }>;
  connectorBreakdown: Array<{ name: string; count: number; durationMs: number }>;
};

export type TraceSearchResultDto = {
  run: TraceRunSummaryDto;
  event: TraceStepDto;
};

export type ToolCallDto = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ToolResultDto = {
  callId: string;
  toolName: string;
  ok: boolean;
  output: unknown;
};

export type ChatRequest = {
  message: string;
  workspacePath?: string;
  sessionId?: string;
};

export type ChatResponse = {
  sessionId: string;
  runId: string;
  content: string;
  toolCalls: ToolCallDto[];
  toolResults: ToolResultDto[];
  trace: TraceDto;
};

export type SettingsDto = {
  appDataDir: string;
  databasePath: string;
  workspacePath?: string;
  modelProvider: "local" | "api" | "mock";
  byokEnabled: boolean;
  modelSettings: {
    provider: "local" | "api" | "mock";
    apiKeyConfigured: boolean;
    apiUrl?: string;
    apiModel: string;
    apiBudgetTokens?: number;
    apiUsedTokens: number;
    apiRemainingTokens?: number;
    apiCost: number;
    costOwner: string;
  };
  connectors: ConnectorDto[];
  connectorSettings: Record<string, { baseUrl?: string; apiKeyConfigured: boolean }>;
};

export type ConnectorDto = {
  name: string;
  systemType: string;
  description: string;
  protocol: string;
  fixtureMode: boolean;
  costOwner: string;
  operations: string[];
};

export type ReflectionDto = {
  id: string;
  sessionId: string;
  runId: string;
  task: string;
  summary: string;
  outcome: string;
  successFactors: unknown[];
  failureModes: unknown[];
  missingTools: unknown[];
  missingPermissions: unknown[];
  missingContext: unknown[];
  reusablePatterns: unknown[];
  memoryCandidates: unknown[];
  failureTaxonomy: unknown[];
  affordanceIds: unknown[];
  createdAt: string;
};

export type AffordanceGapDto = {
  id: string;
  runId: string;
  reflectionId: string | null;
  type: string;
  name: string;
  severity: "low" | "medium" | "high";
  description: string;
  context: unknown;
  status: "open" | "resolved" | "wontfix";
  createdAt: string;
  resolvedAt: string | null;
};

export type SandboxDto = {
  id: string;
  sessionId: string | null;
  runId: string | null;
  workspacePath: string;
  sandboxPath: string;
  backend: string;
  status: "active" | "promoted" | "rejected" | "destroyed" | "failed";
  resourceLimits: unknown;
  networkPolicy: "allow" | "deny" | "custom";
  diff: string;
  testResults: unknown[];
  approvalId: string | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  destroyedAt: string | null;
  lastError: string | null;
};

export type SkillManifestDto = {
  id: string;
  name: string;
  version: string;
  description: string;
  requiredTools: string[];
  prompts: Record<string, string>;
  testFixtures: Array<{
    id: string;
    name: string;
    task: string;
    testCommand?: string;
    repoPath?: string;
    expectedResult?: Record<string, unknown>;
    expectedDiff?: string;
  }>;
  permissions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  author: string;
  tags?: string[];
  domains?: string[];
};

export type SkillDto = {
  id: string;
  name: string;
  currentVersion: string;
  status: "draft" | "approved" | "archived";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type SkillVersionDto = {
  id: string;
  skillId: string;
  version: string;
  status: "draft" | "approved" | "archived";
  manifest: SkillManifestDto;
  prompts: Record<string, string>;
  testFixtures: SkillManifestDto["testFixtures"];
  packagePath: string | null;
  evaluation: SkillEvaluationResultDto | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  archivedAt: string | null;
};

export type SkillEvaluationResultDto = {
  id: string;
  skillId: string;
  version: string;
  pass: boolean;
  createdAt: string;
  metrics: {
    fixtureCount: number;
    passedFixtures: number;
    successRate: number;
    medianRuntimeMs: number;
    toolCount: number;
    cost: number;
  };
  fixtures: Array<{
    fixtureId: string;
    name: string;
    pass: boolean;
    durationMs: number;
    toolCount: number;
    cost: number;
    runId?: string;
    errors: string[];
  }>;
};

export type SkillDetailDto = {
  skill: SkillDto;
  version: SkillVersionDto | null;
  versions: SkillVersionDto[];
  evaluations: Array<{
    id: string;
    skillId: string;
    version: string;
    result: SkillEvaluationResultDto;
    createdAt: string;
  }>;
};

export type JobDto = {
  id: string;
  name: string;
  type: "skill" | "task";
  refId: string;
  version: string | null;
  schedule: string;
  scheduleKind: "recurring" | "oneOff";
  nextRunAt: string | null;
  status: "active" | "paused" | "running" | "completed";
  lastOutcome: "success" | "failure" | "running" | "never";
  workspacePath: string | null;
  testCommand: string | null;
  testMode: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
};

export type JobRunDto = {
  id: string;
  jobId: string;
  runId: string | null;
  traceId: string | null;
  outcome: "success" | "failure" | "running";
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  summary: string | null;
  error: string | null;
};

export type JobDetailDto = {
  job: JobDto;
  runs: JobRunDto[];
  schedule: {
    input: string;
    normalized: string;
    kind: "recurring" | "oneOff";
    nextRunAt: string | null;
  };
};

export type JobCreateRequestDto = {
  name: string;
  type: "skill" | "task";
  refId: string;
  version?: string | null;
  schedule: string;
  workspacePath?: string | null;
  testCommand?: string | null;
  testMode?: boolean;
};

export type AgentRoleDto = {
  id: string;
  name: string;
  description: string;
  manifest: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type TeamDto = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  manifest: {
    id: string;
    name: string;
    description: string;
    roles: string[];
    coordinatorRoleId: string;
    defaultPolicy: Record<string, unknown>;
    taskRoutingRules?: Array<Record<string, unknown>>;
  };
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type TeamRunDto = {
  id: string;
  teamId: string;
  parentRunId: string | null;
  task: string;
  status: "queued" | "running" | "waiting_for_human" | "completed" | "failed" | "canceled";
  coordinatorRoleId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  finalResult: Record<string, unknown> | null;
};

export type TeamSubtaskDto = {
  id: string;
  teamRunId: string;
  parentSubtaskId: string | null;
  assignedRoleId: string | null;
  title: string;
  description: string;
  status: string;
  priority: number;
  riskLevel: "low" | "medium" | "high";
  requiredCapabilities: string[];
  requiredTools: string[];
  dependsOn: string[];
  result: unknown | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type BlackboardEntryDto = {
  id: string;
  teamRunId: string;
  subtaskId: string | null;
  authorRoleId: string | null;
  type: string;
  title: string;
  body: string;
  data: unknown;
  confidence: number;
  importance: number;
  sensitivity: "public" | "restricted" | "secret";
  sourceEventId: string | null;
  sourceRunId: string | null;
  sourceMemoryNodeId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type TeamConflictDto = {
  id: string;
  teamRunId: string;
  type: string;
  severity: "low" | "medium" | "high";
  status: "open" | "resolved" | "dismissed";
  description: string;
  involvedEntryIds: string[];
  involvedRoleIds: string[];
  resolution: unknown | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type HumanHandoffDto = {
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

export type AgentMessageDto = {
  id: string;
  teamRunId: string;
  fromRoleId: string | null;
  toRoleId: string | null;
  messageType: string;
  content: string;
  data: unknown;
  createdAt: string;
};

export type TeamRunDetailDto = {
  run: TeamRunDto;
  subtasks: TeamSubtaskDto[];
  blackboardEntries: BlackboardEntryDto[];
  messages: AgentMessageDto[];
  conflicts: TeamConflictDto[];
  handoffs: HumanHandoffDto[];
};

export type TeamRunRequestDto = {
  teamId: string;
  workspacePath?: string | null;
  task: string;
  mode?: "dry-run" | "sandbox" | "approved-write";
};

export type EvalDatasetDto = {
  id: string;
  name: string;
  domain: string;
  version: string;
  description: string | null;
  manifest: Record<string, unknown>;
  sourcePath: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type EvalRunDto = {
  id: string;
  datasetId: string;
  targetType: string;
  targetId: string;
  baselineTargetId: string | null;
  status: "queued" | "running" | "completed" | "failed" | "canceled";
  mode: string;
  startedAt: string | null;
  completedAt: string | null;
  summary: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
  report: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type EvalTaskResultDto = {
  id: string;
  evalRunId: string;
  evalTaskId: string;
  status: "passed" | "failed" | "skipped" | "error";
  score: number;
  metrics: Array<Record<string, unknown>>;
  traceId: string | null;
  runId: string | null;
  sandboxId: string | null;
  error: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SkillVariantDto = {
  id: string;
  skillId: string;
  baseVersion: string;
  variantVersion: string | null;
  state: string;
  name: string;
  description: string | null;
  mutationType: string;
  sourceType: string;
  sourceId: string | null;
  patch: Record<string, unknown>;
  manifest: Record<string, unknown>;
  prompts: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StaticCheckDto = {
  status: "passed" | "failed";
  checks: Array<{
    id: string;
    name: string;
    passed: boolean;
    severity: "low" | "medium" | "high";
    message: string;
  }>;
};

export type CanaryStateDto = {
  id: string;
  variantId: string;
  skillId: string;
  status: string;
  scope: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BenchmarkComparisonDto = {
  id: string;
  datasetId: string;
  baselineEvalRunId: string;
  candidateEvalRunId: string;
  winnerTargetId: string | null;
  status: "candidate_won" | "baseline_won" | "tie" | "rejected";
  decision: Record<string, unknown>;
  createdAt: string;
};

export type LeaderboardEntryDto = {
  id: string;
  datasetId: string;
  targetType: string;
  targetId: string;
  evalRunId: string;
  compositeScore: number;
  metrics: Record<string, unknown>;
  rank: number | null;
  createdAt: string;
};

export type EvalRunDetailDto = {
  evalRun: EvalRunDto;
  taskResults: EvalTaskResultDto[];
  comparisons: BenchmarkComparisonDto[];
};

export type MessagingCapabilitiesDto = Record<
  | "text"
  | "markdown"
  | "threads"
  | "reactions"
  | "slashCommands"
  | "buttons"
  | "modals"
  | "files"
  | "images"
  | "audio"
  | "voiceTranscription"
  | "edits"
  | "deletes"
  | "readReceipts"
  | "ephemeralMessages"
  | "deliveryReceipts"
  | "webhooks"
  | "polling",
  boolean
>;

export type PlatformMatrixEntryDto = {
  platform: string;
  displayName: string;
  capabilities: MessagingCapabilitiesDto;
  authType: string;
  selfHostedOption: boolean;
  realAdapterStatus: "fixtureOnly" | "betaReal" | "supportedReal" | "planned";
  complianceNotes: string[];
  risks: string[];
  requiredSettings: string[];
};

export type MessagingAdapterDto = {
  id: string;
  name: string;
  platform: string;
  status: "installed" | "disabled" | "archived";
  manifest: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type MessagingChannelDto = {
  id: string;
  adapterId: string;
  platform: string;
  externalChannelId: string;
  displayName: string | null;
  channelType: "dm" | "group" | "channel" | "thread" | "email" | "room" | "webchat";
  status: "active" | "paused" | "disabled";
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MessagingAllowlistRuleDto = {
  id: string;
  platform: string;
  adapterId: string | null;
  externalUserId: string | null;
  externalChannelId: string | null;
  ruleType: "allowUser" | "allowChannel" | "blockUser" | "blockChannel" | "allowDomain";
  allowedActions: string[];
  riskLimit: "low" | "medium" | "high";
  createdAt: string;
  updatedAt: string;
};

export type MessagingDeliveryRuleDto = {
  id: string;
  name: string;
  triggerType: "runSummary" | "approvalRequest" | "jobComplete" | "sandboxReady" | "evalComplete" | "teamHandoff" | "gapCreated";
  targetChannelId: string;
  filter: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MessagingEventDto = {
  id: string;
  adapterId: string;
  platform: string;
  direction: "inbound" | "outbound";
  normalizedType: string;
  channelId: string | null;
  identityId: string | null;
  sessionId: string | null;
  runId: string | null;
  teamRunId: string | null;
  jobId: string | null;
  skillId: string | null;
  bodyText: string | null;
  redactedPayload: Record<string, unknown> | null;
  sensitivity: "public" | "restricted" | "secret";
  createdAt: string;
};

export type MessagingSessionDto = {
  id: string;
  platform: string;
  adapterId: string;
  channelId: string;
  externalThreadId: string | null;
  localSessionId: string | null;
  activeRunId: string | null;
  activeTeamRunId: string | null;
  activeJobId: string | null;
  status: "active" | "idle" | "archived";
  context: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MessagingIdentityDto = {
  id: string;
  platform: string;
  externalUserId: string;
  displayName: string | null;
  username: string | null;
  email: string | null;
  trustLevel: "unknown" | "allowed" | "trusted" | "admin" | "blocked";
  linkedLocalUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MemoryDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  sourceRunId: string;
  sourceReflectionId: string | null;
  sourceEventId: string | null;
  confidence: number;
  importance: number;
  createdAt: string;
  approvedAt: string | null;
  archivedAt: string | null;
};

export type MemoryGraphNodeDto = {
  id: string;
  type: string;
  title: string;
  body: string;
  confidence: number;
  importance: number;
  sensitivity: "public" | "restricted" | "secret";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  affordanceId: string | null;
};

export type MemoryGraphEdgeDto = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: string;
  createdAt: string;
  deletedAt: string | null;
};

export type MemoryGraphSearchResultDto = {
  node: MemoryGraphNodeDto;
  score: number;
  source: string;
  rank: number;
};

export type MemoryGraphDetailDto = {
  node: MemoryGraphNodeDto;
  edges: MemoryGraphEdgeDto[];
  relatedNodes: MemoryGraphNodeDto[];
};

export type GovernanceStatusDto = {
  tenantId: string;
  users: number;
  roles: number;
  decisions: number;
  auditEntries: number;
  secrets: number;
  retentionPolicies: number;
  legalHolds: number;
  n8nIntegrations: number;
  policyPacks: number;
};

export type GovernanceUserDto = {
  id: string;
  tenantId: string;
  email: string | null;
  username: string;
  displayName: string | null;
  status: string;
  authType: string;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

export type GovernanceRoleDto = {
  id: string;
  name: string;
  description: string;
  permissions: string[];
};

export type GovernancePolicyDecisionDto = {
  id?: string;
  tenantId: string;
  decision: string;
  reason: string;
  matchedPolicies: string[];
  obligations: string[];
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  createdAt?: string;
};

export type GovernanceAuditEntryDto = {
  id: string;
  tenantId: string;
  sequence: number;
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: string;
  source?: string;
  dataClassification?: string;
  redactedDetail?: unknown;
  previousHash: string | null;
  entryHash: string;
  createdAt: string;
};

export type GovernanceSecretRefDto = {
  id: string;
  tenantId: string;
  name: string;
  provider: string;
  path: string;
  version: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  rotatedAt: string | null;
  archivedAt: string | null;
};

export type GovernanceRetentionPolicyDto = {
  id: string;
  name: string;
  resourceType: string;
  dataClassification: string;
  retentionDays: number;
  action: string;
  enabled: boolean;
};

export type GovernanceN8nIntegrationDto = {
  id: string;
  name: string;
  direction: "inbound" | "outbound";
  authMode: string;
  allowedEventTypes: string[];
  allowedActions: string[];
  enabled: boolean;
};

export type SquidbotApi = {
  chooseWorkspace: () => Promise<string | null>;
  getSettings: () => Promise<SettingsDto>;
  saveSetting: (
    key:
      | "workspacePath"
      | "modelProvider"
      | "byokEnabled"
      | "model.provider"
      | "model.apiKey"
      | "model.apiUrl"
      | "model.apiModel"
      | "model.budget.api",
    value: unknown
  ) => Promise<SettingsDto>;
  saveConnectorSetting: (connectorName: string, key: "apiKey" | "baseUrl", value: string) => Promise<SettingsDto>;
  sendChatMessage: (request: ChatRequest) => Promise<ChatResponse>;
  getLatestTrace: () => Promise<TraceDto | null>;
  listTraces: () => Promise<TraceDto[]>;
  listRuns: (options?: { limit?: number; offset?: number; sortBy?: "createdAt" | "duration" | "cost" }) => Promise<TraceRunSummaryDto[]>;
  getTrace: (runId: string) => Promise<TraceDto | null>;
  getTraceMetrics: (runId: string) => Promise<TraceMetricsDto | null>;
  searchTraceEvents: (options?: {
    runId?: string;
    type?: string;
    provider?: string;
    tool?: string;
    jobId?: string;
    teamRunId?: string;
    text?: string;
    limit?: number;
  }) => Promise<TraceSearchResultDto[]>;
  listConnectors: () => Promise<ConnectorDto[]>;
  listReflections: () => Promise<ReflectionDto[]>;
  listMemories: () => Promise<MemoryDto[]>;
  approveMemoryCandidate: (reflectionId: string, candidateIndex: number) => Promise<{ memory: MemoryDto; reflection: ReflectionDto }>;
  listAffordanceGaps: (options?: { status?: "open" | "resolved" | "wontfix" | "all" }) => Promise<AffordanceGapDto[]>;
  getAffordanceGap: (gapId: string) => Promise<AffordanceGapDto | null>;
  resolveAffordanceGap: (gapId: string, status?: "resolved" | "wontfix") => Promise<AffordanceGapDto>;
  listSandboxes: (options?: { status?: "active" | "promoted" | "rejected" | "destroyed" | "failed" | "all" }) => Promise<SandboxDto[]>;
  getSandbox: (sandboxId: string) => Promise<SandboxDto | null>;
  approveSandbox: (sandboxId: string) => Promise<SandboxDto>;
  rejectSandbox: (sandboxId: string) => Promise<SandboxDto>;
  listSkills: () => Promise<SkillDto[]>;
  getSkill: (skillId: string, version?: string) => Promise<SkillDetailDto | null>;
  evaluateSkill: (skillId: string, version?: string) => Promise<SkillEvaluationResultDto>;
  promoteSkill: (skillId: string, version: string, override?: boolean) => Promise<SkillVersionDto>;
  rollbackSkill: (skillId: string, version: string) => Promise<SkillDto>;
  deleteSkill: (skillId: string, version?: string) => Promise<SkillDto | SkillVersionDto>;
  runSkill: (skillId: string, request?: { version?: string; workspacePath?: string; test?: boolean }) => Promise<{
    runId: string;
    finalSummary: string;
    trace: TraceDto;
  }>;
  listJobs: (options?: { status?: "active" | "paused" | "running" | "completed" | "all"; limit?: number }) => Promise<JobDto[]>;
  getJob: (jobId: string) => Promise<JobDetailDto | null>;
  createJob: (request: JobCreateRequestDto) => Promise<JobDto>;
  pauseJob: (jobId: string) => Promise<JobDto>;
  resumeJob: (jobId: string) => Promise<JobDto>;
  removeJob: (jobId: string) => Promise<JobDto>;
  runJobNow: (jobId: string) => Promise<{ job: JobDto; run: JobRunDto }>;
  listTeamRoles: () => Promise<AgentRoleDto[]>;
  listTeams: () => Promise<TeamDto[]>;
  getTeam: (teamId: string) => Promise<{ team: TeamDto; runs: TeamRunDto[] } | null>;
  createTeam: (request: { name: string; roles: string[]; description?: string }) => Promise<TeamDto>;
  listTeamRuns: (teamId?: string) => Promise<TeamRunDto[]>;
  getTeamRun: (teamRunId: string) => Promise<TeamRunDetailDto | null>;
  runTeamTask: (request: TeamRunRequestDto) => Promise<{
    team: TeamDto;
    run: TeamRunDto;
    subtasks: TeamSubtaskDto[];
    blackboardEntries: BlackboardEntryDto[];
    conflicts: TeamConflictDto[];
    handoffs: HumanHandoffDto[];
    synthesis: Record<string, unknown>;
    traceId: string;
  }>;
  listTeamHandoffs: (status?: "open" | "answered" | "canceled" | "all") => Promise<HumanHandoffDto[]>;
  answerTeamHandoff: (handoffId: string, responseText: string) => Promise<HumanHandoffDto>;
  listEvalDatasets: () => Promise<EvalDatasetDto[]>;
  getEvalDataset: (datasetId: string) => Promise<{ dataset: EvalDatasetDto; tasks: unknown[] } | null>;
  listEvalRuns: () => Promise<EvalRunDto[]>;
  getEvalRunDetail: (evalRunId: string) => Promise<EvalRunDetailDto | null>;
  listSkillVariants: (skillId?: string) => Promise<SkillVariantDto[]>;
  getSkillVariant: (variantId: string) => Promise<{ variant: SkillVariantDto; staticCheck: StaticCheckDto | null; canary: CanaryStateDto | null } | null>;
  listEvalLeaderboard: (options?: { datasetId?: string; domain?: string }) => Promise<LeaderboardEntryDto[]>;
  listMessagingAdapters: () => Promise<MessagingAdapterDto[]>;
  listMessagingMatrix: (platform?: string) => Promise<PlatformMatrixEntryDto[] | PlatformMatrixEntryDto | null>;
  listMessagingChannels: (platform?: string) => Promise<MessagingChannelDto[]>;
  addMessagingChannel: (request: {
    platform: string;
    externalChannelId: string;
    displayName?: string;
    channelType?: MessagingChannelDto["channelType"];
  }) => Promise<MessagingChannelDto>;
  listMessagingAllowlist: (platform?: string) => Promise<MessagingAllowlistRuleDto[]>;
  addMessagingAllowlistRule: (request: {
    platform: string;
    externalUserId?: string | null;
    externalChannelId?: string | null;
    ruleType: MessagingAllowlistRuleDto["ruleType"];
    riskLimit?: MessagingAllowlistRuleDto["riskLimit"];
  }) => Promise<MessagingAllowlistRuleDto>;
  removeMessagingAllowlistRule: (ruleId: string) => Promise<boolean>;
  listMessagingDeliveryRules: (triggerType?: MessagingDeliveryRuleDto["triggerType"]) => Promise<MessagingDeliveryRuleDto[]>;
  addMessagingDeliveryRule: (request: {
    name: string;
    triggerType: MessagingDeliveryRuleDto["triggerType"];
    targetChannelId: string;
  }) => Promise<MessagingDeliveryRuleDto>;
  removeMessagingDeliveryRule: (ruleId: string) => Promise<boolean>;
  listMessagingEvents: (options?: { platform?: string; runId?: string; limit?: number }) => Promise<MessagingEventDto[]>;
  listMessagingSessions: (platform?: string) => Promise<MessagingSessionDto[]>;
  listMessagingIdentities: (platform?: string) => Promise<MessagingIdentityDto[]>;
  sendLocalWebMessage: (text: string) => Promise<{ event: unknown; route: unknown }>;
  bootstrapGovernance: () => Promise<{ organizationId: string; tenantId: string; adminUserId: string; rolesCreated: number }>;
  getGovernanceStatus: () => Promise<GovernanceStatusDto>;
  listGovernanceUsers: () => Promise<GovernanceUserDto[]>;
  listGovernanceRoles: () => Promise<GovernanceRoleDto[]>;
  simulateGovernancePolicy: (request: { userId: string; action: string; resource: string; riskLevel?: string }) => Promise<GovernancePolicyDecisionDto>;
  listGovernancePolicyDecisions: () => Promise<GovernancePolicyDecisionDto[]>;
  listGovernanceSecrets: () => Promise<GovernanceSecretRefDto[]>;
  listGovernanceAudit: () => Promise<GovernanceAuditEntryDto[]>;
  listGovernanceRetentionPolicies: () => Promise<GovernanceRetentionPolicyDto[]>;
  listGovernanceN8nIntegrations: () => Promise<GovernanceN8nIntegrationDto[]>;
  listMemoryGraphNodes: () => Promise<MemoryGraphNodeDto[]>;
  searchMemoryGraph: (query: string, mode: "fts" | "vector" | "hybrid", topK?: number) => Promise<MemoryGraphSearchResultDto[]>;
  getMemoryGraphNode: (nodeId: string) => Promise<MemoryGraphDetailDto | null>;
  createMemoryGraphNode: (input: {
    type: string;
    title: string;
    body: string;
    confidence?: number;
    importance?: number;
    sensitivity?: string;
  }) => Promise<MemoryGraphNodeDto>;
  updateMemoryGraphNode: (
    nodeId: string,
    input: Partial<{ title: string; body: string; confidence: number; importance: number; sensitivity: string }>
  ) => Promise<MemoryGraphNodeDto>;
  archiveMemoryGraphNode: (nodeId: string) => Promise<MemoryGraphNodeDto>;
  deleteMemoryGraphNode: (nodeId: string) => Promise<MemoryGraphNodeDto>;
  mergeMemoryGraphNodes: (targetNodeId: string, sourceNodeId: string) => Promise<MemoryGraphNodeDto>;
};
