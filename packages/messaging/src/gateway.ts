import type { AgentRuntime, AgentResponse, RepoTaskResult } from "@squidbot/core";
import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import { MessagingAllowlist } from "./allowlist.js";
import { AttachmentStore } from "./attachmentStore.js";
import { DeliveryRouter } from "./deliveryRouter.js";
import { appendMessagingEvent } from "./events.js";
import { createMessagingAdapter } from "./createAdapter.js";
import { normalizeMessagingEvent } from "./normalizer.js";
import { SessionMapper } from "./sessionMapper.js";
import { MessagingStore } from "./store.js";
import type {
  DeliveryResult,
  MessagingAdapterManifest,
  MessagingRouteResult,
  MessagingTarget,
  NormalizedMessagingEvent,
  OutboundMessage
} from "./types.js";

export type MessagingGatewayDeps = {
  database: SquidDatabase;
  workspacePath?: string;
  createRuntime?: (workspacePath: string, sessionId?: string) => AgentRuntime;
  runSkillCommand?: (args: string[], sessionId?: string) => Promise<{ runId: string; summary: string }>;
};

export class MessagingGateway {
  readonly store: MessagingStore;
  private readonly mapper: SessionMapper;
  private readonly delivery: DeliveryRouter;

  constructor(private readonly deps: MessagingGatewayDeps) {
    this.store = new MessagingStore(deps.database);
    this.mapper = new SessionMapper(this.store);
    this.delivery = new DeliveryRouter(this.store);
  }

  installAdapter(manifest: MessagingAdapterManifest): void {
    const adapter = this.store.saveAdapter(manifest);
    appendMessagingEvent(this.deps.database, "messaging.adapter.installed", {
      adapterId: adapter.id,
      platform: adapter.platform,
      name: adapter.name
    });
  }

  listAdapters() {
    return this.store.listAdapters();
  }

  async ingest(rawEvent: unknown, adapterId: string): Promise<NormalizedMessagingEvent> {
    const adapter = this.store.getAdapter(adapterId);
    if (!adapter) {
      throw new Error(`Messaging adapter not found: ${adapterId}`);
    }
    if (adapter.status !== "installed") {
      throw new Error(`Messaging adapter is ${adapter.status}: ${adapterId}`);
    }
    const messagingAdapter = this.createAdapter(adapter.manifest);
    const normalized = await messagingAdapter.normalizeInbound(rawEvent);
    validateInboundEvent(normalized);
    if (normalized.externalEventId) {
      const existing = this.store.findEventByExternalId({
        adapterId: normalized.adapterId,
        platform: normalized.platform,
        direction: "inbound",
        externalEventId: normalized.externalEventId
      });
      if (existing) {
        appendMessagingEvent(this.deps.database, "messaging.duplicate", {
          duplicateOf: existing.id,
          adapterId,
          platform: normalized.platform,
          externalEventId: normalized.externalEventId
        });
        return {
          ...normalized,
          metadata: {
            ...normalized.metadata,
            duplicateOf: existing.id
          }
        };
      }
    }
    const { channel, session } = this.mapper.map(normalized);
    const identity = normalized.externalUserId
      ? this.store.upsertIdentity({
          platform: normalized.platform,
          externalUserId: normalized.externalUserId,
          displayName: stringFrom(normalized.metadata.displayName) ?? stringFrom(normalized.metadata.username),
          username: stringFrom(normalized.metadata.username),
          email: stringFrom(normalized.metadata.email)
        })
      : null;
    const record = this.store.recordInboundEvent(normalized, {
      channelId: channel.id,
      identityId: identity?.id ?? null,
      sessionId: session.id
    });
    const attachmentResults = new AttachmentStore(this.store).ingest(record, normalized.attachments);
    const routedEvent =
      attachmentResults.length > 0
        ? {
            ...normalized,
            metadata: {
              ...normalized.metadata,
              attachmentBlocked: attachmentResults.some((result) => result.status === "blocked"),
              attachmentBlockReasons: attachmentResults.filter((result) => result.reason).map((result) => result.reason)
            }
          }
        : normalized;
    appendMessagingEvent(this.deps.database, "messaging.inbound", {
      messagingEventId: record.id,
      adapterId,
      platform: routedEvent.platform,
      type: routedEvent.type,
      channelId: channel.id,
      identityId: identity?.id ?? null,
      messagingSessionId: session.id,
      text: routedEvent.text ?? null
    });
    return routedEvent;
  }

