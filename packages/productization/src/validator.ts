import type { PluginManifest, PluginRiskLevel } from "./types.js";

export type PluginValidationResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; errors: string[] };

const ID_PATTERN = /^[a-z][a-z0-9._-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+([-+].+)?$/;
const RISK_LEVELS: ReadonlySet<PluginRiskLevel> = new Set(["low", "medium", "high", "critical"]);

/**
 * Validate an untrusted plugin manifest. Returns the typed manifest on success
 * or a list of every problem found (not just the first) so authors can fix all
 * at once. A plugin must declare at least one contribution — an empty plugin is
 * rejected rather than silently installed.
 */
export function validatePluginManifest(input: unknown): PluginValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["Plugin manifest must be an object."] };
  }
  const m = input as Record<string, unknown>;
  const errors: string[] = [];

  for (const field of ["id", "name", "version", "description", "author"] as const) {
    if (typeof m[field] !== "string" || (m[field] as string).trim().length === 0) {
      errors.push(`Missing or empty required string field: ${field}`);
    }
  }

  if (typeof m.id === "string" && !ID_PATTERN.test(m.id)) {
    errors.push(`id must match ${ID_PATTERN} (lowercase, alphanumerics, . _ -)`);
  }
  if (typeof m.version === "string" && !SEMVER_PATTERN.test(m.version)) {
    errors.push(`version must be semver (e.g. 1.0.0), got: ${m.version}`);
  }

  if (m.contributes === undefined || typeof m.contributes !== "object" || Array.isArray(m.contributes)) {
    errors.push("contributes must be an object with at least one of: tools, connectors, skills");
  } else {
    const c = m.contributes as Record<string, unknown>;
    for (const key of ["tools", "connectors", "skills"] as const) {
      if (c[key] !== undefined && (!Array.isArray(c[key]) || (c[key] as unknown[]).some((v) => typeof v !== "string"))) {
        errors.push(`contributes.${key} must be an array of strings`);
      }
    }
    const total = (["tools", "connectors", "skills"] as const).reduce(
      (sum, key) => sum + (Array.isArray(c[key]) ? (c[key] as unknown[]).length : 0),
      0
    );
    if (total === 0) {
      errors.push("Plugin must contribute at least one tool, connector, or skill.");
    }
  }

  if (m.permissions !== undefined && (!Array.isArray(m.permissions) || m.permissions.some((p) => typeof p !== "string"))) {
    errors.push("permissions must be an array of strings");
  }
  if (m.riskLevel !== undefined && !RISK_LEVELS.has(m.riskLevel as PluginRiskLevel)) {
    errors.push("riskLevel must be one of: low, medium, high, critical");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, manifest: input as PluginManifest };
}
