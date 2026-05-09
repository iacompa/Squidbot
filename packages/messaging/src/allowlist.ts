import type { MessagingRisk, NormalizedMessagingEvent } from "./types.js";
import type { MessagingStore } from "./store.js";

const riskOrder: Record<MessagingRisk, number> = {
  low: 1,
  medium: 2,
  high: 3
};

export type AllowlistDecision = {
  allowed: boolean;
  reason: string;
  riskLimit: MessagingRisk;
};

export class MessagingAllowlist {
  constructor(private readonly store: MessagingStore) {}

  evaluate(event: NormalizedMessagingEvent, requestedRisk: MessagingRisk = "low"): AllowlistDecision {
    const rules = this.store.listAllowlistRules(event.platform);
    const userId = event.externalUserId;
    const channelId = event.externalChannelId;
    const triggersAction = Boolean(event.command || event.approval || event.type === "command" || event.type === "approval");
    if (triggersAction && !userId) {
      return { allowed: false, reason: "Messaging command denied because the sender identity is missing.", riskLimit: "low" };
    }
    if (triggersAction && !channelId) {
      return { allowed: false, reason: "Messaging command denied because the channel identity is missing.", riskLimit: "low" };
    }
    const blocked = rules.find(
      (rule) =>
        (rule.ruleType === "blockUser" && rule.externalUserId === userId) ||
        (rule.ruleType === "blockChannel" && rule.externalChannelId === channelId)
    );
    if (blocked) {
      return { allowed: false, reason: `Blocked by allowlist rule ${blocked.id}.`, riskLimit: blocked.riskLimit };
    }
    const identity = userId ? this.store.findIdentity(event.platform, userId) : null;
    if (identity?.trustLevel === "blocked") {
      return { allowed: false, reason: "Messaging identity is blocked.", riskLimit: "low" };
    }
    const userRule = rules.find((rule) => rule.ruleType === "allowUser" && rule.externalUserId === userId);
    const channelRule = rules.find((rule) => rule.ruleType === "allowChannel" && rule.externalChannelId === channelId);
    const riskLimit = maxRisk(userRule?.riskLimit, channelRule?.riskLimit, identityTrustRisk(identity?.trustLevel));
    const userAllowed = Boolean(userRule || (identity && identity.trustLevel !== "unknown"));
    const channelAllowed = Boolean(channelRule);
    const allowedByRule = triggersAction ? userAllowed && channelAllowed : userAllowed || channelAllowed;
    if (!allowedByRule) {
      return { allowed: false, reason: triggersAction ? "Messaging commands require an allowlisted user and channel." : "Unknown messaging user/channel denied by default.", riskLimit };
    }
    if (riskOrder[requestedRisk] > riskOrder[riskLimit]) {
      return { allowed: false, reason: `Requested risk ${requestedRisk} exceeds messaging risk limit ${riskLimit}.`, riskLimit };
    }
    return { allowed: true, reason: "Messaging identity/channel is allowlisted.", riskLimit };
  }
}

function identityTrustRisk(trustLevel: string | null | undefined): MessagingRisk | undefined {
  if (trustLevel === "admin" || trustLevel === "trusted") {
    return "high";
  }
  if (trustLevel === "allowed") {
    return "medium";
  }
  return undefined;
}

function maxRisk(...values: Array<MessagingRisk | undefined>): MessagingRisk {
  return values.filter(Boolean).sort((a, b) => riskOrder[b as MessagingRisk] - riskOrder[a as MessagingRisk])[0] ?? "low";
}