  async route(event: NormalizedMessagingEvent): Promise<MessagingRouteResult> {
    if (typeof event.metadata.duplicateOf === "string") {
      appendMessagingEvent(this.deps.database, "messaging.duplicate.ignored", {
        duplicateOf: event.metadata.duplicateOf,
        adapterId: event.adapterId,
        platform: event.platform,
        externalEventId: event.externalEventId ?? null
      });
      return { allowed: true, action: "ignored", reason: `Duplicate messaging event ignored: ${event.metadata.duplicateOf}` };
    }
    const { channel, session } = this.mapper.map(event);
    if (channel.status !== "active") {
      appendMessagingEvent(this.deps.database, "messaging.denied", {
        platform: event.platform,
        adapterId: event.adapterId,
        channelId: channel.id,
        messagingSessionId: session.id,
        reason: `Messaging channel is ${channel.status}.`,
        text: event.text ?? null
      });
      return { allowed: false, action: "denied", sessionId: session.id, reason: `Messaging channel is ${channel.status}.` };
    }
    if (event.metadata.attachmentBlocked === true) {
      const reason = `Attachment blocked by messaging safety policy: ${Array.isArray(event.metadata.attachmentBlockReasons) ? event.metadata.attachmentBlockReasons.join("; ") : "blocked attachment"}`;
      appendMessagingEvent(this.deps.database, "messaging.denied", {
        platform: event.platform,
        adapterId: event.adapterId,
        channelId: channel.id,
        messagingSessionId: session.id,
        reason,
        text: event.text ?? null
      });
      const sent = await this.send({ channelId: channel.id }, { text: reason });
      return { allowed: false, action: "denied", sessionId: session.id, outboundEventId: sent.eventId, reason, responseText: reason };
    }
    if (event.type === "approval" && !event.approval?.approvalId) {
      const reason = "Messaging approval response is missing an approval ID.";
      appendMessagingEvent(this.deps.database, "messaging.approval.denied", {
        platform: event.platform,
        adapterId: event.adapterId,
        channelId: channel.id,
        messagingSessionId: session.id,
        reason
      });
      const sent = await this.send({ channelId: channel.id }, { text: reason });
      return { allowed: false, action: "approval", sessionId: session.id, outboundEventId: sent.eventId, reason, responseText: reason };
    }
    const requestedRisk =
      event.approval || event.command?.name === "approve" || event.command?.name === "reject" || event.command?.name === "run"
        ? "medium"
        : "low";
    const decision = new MessagingAllowlist(this.store).evaluate(event, requestedRisk);
    if (!decision.allowed) {
      appendMessagingEvent(this.deps.database, "messaging.denied", {
        platform: event.platform,
        adapterId: event.adapterId,
        channelId: channel.id,
        messagingSessionId: session.id,
        reason: decision.reason,
        text: event.text ?? null
      });
      const sent = await this.send({ channelId: channel.id }, { text: `SquidBot denied this messaging request: ${decision.reason}` });
      return {
        allowed: false,
        action: "denied",
        sessionId: session.id,
        outboundEventId: sent.eventId,
        reason: decision.reason,
        responseText: `Denied: ${decision.reason}`
      };
    }

    if (event.approval?.approvalId) {
      return this.resolveApproval(event.approval.approvalId, event.approval.action, event.id, channel.id, session.id, event.platform);
    }

    if (event.command) {
      appendMessagingEvent(this.deps.database, "messaging.command.received", {
        command: event.command,
        platform: event.platform,
        channelId: channel.id,
        messagingSessionId: session.id
      });
      if (event.command.name === "approve" || event.command.name === "reject") {
        const approvalId = event.command.args[0];
        if (!approvalId) {
          const sent = await this.send({ channelId: channel.id }, { text: `Usage: /squid ${event.command.name} <approvalId>` });
          return { allowed: true, action: "approval", sessionId: session.id, outboundEventId: sent.eventId };
        }
        return this.resolveApproval(approvalId, event.command.name, event.id, channel.id, session.id, event.platform);
      }
      if (event.command.name === "run") {
        const task = event.command.args.join(" ").trim();
        if (!task) {
          const sent = await this.send({ channelId: channel.id }, { text: "Usage: /squid run <task>" });
          return { allowed: true, action: "help", sessionId: session.id, outboundEventId: sent.eventId, responseText: "Usage: /squid run <task>" };
        }
        const result = await this.runTask(task, session.localSessionId ?? undefined);
        this.store.updateSessionRun(session.id, result.runId);
        appendMessagingEvent(this.deps.database, "messaging.command.executed", {
          command: event.command,
          runId: result.runId,
          traceId: result.trace.id,
          channelId: channel.id,
          messagingSessionId: session.id
        });
        const sent = await this.send({ channelId: channel.id }, { text: result.finalSummary, runId: result.runId });
        return { allowed: true, action: "run", sessionId: session.id, runId: result.runId, outboundEventId: sent.eventId, responseText: result.finalSummary };
      }
      if (event.command.name === "skill" && event.command.args[0] === "run") {
        if (!this.deps.runSkillCommand) {
          const sent = await this.send({ channelId: channel.id }, { text: "Messaging skill runs are not configured in this runtime." });
          return { allowed: true, action: "help", sessionId: session.id, outboundEventId: sent.eventId };
        }
        const result = await this.deps.runSkillCommand(event.command.args, session.localSessionId ?? undefined);
        this.store.updateSessionRun(session.id, result.runId);
        appendMessagingEvent(this.deps.database, "messaging.command.executed", {
          command: event.command,
          runId: result.runId,
          channelId: channel.id,
          messagingSessionId: session.id
        });
        const sent = await this.send({ channelId: channel.id }, { text: result.summary, runId: result.runId });
        return { allowed: true, action: "run", sessionId: session.id, runId: result.runId, outboundEventId: sent.eventId, responseText: result.summary };
      }
      if (event.command.name === "status") {
        const targetRunId = event.command.args[0] ?? session.activeRunId;
        const sent = await this.send({ channelId: channel.id }, { text: targetRunId ? `Latest linked run: ${targetRunId}` : "No linked run in this messaging session." });
        return { allowed: true, action: "status", sessionId: session.id, outboundEventId: sent.eventId };
      }
      const sent = await this.send({
        channelId: channel.id
      }, { text: "Commands: /squid run <task>, /squid status <runId>, /squid approve <approvalId>, /squid reject <approvalId>, /squid help" });
      return { allowed: true, action: "help", sessionId: session.id, outboundEventId: sent.eventId };
    }

    const response = await this.chat(event.text ?? "", session.localSessionId ?? undefined);
    this.store.updateSessionRun(session.id, response.runId);
    const sent = await this.send({ channelId: channel.id }, { text: response.content, runId: response.runId });
    return { allowed: true, action: "chat", sessionId: session.id, runId: response.runId, outboundEventId: sent.eventId, responseText: response.content };
  }

