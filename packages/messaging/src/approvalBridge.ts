import { createId } from "@squidbot/core";
import { MessagingAllowlist } from "./allowlist.js";
import type { MessagingStore } from "./store.js";
import type { MessagingApprovalLink, MessagingChannelRecord, NormalizedMessagingEvent } from "./types.js";

export class ApprovalBridge {
  constructor(private readonly store: MessagingStore) {}

  sendApproval(input: {
    approvalId: string;
    channel: MessagingChannelRecord;
    summary: string;
    riskLevel?: "low" | "medium" | "high";
    runId?: string;
    expiresAt?: string | null;
  }): MessagingApprovalLink {
    const outbound = this.store.recordOutboundEvent({
      adapterId: input.channel.adapterId,
      platform: input.channel.platform,
      channelId: input.channel.id,
      runId: input.runId ?? null,
      message: {
        text: `Approval requested: ${input.summary}\nApproval ID: ${input.approvalId}\nRisk: ${input.riskLevel ?? "medium"}`,
        approvalId: input.approvalId,
        runId: input.runId,
        metadata: {
          kind: "approvalRequest",
          riskLevel: input.riskLevel ?? "medium"
        }
      },
      externalMessageId: `fixture_approval_${createId("message")}`
    });
    return this.store.createApprovalLink({
      approvalId: input.approvalId,
      messagingEventId: outbound.id,
      platform: input.channel.platform,
      channelId: input.channel.id,
      expiresAt: input.expiresAt ?? null
    });
  }

  receiveApproval(event: NormalizedMessagingEvent): MessagingApprovalLink {
    if (!event.approval?.approvalId) {
      throw new Error("Messaging approval response requires an approval ID.");
    }
    const decision = new MessagingAllowlist(this.store).evaluate(event, "medium");
    if (!decision.allowed) {
      throw new Error(`Messaging approval denied: ${decision.reason}`);
    }
    const link = this.store.getApprovalLinkByApprovalId(event.approval.approvalId);
    if (!link) {
      throw new Error(`Approval link not found: ${event.approval.approvalId}`);
    }
    if (link.expiresAt && Date.parse(link.expiresAt) < Date.now()) {
      return this.store.resolveApprovalLink(link.approvalId, "expired", event.id);
    }
    if (link.status !== "pending") {
      return link;
    }
    return this.store.resolveApprovalLink(link.approvalId, event.approval.action === "approve" ? "approved" : "rejected", event.id);
  }
}
