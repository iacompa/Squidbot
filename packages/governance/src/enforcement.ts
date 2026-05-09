import type { GovernanceDecision, GovernancePolicyInput } from "./types.js";
import { GovernancePolicyEngine } from "./policyEngine.js";

export class GovernanceEnforcer {
  constructor(private readonly policyEngine: GovernancePolicyEngine) {}

  decide(input: GovernancePolicyInput): GovernanceDecision {
    return this.policyEngine.decide(input);
  }

  assertAllowed(input: GovernancePolicyInput): GovernanceDecision {
    const decision = this.decide(input);
    if (decision.decision === "deny") {
      throw new Error(`Governance denied ${input.action}: ${decision.reason}`);
    }
    return decision;
  }
}
