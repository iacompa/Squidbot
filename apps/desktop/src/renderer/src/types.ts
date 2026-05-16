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
  | "integrations"      // NEW — top-level home for AI models / connectors / messaging
  | "history"           // NEW — merges traces (runs) + memory
  | "approvals"
  | "trust"
  | "settings"
  // Advanced (collapsed by default)
  | "jobs"
  | "teams"
  | "evals"
  | "sandboxes"
  | "gaps"
  // Deprecated but kept reachable through navRedirects — do NOT remove,
  // some pages call onNavigate("traces"|"memory"|...) and resolveNav handles
  // the redirect to the new destination.
  | "identity"
  | "profiles"
  | "skills"
  | "traces"
  | "memory"
  | "messaging"
  | "governance";

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
