import { afterEach, describe, expect, it } from "vitest";
import type { SquidDatabase } from "@squidbot/db";
import { ApprovalBridge, normalizeMessagingEvent } from "../src/index.js";
import { setupMessaging, tempDatabase } from "./helpers.js";

let db: SquidDatabase | null = null;

afterEach(() => db?.close());

describe("Approval bridge", () => {
  it("sends an approval and accepts a trusted response", () => {
    db = tempDatabase();
    const store = setupMessaging(db);
    const channel = store.createChannel({ adapterId: "adapter_slack", platform: "slack", externalChannelId: "C1" });
    store.createAllowlistRule({ platform: "slack", externalUserId: "U1", externalChannelId: "C1", ruleType: "allowUser", riskLimit: "medium" });
    store.createAllowlistRule({ platform: "slack", externalChannelId: "C1", ruleType: "allowChannel", riskLimit: "medium" });
    const bridge = new ApprovalBridge(store);
    bridge.sendApproval({ approvalId: "approval_1", channel, summary: "Promote sandbox patch" });
    const event = normalizeMessagingEvent({ platform: "slack", channel: "C1", user: "U1", action: "approve", approvalId: "approval_1" }, "adapter_slack");
    const inbound = store.recordInboundEvent(event, { channelId: channel.id });
    const resolved = bridge.receiveApproval({ ...event, id: inbound.id });
    expect(resolved.status).toBe("approved");
  });
});
