import { baseCapabilities } from "./adapterManifest.js";
import type { MessagingPlatform, PlatformMatrixEntry } from "./types.js";

const commonRisks = ["Unknown users denied by default", "High-risk actions require existing approval gates"];

export const platformMatrix: PlatformMatrixEntry[] = [
  entry("localWeb", "Local Web Chat", "supportedReal", [], { markdown: true, buttons: true, files: true, images: true }, true),
  entry("slack", "Slack", "betaReal", ["messaging.slack.botToken", "messaging.slack.signingSecret"], {
    markdown: true,
    threads: true,
    reactions: true,
    slashCommands: true,
    buttons: true,
    files: true,
    images: true,
    webhooks: true
  }),
  entry("discord", "Discord", "betaReal", ["messaging.discord.botToken"], { markdown: true, reactions: true, slashCommands: true, buttons: true, files: true, images: true, webhooks: true }),
  entry("telegram", "Telegram", "betaReal", ["messaging.telegram.botToken"], { buttons: true, files: true, images: true, audio: true, polling: true, webhooks: true }),
  entry("matrix", "Matrix", "betaReal", ["messaging.matrix.homeserver", "messaging.matrix.accessToken", "messaging.matrix.roomId"], {
    markdown: true,
    threads: true,
    reactions: true,
    files: true,
    images: true,
    polling: true
  }, true),
  entry("email", "Email", "betaReal", ["messaging.email.smtpUrl", "messaging.email.imapUrl", "messaging.email.from"], { markdown: true, files: true, images: true, polling: true }, true),
  entry("teams", "Microsoft Teams", "planned", ["messaging.teams.botToken"], { markdown: true, threads: true, buttons: true, files: true, images: true, webhooks: true }),
  entry("whatsapp", "WhatsApp Business Platform", "fixtureOnly", ["messaging.whatsapp.accessToken", "messaging.whatsapp.phoneNumberId"], { buttons: true, files: true, images: true, audio: true, webhooks: true }, false, [
    "Official WhatsApp Business Platform only.",
    "Fixture-first and BYOK-only; no general-purpose assistant mode is enabled by default.",
    "Meta AI-provider/commercial policy must be reviewed before real use."
  ]),
  entry("messenger", "Messenger", "fixtureOnly", ["messaging.messenger.pageToken"], { buttons: true, files: true, images: true, webhooks: true }, false, ["Official APIs only; no scraping or personal-account automation."]),
  entry("instagram", "Instagram DM", "fixtureOnly", ["messaging.instagram.pageToken"], { buttons: true, images: true, webhooks: true }, false, ["Official APIs only; BYOK and fixture-first."]),
  entry("imessage", "iMessage / BlueBubbles", "fixtureOnly", ["messaging.imessage.bridgeUrl", "messaging.imessage.bridgeToken"], { files: true, images: true, reactions: true, polling: true }, true, [
    "Requires a user-operated local bridge such as BlueBubbles if real mode is configured."
  ]),
  entry("signal", "Signal", "fixtureOnly", ["messaging.signal.signalCliPath"], { files: true, images: true, audio: true, polling: true }, true, ["Optional real mode should use user-installed signal-cli only."]),
  entry("googleChat", "Google Chat", "planned", ["messaging.googleChat.webhookUrl"], { markdown: true, threads: true, buttons: true, files: true, webhooks: true }),
  entry("mattermost", "Mattermost", "planned", ["messaging.mattermost.apiUrl", "messaging.mattermost.token"], { markdown: true, threads: true, slashCommands: true, buttons: true, files: true, webhooks: true }, true),
  entry("nextcloudTalk", "Nextcloud Talk", "planned", ["messaging.nextcloudTalk.apiUrl", "messaging.nextcloudTalk.token"], { files: true, images: true, polling: true }, true),
  entry("xmpp", "XMPP", "planned", ["messaging.xmpp.jid", "messaging.xmpp.password"], { files: true, polling: true }, true),
  entry("line", "LINE", "fixtureOnly", ["messaging.line.channelToken"], { buttons: true, files: true, images: true, webhooks: true }, false, ["Official APIs only; fixture-first."]),
  entry("wechat", "WeChat / Weixin", "fixtureOnly", ["messaging.wechat.token"], { buttons: true, files: true, images: true, webhooks: true }, false, ["Official APIs only; compliance review required."]),
  entry("qq", "QQ", "fixtureOnly", ["messaging.qq.token"], { files: true, images: true }, false, ["Official or user-operated bridge only."]),
  entry("feishu", "Feishu / Lark", "planned", ["messaging.feishu.appId", "messaging.feishu.appSecret"], { markdown: true, buttons: true, files: true, webhooks: true }),
  entry("dingtalk", "DingTalk", "planned", ["messaging.dingtalk.token"], { markdown: true, buttons: true, files: true, webhooks: true }),
  entry("wecom", "WeCom", "planned", ["messaging.wecom.token"], { markdown: true, buttons: true, files: true, webhooks: true }),
  entry("nostr", "Nostr", "planned", ["messaging.nostr.privateKey"], { markdown: true }, true),
  entry("irc", "IRC", "planned", ["messaging.irc.server", "messaging.irc.nick"], {}, true),
  entry("sms", "SMS", "fixtureOnly", ["messaging.sms.providerToken"], {}, false, ["Fixture-only unless the user configures their own provider; no project-paid SMS."]),
  entry("genericWebhook", "Generic Webhook", "betaReal", ["messaging.genericWebhook.secret"], { markdown: true, webhooks: true, buttons: true }, true),
  entry("custom", "Custom Adapter", "planned", [], {}, true)
];

export function listPlatformMatrix(): PlatformMatrixEntry[] {
  return platformMatrix;
}

export function getPlatformMatrixEntry(platform: string): PlatformMatrixEntry | null {
  return platformMatrix.find((entry) => entry.platform === platform) ?? null;
}

function entry(
  platform: MessagingPlatform,
  displayName: string,
  status: PlatformMatrixEntry["realAdapterStatus"],
  requiredSettings: string[],
  capabilities: Partial<PlatformMatrixEntry["capabilities"]> = {},
  selfHostedOption = false,
  complianceNotes: string[] = []
): PlatformMatrixEntry {
  return {
    platform,
    displayName,
    capabilities: baseCapabilities(capabilities),
    authType: requiredSettings.length > 0 ? "BYOK" : "none",
    selfHostedOption,
    realAdapterStatus: status,
    complianceNotes,
    risks: [...commonRisks, ...(status === "fixtureOnly" ? ["Real adapter disabled by default"] : [])],
    requiredSettings
  };
}
