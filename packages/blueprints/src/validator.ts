import { SEMVER_PATTERN, SLUG_PATTERN } from "./schema.js";
import type { BlueprintManifest } from "./types.js";

export type ValidationResult =
  | { ok: true; manifest: BlueprintManifest }
  | { ok: false; errors: string[] };

const ALLOWED_ROLLOUT = new Set(["draft", "pilot", "stable", "archived"]);
const ALLOWED_PROMOTION = new Set(["manual", "auto-with-benchmark", "auto-with-eval+rollback"]);

export function validateManifest(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["Manifest must be an object, not an array or primitive"] };
  }

  const m = input as Record<string, unknown>;

  function assertField(field: string, type: "string" | "array" | "object"): void {
    const v = m[field];
    if (v === undefined || v === null) errors.push(`Missing required field: ${field}`);
    else if (type === "string" && typeof v !== "string") errors.push(`${field} must be a string`);
    else if (type === "array" && !Array.isArray(v)) errors.push(`${field} must be an array`);
    else if (type === "object" && (typeof v !== "object" || Array.isArray(v))) errors.push(`${field} must be an object`);
  }

  assertField("name", "string");
  assertField("slug", "string");
  assertField("version", "string");
  assertField("description", "string");
  assertField("owner", "string");
  assertField("tags", "array");
  assertField("graph", "object");
  assertField("agentRoles", "array");
  assertField("tools", "array");
  assertField("connectors", "array");
  assertField("policies", "array");
  assertField("datasets", "array");
  assertField("benchmarks", "array");
  assertField("kpis", "array");
  assertField("rollout", "object");
  assertField("scope", "object");
  assertField("createdAt", "string");
  assertField("createdBy", "string");
  assertField("updatedAt", "string");
  assertField("updatedBy", "string");
  assertField("auditTrail", "array");

  if (typeof m.slug === "string" && !SLUG_PATTERN.test(m.slug)) {
    errors.push("slug must be lowercase kebab-case (e.g. 'ai-ceo-ops')");
  }
  if (typeof m.version === "string" && !SEMVER_PATTERN.test(m.version)) {
    errors.push(`version "${m.version}" is not valid semver (expected major.minor.patch)`);
  }

  const rollout = m.rollout as Record<string, unknown> | undefined;
  if (rollout && typeof rollout === "object" && !Array.isArray(rollout)) {
    if (typeof rollout.status !== "string" || !ALLOWED_ROLLOUT.has(rollout.status)) {
      errors.push(`rollout.status must be one of ${[...ALLOWED_ROLLOUT].join("|")}`);
    }
    if (typeof rollout.haltOnFailure !== "boolean") {
      errors.push("rollout.haltOnFailure must be a boolean");
    }
    if (rollout.canaryPercent !== undefined) {
      const p = rollout.canaryPercent as number;
      if (typeof p !== "number" || p < 0 || p > 100) {
        errors.push("rollout.canaryPercent must be a number between 0 and 100");
      }
    }
  }

  // trainability + adaptivity are optional, but if present must be valid
  const train = m.trainability as Record<string, unknown> | undefined;
  if (train) {
    if (typeof train.promotionGate !== "string" || !ALLOWED_PROMOTION.has(train.promotionGate)) {
      errors.push(`trainability.promotionGate must be one of ${[...ALLOWED_PROMOTION].join("|")}`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: m as unknown as BlueprintManifest };
}
