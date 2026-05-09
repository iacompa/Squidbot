import type { SquidDatabase } from "@squidbot/db";
import { createId, redactValue } from "@squidbot/core";
import { validateMessagingAdapterManifest } from "./adapterManifest.js";
import type {
  MessagingAdapterManifest,
  MessagingAdapterRecord,
  MessagingAllowlistRule,
  MessagingApprovalLink,
  MessagingChannelRecord,
  MessagingDeliveryRule,
  MessagingEventRecord,
  MessagingIdentityRecord,
  MessagingPlatform,
  MessagingSessionRecord,
  NormalizedMessagingEvent,
  OutboundMessage
} from "./types.js";

type Row = Record<string, unknown>;

export class MessagingStore {
  constructor(readonly database: SquidDatabase) {}

  saveAdapter(manifestInput: MessagingAdapterManifest, status: MessagingAdapterRecord["status"] = "installed"): MessagingAdapterRecord {
    const manifest = validateMessagingAdapterManifest(manifestInput);
    const now = new Date().toISOString();
    const createdAt = manifest.createdAt ?? now;
    const updatedAt = now;
    this.database.db
      .prepare(
        `INSERT INTO messaging_adapters (id, name, platform, status, manifestJson, createdAt, updatedAt, archivedAt)
         VALUES (@id, @name, @platform, @status, @manifestJson, @createdAt, @updatedAt, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           platform = excluded.platform,
           status = excluded.status,
           manifestJson = excluded.manifestJson,
           updatedAt = excluded.updatedAt,
           archivedAt = NULL`
      )
      .run({
        id: manifest.id,
        name: manifest.name,
        platform: manifest.platform,
        status,
        manifestJson: JSON.stringify({ ...manifest, createdAt, updatedAt }),
        createdAt,
        updatedAt
      });
    return this.getAdapter(manifest.id)!;
  }

  getAdapter(adapterId: string): MessagingAdapterRecord | null {
    const row = this.database.db.prepare("SELECT * FROM messaging_adapters WHERE id = ?").get(adapterId) as Row | undefined;
    return row ? parseAdapter(row) : null;
  }

  getAdapterByPlatform(platform: string): MessagingAdapterRecord | null {
    const row = this.database.db
      .prepare("SELECT * FROM messaging_adapters WHERE platform = ? AND archivedAt IS NULL ORDER BY createdAt DESC LIMIT 1")
      .get(platform) as Row | undefined;
    return row ? parseAdapter(row) : null;
  }

  listAdapters(includeArchived = false): MessagingAdapterRecord[] {
    const rows = this.database.db
      .prepare(`SELECT * FROM messaging_adapters ${includeArchived ? "" : "WHERE archivedAt IS NULL"} ORDER BY platform ASC`)
      .all() as Row[];
    return rows.map(parseAdapter);
  }

  updateAdapterStatus(adapterId: string, status: MessagingAdapterRecord["status"]): MessagingAdapterRecord {
    const archivedAt = status === "archived" ? new Date().toISOString() : null;
    this.database.db
      .prepare("UPDATE messaging_adapters SET status = @status, updatedAt = @updatedAt, archivedAt = @archivedAt WHERE id = @id")
      .run({ id: adapterId, status, updatedAt: new Date().toISOString(), archivedAt });
    const adapter = this.getAdapter(adapterId);
    if (!adapter) {
      throw new Error(`Messaging adapter not found: ${adapterId}`);
    }
    return adapter;
  }

  updateChannelStatus(channelId: string, status: MessagingChannelRecord["status"]): MessagingChannelRecord {
    this.database.db
      .prepare("UPDATE messaging_channels SET status = @status, updatedAt = @updatedAt WHERE id = @id")
      .run({ id: channelId, status, updatedAt: new Date().toISOString() });
    const channel = this.getChannel(channelId);
    if (!channel) {
      throw new Error(`Messaging channel not found: ${channelId}`);
    }
    return channel;
  }

