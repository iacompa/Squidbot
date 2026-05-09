// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adapter = {
  id: "adapter_slack",
  name: "Slack",
  platform: "slack",
  status: "installed" as const,
  manifest: {
    transport: { mode: "webhook" },
    auth: { type: "botToken" }
  },
  createdAt: "2026-05-08T12:00:00.000Z",
  updatedAt: "2026-05-08T12:00:00.000Z",
  archivedAt: null
};

const matrix = {
  platform: "slack",
  displayName: "Slack",
  capabilities: {
    text: true,
    markdown: true,
    threads: true,
    reactions: true,
    slashCommands: true,
    buttons: true,
    modals: false,
    files: true,
    images: true,
    audio: false,
    voiceTranscription: false,
    edits: false,
    deletes: false,
    readReceipts: false,
    ephemeralMessages: false,
    deliveryReceipts: false,
    webhooks: true,
    polling: false
  },
  authType: "BYOK",
  selfHostedOption: false,
  realAdapterStatus: "betaReal" as const,
  complianceNotes: ["Fixture-first; BYOK for real mode."],
  risks: ["Unknown users denied by default"],
  requiredSettings: ["messaging.slack.botToken"]
};

const channel = {
  id: "msg_channel_test",
  adapterId: "adapter_slack",
  platform: "slack",
  externalChannelId: "C_FIXTURE",
  displayName: "#fixture-approvals",
  channelType: "channel" as const,
  status: "active" as const,
  config: {},
  createdAt: "2026-05-08T12:00:00.000Z",
  updatedAt: "2026-05-08T12:00:00.000Z"
};

beforeEach(() => {
  Object.defineProperty(window, "squidbot", {
    configurable: true,
    value: {
      listMessagingAdapters: vi.fn(async () => [adapter]),
      listMessagingMatrix: vi.fn(async () => [matrix]),
      listMessagingChannels: vi.fn(async () => [channel]),
      addMessagingChannel: vi.fn(async () => channel),
      listMessagingAllowlist: vi.fn(async () => [
        {
          id: "msg_allow_test",
          platform: "slack",
          adapterId: null,
          externalUserId: "U_FIXTURE",
          externalChannelId: null,
          ruleType: "allowUser",
          allowedActions: ["message", "command"],
          riskLimit: "medium",
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt
        }
      ]),
      addMessagingAllowlistRule: vi.fn(async () => ({})),
      removeMessagingAllowlistRule: vi.fn(async () => true),
      listMessagingDeliveryRules: vi.fn(async () => [
        {
          id: "msg_delivery_test",
          name: "Run summaries",
          triggerType: "runSummary",
          targetChannelId: channel.id,
          filter: {},
          enabled: true,
          createdAt: channel.createdAt,
          updatedAt: channel.updatedAt
        }
      ]),
      addMessagingDeliveryRule: vi.fn(async () => ({})),
      removeMessagingDeliveryRule: vi.fn(async () => true),
      listMessagingEvents: vi.fn(async () => [
        {
          id: "msg_event_test",
          adapterId: "adapter_slack",
          platform: "slack",
          direction: "inbound",
          normalizedType: "command",
          channelId: channel.id,
          identityId: "identity_test",
          sessionId: "session_test",
          runId: "run_test",
          teamRunId: null,
          jobId: null,
          skillId: null,
          bodyText: "/squid run list files",
          redactedPayload: null,
          sensitivity: "public",
          createdAt: channel.createdAt
        }
      ]),
      listMessagingSessions: vi.fn(async () => []),
      listMessagingIdentities: vi.fn(async () => []),
      sendLocalWebMessage: vi.fn(async () => ({ event: {}, route: { allowed: true } }))
    }
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "squidbot");
});

describe("MessagingPage", () => {
  it("renders adapters, matrix, channel controls, delivery rules, and inbox", async () => {
    const { MessagingPage } = await import("./MessagingPage");
    render(<MessagingPage />);

    await waitFor(() => expect(screen.getByText("Slack")).toBeTruthy());
    expect(screen.getByText("Fixture-first; BYOK for real mode.")).toBeTruthy();
    expect(screen.getByText("#fixture-approvals")).toBeTruthy();
    expect(screen.getByText("Run summaries")).toBeTruthy();
    expect(screen.getByText("/squid run list files")).toBeTruthy();

    fireEvent.click(screen.getByText("Send"));
    await waitFor(() => expect(window.squidbot.sendLocalWebMessage).toHaveBeenCalled());
  });
});
