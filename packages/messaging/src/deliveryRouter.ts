import type { MessagingStore } from "./store.js";
import type { DeliveryResult, MessagingDeliveryRule, OutboundMessage } from "./types.js";

export class DeliveryRouter {
  constructor(private readonly store: MessagingStore) {}

  listRules(triggerType?: string): MessagingDeliveryRule[] {
    return this.store.listDeliveryRules(triggerType);
  }

  addRule(input: Parameters<MessagingStore["createDeliveryRule"]>[0]): MessagingDeliveryRule {
    return this.store.createDeliveryRule(input);
  }

  removeRule(ruleId: string): boolean {
    return this.store.removeDeliveryRule(ruleId);
  }

  setRuleEnabled(ruleId: string, enabled: boolean): MessagingDeliveryRule {
    return this.store.updateDeliveryRuleEnabled(ruleId, enabled);
  }

  deliverToRules(triggerType: MessagingDeliveryRule["triggerType"], message: OutboundMessage): DeliveryResult[] {
    const rules = this.store.listDeliveryRules(triggerType).filter((rule) => rule.enabled);
    return rules.map((rule) => {
      const channel = this.store.getChannel(rule.targetChannelId);
      if (!channel) {
        return { ok: false, error: `Delivery target channel not found: ${rule.targetChannelId}` };
      }
      if (channel.status !== "active") {
        return { ok: false, error: `Delivery target channel is ${channel.status}: ${rule.targetChannelId}` };
      }
      const outbound = this.store.recordOutboundEvent({
        adapterId: channel.adapterId,
        platform: channel.platform,
        channelId: channel.id,
        runId: message.runId,
        teamRunId: message.teamRunId,
        jobId: message.jobId,
        skillId: message.skillId,
        message: {
          ...message,
          metadata: {
            ...(message.metadata ?? {}),
            deliveryRuleId: rule.id,
            triggerType
          }
        },
        externalMessageId: `fixture_${rule.id}`
      });
      return { ok: true, eventId: outbound.id, externalMessageId: `fixture_${outbound.id}` };
    });
  }
}
