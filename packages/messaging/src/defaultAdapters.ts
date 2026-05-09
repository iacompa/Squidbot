import { createFixtureManifest } from "./adapterManifest.js";
import { platformMatrix } from "./platformMatrix.js";
import type { MessagingAdapterManifest } from "./types.js";

export function createDefaultMessagingManifests(): MessagingAdapterManifest[] {
  return platformMatrix.map((entry) =>
    createFixtureManifest({
      id: `adapter_${entry.platform}`,
      name: entry.displayName,
      platform: entry.platform,
      description: `${entry.displayName} messaging adapter. Fixture-first with real network disabled by default.`,
      capabilities: entry.capabilities,
      complianceNotes: entry.complianceNotes,
      settingKeys: entry.requiredSettings,
      authType: defaultAuthType(entry.platform, entry.requiredSettings),
      transportMode: entry.platform === "email" ? "smtpImap" : entry.platform === "localWeb" ? "localServer" : entry.capabilities.webhooks ? "webhook" : "fixture"
    })
  );
}

function defaultAuthType(platform: string, settingKeys: string[]): MessagingAdapterManifest["auth"]["type"] {
  if (settingKeys.length === 0) {
    return "none";
  }
  if (platform === "localWeb") {
    return "none";
  }
  if (platform === "email") {
    return "smtpImap";
  }
  if (platform === "genericWebhook" || settingKeys.some((key) => key.toLowerCase().includes("webhook"))) {
    return "webhookSecret";
  }
  if (platform === "imessage") {
    return "bridgeToken";
  }
  if (settingKeys.some((key) => /secret|password/i.test(key))) {
    return "apiKey";
  }
  return "botToken";
}