  async send(target: MessagingTarget, message: OutboundMessage): Promise<DeliveryResult> {
    const channel = this.store.getChannel(target.channelId);
    if (!channel) {
      return { ok: false, error: `Messaging channel not found: ${target.channelId}` };
    }
    if (channel.status !== "active") {
      return { ok: false, error: `Messaging channel is ${channel.status}: ${target.channelId}` };
    }
    const adapterRecord = this.store.getAdapter(channel.adapterId);
    if (!adapterRecord) {
      return { ok: false, error: `Messaging adapter not found: ${channel.adapterId}` };
    }

    const messagingAdapter = this.createAdapter(adapterRecord.manifest);
    const deliveryTarget = {
      channelId: channel.id,
      externalChannelId: channel.externalChannelId
    };
    const adapterResult = await messagingAdapter.send(deliveryTarget, message);
    const externalMessageId =
      adapterResult.externalMessageId ?? `local_${createId("outbound")}`;

    const record = this.store.recordOutboundEvent({
      adapterId: channel.adapterId,
      platform: channel.platform,
      channelId: channel.id,
      runId: message.runId ?? null,
      teamRunId: message.teamRunId ?? null,
      jobId: message.jobId ?? null,
      skillId: message.skillId ?? null,
      message,
      externalMessageId
    });
    appendMessagingEvent(this.deps.database, adapterResult.ok ? "messaging.outbound" : "messaging.delivery.failed", {
      messagingEventId: record.id,
      adapterId: channel.adapterId,
      platform: channel.platform,
      channelId: channel.id,
      runId: message.runId ?? null,
      text: message.text,
      error: adapterResult.error ?? null,
      transport: adapterResult.ok ? "real" : "local-fallback"
    });
    return adapterResult.ok
      ? { ok: true, eventId: record.id, externalMessageId }
      : { ok: false, eventId: record.id, externalMessageId, error: adapterResult.error };
  }

