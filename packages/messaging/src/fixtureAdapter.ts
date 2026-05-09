import fs from "node:fs";
import type { MessagingAdapter, MessagingAdapterManifest, MessagingTarget, OutboundMessage, DeliveryResult, NormalizedMessagingEvent } from "./types.js";
import { normalizeMessagingEvent } from "./normalizer.js";

export class FixtureMessagingAdapter implements MessagingAdapter {
  constructor(readonly manifest: MessagingAdapterManifest) {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async normalizeInbound(raw: unknown): Promise<NormalizedMessagingEvent> {
    return normalizeMessagingEvent(raw, this.manifest.id, this.manifest.platform);
  }

  async send(target: MessagingTarget, message: OutboundMessage): Promise<DeliveryResult> {
    return {
      ok: true,
      externalMessageId: `fixture_${this.manifest.platform}_${target.externalChannelId ?? target.channelId}_${Date.now()}`,
      eventId: message.runId
    };
  }

  async loadFixtures(): Promise<unknown[]> {
    const fixturePath = this.manifest.fixtureMode.fixturePath;
    if (!fixturePath || !fs.existsSync(fixturePath)) {
      return [];
    }
    return [JSON.parse(fs.readFileSync(fixturePath, "utf8")) as unknown];
  }
}
