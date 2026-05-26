import { describe, expect, it } from "vitest";
import { createMessagingAdapter } from "../src/createAdapter.js";
import { createDefaultMessagingManifests } from "../src/defaultAdapters.js";
import { FixtureMessagingAdapter } from "../src/fixtureAdapter.js";
import { SlackAdapter } from "../src/slackAdapter.js";

describe("createMessagingAdapter", () => {
  it("returns SlackAdapter when a bot token is configured", () => {
    const slackManifest = createDefaultMessagingManifests().find((manifest) => manifest.platform === "slack");
    expect(slackManifest).toBeDefined();
    const adapter = createMessagingAdapter(slackManifest!, {
      getSetting: (key) => (key === "messaging.slack.botToken" ? "xoxb-test-token" : undefined)
    });
    expect(adapter).toBeInstanceOf(SlackAdapter);
  });

  it("falls back to fixture adapter when Slack token is missing", () => {
    const slackManifest = createDefaultMessagingManifests().find((manifest) => manifest.platform === "slack");
    expect(slackManifest).toBeDefined();
    const adapter = createMessagingAdapter(slackManifest!, { getSetting: () => undefined });
    expect(adapter).toBeInstanceOf(FixtureMessagingAdapter);
  });
});
