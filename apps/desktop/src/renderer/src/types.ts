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
  PlatformMatrixEntryDto,
  GovernanceAuditEntryDto,
  GovernanceN8nIntegrationDto,
  GovernancePolicyDecisionDto,
  GovernanceRetentionPolicyDto,
  GovernanceRoleDto,
  GovernanceSecretRefDto,
  GovernanceStatusDto,
  GovernanceUserDto
} from "../../shared/api";

export type PageId =
  | "chat"
  | "onboarding"
  | "identity"
  | "trust"
  | "profiles"
  | "traces"
  | "memory"
  | "gaps"
  | "sandboxes"
  | "skills"
  | "jobs"
  | "teams"
  | "evals"
  | "messaging"
  | "governance"
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
  PlatformMatrixEntryDto,
  GovernanceAuditEntryDto,
  GovernanceN8nIntegrationDto,
  GovernancePolicyDecisionDto,
  GovernanceRetentionPolicyDto,
  GovernanceRoleDto,
  GovernanceSecretRefDto,
  GovernanceStatusDto,
  GovernanceUserDto
};

// Identity / Trust / Profile / Onboarding / Terminal-in-app
export type {
  ApprovedMemoryDto,
  CapabilitySnapshotDto,
  CapabilityToolSummaryDto,
  CommandRunResultDto,
  CommittedOnboardingDto,
  ComplianceControlEvidenceDto,
  CompliancePacketDto,
  EnterpriseProfileBrandingDto,
  EnterpriseProfileCreateRequestDto,
  EnterpriseProfileDto,
  IdentityCardDto,
  IdentityReportDto,
  ModelAccountInputDto,
  ModelAccountSummaryDto,
  ModelCatalogEntryDto,
  OnboardingAnswerDto,
  OnboardingInferenceDto,
  OnboardingMemoryDraftDto,
  OnboardingQuestionDto,
  ProfileSensitivityDto,
  ProviderKindDto,
  ProviderPresetDto,
  SquidbotCommandDescriptorDto,
  SquidbotCommandId,
  TrustAffordanceStatsDto,
  TrustAuditStatsDto,
  TrustConnectorStatsDto,
  TrustDigestDto,
  TrustHealthLabelDto,
  TrustModelCostStatsDto,
  TrustModelProviderSpendDto,
  TrustPolicyPackSummaryDto,
  TrustPolicyStatsDto,
  TrustReportDto,
  TrustRetentionStatsDto,
  TrustSandboxStatsDto,
  TrustVaultStatsDto
} from "../../shared/api";