  private createAdapter(manifest: MessagingAdapterManifest) {
    return createMessagingAdapter(manifest, {
      getSetting: (key) => {
        const value = this.deps.database.getSetting<string>(key);
        return value ?? undefined;
      }
    });
  }

  deliverRunSummary(runId: string, text: string): DeliveryResult[] {
    const results = this.delivery.deliverToRules("runSummary", { text, runId });
    for (const result of results) {
      appendMessagingEvent(this.deps.database, result.ok ? "messaging.delivery.sent" : "messaging.delivery.failed", {
        runId,
        messagingEventId: result.eventId ?? null,
        error: result.error ?? null,
        triggerType: "runSummary"
      });
    }
    return results;
  }

  private async chat(message: string, sessionId?: string): Promise<AgentResponse> {
    const runtime = this.getRuntime(sessionId);
    return runtime.sendMessage(message);
  }

  private async runTask(task: string, sessionId?: string): Promise<RepoTaskResult> {
    const runtime = this.getRuntime(sessionId);
    return runtime.runTask(task);
  }

  private getRuntime(sessionId?: string): AgentRuntime {
    const workspacePath = this.deps.workspacePath;
    if (!workspacePath) {
      throw new Error("Messaging gateway requires a workspace path to run tasks.");
    }
    if (!this.deps.createRuntime) {
      throw new Error("Messaging gateway was not configured with an AgentRuntime factory.");
    }
    return this.deps.createRuntime(workspacePath, sessionId);
  }

  private async resolveApproval(
    approvalId: string,
    action: "approve" | "reject" | "revise" | "unknown" | string,
    responseEventId: string,
    channelId: string,
    sessionId: string,
    platform: string
  ): Promise<MessagingRouteResult> {
    const deny = async (reason: string): Promise<MessagingRouteResult> => {
      appendMessagingEvent(this.deps.database, "messaging.approval.denied", {
        approvalId,
        action,
        platform,
        channelId,
        messagingSessionId: sessionId,
        reason
      });
      const sent = await this.send({ channelId }, { text: `Approval ${approvalId} denied: ${reason}` });
      return { allowed: false, action: "approval", sessionId, outboundEventId: sent.eventId, reason, responseText: `Approval denied: ${reason}` };
    };

    if (action !== "approve" && action !== "reject") {
      return deny(`unsupported approval action: ${action}`);
    }
    const status: "approved" | "rejected" = action === "approve" ? "approved" : "rejected";

    const link = this.store.getApprovalLinkByApprovalId(approvalId);
    if (!link) {
      return deny("approval link not found");
    }
    if (link.channelId !== channelId) {
      return deny("approval response channel does not match the request channel");
    }
    if (link.expiresAt && Date.parse(link.expiresAt) < Date.now()) {
      const expired = this.store.resolveApprovalLinkIfPending(approvalId, "expired", responseEventId);
      if (expired) {
        return deny("approval expired");
      }
      return deny(`approval is not pending (${link.status})`);
    }

    const resolved = this.store.resolveApprovalLinkIfPending(approvalId, status, responseEventId);
    if (!resolved) {
      const current = this.store.getApprovalLinkByApprovalId(approvalId);
      return deny(`approval is not pending (${current?.status ?? "unknown"})`);
    }

    appendMessagingEvent(this.deps.database, "messaging.approval.received", {
      approvalId,
      action,
      platform,
      channelId,
      messagingSessionId: sessionId
    });
    const sent = await this.send({ channelId }, { text: `Approval ${approvalId} recorded as ${status}.` });
    return { allowed: true, action: "approval", sessionId, outboundEventId: sent.eventId, responseText: `Approval ${status}.` };
  }
}

function validateInboundEvent(event: NormalizedMessagingEvent): void {
  if (!event.platform || event.platform === "custom") {
    throw new Error("Messaging fixture is missing a supported platform.");
  }
  if (!event.externalChannelId) {
    throw new Error("Messaging fixture is missing a channel identifier.");
  }
  if (!event.text && !event.command && !event.approval && (!event.attachments || event.attachments.length === 0) && event.type !== "reaction") {
    throw new Error("Messaging fixture has no message, command, approval, reaction, or attachment content.");
  }
}

export function normalizeFixtureEvent(raw: unknown, adapterId: string, platform?: string): NormalizedMessagingEvent {
  return normalizeMessagingEvent(raw, adapterId, platform);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
