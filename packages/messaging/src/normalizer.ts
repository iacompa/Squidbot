import { createId, redactSecrets } from "@squidbot/core";
import type { MessagingAttachmentInput, MessagingEventType, MessagingPlatform, NormalizedMessagingEvent } from "./types.js";

const maxTextLength = 12_000;

export function normalizeMessagingEvent(raw: unknown, adapterId: string, fallbackPlatform?: MessagingPlatform | string): NormalizedMessagingEvent {
  const input = asRecord(raw);
  const platform = String(input.platform ?? fallbackPlatform ?? inferPlatform(input) ?? "custom");
  if (input.normalized && typeof input.normalized === "object") {
    return normalizeAlreadyNormalized(input.normalized as Record<string, unknown>, adapterId, platform);
  }
  if (platform === "slack") {
    return normalizeSlack(input, adapterId);
  }
  if (platform === "discord") {
    return normalizeDiscord(input, adapterId);
  }
  if (platform === "telegram") {
    return normalizeTelegram(input, adapterId);
  }
  if (platform === "matrix") {
    return normalizeMatrix(input, adapterId);
  }
  if (platform === "email") {
    return normalizeEmail(input, adapterId);
  }
  return normalizeGeneric(input, adapterId, platform);
}

export function parseCommand(text: string | undefined): NormalizedMessagingEvent["command"] | undefined {
  const value = text?.trim() ?? "";
  if (!value) {
    return undefined;
  }
  const prefix = value.startsWith("/squid") ? "/squid" : value.toLowerCase().startsWith("squid ") ? "squid" : "";
  if (!prefix) {
    return undefined;
  }
  const raw = prefix === "/squid" ? value.slice("/squid".length).trim() : value.slice("squid".length).trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  return {
    name: parts[0] ?? "help",
    args: parts.slice(1),
    raw: value
  };
}

function normalizeAlreadyNormalized(input: Record<string, unknown>, adapterId: string, platform: string): NormalizedMessagingEvent {
  const text = stringValue(input.text);
  const command = parseCommand(text);
  return {
    id: stringValue(input.id) ?? createId("msg_event"),
    platform: stringValue(input.platform) ?? platform,
    adapterId: stringValue(input.adapterId) ?? adapterId,
    direction: input.direction === "outbound" ? "outbound" : "inbound",
    type: normalizeType(stringValue(input.type), command),
    externalEventId: stringValue(input.externalEventId),
    externalUserId: stringValue(input.externalUserId),
    externalChannelId: stringValue(input.externalChannelId),
    externalThreadId: stringValue(input.externalThreadId),
    externalMessageId: stringValue(input.externalMessageId),
    text: text ? sanitizeText(text) : undefined,
    command,
    approval: parseApproval(input.approval, text),
    attachments: parseAttachments(input.attachments),
    metadata: sanitizeMetadata(asRecord(input.metadata)),
    receivedAt: stringValue(input.receivedAt) ?? new Date().toISOString()
  };
}

function normalizeSlack(input: Record<string, unknown>, adapterId: string): NormalizedMessagingEvent {
  const text = stringValue(input.text) ?? stringValue(input.message);
  const action = stringValue(input.action) ?? stringValue(input.action_id) ?? stringValue(input.value);
  const command = stringValue(input.command) ? parseCommand(`${input.command} ${stringValue(input.text) ?? ""}`) : parseCommand(text);
  const fileInput = input.files ?? (input.file ? [input.file] : undefined);
  return baseEvent({
    adapterId,
    platform: "slack",
    type: action ? "approval" : command ? "command" : stringValue(input.thread_ts) ? "threadReply" : "message",
    externalEventId: stringValue(input.event_id) ?? stringValue(input.trigger_id) ?? stringValue(input.ts),
    externalUserId: stringValue(input.user) ?? stringValue(input.user_id) ?? stringValue(asRecord(input.user).id),
    externalChannelId: stringValue(input.channel) ?? stringValue(input.channel_id) ?? stringValue(asRecord(input.channel).id),
    externalThreadId: stringValue(input.thread_ts),
    externalMessageId: stringValue(input.ts),
    text,
    command,
    approval: parseApproval({ action, approvalId: stringValue(input.approvalId) }, text),
    attachments: parseAttachments(fileInput),
    metadata: input
  });
}

