// --- Identity references (typed pointers to existing entities) ---

export type AgentRoleRef = { id: string; version?: string };
export type ToolRef = { id: string; permission?: string };
export type ConnectorRef = { name: string; fixtureMode?: boolean };
export type PolicyRef = { id: string };
export type DatasetRef = { id: string; source: "fixture" | "live" };

// --- Graph (canvas state) ---

export type GraphNodeKind =
  | "agent"
  | "tool"
  | "connector"
  | "policy"
  | "dataset"
  | "benchmark";

export type GraphNode = {
  id: string;
  kind: GraphNodeKind;
  refId: string;             // references one of AgentRoleRef.id / ToolRef.id / etc
  label: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
};

export type GraphEdgeKind = "data" | "control" | "approval-gate";

export type GraphEdge = {
  id: string;
  kind: GraphEdgeKind;
  source: string;            // GraphNode.id
  target: string;            // GraphNode.id
  label?: string;
};

// --- Benchmarks + KPIs ---

export type BenchmarkTarget = {
  datasetId: string;
  metric: string;
  threshold: number;
  baseline?: number;
};

export type KpiTarget = {
  name: string;
  target: number;
  unit: string;
  businessValuePerUnit?: number;
};

// --- Audit ---

export type BlueprintAuditEntry = {
  id: string;
  blueprintSlug: string;
  blueprintVersion: string;
  eventType:
    | "installed"
    | "edited"
    | "benchmark_run"
    | "promoted"
    | "rolled_back"
    | "uninstalled"
    | "scope_changed";
  actor: string;
  timestamp: string;
  prevHash: string;
  hash: string;
  payload: Record<string, unknown>;
};

// --- Forward-compatible Phase 4 + Phase 8 hooks ---

export type WidgetRef = { id: string; label: string; source: string; position: string };
export type SidebarItemRef = { id: string; label: string; icon?: string; blueprint: string; requiresRole?: string[] };
export type PageOverlayRef = { page: string; tab?: string; blueprint: string };
export type ThemeRef = { id: string; preferDensity?: "compact" | "comfortable"; preferColorScheme?: "light" | "dark" | "auto" };

export type ReflectionTriggerPolicy = {
  onMultiToolTask?: boolean;
  onLongRuntime?: boolean;
  onPlanRevision?: boolean;
  onRepeatedFailure?: boolean;
  onUserCorrection?: boolean;
  onHighRiskOp?: boolean;
  onScheduledJobComplete?: boolean;
};

// --- The manifest itself ---

export type BlueprintManifest = {
  name: string;
  slug: string;
  version: string;             // semver
  description: string;
  owner: string;
  tags: string[];

  graph: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    layout?: Record<string, { x: number; y: number }>;
  };

  agentRoles: AgentRoleRef[];
  tools: ToolRef[];
  connectors: ConnectorRef[];
  policies: PolicyRef[];
  datasets: DatasetRef[];

  benchmarks: BenchmarkTarget[];
  kpis: KpiTarget[];

  rollout: {
    status: "draft" | "pilot" | "stable" | "archived";
    canaryPercent?: number;
    haltOnFailure: boolean;
    previousVersion?: string;
  };

  scope: {
    tenants?: string[];
    departments?: string[];
    roles?: string[];
    users?: string[];
  };

  // Stored now, consumed by Phase 8 (uiContributions) and Phase 4 (trainability + adaptivity).
  uiContributions?: {
    dashboardWidgets?: WidgetRef[];
    sidebarItems?: SidebarItemRef[];
    pageOverlays?: PageOverlayRef[];
    themes?: ThemeRef[];
    homeScreen?: string;
  };

  trainability?: {
    feedbackTargets: string[];
    mutationCandidates: string[];
    promotionGate: "manual" | "auto-with-benchmark" | "auto-with-eval+rollback";
    rollbackOnBenchmarkRegression: boolean;
  };

  adaptivity?: {
    reflectionTrigger: ReflectionTriggerPolicy;
    memoryNudgeFrequency?: "daily" | "weekly" | "manual" | "after_N_runs";
    affordanceGapPolicy: "log-only" | "auto-propose-skill" | "block-on-detection";
  };

  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  auditTrail: BlueprintAuditEntry[];
};

// --- Blueprint run types ---
// Keep in sync with the CHECK constraint in DB migration 19 (run_type column).
export type BlueprintRunType = "benchmark" | "pilot" | "production" | "reflection";
