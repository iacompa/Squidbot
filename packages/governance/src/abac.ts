import type { GovernancePolicyInput } from "./types.js";

export function violatesExternalModelRestriction(input: GovernancePolicyInput): boolean {
  const classification = String(input.context?.dataClassification ?? input.context?.sensitivity ?? "internal");
  const provider = String(input.context?.modelProvider ?? "");
  return ["restricted", "secret"].includes(classification) && ["api", "external", "paid"].includes(provider);
}

export function violatesZeroSpend(input: GovernancePolicyInput): boolean {
  const costOwner = String(input.context?.costOwner ?? "local/free");
  const provider = String(input.context?.modelProvider ?? "");
  return costOwner.includes("user-paid") || provider === "api-paid";
}

export function requiresSandbox(input: GovernancePolicyInput): boolean {
  return Boolean(input.context?.requiresWrite) || /(workspace\.write|sandbox\.promote|filesystem\.write)/i.test(input.action);
}