  createChannel(input: {
    adapterId: string;
    platform: MessagingPlatform | string;
    externalChannelId: string;
    displayName?: string | null;
    channelType?: MessagingChannelRecord["channelType"];
    config?: Record<string, unknown>;
  }): MessagingChannelRecord {
    const now = new Date().toISOString();
    const existing = this.findChannel(input.platform, input.externalChannelId);
    const id = existing?.id ?? createId("msg_channel");
    this.database.db
      .prepare(
        `INSERT INTO messaging_channels (id, adapterId, platform, externalChannelId, displayName, channelType, status, configJson, createdAt, updatedAt)
         VALUES (@id, @adapterId, @platform, @externalChannelId, @displayName, @channelType, 'active', @configJson, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           adapterId = excluded.adapterId,
           platform = excluded.platform,
           externalChannelId = excluded.externalChannelId,
           displayName = excluded.displayName,
           channelType = excluded.channelType,
           status = 'active',
           configJson = excluded.configJson,
           updatedAt = excluded.updatedAt`
      )
      .run({
        id,
        adapterId: input.adapterId,
        platform: input.platform,
        externalChannelId: input.externalChannelId,
        displayName: input.displayName ?? null,
        channelType: input.channelType ?? "channel",
        configJson: JSON.stringify(input.config ?? {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
    return this.getChannel(id)!;
  }

  getChannel(channelId: string): MessagingChannelRecord | null {
    const row = this.database.db.prepare("SELECT * FROM messaging_channels WHERE id = ?").get(channelId) as Row | undefined;
    return row ? parseChannel(row) : null;
  }

  findChannel(platform: string, externalChannelId: string): MessagingChannelRecord | null {
    const row = this.database.db
      .prepare("SELECT * FROM messaging_channels WHERE platform = ? AND externalChannelId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(platform, externalChannelId) as Row | undefined;
    return row ? parseChannel(row) : null;
  }

  listChannels(platform?: string): MessagingChannelRecord[] {
    const rows = platform
      ? (this.database.db.prepare("SELECT * FROM messaging_channels WHERE platform = ? ORDER BY createdAt DESC").all(platform) as Row[])
      : (this.database.db.prepare("SELECT * FROM messaging_channels ORDER BY createdAt DESC").all() as Row[]);
    return rows.map(parseChannel);
  }

  upsertIdentity(input: {
    platform: MessagingPlatform | string;
    externalUserId: string;
    displayName?: string | null;
    username?: string | null;
    email?: string | null;
    trustLevel?: MessagingIdentityRecord["trustLevel"];
    metadata?: Record<string, unknown>;
  }): MessagingIdentityRecord {
    const now = new Date().toISOString();
    const existing = this.findIdentity(input.platform, input.externalUserId);
    const id = existing?.id ?? createId("msg_identity");
    this.database.db
      .prepare(
        `INSERT INTO messaging_identities (id, platform, externalUserId, displayName, username, email, trustLevel, linkedLocalUserId, metadataJson, createdAt, updatedAt)
         VALUES (@id, @platform, @externalUserId, @displayName, @username, @email, @trustLevel, NULL, @metadataJson, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           displayName = excluded.displayName,
           username = excluded.username,
           email = excluded.email,
           trustLevel = excluded.trustLevel,
           metadataJson = excluded.metadataJson,
           updatedAt = excluded.updatedAt`
      )
      .run({
        id,
        platform: input.platform,
        externalUserId: input.externalUserId,
        displayName: input.displayName ?? existing?.displayName ?? null,
        username: input.username ?? existing?.username ?? null,
        email: input.email ?? existing?.email ?? null,
        trustLevel: input.trustLevel ?? existing?.trustLevel ?? "unknown",
        metadataJson: JSON.stringify(input.metadata ?? existing?.metadata ?? {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
    return this.getIdentity(id)!;
  }

  getIdentity(identityId: string): MessagingIdentityRecord | null {
    const row = this.database.db.prepare("SELECT * FROM messaging_identities WHERE id = ?").get(identityId) as Row | undefined;
    return row ? parseIdentity(row) : null;
  }

  findIdentity(platform: string, externalUserId: string): MessagingIdentityRecord | null {
    const row = this.database.db
      .prepare("SELECT * FROM messaging_identities WHERE platform = ? AND externalUserId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(platform, externalUserId) as Row | undefined;
    return row ? parseIdentity(row) : null;
  }

  listIdentities(platform?: string): MessagingIdentityRecord[] {
    const rows = platform
      ? (this.database.db.prepare("SELECT * FROM messaging_identities WHERE platform = ? ORDER BY createdAt DESC").all(platform) as Row[])
      : (this.database.db.prepare("SELECT * FROM messaging_identities ORDER BY createdAt DESC").all() as Row[]);
    return rows.map(parseIdentity);
  }

  createAllowlistRule(input: {
    platform: MessagingPlatform | string;
    adapterId?: string | null;
    externalUserId?: string | null;
    externalChannelId?: string | null;
    ruleType: MessagingAllowlistRule["ruleType"];
    allowedActions?: string[];
    riskLimit?: MessagingAllowlistRule["riskLimit"];
  }): MessagingAllowlistRule {
    const now = new Date().toISOString();
    const id = createId("msg_allow");
    this.database.db
      .prepare(
        `INSERT INTO messaging_allowlist (id, platform, adapterId, externalUserId, externalChannelId, ruleType, allowedActionsJson, riskLimit, createdAt, updatedAt)
         VALUES (@id, @platform, @adapterId, @externalUserId, @externalChannelId, @ruleType, @allowedActionsJson, @riskLimit, @createdAt, @updatedAt)`
      )
      .run({
        id,
        platform: input.platform,
        adapterId: input.adapterId ?? null,
        externalUserId: input.externalUserId ?? null,
        externalChannelId: input.externalChannelId ?? null,
        ruleType: input.ruleType,
        allowedActionsJson: JSON.stringify(input.allowedActions ?? ["message", "command", "approval"]),
        riskLimit: input.riskLimit ?? "low",
        createdAt: now,
        updatedAt: now
      });
    return this.getAllowlistRule(id)!;
  }

  getAllowlistRule(ruleId: string): MessagingAllowlistRule | null {
    const row = this.database.db.prepare("SELECT * FROM messaging_allowlist WHERE id = ?").get(ruleId) as Row | undefined;
    return row ? parseAllowlist(row) : null;
  }

  removeAllowlistRule(ruleId: string): boolean {
    const result = this.database.db.prepare("DELETE FROM messaging_allowlist WHERE id = ?").run(ruleId);
    return result.changes > 0;
  }

  listAllowlistRules(platform?: string): MessagingAllowlistRule[] {
    const rows = platform
      ? (this.database.db.prepare("SELECT * FROM messaging_allowlist WHERE platform = ? ORDER BY createdAt DESC").all(platform) as Row[])
      : (this.database.db.prepare("SELECT * FROM messaging_allowlist ORDER BY createdAt DESC").all() as Row[]);
    return rows.map(parseAllowlist);
  }

  upsertSession(input: {
    platform: MessagingPlatform | string;
    adapterId: string;
    channelId: string;
    externalThreadId?: string | null;
    localSessionId?: string | null;
    context?: Record<string, unknown>;
  }): MessagingSessionRecord {
    const now = new Date().toISOString();
    const existing = this.findSession(input.platform, input.channelId, input.externalThreadId ?? null);
    const id = existing?.id ?? createId("msg_session");
    this.database.db
      .prepare(
        `INSERT INTO messaging_sessions (id, platform, adapterId, channelId, externalThreadId, localSessionId, activeRunId, activeTeamRunId, activeJobId, status, contextJson, createdAt, updatedAt)
         VALUES (@id, @platform, @adapterId, @channelId, @externalThreadId, @localSessionId, NULL, NULL, NULL, 'active', @contextJson, @createdAt, @updatedAt)
         ON CONFLICT(id) DO UPDATE SET
           localSessionId = COALESCE(excluded.localSessionId, messaging_sessions.localSessionId),
           status = 'active',
           contextJson = excluded.contextJson,
           updatedAt = excluded.updatedAt`
      )
      .run({
        id,
        platform: input.platform,
        adapterId: input.adapterId,
        channelId: input.channelId,
        externalThreadId: input.externalThreadId ?? null,
        localSessionId: input.localSessionId ?? existing?.localSessionId ?? null,
        contextJson: JSON.stringify(input.context ?? existing?.context ?? {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      });
    return this.getSession(id)!;
  }

  getSession(sessionId: string): MessagingSessionRecord | null {
    const row = this.database.db.prepare("SELECT * FROM messaging_sessions WHERE id = ?").get(sessionId) as Row | undefined;
    return row ? parseSession(row) : null;
  }

  findSession(platform: string, channelId: string, externalThreadId: string | null): MessagingSessionRecord | null {
    const row = this.database.db
      .prepare(
        `SELECT * FROM messaging_sessions
         WHERE platform = @platform
           AND channelId = @channelId
           AND COALESCE(externalThreadId, '') = COALESCE(@externalThreadId, '')
         ORDER BY createdAt DESC LIMIT 1`
      )
      .get({ platform, channelId, externalThreadId }) as Row | undefined;
    return row ? parseSession(row) : null;
  }

  listSessions(platform?: string): MessagingSessionRecord[] {
    const rows = platform
      ? (this.database.db.prepare("SELECT * FROM messaging_sessions WHERE platform = ? ORDER BY updatedAt DESC").all(platform) as Row[])
      : (this.database.db.prepare("SELECT * FROM messaging_sessions ORDER BY updatedAt DESC").all() as Row[]);
    return rows.map(parseSession);
  }

  updateSessionRun(sessionId: string, runId: string): MessagingSessionRecord {
    this.database.db.prepare("UPDATE messaging_sessions SET activeRunId = @runId, updatedAt = @updatedAt WHERE id = @sessionId").run({
      sessionId,
      runId,
      updatedAt: new Date().toISOString()
    });
    return this.getSession(sessionId)!;
  }

  recordInboundEvent(event: NormalizedMessagingEvent, links: { channelId?: string | null; identityId?: string | null; sessionId?: string | null } = {}): MessagingEventRecord {
    return this.recordEvent({
      event,
      channelId: links.channelId,
      identityId: links.identityId,
      sessionId: links.sessionId
    });
  }

  recordOutboundEvent(input: {
    adapterId: string;
    platform: MessagingPlatform | string;
    channelId?: string | null;
    sessionId?: string | null;
    runId?: string | null;
    teamRunId?: string | null;
    jobId?: string | null;
    skillId?: string | null;
    message: OutboundMessage;
    externalMessageId?: string | null;
  }): MessagingEventRecord {
    const event: NormalizedMessagingEvent = {
      id: createId("msg_event"),
      adapterId: input.adapterId,
      platform: input.platform,
      direction: "outbound",
      type: "message",
      externalMessageId: input.externalMessageId ?? undefined,
      text: input.message.text,
      metadata: input.message.metadata ?? {},
      receivedAt: new Date().toISOString()
    };
    return this.recordEvent({
      event,
      channelId: input.channelId,
      sessionId: input.sessionId,
      runId: input.runId ?? input.message.runId ?? null,
      teamRunId: input.teamRunId ?? input.message.teamRunId ?? null,
      jobId: input.jobId ?? input.message.jobId ?? null,
      skillId: input.skillId ?? input.message.skillId ?? null
    });
  }

  recordEvent(input: {
    event: NormalizedMessagingEvent;
    channelId?: string | null;
    identityId?: string | null;
    sessionId?: string | null;
    runId?: string | null;
    teamRunId?: string | null;
    jobId?: string | null;
    skillId?: string | null;
  }): MessagingEventRecord {
    const redacted = redactValue(input.event);
    this.database.db
      .prepare(
        `INSERT INTO messaging_events (
          id, adapterId, platform, direction, normalizedType, externalEventId, externalTimestamp,
          channelId, identityId, sessionId, runId, teamRunId, jobId, skillId, bodyText,
          payloadJson, redactedPayloadJson, sensitivity, createdAt
        )
        VALUES (
          @id, @adapterId, @platform, @direction, @normalizedType, @externalEventId, @externalTimestamp,
          @channelId, @identityId, @sessionId, @runId, @teamRunId, @jobId, @skillId, @bodyText,
          @payloadJson, @redactedPayloadJson, @sensitivity, @createdAt
        )`
      )
      .run({
        id: input.event.id,
        adapterId: input.event.adapterId,
        platform: input.event.platform,
        direction: input.event.direction,
        normalizedType: input.event.type,
        externalEventId: input.event.externalEventId ?? null,
        externalTimestamp: input.event.receivedAt,
        channelId: input.channelId ?? null,
        identityId: input.identityId ?? null,
        sessionId: input.sessionId ?? null,
        runId: input.runId ?? null,
        teamRunId: input.teamRunId ?? null,
        jobId: input.jobId ?? null,
        skillId: input.skillId ?? null,
        bodyText: typeof redacted.value.text === "string" ? redacted.value.text : input.event.text ?? null,
        payloadJson: JSON.stringify(redacted.value),
        redactedPayloadJson: JSON.stringify(redacted.value),
        sensitivity: redacted.redacted ? "restricted" : "public",
        createdAt: new Date().toISOString()
      });
    return this.getEvent(input.event.id)!;
  }

  getEvent(eventId: string): MessagingEventRecord | null {
    const row = this.database.db.prepare("SELECT * FROM messaging_events WHERE id = ?").get(eventId) as Row | undefined;
    return row ? parseEvent(row) : null;
  }

  listEvents(options: { platform?: string; runId?: string; limit?: number } = {}): MessagingEventRecord[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit: options.limit ?? 100 };
    if (options.platform) {
      clauses.push("platform = @platform");
      params.platform = options.platform;
    }
    if (options.runId) {
      clauses.push("runId = @runId");
      params.runId = options.runId;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.db.prepare(`SELECT * FROM messaging_events ${where} ORDER BY createdAt DESC LIMIT @limit`).all(params) as Row[];
    return rows.map(parseEvent);
  }

  createAttachment(input: {
    messagingEventId: string;
    filename?: string | null;
    mimeType?: string | null;
    sizeBytes?: number | null;
    storagePath?: string | null;
    checksum?: string | null;
    scanStatus: "pending" | "safe" | "blocked" | "error";
    metadata?: Record<string, unknown>;
  }): void {
    this.database.db
      .prepare(
        `INSERT INTO messaging_attachments (id, messagingEventId, filename, mimeType, sizeBytes, storagePath, checksum, scanStatus, metadataJson, createdAt)
         VALUES (@id, @messagingEventId, @filename, @mimeType, @sizeBytes, @storagePath, @checksum, @scanStatus, @metadataJson, @createdAt)`
      )
      .run({
        id: createId("msg_attachment"),
        messagingEventId: input.messagingEventId,
        filename: input.filename ?? null,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        storagePath: input.storagePath ?? null,
        checksum: input.checksum ?? null,
        scanStatus: input.scanStatus,
        metadataJson: JSON.stringify(input.metadata ?? {}),
        createdAt: new Date().toISOString()
      });
  }

  createDeliveryRule(input: {
    name: string;
    triggerType: MessagingDeliveryRule["triggerType"];
    targetChannelId: string;
    filter?: Record<string, unknown>;
    enabled?: boolean;
  }): MessagingDeliveryRule {
    const now = new Date().toISOString();
    const id = createId("msg_delivery");
    this.database.db
      .prepare(
        `INSERT INTO messaging_delivery_rules (id, name, triggerType, targetChannelId, filterJson, enabled, createdAt, updatedAt)
         VALUES (@id, @name, @triggerType, @targetChannelId, @filterJson, @enabled, @createdAt, @updatedAt)`
      )
      .run({
        id,
        name: input.name,
        triggerType: input.triggerType,
        targetChannelId: input.targetChannelId,
        filterJson: JSON.stringify(input.filter ?? {}),
        enabled: input.enabled === false ? 0 : 1,
        createdAt: now,
        updatedAt: now
      });
    return this.getDeliveryRule(id)!;
  }

  getDeliveryRule(ruleId: string): MessagingDeliveryRule | null {
    const row = this.database.db.prepare("SELECT * FROM messaging_delivery_rules WHERE id = ?").get(ruleId) as Row | undefined;
    return row ? parseDeliveryRule(row) : null;
  }

  listDeliveryRules(triggerType?: string): MessagingDeliveryRule[] {
    const rows = triggerType
      ? (this.database.db.prepare("SELECT * FROM messaging_delivery_rules WHERE triggerType = ? ORDER BY createdAt DESC").all(triggerType) as Row[])
      : (this.database.db.prepare("SELECT * FROM messaging_delivery_rules ORDER BY createdAt DESC").all() as Row[]);
    return rows.map(parseDeliveryRule);
  }

  updateDeliveryRuleEnabled(ruleId: string, enabled: boolean): MessagingDeliveryRule {
    this.database.db
      .prepare("UPDATE messaging_delivery_rules SET enabled = @enabled, updatedAt = @updatedAt WHERE id = @id")
      .run({ id: ruleId, enabled: enabled ? 1 : 0, updatedAt: new Date().toISOString() });
    const rule = this.getDeliveryRule(ruleId);
    if (!rule) {
      throw new Error(`Messaging delivery rule not found: ${ruleId}`);
    }
    return rule;
  }

  removeDeliveryRule(ruleId: string): boolean {
    return this.database.db.prepare("DELETE FROM messaging_delivery_rules WHERE id = ?").run(ruleId).changes > 0;
  }

  createApprovalLink(input: {
    approvalId: string;
    messagingEventId?: string | null;
    platform: MessagingPlatform | string;
    channelId: string;
    expiresAt?: string | null;
  }): MessagingApprovalLink {
    const now = new Date().toISOString();
    const id = createId("msg_approval");
    this.database.db
      .prepare(
        `INSERT INTO messaging_approval_links (id, approvalId, messagingEventId, platform, channelId, status, expiresAt, responseEventId, createdAt, resolvedAt)
         VALUES (@id, @approvalId, @messagingEventId, @platform, @channelId, 'pending', @expiresAt, NULL, @createdAt, NULL)`
      )
      .run({
        id,
        approvalId: input.approvalId,
        messagingEventId: input.messagingEventId ?? null,
        platform: input.platform,
        channelId: input.channelId,
        expiresAt: input.expiresAt ?? null,
        createdAt: now
      });
    return this.getApprovalLink(id)!;
  }

  getApprovalLink(linkId: string): MessagingApprovalLink | null {
    const row = this.database.db.prepare("SELECT * FROM messaging_approval_links WHERE id = ?").get(linkId) as Row | undefined;
    return row ? parseApprovalLink(row) : null;
  }

  getApprovalLinkByApprovalId(approvalId: string): MessagingApprovalLink | null {
    const row = this.database.db
      .prepare("SELECT * FROM messaging_approval_links WHERE approvalId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(approvalId) as Row | undefined;
    return row ? parseApprovalLink(row) : null;
  }

  findEventByExternalId(input: {
    adapterId: string;
    platform: string;
    direction: "inbound" | "outbound";
    externalEventId: string;
  }): MessagingEventRecord | null {
    const row = this.database.db
      .prepare(
        `SELECT * FROM messaging_events
         WHERE adapterId = @adapterId
           AND platform = @platform
           AND direction = @direction
           AND externalEventId = @externalEventId
         ORDER BY createdAt ASC
         LIMIT 1`
      )
      .get(input) as Row | undefined;
    return row ? parseEvent(row) : null;
  }

  resolveApprovalLink(approvalId: string, status: "approved" | "rejected" | "expired" | "canceled", responseEventId?: string | null): MessagingApprovalLink {
    this.database.db
      .prepare("UPDATE messaging_approval_links SET status = @status, responseEventId = @responseEventId, resolvedAt = @resolvedAt WHERE approvalId = @approvalId")
      .run({ approvalId, status, responseEventId: responseEventId ?? null, resolvedAt: new Date().toISOString() });
    const link = this.getApprovalLinkByApprovalId(approvalId);
    if (!link) {
      throw new Error(`Messaging approval link not found: ${approvalId}`);
    }
    return link;
  }
}

export function parseAdapter(row: Row): MessagingAdapterRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    platform: row.platform as MessagingPlatform,
    status: row.status as MessagingAdapterRecord["status"],
    manifest: JSON.parse(String(row.manifestJson)) as MessagingAdapterManifest,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    archivedAt: nullableString(row.archivedAt)
  };
}

function parseChannel(row: Row): MessagingChannelRecord {
  return {
    id: String(row.id),
    adapterId: String(row.adapterId),
    platform: row.platform as MessagingPlatform,
    externalChannelId: String(row.externalChannelId),
    displayName: nullableString(row.displayName),
    channelType: row.channelType as MessagingChannelRecord["channelType"],
    status: row.status as MessagingChannelRecord["status"],
    config: parseObject(row.configJson),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function parseIdentity(row: Row): MessagingIdentityRecord {
  return {
    id: String(row.id),
    platform: row.platform as MessagingPlatform,
    externalUserId: String(row.externalUserId),
    displayName: nullableString(row.displayName),
    username: nullableString(row.username),
    email: nullableString(row.email),
    trustLevel: row.trustLevel as MessagingIdentityRecord["trustLevel"],
    linkedLocalUserId: nullableString(row.linkedLocalUserId),
    metadata: parseObject(row.metadataJson),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function parseAllowlist(row: Row): MessagingAllowlistRule {
  return {
    id: String(row.id),
    platform: row.platform as MessagingPlatform,
    adapterId: nullableString(row.adapterId),
    externalUserId: nullableString(row.externalUserId),
    externalChannelId: nullableString(row.externalChannelId),
    ruleType: row.ruleType as MessagingAllowlistRule["ruleType"],
    allowedActions: parseArray(row.allowedActionsJson).filter((item): item is string => typeof item === "string"),
    riskLimit: row.riskLimit as MessagingAllowlistRule["riskLimit"],
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function parseSession(row: Row): MessagingSessionRecord {
  return {
    id: String(row.id),
    platform: row.platform as MessagingPlatform,
    adapterId: String(row.adapterId),
    channelId: String(row.channelId),
    externalThreadId: nullableString(row.externalThreadId),
    localSessionId: nullableString(row.localSessionId),
    activeRunId: nullableString(row.activeRunId),
    activeTeamRunId: nullableString(row.activeTeamRunId),
    activeJobId: nullableString(row.activeJobId),
    status: row.status as MessagingSessionRecord["status"],
    context: parseObject(row.contextJson),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function parseEvent(row: Row): MessagingEventRecord {
  return {
    id: String(row.id),
    adapterId: String(row.adapterId),
    platform: row.platform as MessagingPlatform,
    direction: row.direction as MessagingEventRecord["direction"],
    normalizedType: row.normalizedType as MessagingEventRecord["normalizedType"],
    externalEventId: nullableString(row.externalEventId),
    externalTimestamp: nullableString(row.externalTimestamp),
    channelId: nullableString(row.channelId),
    identityId: nullableString(row.identityId),
    sessionId: nullableString(row.sessionId),
    runId: nullableString(row.runId),
    teamRunId: nullableString(row.teamRunId),
    jobId: nullableString(row.jobId),
    skillId: nullableString(row.skillId),
    bodyText: nullableString(row.bodyText),
    payload: parseObject(row.payloadJson),
    redactedPayload: row.redactedPayloadJson ? parseObject(row.redactedPayloadJson) : null,
    sensitivity: row.sensitivity as MessagingEventRecord["sensitivity"],
    createdAt: String(row.createdAt)
  };
}

function parseDeliveryRule(row: Row): MessagingDeliveryRule {
  return {
    id: String(row.id),
    name: String(row.name),
    triggerType: row.triggerType as MessagingDeliveryRule["triggerType"],
    targetChannelId: String(row.targetChannelId),
    filter: parseObject(row.filterJson),
    enabled: Number(row.enabled) === 1,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function parseApprovalLink(row: Row): MessagingApprovalLink {
  return {
    id: String(row.id),
    approvalId: String(row.approvalId),
    messagingEventId: nullableString(row.messagingEventId),
    platform: row.platform as MessagingPlatform,
    channelId: String(row.channelId),
    status: row.status as MessagingApprovalLink["status"],
    expiresAt: nullableString(row.expiresAt),
    responseEventId: nullableString(row.responseEventId),
    createdAt: String(row.createdAt),
    resolvedAt: nullableString(row.resolvedAt)
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "string" || !value) {
    return {};
  }
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
}

function parseArray(value: unknown): unknown[] {
  if (typeof value !== "string" || !value) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