function normalizeDiscord(input: Record<string, unknown>, adapterId: string): NormalizedMessagingEvent {
  const data = asRecord(input.data);
  const member = asRecord(input.member);
  const user = firstRecord(input.user, member.user);
  const text = stringValue(input.content) ?? stringValue(data.optionsText) ?? stringValue(data.value);
  const slashName = stringValue(data.name);
  const customId = stringValue(data.custom_id);
  const command = slashName ? { name: slashName, args: parseArgsFromOptions(data.options), raw: `/${slashName}` } : parseCommand(text);
  return baseEvent({
    adapterId,
    platform: "discord",
    type: customId ? "approval" : command ? "command" : "message",
    externalEventId: stringValue(input.id),
    externalUserId: stringValue(user.id),
    externalChannelId: stringValue(input.channel_id),
    externalThreadId: stringValue(input.thread_id),
    externalMessageId: stringValue(input.message_id),
    text,
    command,
    approval: parseApproval({ action: customId, approvalId: stringValue(input.approvalId) }, text),
    attachments: parseAttachments(input.attachments),
    metadata: input
  });
}

function normalizeTelegram(input: Record<string, unknown>, adapterId: string): NormalizedMessagingEvent {
  const message = asRecord(input.message);
  const callback = asRecord(input.callback_query);
  const from = firstRecord(callback.from, message.from);
  const chat = firstRecord(message.chat, asRecord(callback.message).chat);
  const text = stringValue(message.text) ?? stringValue(callback.data) ?? stringValue(input.text);
  const command = parseCommand(text);
  return baseEvent({
    adapterId,
    platform: "telegram",
    type: callback.data ? "approval" : command ? "command" : message.voice ? "attachment" : "message",
    externalEventId: String(input.update_id ?? callback.id ?? message.message_id ?? createId("telegram")),
    externalUserId: stringValue(from.id),
    externalChannelId: stringValue(chat.id),
    externalThreadId: stringValue(message.message_thread_id),
    externalMessageId: stringValue(message.message_id),
    text,
    command,
    approval: parseApproval({ action: callback.data, approvalId: stringValue(input.approvalId) }, text),
    attachments: parseAttachments(message.document ? [message.document] : message.voice ? [message.voice] : undefined),
    metadata: input
  });
}

function normalizeMatrix(input: Record<string, unknown>, adapterId: string): NormalizedMessagingEvent {
  const content = asRecord(input.content);
  const text = stringValue(content.body) ?? stringValue(input.body);
  const command = parseCommand(text);
  return baseEvent({
    adapterId,
    platform: "matrix",
    type: stringValue(input.type) === "m.reaction" ? "reaction" : command ? "command" : content.url ? "attachment" : "message",
    externalEventId: stringValue(input.event_id),
    externalUserId: stringValue(input.sender),
    externalChannelId: stringValue(input.room_id),
    externalThreadId: stringValue(asRecord(content["m.relates_to"]).event_id),
    externalMessageId: stringValue(input.event_id),
    text,
    command,
    attachments: content.url ? parseAttachments([{ id: content.url, filename: content.body, mimeType: asRecord(content.info).mimetype, sizeBytes: asRecord(content.info).size }]) : undefined,
    metadata: input
  });
}

function normalizeEmail(input: Record<string, unknown>, adapterId: string): NormalizedMessagingEvent {
  const text = stringValue(input.text) ?? stringValue(input.body) ?? stringValue(input.subject);
  const command = parseCommand(text);
  return baseEvent({
    adapterId,
    platform: "email",
    type: command ? "command" : "message",
    externalEventId: stringValue(input.messageId) ?? stringValue(input.message_id),
    externalUserId: stringValue(input.from),
    externalChannelId: stringValue(input.to) ?? stringValue(input.mailbox) ?? "inbox",
    externalThreadId: stringValue(input.threadId) ?? stringValue(input.references),
    text,
    command,
    attachments: parseAttachments(input.attachments),
    metadata: input
  });
}

function normalizeGeneric(input: Record<string, unknown>, adapterId: string, platform: string): NormalizedMessagingEvent {
  const text = stringValue(input.text) ?? stringValue(input.body) ?? stringValue(input.message);
  const command = parseCommand(text);
  return baseEvent({
    adapterId,
    platform,
    type: command ? "command" : "message",
    externalEventId: stringValue(input.id) ?? stringValue(input.eventId),
    externalUserId: stringValue(input.userId) ?? stringValue(input.user),
    externalChannelId: stringValue(input.channelId) ?? stringValue(input.channel),
    externalThreadId: stringValue(input.threadId),
    externalMessageId: stringValue(input.messageId),
    text,
    command,
    attachments: parseAttachments(input.attachments),
    metadata: input
  });
}

