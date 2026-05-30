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
 * Real Telegram adapter — outbound via the Bot API
 * (`POST https://api.telegram.org/bot<token>/sendMessage`). Telegram replies
 * with `{ ok, result, description }`; we surface `description` on failure.
 */
export class TelegramAdapter implements MessagingAdapter {
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
    const token = this.botToken ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      return { ok: false, error: "Telegram bot token not configured", eventId: message.runId };
    }

    const chatId = target.externalChannelId ?? target.channelId;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message.text ?? "" })
    });

    const data = (await res.json()) as { ok: boolean; result?: { message_id?: number }; description?: string };
    if (!data.ok) {
      return { ok: false, error: data.description ?? `Telegram API error ${res.status}`, eventId: message.runId };
    }

    return {
      ok: true,
      externalMessageId: data.result?.message_id != null ? String(data.result.message_id) : undefined,
      eventId: message.runId
    };
  }
}
