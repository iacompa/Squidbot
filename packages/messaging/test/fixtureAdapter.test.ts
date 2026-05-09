import { describe, expect, it } from "vitest";
import { createDefaultMessagingManifests, FixtureMessagingAdapter } from "../src/index.js";

describe("Fixture messaging adapter", () => {
  it("normalizes fixture inbound events and simulates outbound delivery without network credentials", async () => {
    const manifest = createDefaultMessagingManifests().find((item) => item.platform === "slack");
    expect(manifest).toBeDefined();
    const adapter = new FixtureMessagingAdapter(manifest!);

    const inbound = await adapter.normalizeInbound({
      platform: "slack",
      event_id: "fixture_evt_1",
      channel_id: "C_FIXTURE",
      user_id: "U_FIXTURE",
      command: "/squid",
      text: "run list files"
    });
    expect(inbound.type).toBe("command");
    expect(inbound.externalChannelId).toBe("C_FIXTURE");
    expect(inbound.externalUserId).toBe("U_FIXTURE");

    const outbound = await adapter.send({ channelId: "msg_channel_1", externalChannelId: "C_FIXTURE" }, { text: "Run complete" });
    expect(outbound.ok).toBe(true);
    expect(outbound.externalMessageId).toContain("fixture_slack");
  });
});
