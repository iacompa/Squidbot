export type JsonObject = Record<string, unknown>;

export type ModelCostOwner = "local/free" | "user-paid" | "user-paid BYOK" | "org-paid" | "organization-paid BYOK" | "disabled";

export type ModelMode = "mock" | "local" | "byok";

export type ChatMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  /** Tool calls requested by an assistant turn (drives the agentic loop). */
  toolCalls?: ToolCall[];
  /** Links a `tool` result message back to the assistant tool call it answers. */
  toolCallId?: string;
  /** Optional tool name on a `tool` result message (aids provider serialization). */
  name?: string;
};

export type ToolSchema = {
  name: string;
  description: string;
  inputSchema: JsonObject;
  permissionScopes?: string[];
  riskLevel?: string;
  metadata?: JsonObject;
};

export type ToolCall = {
  id: string;
  name: string;
  args: JsonObject;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type ModelResponse = {
  provider: string;
  modelName: string;
  mode: ModelMode;
  costOwner: ModelCostOwner;
  content: string;
  toolCalls: ToolCall[];
  tokenUsage?: TokenUsage;
  costEstimate?: number;
};

export type WorkspaceSummaryFile = {
  path: string;
  firstLines: string[];
};

export type WorkspaceSummary = {
  workspacePath: string;
  topLevelEntries: string[];
  keyFiles: WorkspaceSummaryFile[];
};

export type TaskPlanAction = {
  id: string;
  description: string;
  toolName: string;
  args: JsonObject;
};

export type TaskPlan = {
  id: string;
  problem: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  actions: TaskPlanAction[];
};

export type ModelEventType =
  | "model.call"
  | "model.result"
  | "model.error"
  | "model.budgetWarning"
  | "model.budgetExceeded"
  | "model.fallback";

export type ModelEventEmitter = (type: ModelEventType, data: JsonObject) => void;

export type ModelProviderRequest = {
  sessionId: string;
  runId: string;
  messages: ChatMessage[];
  tools: ToolSchema[];
  emitEvent?: ModelEventEmitter;
};

export type TaskPlanRequest = {
  sessionId: string;
  runId: string;
  task: string;
  workspaceSummary: WorkspaceSummary;
  testCommand?: string;
  memoryBulletin?: string;
  tools?: ToolSchema[];
  emitEvent?: ModelEventEmitter;
};

export interface ModelProvider {
  name: string;
  modelName: string;
  mode: ModelMode;
  maxTokens: number;
  supportsTools: boolean;
  costOwner: ModelCostOwner;
  costPerToken?: number;
  isAvailable?(): Promise<boolean> | boolean;
  estimateTokens?(messages: ChatMessage[], tools?: ToolSchema[]): number;
  generate(request: ModelProviderRequest): Promise<ModelResponse>;
  generateTaskPlan?(request: TaskPlanRequest): Promise<TaskPlan>;
}

export type ModelProviderName = "local" | "api" | "mock";

export type ModelRouterSettings = {
  provider?: ModelProviderName | string;
  legacyProvider?: string;
  apiKey?: string | null;
  apiUrl?: string | null;
  apiModel?: string | null;
  apiBudgetTokens?: number | null;
  localModel?: string | null;
};

export type ModelUsageRecord = {
  provider: string;
  usageDate: string;
  tokens: number;
  cost: number;
  updatedAt: string;
};

export interface ModelBudgetStore {
  getModelUsage(provider: string, usageDate: string): ModelUsageRecord | null;
  addModelUsage(provider: string, usageDate: string, tokens: number, cost: number): ModelUsageRecord;
}
