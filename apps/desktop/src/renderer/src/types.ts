import type {
  AffordanceGapDto,
  AgentMessageDto,
  AgentRoleDto,
  BlackboardEntryDto,
  ConnectorDto,
  BenchmarkComparisonDto,
  CanaryStateDto,
  EvalDatasetDto,
  EvalRunDetailDto,
  EvalRunDto,
  EvalTaskResultDto,
  HumanHandoffDto,
  JobDetailDto,
  JobDto,
  JobRunDto,
  MemoryDto,
  MemoryGraphDetailDto,
  MemoryGraphEdgeDto,
  MemoryGraphNodeDto,
  MemoryGraphSearchResultDto,
  ReflectionDto,
  SandboxDto,
  SkillDetailDto,
  SkillDto,
  SkillEvaluationResultDto,
  SkillManifestDto,
  SkillVariantDto,
  SkillVersionDto,
  StaticCheckDto,
  TeamConflictDto,
  TeamDto,
  TeamRunDetailDto,
  TeamRunDto,
  TeamSubtaskDto,
  ToolCallDto,
  ToolResultDto,
  TraceDto,
  TraceMetricsDto,
  TraceRunSummaryDto,
  TraceStepDto,
  TraceSearchResultDto,
  LeaderboardEntryDto,
  MessagingAdapterDto,
  MessagingAllowlistRuleDto,
  MessagingChannelDto,
  MessagingDeliveryRuleDto,
  MessagingEventDto,
  MessagingIdentityDto,
  MessagingSessionDto,
  PlatformMatrixEntryDto
} from "../../shared/api";

export type PageId =
  | "chat"
  | "traces"
  | "memory"
  | "gaps"
  | "sandboxes"
  | "skills"
  | "jobs"
  | "teams"
  | "evals"
  | "messaging"
  | "approvals"
  | "settings";

export type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCallDto[];
  toolResults?: ToolResultDto[];
};

export type {
  AffordanceGapDto,
  AgentMessageDto,
  AgentRoleDto,
  BlackboardEntryDto,
  ConnectorDto,
  BenchmarkComparisonDto,
  CanaryStateDto,
  EvalDatasetDto,
  EvalRunDetailDto,
  EvalRunDto,
  EvalTaskResultDto,
  HumanHandoffDto,
  JobDetailDto,
  JobDto,
  JobRunDto,
  MemoryDto,
  MemoryGraphDetailDto,
  MemoryGraphEdgeDto,
  MemoryGraphNodeDto,
  MemoryGraphSearchResultDto,
  ReflectionDto,
  SandboxDto,
  SkillDetailDto,
  SkillDto,
  SkillEvaluationResultDto,
  SkillManifestDto,
  SkillVariantDto,
  SkillVersionDto,
  StaticCheckDto,
  TeamConflictDto,
  TeamDto,
  TeamRunDetailDto,
  TeamRunDto,
  TeamSubtaskDto,
  TraceDto,
  TraceMetricsDto,
  TraceRunSummaryDto,
  TraceStepDto,
  TraceSearchResultDto,
  LeaderboardEntryDto,
  MessagingAdapterDto,
  MessagingAllowlistRuleDto,
  MessagingChannelDto,
  MessagingDeliveryRuleDto,
  MessagingEventDto,
  MessagingIdentityDto,
  MessagingSessionDto,
  PlatformMatrixEntryDto
};
