import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { AgentRuntime } from "@squidbot/core";
import { MessagingGateway } from "../src/index.js";
import { setupMessaging, tempDatabase } from "./helpers.js";

let db: SquidDatabase | null = null;

afterEach(() => db?.close());

describe("Messaging gateway integration", () => {
  it("denies unknown fixture users and routes trusted commands through the runtime", async () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    store.createAllowlistRule({ platform: "slack", externalUserId: "U_FIXTURE", externalChannelId: "C_FIXTURE", ruleType: "allowUser", riskLimit: "medium" });
    store.createAllowlistRule({ platform: "slack", externalChannelId: "C_FIXTURE", ruleType: "allowChannel", riskLimit: "medium" });
    const gateway = new MessagingGateway({
      database: db,
      workspacePath: process.cwd(),
      createRuntime: (workspacePath, sessionId) => new AgentRuntime({ database: db!, workspacePath, sessionId })
    });

    const denied = await gateway.ingest({ platform: "slack", channel: "C_UNKNOWN", user: "U_UNKNOWN", text: "/squid run list files" }, "adapter_slack");
    expect((await gateway.route(denied)).allowed).toBe(false);

    const trusted = await gateway.ingest({ platform: "slack", channel: "C_FIXTURE", user: "U_FIXTURE", text: "/squid run list files" }, "adapter_slack");
    const result = await gateway.route(trusted);
    expect(result.allowed).toBe(true);
    expect(result.runId).toMatch(/^run_/);
    expect(store.listEvents({ platform: "slack" }).some((event) => event.direction === "outbound")).toBe(true);
  });

  it("ignores duplicate external events before routing work twice", async () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    store.createAllowlistRule({ platform: "slack", externalUserId: "U_FIXTURE", ruleType: "allowUser", riskLimit: "medium" });
    store.createAllowlistRule({ platform: "slack", externalChannelId: "C_FIXTURE", ruleType: "allowChannel", riskLimit: "medium" });
    const gateway = new MessagingGateway({
      database: db,
      workspacePath: process.cwd(),
      createRuntime: (workspacePath, sessionId) => new AgentRuntime({ database: db!, workspacePath, sessionId })
    });

    const raw = { platform: "slack", event_id: "dup_evt_001", channel: "C_FIXTURE", user: "U_FIXTURE", text: "/squid run list files" };
    const first = await gateway.route(await gateway.ingest(raw, "adapter_slack"));
    const second = await gateway.route(await gateway.ingest(raw, "adapter_slack"));
    expect(first.action).toBe("run");
    expect(second.action).toBe("ignored");
    expect(store.listEvents({ platform: "slack" }).filter((event) => event.externalEventId === "dup_evt_001")).toHaveLength(1);
  });

  it("rejects malformed inbound fixtures without creating unknown-channel sessions", async () => {
    db = tempDatabase();
    setupMessaging(db);
    const gateway = new MessagingGateway({ database: db, workspacePath: process.cwd(), createRuntime: (workspacePath, sessionId) => new AgentRuntime({ database: db!, workspacePath, sessionId }) });

    await expect(gateway.ingest({}, "adapter_slack")).rejects.toThrow(/missing a channel/i);
  });

  it("does not route commands for disabled channels", async () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    store.createAllowlistRule({ platform: "slack", externalUserId: "U_FIXTURE", ruleType: "allowUser", riskLimit: "medium" });
    store.createAllowlistRule({ platform: "slack", externalChannelId: "C_FIXTURE", ruleType: "allowChannel", riskLimit: "medium" });
    const channel = store.createChannel({ adapterId: "adapter_slack", platform: "slack", externalChannelId: "C_FIXTURE" });
    store.updateChannelStatus(channel.id, "disabled");
    const gateway = new MessagingGateway({
      database: db,
      workspacePath: process.cwd(),
      createRuntime: (workspacePath, sessionId) => new AgentRuntime({ database: db!, workspacePath, sessionId })
    });

    const event = await gateway.ingest({ platform: "slack", event_id: "disabled_evt_001", channel: "C_FIXTURE", user: "U_FIXTURE", text: "/squid run list files" }, "adapter_slack");
    const result = await gateway.route(event);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/disabled/);
  });

  it("blocks dangerous attachments before starting a chat run", async () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    store.createAllowlistRule({ platform: "slack", externalUserId: "U_FIXTURE", ruleType: "allowUser", riskLimit: "medium" });
    store.createAllowlistRule({ platform: "slack", externalChannelId: "C_FIXTURE", ruleType: "allowChannel", riskLimit: "medium" });
    const gateway = new MessagingGateway({
      database: db,
      workspacePath: process.cwd(),
      createRuntime: (workspacePath, sessionId) => new AgentRuntime({ database: db!, workspacePath, sessionId })
    });

    const event = await gateway.ingest(
      {
        platform: "slack",
        event_id: "dangerous_attachment_evt",
        channel: "C_FIXTURE",
        user: "U_FIXTURE",
        file: { id: "F1", name: "run.sh", size: 100 }
      },
      "adapter_slack"
    );
    const result = await gateway.route(event);
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/Attachment blocked/);
    expect(result.runId).toBeUndefined();
  });

  it("denies invalid and expired approval responses", async () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    const channel = store.createChannel({ adapterId: "adapter_slack", platform: "slack", externalChannelId: "C_FIXTURE" });
    store.createAllowlistRule({ platform: "slack", externalUserId: "U_FIXTURE", ruleType: "allowUser", riskLimit: "medium" });
    store.createAllowlistRule({ platform: "slack", externalChannelId: "C_FIXTURE", ruleType: "allowChannel", riskLimit: "medium" });
    store.createApprovalLink({
      approvalId: "approval_expired",
      platform: "slack",
      channelId: channel.id,
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });
    const gateway = new MessagingGateway({
      database: db,
      workspacePath: process.cwd(),
      createRuntime: (workspacePath, sessionId) => new AgentRuntime({ database: db!, workspacePath, sessionId })
    });

    const invalid = await gateway.route(
      await gateway.ingest({ platform: "slack", event_id: "invalid_approval_evt", channel: "C_FIXTURE", user: "U_FIXTURE", action: "approve", approvalId: "approval_missing" }, "adapter_slack")
    );
    const expired = await gateway.route(
      await gateway.ingest({ platform: "slack", event_id: "expired_approval_evt", channel: "C_FIXTURE", user: "U_FIXTURE", action: "approve", approvalId: "approval_expired" }, "adapter_slack")
    );
    expect(invalid.allowed).toBe(false);
    expect(invalid.reason).toMatch(/not found/);
    expect(expired.allowed).toBe(false);
    expect(expired.reason).toMatch(/expired/);
  });
});