function baseEvent(input: {
  adapterId: string;
  platform: string;
  type: MessagingEventType;
  externalEventId?: string;
  externalUserId?: string;
  externalChannelId?: string;
  externalThreadId?: string;
  externalMessageId?: string;
  text?: string;
  command?: NormalizedMessagingEvent["command"];
  approval?: NormalizedMessagingEvent["approval"];
  attachments?: MessagingAttachmentInput[];
  metadata: Record<string, unknown>;
}): NormalizedMessagingEvent {
  const text = input.text ? sanitizeText(input.text) : undefined;
  return {
    id: createId("msg_event"),
    platform: input.platform,
    adapterId: input.adapterId,
    direction: "inbound",
    type: input.approval?.action && input.approval.action !== "unknown" ? "approval" : input.type,
    externalEventId: input.externalEventId,
    externalUserId: input.externalUserId,
    externalChannelId: input.externalChannelId,
    externalThreadId: input.externalThreadId,
    externalMessageId: input.externalMessageId,
    text,
    command: input.command,
    approval: input.approval,
    attachments: input.attachments,
    metadata: sanitizeMetadata(input.metadata),
    receivedAt: new Date().toISOString()
  };
}

function parseApproval(value: unknown, text?: string): NormalizedMessagingEvent["approval"] | undefined {
  const input = asRecord(value);
  const structuredAction = stringValue(input.action);
  const rawAction = `${stringValue(input.action) ?? text ?? ""}`.toLowerCase();
  const approvalId = stringValue(input.approvalId) ?? text?.match(/\bapproval_[A-Za-z0-9_-]+\b/)?.[0];
  if (!approvalId && !structuredAction) {
    return undefined;
  }
  const action = rawAction.includes("approve") ? "approve" : rawAction.includes("reject") ? "reject" : rawAction.includes("revise") ? "revise" : "unknown";
  if (!approvalId && action === "unknown") {
    return undefined;
  }
  return {
    approvalId,
    action,
    reason: stringValue(input.reason)
  };
}

function parseAttachments(value: unknown): MessagingAttachmentInput[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((item, index) => {
    const record = asRecord(item);
    return {
      id: stringValue(record.id) ?? stringValue(record.file_id) ?? stringValue(record.url) ?? `attachment_${index}`,
      filename: stringValue(record.filename) ?? stringValue(record.name) ?? stringValue(record.title),
      mimeType: stringValue(record.mimeType) ?? stringValue(record.mimetype),
      sizeBytes: numberValue(record.sizeBytes) ?? numberValue(record.size),
      localPath: stringValue(record.localPath),
      url: stringValue(record.url),
      checksum: stringValue(record.checksum)
    };
  });
}

function parseArgsFromOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => stringValue(asRecord(item).value)).filter((item): item is string => Boolean(item));
}

function normalizeType(type: string | undefined, command: NormalizedMessagingEvent["command"] | undefined): MessagingEventType {
  if (type === "approval" || type === "button" || type === "reaction" || type === "attachment" || type === "threadReply" || type === "deliveryStatus" || type === "error") {
    return type;
  }
  return command ? "command" : "message";
}

function inferPlatform(input: Record<string, unknown>): string | undefined {
  if (input.team_id || input.channel || input.event_id) {
    return "slack";
  }
  if (input.update_id || input.callback_query) {
    return "telegram";
  }
  if (input.room_id || input.event_id || input.sender) {
    return "matrix";
  }
  if (input.messageId || input.from || input.subject) {
    return "email";
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) {
      return record;
    }
  }
  return {};
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeText(value: string): string {
  const redacted = redactSecrets(value);
  if (redacted.length <= maxTextLength) {
    return redacted;
  }
  return `${redacted.slice(0, maxTextLength)}\n[TRUNCATED ${redacted.length - maxTextLength} chars]`;
}

function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizeMetadataValue(value, 0) as Record<string, unknown>;
}

function sanitizeMetadataValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return sanitizeText(value);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return value;
  }
  if (depth > 6) {
    return "[TRUNCATED_DEPTH]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      result[key] = sanitizeMetadataValue(item, depth + 1);
    }
    return result;
  }
  return undefined;
}
