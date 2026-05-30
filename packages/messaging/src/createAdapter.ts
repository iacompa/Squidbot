import { DiscordAdapter } from "./discordAdapter.js";
import { FixtureMessagingAdapter } from "./fixtureAdapter.js";
import { SlackAdapter } from "./slackAdapter.js";
import { TelegramAdapter } from "./telegramAdapter.js";
import type { MessagingAdapter, MessagingAdapterManifest } from "./types.js";

export type MessagingAdapterFactoryOptions = {
  getSetting?: (key: string) => string | undefined;
};

export function createMessagingAdapter(
  manifest: MessagingAdapterManifest,
  options: MessagingAdapterFactoryOptions = {}
): MessagingAdapter {
  const getSetting = options.getSetting;
  const token = (settingKey: string, envKey: string): string | undefined =>
    (getSetting?.(settingKey) ?? process.env[envKey])?.trim() || undefined;

  // Real adapters are used when a credential is configured; otherwise each
  // degrades to the fixture adapter so demos/tests still work offline.
  if (manifest.platform === "slack") {
    const t = token("messaging.slack.botToken", "SLACK_BOT_TOKEN");
    if (t) return new SlackAdapter(manifest, t);
  }

  if (manifest.platform === "discord") {
    const t = token("messaging.discord.botToken", "DISCORD_BOT_TOKEN");
    if (t) return new DiscordAdapter(manifest, t);
  }

  if (manifest.platform === "telegram") {
    const t = token("messaging.telegram.botToken", "TELEGRAM_BOT_TOKEN");
    if (t) return new TelegramAdapter(manifest, t);
  }

  return new FixtureMessagingAdapter(manifest);
}
