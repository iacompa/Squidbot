import type { MessagingAdapterManifest, MessagingCapabilities, MessagingPlatform } from "./types.js";

export const messagingPlatforms: MessagingPlatform[] = [
  "localWeb",
  "slack",
  "discord",
  "telegram",
  "matrix",
  "email",
  "teams",
  "whatsapp",
  "messenger",
  "instagram",
  "imessage",
  "signal",
  "googleChat",
  "mattermost",
  "nextcloudTalk",
  "xmpp",
  "line",
  "wechat",
  "qq",
  "feishu",
  "dingtalk",
  "wecom",
  "nostr",
  "irc",
  "sms",
  "genericWebhook",
  "custom"
];

const platformSet = new Set<string>(messagingPlatforms);
const complianceGatedPlatforms = new Set<MessagingPlatform>(["whatsapp", "messenger", "instagram", "imessage", "signal", "sms"]);

export function validateMessagingAdapterManifest(input: unknown): MessagingAdapterManifest {
  const manifest = input && typeof input === "object" ? (input as MessagingAdapterManifest) : null;
  if (!manifest) {
    throw new Error("Messaging adapter manifest must be an object.");
  }
  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("Messaging adapter manifest requires an id.");
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error("Messaging adapter manifest requires a name.");
  }
  if (!platformSet.has(manifest.platform)) {
    throw new Error(`Unsupported messaging platform: ${String(manifest.platform)}`);
  }
  if (!manifest.description || typeof manifest.description !== "string") {
    throw new Error("Messaging adapter manifest requires a description.");
  }
  if (!manifest.transport || manifest.transport.realNetworkDefault !== false) {
    throw new Error("Messaging adapters must set transport.realNetworkDefault to false.");
  }
  if (!manifest.fixtureMode?.supported) {
    throw new Error("Built-in messaging adapters must support fixture mode.");
  }
  if (manifest.transport.inboundSupported && !manifest.risk?.requiresAllowlist) {
    throw new Error("Inbound messaging adapters must require an allowlist.");
  }
  if (manifest.transport.interactiveSupported && !manifest.risk?.requiresApprovalForCommands) {
    throw new Error("Interactive messaging adapters must require approval-aware command handling.");
  }
  if (manifest.auth?.requiresUserProvidedCredential && manifest.auth.settingKeys.length === 0) {
    throw new Error("BYOK messaging adapters must declare redacted setting keys.");
  }
  if (complianceGatedPlatforms.has(manifest.platform) && (manifest.complianceNotes?.length ?? 0) === 0) {
    throw new Error(`${manifest.platform} adapter must include compliance notes.`);
  }
  return {
    ...manifest,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt
  };
}

export function baseCapabilities(partial: Partial<MessagingCapabilities> = {}): MessagingCapabilities {
  return {
    text: true,
    markdown: false,
    threads: false,
    reactions: false,
    slashCommands: false,
    buttons: false,
    modals: false,
    files: false,
    images: false,
    audio: false,
    voiceTranscription: false,
    edits: false,
    deletes: false,
    readReceipts: false,
    ephemeralMessages: false,
    deliveryReceipts: false,
    webhooks: false,
    polling: false,
    ...partial
  };
}

export function createFixtureManifest(input: {
  id: string;
  name: string;
  platform: MessagingPlatform;
  description: string;
  fixturePath?: string;
  capabilities?: Partial<MessagingCapabilities>;
  complianceNotes?: string[];
  authType?: MessagingAdapterManifest["auth"]["type"];
  settingKeys?: string[];
  transportMode?: MessagingAdapterManifest["transport"]["mode"];
  realStatus?: "fixtureOnly" | "planned" | "betaReal";
}): MessagingAdapterManifest {
  const capabilities = baseCapabilities(input.capabilities);
  return validateMessagingAdapterManifest({
    id: input.id,
    name: input.name,
    platform: input.platform,
    description: input.description,
    transport: {
      mode: input.transportMode ?? "fixture",
      inboundSupported: true,
      outboundSupported: true,
      interactiveSupported: capabilities.buttons || capabilities.slashCommands,
      realNetworkDefault: false
    },
    auth: {
      type: input.authType ?? "none",
      settingKeys: input.settingKeys ?? [],
      requiresUserProvidedCredential: (input.settingKeys?.length ?? 0) > 0
    },
    capabilities,
    risk: {
      defaultReadRisk: "low",
      defaultWriteRisk: "medium",
      requiresAllowlist: true,
      requiresApprovalForCommands: true,
      maxDefaultActionRisk: "medium"
    },
    privacy: {
      storesMessageBodiesLocally: true,
      attachmentPolicy: capabilities.files || capabilities.images || capabilities.audio ? "metadataOnly" : "blockByDefault",
      redactionRequired: true
    },
    fixtureMode: {
      supported: true,
      fixturePath: input.fixturePath
    },
    complianceNotes: input.complianceNotes ?? []
  });
}
