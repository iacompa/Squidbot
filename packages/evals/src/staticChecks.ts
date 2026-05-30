import { redactSecrets } from "@squidbot/core";
import type { SkillVariantRecord, StaticCheckResult } from "./types.js";

const knownToolPrefixes = [
  "workspace.",
  "sandbox.",
  "test.",
  "connector.",
  "team.",
  "memory.",
  "terminal.",
  "skill."
];

export function runStaticChecks(variant: SkillVariantRecord): StaticCheckResult {
  const patchText = JSON.stringify(variant.patch);
  const manifestText = JSON.stringify(variant.manifest);
  const policyText = JSON.stringify(variant.policy ?? {});
  const promptsText = JSON.stringify(variant.prompts ?? {});
  const requiredTools = readRequiredTools(variant);
  const policy = variant.policy ?? {};
  const requireSandbox = policy.requireSandbox === true;
  const connectorWritesRequireApproval = policy.connectorWritesRequireApproval === true;
  const checks: StaticCheckResult["checks"] = [
    {
      id: "manifest-valid",
      name: "Manifest shape",
      passed: Boolean(variant.skillId && variant.baseVersion && variant.name && variant.mutationType),
      severity: "high",
      message: "Variant must reference a skill, base version, name, and mutation type."
    },
    {
      id: "tools-known",
      name: "Required tools exist",
      passed: requiredTools.every((tool) => knownToolPrefixes.some((prefix) => tool.startsWith(prefix))),
      severity: "high",
      message: "Variant required tools must use known tool namespaces."
    },
    {
      id: "sandbox-required",
      name: "Sandbox required for writes",
      passed: !/(workspace\.writeFile|sandbox\.promote|pushCommit|mergePullRequest)/i.test(patchText + manifestText) || requireSandbox,
      severity: "high",
      message: "Workspace writes, promotion, branch pushes, and merges must be sandboxed or approval-gated."
    },
    {
      id: "connector-approval",
      name: "Connector writes require approval",
      passed: !/connector\.[^.]+?\.(create|update|close|add|open|merge|push|delete|trigger|cancel)/i.test(patchText + manifestText) || connectorWritesRequireApproval,
      severity: "high",
      message: "Connector write variants must require approval or fixture mode."
    },
    {
      id: "no-paid-provider",
      name: "No paid provider requirement",
      passed: !/("allowPaid"\s*:\s*true|"allowByok"\s*:\s*true|paidProvider|"provider"\s*:\s*"api"|"requiredProvider"\s*:\s*"api"|byokRequired)/i.test(
        patchText + manifestText + policyText
      ),
      severity: "high",
      message: "Zero-spend variants cannot require BYOK or paid providers."
    },
    {
      id: "no-raw-secrets",
      name: "No raw secrets",
      passed: redactSecrets(patchText + manifestText + policyText + promptsText) === patchText + manifestText + policyText + promptsText,
      severity: "high",
      message: "Variants must not contain raw API keys, credentials, or personal secrets."
    },
    {
      id: "no-policy-bypass",
      name: "No bypass instructions",
      passed: !/(bypass|ignore|disable).{0,40}(policy|sandbox|approval|redaction|trace)/i.test(promptsText + patchText),
      severity: "high",
      message: "Variants must not instruct the agent to bypass policy, sandboxing, approvals, redaction, or trace logging."
    }
  ];
  return {
    status: checks.every((check) => check.passed || check.severity === "low") ? "passed" : "failed",
    checks
  };
}

function readRequiredTools(variant: SkillVariantRecord): string[] {
  const value = variant.manifest.requiredTools ?? variant.patch.requiredTools;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
