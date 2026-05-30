import type {
  MessagingAdapter,
  MessagingAdapterManifest,
  MessagingTarget,
  OutboundMessage,
  DeliveryResult,
  NormalizedMessagingEvent
} from "./types.js";
import { normalizeMessagingEvent } from "./normalizer.js";

/**
 * Real Discord adapter — outbound via the bot REST API
 * (`POST /channels/{id}/messages` with `Authorization: Bot <token>`).
 * Falls back to a clean error (no network call) when no token is configured,
 * so it degrades gracefully rather than throwing.
 */
export class DiscordAdapter implements MessagingAdapter {
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
    const token = this.botToken ?? process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      return { ok: false, error: "Discord bot token not configured", eventId: message.runId };
    }

    const channel = target.externalChannelId ?? target.channelId;
    const res = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bot ${token}` },
      body: JSON.stringify({ content: message.text ?? "" })
    });

    if (!res.ok) {
      const body = await res.text();
      let detail = body;
      try {
        const parsed = JSON.parse(body) as { message?: string };
        detail = parsed.message ?? body;
      } catch {
        // non-JSON body — keep the raw text
      }
      return { ok: false, error: `Discord API error ${res.status}: ${detail}`, eventId: message.runId };
    }

    const data = (await res.json()) as { id?: string };
    return { ok: true, externalMessageId: data.id, eventId: message.runId };
  }
}
