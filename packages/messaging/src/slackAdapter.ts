import type {
  MessagingAdapter,
  MessagingAdapterManifest,
  MessagingTarget,
  OutboundMessage,
  DeliveryResult,
  NormalizedMessagingEvent
} from "./types.js";
import { normalizeMessagingEvent } from "./normalizer.js";

export class SlackAdapter implements MessagingAdapter {
  constructor(
    readonly manifest: MessagingAdapterManifest,
    private readonly botToken?: string
  ) {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async normalizeInbound(raw: unknown): Promise<NormalizedMessagingEvent> {
    return normalizeMessagingEvent(raw, this.manifest.id, this.manifest.platform);
  }

  async send(target: MessagingTarget, message: OutboundMessage): Promise<DeliveryResult> {
    const token = this.botToken ?? process.env.SLACK_BOT_TOKEN;
    if (!token) {
      return {
        ok: false,
        error: "Slack bot token not configured",
        externalMessageId: undefined,
        eventId: message.runId
      };
    }

    const channel = target.externalChannelId ?? target.channelId;
    const text = message.text ?? "";

    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ channel, text })
    });

    const data = (await res.json()) as { ok: boolean; ts?: string; error?: string };
    if (!data.ok) {
      return {
        ok: false,
        error: data.error ?? "Slack API error",
        externalMessageId: undefined,
        eventId: message.runId
      };
    }

    return {
      ok: true,
      externalMessageId: data.ts,
      eventId: message.runId
    };
  }
}
