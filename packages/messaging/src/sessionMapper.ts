import { createId } from "@squidbot/core";
import type { MessagingStore } from "./store.js";
import type { MessagingChannelRecord, MessagingSessionRecord, NormalizedMessagingEvent } from "./types.js";

export class SessionMapper {
  constructor(private readonly store: MessagingStore) {}

  map(event: NormalizedMessagingEvent): { channel: MessagingChannelRecord; session: MessagingSessionRecord } {
    const adapter = this.store.getAdapter(event.adapterId);
    if (!adapter) {
      throw new Error(`Messaging adapter not installed: ${event.adapterId}`);
    }
    const externalChannelId = event.externalChannelId ?? "unknown-channel";
    const channel =
      this.store.findChannel(event.platform, externalChannelId) ??
      this.store.createChannel({
        adapterId: event.adapterId,
        platform: event.platform,
        externalChannelId,
        displayName: externalChannelId,
        channelType: event.platform === "matrix" ? "room" : event.platform === "email" ? "email" : event.platform === "localWeb" ? "webchat" : "channel"
      });
    const session = this.store.upsertSession({
      platform: event.platform,
      adapterId: event.adapterId,
      channelId: channel.id,
      externalThreadId: event.externalThreadId ?? event.externalMessageId ?? null,
      localSessionId: `session_msg_${event.platform}_${externalChannelId}`.replace(/[^a-zA-Z0-9_:-]/g, "_"),
      context: {
        lastExternalEventId: event.externalEventId ?? null,
        memoryBoundary: event.platform === "email" ? "sender" : "channel"
      }
    });
    return { channel, session };
  }

  createLocalWebSession(): { channel: MessagingChannelRecord; session: MessagingSessionRecord } {
    const adapter = this.store.getAdapterByPlatform("localWeb") ?? this.store.getAdapter("adapter_localWeb");
    if (!adapter) {
      throw new Error("Local web chat adapter is not installed.");
    }
    const channel = this.store.createChannel({
      adapterId: adapter.id,
      platform: "localWeb",
      externalChannelId: `local-web-${createId("channel")}`,
      displayName: "Local Web Chat",
      channelType: "webchat"
    });
    const session = this.store.upsertSession({
      platform: "localWeb",
      adapterId: adapter.id,
      channelId: channel.id,
      localSessionId: createId("session_local_web")
    });
    return { channel, session };
  }
}
