export type EvalDatasetDomain = "coding" | "developerWorkflow" | "support" | "sales" | "operations" | "research" | "custom";
export type EvalTargetType = "skillVersion" | "skillVariant" | "team" | "workflow" | "modelRoute";
export type EvalRunStatus = "queued" | "running" | "completed" | "failed" | "canceled";
export type EvalTaskResultStatus = "passed" | "failed" | "skipped" | "error";
export type VariantState = "draft" | "generated" | "sandbox_testing" | "benchmarking" | "canary" | "stable" | "rejected" | "archived";
export type VariantMutationType =
  | "prompt_clarification"
  | "procedure_reordering"
  | "additional_verification"
  | "safer_tool_choice"
  | "fallback_improvement"
  | "context_reduction"
  | "new_examples"
  | "new_fixtures"
  | "model_routing_hint"
  | "ui_command_wrapper";
export type VariantSourceType = "user" | "reflection" | "affordanceGap" | "evalFailure" | "manual";

export type MetricDefinition = {
  name: string;
  description?: string;
  higherIsBetter?: boolean;
};

export type EvalTaskManifest = {
  id: string;
  name: string;
  description: string;
  task: string;
  fixture: {
    workspacePath?: string;
    connectorFixtures?: string[];
    inputFiles?: string[];
  };
  target: {
    type: "skill" | "team" | "workflow";
    requiredSkillId?: string;
  };
  expected: {
    mustPassTests?: string[];
    expectedDiffPath?: string;
    expectedOutputContains?: string[];
    forbiddenOutputContains?: string[];
    expectedEvents?: string[];
    forbiddenEvents?: string[];
    expectedToolCalls?: string[];
    forbiddenToolCalls?: string[];
  };
  scoringOverrides?: {
    weights?: Record<string, number>;
    passThreshold?: number;
  };
};

export type EvalDatasetManifest = {
  id: string;
  name: string;
  domain: EvalDatasetDomain;
  version: string;
  description: string;
  tags?: string[];
  zeroSpend: true;
  tasks: EvalTaskManifest[];
  scoring: {
    primaryMetric: string;
    metrics: MetricDefinition[];
    compositeFormula: "weighted_sum" | "pass_fail_then_weighted" | "custom_local";
    weights: Record<string, number>;
    passThreshold: number;
    safetyGateRequired: boolean;
  };
  constraints: {
    requiredProvider: "mock" | "local";
    allowByok: false;
    requireSandbox: boolean;
    networkPolicy: "deny" | "fixtureOnly";
    maxCostEstimate: number;
    maxRuntimeMs: number;
    maxToolCalls?: number;
  };
  provenance: {
    author: string;
    createdAt: string;
    source?: string;
    license?: string;
  };
};

export type EvalDatasetRecord = {
  id: string;
  name: string;
  domain: EvalDatasetDomain;
  version: string;
  description: string | null;
  manifest: EvalDatasetManifest;
  sourcePath: string | null;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type EvalTaskRecord = {
  id: string;
  datasetId: string;
  name: string;
  domain: EvalDatasetDomain;
  task: EvalTaskManifest;
  fixturePath: string | null;
  expected: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type EvalMetricResult = {
  name: string;
  value: number;
  passed: boolean;
  weight: number;
  evidence: Array<{
    type: "traceEvent" | "file" | "testOutput" | "connectorFixture" | "memoryNode" | "manual";
    id?: string;
    summary: string;
  }>;
};

export type EvalRunMetrics = {
  compositeScore: number;
  taskSuccessRate: number;
  verificationCompleteness: number;
  toolErrorRate: number;
  costPerSuccessfulTask: number;
  latencyMs: number;
  humanApprovalBurden: number;
  safetyIncidentRate: number;
  traceCompleteness: number;
  testPassRate: number;
  regressionRate: number;
  taskCount: number;
  passedTaskCount: number;
};

export type EvalRunRecord = {
  id: string;
  datasetId: string;
  targetType: EvalTargetType;
  targetId: string;
  baselineTargetId: string | null;
  status: EvalRunStatus;
  mode: "offline" | "local" | "byok-disabled";
  startedAt: string | null;
  completedAt: string | null;
  summary: Record<string, unknown> | null;
  metrics: EvalRunMetrics | null;
  report: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type EvalTaskResultRecord = {
  id: string;
  evalRunId: string;
  evalTaskId: string;
  status: EvalTaskResultStatus;
  score: number;
  metrics: EvalMetricResult[];
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

export type SkillVariantRecord = {
  id: string;
  skillId: string;
  baseVersion: string;
  variantVersion: string | null;
  state: VariantState;
  name: string;
  description: string | null;
  mutationType: VariantMutationType;
  sourceType: VariantSourceType;
  sourceId: string | null;
  patch: Record<string, unknown>;
  manifest: Record<string, unknown>;
  prompts: Record<string, unknown> | null;
  policy: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type StaticCheckResult = {
  status: "passed" | "failed";
  checks: Array<{
    id: string;
    name: string;
    passed: boolean;
    severity: "low" | "medium" | "high";
    message: string;
  }>;
};

export type BenchmarkComparisonRecord = {
  id: string;
  datasetId: string;
  baselineEvalRunId: string;
  candidateEvalRunId: string;
  winnerTargetId: string | null;
  status: "candidate_won" | "baseline_won" | "tie" | "rejected";
  decision: Record<string, unknown>;
  createdAt: string;
};

export type CanaryStateRecord = {
  id: string;
  variantId: string;
  skillId: string;
  status: "pending" | "running" | "passed" | "failed" | "promoted" | "rolled_back";
  scope: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  metrics: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeaderboardEntryRecord = {
  id: string;
  datasetId: string;
  targetType: EvalTargetType;
  targetId: string;
  evalRunId: string;
  compositeScore: number;
  metrics: EvalRunMetrics;
  rank: number | null;
  createdAt: string;
};
