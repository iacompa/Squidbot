export type MessagingPlatform =
  | "localWeb"
  | "slack"
  | "discord"
  | "telegram"
  | "matrix"
  | "email"
  | "teams"
  | "whatsapp"
  | "messenger"
  | "instagram"
  | "imessage"
  | "signal"
  | "googleChat"
  | "mattermost"
  | "nextcloudTalk"
  | "xmpp"
  | "line"
  | "wechat"
  | "qq"
  | "feishu"
  | "dingtalk"
  | "wecom"
  | "nostr"
  | "irc"
  | "sms"
  | "genericWebhook"
  | "custom";

export type MessagingRisk = "low" | "medium" | "high";
export type MessagingDirection = "inbound" | "outbound";
export type MessagingEventType =
  | "message"
  | "command"
  | "reaction"
  | "button"
  | "approval"
  | "attachment"
  | "threadReply"
  | "deliveryStatus"
  | "error";

export type NormalizedMessagingEvent = {
  id: string;
  platform: MessagingPlatform | string;
  adapterId: string;
  direction: MessagingDirection;
  type: MessagingEventType;
  externalEventId?: string;
  externalUserId?: string;
  externalChannelId?: string;
  externalThreadId?: string;
  externalMessageId?: string;
  text?: string;
  command?: {
    name: string;
    args: string[];
    raw: string;
  };
  approval?: {
    approvalId?: string;
    action: "approve" | "reject" | "revise" | "unknown";
    reason?: string;
  };
  attachments?: MessagingAttachmentInput[];
  metadata: Record<string, unknown>;
  receivedAt: string;
};

export type MessagingAttachmentInput = {
  id: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
  localPath?: string;
  url?: string;
  checksum?: string;
};

export type MessagingAdapterManifest = {
  id: string;
  name: string;
  platform: MessagingPlatform;
  description: string;
  transport: {
    mode: "fixture" | "webhook" | "polling" | "socket" | "smtpImap" | "localServer" | "bridge" | "custom";
    inboundSupported: boolean;
    outboundSupported: boolean;
    interactiveSupported: boolean;
    realNetworkDefault: false;
  };
  auth: {
    type: "none" | "botToken" | "webhookSecret" | "oauth2" | "apiKey" | "smtpImap" | "bridgeToken" | "custom";
    settingKeys: string[];
    requiresUserProvidedCredential: boolean;
  };
  capabilities: MessagingCapabilities;
  risk: {
    defaultReadRisk: MessagingRisk;
    defaultWriteRisk: MessagingRisk;
    requiresAllowlist: boolean;
    requiresApprovalForCommands: boolean;
    maxDefaultActionRisk: "low" | "medium";
  };
  privacy: {
    supportsE2EE?: boolean;
    storesMessageBodiesLocally: boolean;
    attachmentPolicy: "metadataOnly" | "storeLocal" | "blockByDefault";
    redactionRequired: boolean;
  };
  fixtureMode: {
    supported: boolean;
    fixturePath?: string;
  };
  complianceNotes?: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type MessagingCapabilities = {
  text: boolean;
  markdown: boolean;
  threads: boolean;
  reactions: boolean;
  slashCommands: boolean;
  buttons: boolean;
  modals: boolean;
  files: boolean;
  images: boolean;
  audio: boolean;
  voiceTranscription: boolean;
  edits: boolean;
  deletes: boolean;
  readReceipts: boolean;
  ephemeralMessages: boolean;
  deliveryReceipts: boolean;
  webhooks: boolean;
  polling: boolean;
};

export type MessagingTarget = {
  channelId: string;
  platform?: string;
  externalChannelId?: string;
  threadId?: string;
};

export type OutboundMessage = {
  text: string;
  markdown?: boolean;
  runId?: string;
  teamRunId?: string;
  jobId?: string;
  skillId?: string;
  approvalId?: string;
  metadata?: Record<string, unknown>;
};

export type DeliveryResult = {
  ok: boolean;
  eventId?: string;
  externalMessageId?: string;
  error?: string;
};

export type MessagingRouteResult = {
  allowed: boolean;
  action: "denied" | "ignored" | "chat" | "run" | "status" | "approval" | "help";
  sessionId?: string;
  runId?: string;
  responseText?: string;
  outboundEventId?: string;
  reason?: string;
};

export type MessagingAdapterRecord = {
  id: string;
  name: string;
  platform: MessagingPlatform;
  status: "installed" | "disabled" | "archived";
  manifest: MessagingAdapterManifest;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type MessagingChannelRecord = {
  id: string;
  adapterId: string;
  platform: MessagingPlatform;
  externalChannelId: string;
  displayName: string | null;
  channelType: "dm" | "group" | "channel" | "thread" | "email" | "room" | "webchat";
  status: "active" | "paused" | "disabled";
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type MessagingIdentityRecord = {
  id: string;
  platform: MessagingPlatform;
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

export type MessagingAllowlistRule = {
  id: string;
  platform: MessagingPlatform;
  adapterId: string | null;
  externalUserId: string | null;
  externalChannelId: string | null;
  ruleType: "allowUser" | "allowChannel" | "blockUser" | "blockChannel" | "allowDomain";
  allowedActions: string[];
  riskLimit: MessagingRisk;
  createdAt: string;
  updatedAt: string;
};

export type MessagingSessionRecord = {
  id: string;
  platform: MessagingPlatform;
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

export type MessagingEventRecord = {
  id: string;
  adapterId: string;
  platform: MessagingPlatform;
  direction: MessagingDirection;
  normalizedType: MessagingEventType;
  externalEventId: string | null;
  externalTimestamp: string | null;
  channelId: string | null;
  identityId: string | null;
  sessionId: string | null;
  runId: string | null;
  teamRunId: string | null;
  jobId: string | null;
  skillId: string | null;
  bodyText: string | null;
  payload: Record<string, unknown>;
  redactedPayload: Record<string, unknown> | null;
  sensitivity: "public" | "restricted" | "secret";
  createdAt: string;
};

export type MessagingDeliveryRule = {
  id: string;
  name: string;
  triggerType: "runSummary" | "approvalRequest" | "jobComplete" | "sandboxReady" | "evalComplete" | "teamHandoff" | "gapCreated";
  targetChannelId: string;
  filter: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MessagingApprovalLink = {
  id: string;
  approvalId: string;
  messagingEventId: string | null;
  platform: MessagingPlatform;
  channelId: string;
  status: "pending" | "approved" | "rejected" | "expired" | "canceled";
  expiresAt: string | null;
  responseEventId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export type PlatformMatrixEntry = {
  platform: MessagingPlatform;
  displayName: string;
  capabilities: MessagingCapabilities;
  authType: string;
  selfHostedOption: boolean;
  realAdapterStatus: "fixtureOnly" | "betaReal" | "supportedReal" | "planned";
  complianceNotes: string[];
  risks: string[];
  requiredSettings: string[];
  docsUrl?: string;
};

export interface MessagingAdapter {
  manifest: MessagingAdapterManifest;
  start(): Promise<void>;
  stop(): Promise<void>;
  normalizeInbound(raw: unknown): Promise<NormalizedMessagingEvent>;
  send(target: MessagingTarget, message: OutboundMessage): Promise<DeliveryResult>;
  verifyWebhook?(headers: Record<string, string>, body: string): Promise<boolean>;
  loadFixtures?(): Promise<unknown[]>;
}
