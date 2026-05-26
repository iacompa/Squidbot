import { FixtureMessagingAdapter } from "./fixtureAdapter.js";
import { SlackAdapter } from "./slackAdapter.js";
import type { MessagingAdapter, MessagingAdapterManifest } from "./types.js";

export type MessagingAdapterFactoryOptions = {
  getSetting?: (key: string) => string | undefined;
};

export function createMessagingAdapter(
  manifest: MessagingAdapterManifest,
  options: MessagingAdapterFactoryOptions = {}
): MessagingAdapter {
  const getSetting = options.getSetting;

  if (manifest.platform === "slack") {
    const token = getSetting?.("messaging.slack.botToken") ?? process.env.SLACK_BOT_TOKEN;
    if (token?.trim()) {
      return new SlackAdapter(manifest, token.trim());
    }
  }

  return new FixtureMessagingAdapter(manifest);
}
