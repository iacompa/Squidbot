import type { SquidDatabase } from "@squidbot/db";

export const DEFAULT_TENANT_ID = "local-tenant";
export const DEFAULT_ORG_ID = "local-org";
export const DEFAULT_ADMIN_USER_ID = "user_local_admin";
export const DEFAULT_N8N_SERVICE_ACCOUNT_ID = "service_n8n_local";

export type GovernanceDecisionKind = "allow" | "deny" | "requireApproval" | "requireSandbox" | "redact";
export type GovernanceEffect = GovernanceDecisionKind;
export type PrincipalType = "user" | "group" | "serviceAccount" | "system";
export type DataClassification = "public" | "internal" | "confidential" | "restricted" | "secret";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = Record<string, JsonValue>;

export type GovernanceActor = {
  type: PrincipalType;
  id: string;
  roles?: string[];
  attributes?: Record<string, unknown>;
};

export type GovernanceResource = {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
};

export type GovernanceContext = {
  source?: string;
  projectId?: string;
  workspacePath?: string;
  dataClassification?: DataClassification | string;
  sensitivity?: string;
  riskLevel?: "low" | "medium" | "high" | "critical" | string;
  environment?: "local" | "test" | "production" | string;
  costOwner?: string;
  modelProvider?: string;
  connectorName?: string;
  requiresWrite?: boolean;
  approvalId?: string;
  [key: string]: unknown;
};

export type GovernancePolicyInput = {
  tenantId?: string;
  actor: GovernanceActor;
  action: string;
  resource: GovernanceResource;
  context?: GovernanceContext;
};

export type GovernanceDecision = {
  id?: string;
  tenantId: string;
  decision: GovernanceDecisionKind;
  reason: string;
  matchedPolicies: string[];
  obligations: string[];
  createdAt?: string;
};

export type UserRecord = {
  id: string;
  tenantId: string;
  email: string | null;
  username: string;
  displayName: string | null;
  status: string;
  authType: string;
  mfaEnabled: boolean;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
};

export type RoleRecord = {
  id: string;
  tenantId: string | null;
  name: string;
  description: string;
  scope: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type RoleAssignmentRecord = {
  id: string;
  tenantId: string;
  principalType: PrincipalType;
  principalId: string;
  roleId: string;
  scopeType: string;
  scopeId: string;
  conditions: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

export type AuditEntryInput = {
  tenantId?: string;
  actorType: PrincipalType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: string;
  eventId?: string | null;
  runId?: string | null;
  traceId?: string | null;
  policyDecisionId?: string | null;
  source?: string;
  dataClassification?: DataClassification | string;
  detail?: unknown;
};

export type AuditEntryRecord = AuditEntryInput & {
  id: string;
  tenantId: string;
  sequence: number;
  redactedDetail: unknown;
  previousHash: string | null;
  entryHash: string;
  createdAt: string;
};

export type SecretReferenceRecord = {
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

export type StaticSecretMetadata = {
  keyId: string;
  algorithm: "aes-256-gcm";
};

export type RetentionPolicyRecord = {
  id: string;
  tenantId: string;
  name: string;
  resourceType: string;
  dataClassification: string;
  retentionDays: number;
  action: "keep" | "archive" | "anonymize" | "delete";
  legalHoldOverride: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type LegalHoldRecord = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  resourceSelector: Record<string, unknown>;
  status: string;
  createdBy: string;
  createdAt: string;
  releasedAt: string | null;
};

export type LineageEdgeRecord = {
  id: string;
  tenantId: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationship: string;
  dataClassification: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type N8nIntegrationRecord = {
  id: string;
  tenantId: string;
  name: string;
  direction: "inbound" | "outbound";
  authMode: "hmac" | "jwt" | "header" | "basic" | "none";
  allowedEventTypes: string[];
  allowedActions: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GovernanceDeps = {
  database: SquidDatabase;
  masterKey?: string;
};
