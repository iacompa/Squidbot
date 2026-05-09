import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import { SkillService } from "@squidbot/skills";
import { EvalResultStore } from "./resultStore.js";
import { SkillVariantStore } from "./skillVariantStore.js";
import { runStaticChecks } from "./staticChecks.js";
import type { SkillVariantRecord } from "./types.js";

export function promoteVariant(database: SquidDatabase, variantId: string, options: { skillsRoot?: string } = {}): { variant: SkillVariantRecord; version: unknown } {
  const variants = new SkillVariantStore(database);
  const store = new EvalResultStore(database);
  const variant = variants.getVariant(variantId);
  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }
  const canary = store.getCanaryForVariant(variant.id);
  if (!canary || canary.status !== "passed") {
    throw new Error("Variant must pass canary before stable promotion.");
  }
  const checks = store.latestStaticCheck(variant.id) ?? store.saveStaticCheck(variant.id, runStaticChecks(variant));
  if (checks.status !== "passed") {
    throw new Error("Variant static checks must pass before promotion.");
  }
  const service = new SkillService(database, options.skillsRoot ? { skillsRoot: options.skillsRoot } : {});
  const base = service.getVersion(variant.skillId, variant.baseVersion);
  if (!base) {
    throw new Error(`Base skill version not found: ${variant.skillId}@${variant.baseVersion}`);
  }
  const nextVersion = variant.variantVersion ?? nextPatchVersion(base.version);
  const manifest = {
    ...base.manifest,
    version: nextVersion,
    description: `${base.manifest.description}\n\nEvolution variant ${variant.id}: ${variant.description ?? variant.name}`,
    updatedAt: new Date().toISOString(),
    prompts: {
      ...base.manifest.prompts,
      evolutionInstruction: String(variant.patch.rationale ?? variant.description ?? variant.name)
    }
  };
  const version = service.saveVersion(manifest, {
    status: "draft",
    packagePath: base.packagePath,
    evaluation: null
  });
  service.promote(variant.skillId, nextVersion, { override: true });
  const stable = variants.markStable(variant.id, nextVersion);
  store.updateCanary(canary.id, { status: "promoted", completedAt: new Date().toISOString() });
  database.appendEvent({
    id: createId("evt"),
    timestamp: new Date().toISOString(),
    sessionId: `session_${variant.id}`,
    type: "evolve.promoted",
    data: {
      runId: variant.id,
      variantId: variant.id,
      skillId: variant.skillId,
      version: nextVersion
    }
  });
  return { variant: stable, version };
}

function nextPatchVersion(version: string): string {
  const [major = "0", minor = "1", patch = "0"] = version.split(".");
  return `${Number(major)}.${Number(minor)}.${Number(patch) + 1}`;
}
