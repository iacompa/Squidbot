import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import { parseVariant } from "./resultStore.js";
import type { SkillVariantRecord, VariantMutationType, VariantSourceType, VariantState } from "./types.js";

const allowedTransitions: Record<VariantState, VariantState[]> = {
  draft: ["generated", "archived", "rejected"],
  generated: ["sandbox_testing", "benchmarking", "rejected", "archived"],
  sandbox_testing: ["benchmarking", "rejected", "archived"],
  benchmarking: ["canary", "rejected", "archived"],
  canary: ["stable", "rejected", "archived"],
  stable: ["archived"],
  rejected: ["archived"],
  archived: []
};

export class SkillVariantStore {
  constructor(private readonly database: SquidDatabase) {}

  createVariant(input: {
    skillId: string;
    baseVersion: string;
    name: string;
    description?: string;
    mutationType: VariantMutationType;
    sourceType: VariantSourceType;
    sourceId?: string | null;
    patch: Record<string, unknown>;
    manifest: Record<string, unknown>;
    prompts?: Record<string, unknown> | null;
    policy?: Record<string, unknown> | null;
    state?: VariantState;
  }): SkillVariantRecord {
    const id = createId("skill_variant");
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT INTO skill_variants (
          id, skillId, baseVersion, variantVersion, state, name, description, mutationType, sourceType, sourceId,
          patchJson, manifestJson, promptsJson, policyJson, createdAt, updatedAt, archivedAt
        )
        VALUES (
          @id, @skillId, @baseVersion, NULL, @state, @name, @description, @mutationType, @sourceType, @sourceId,
          @patchJson, @manifestJson, @promptsJson, @policyJson, @createdAt, @updatedAt, NULL
        )`
      )
      .run({
        id,
        skillId: input.skillId,
        baseVersion: input.baseVersion,
        state: input.state ?? "generated",
        name: input.name,
        description: input.description ?? null,
        mutationType: input.mutationType,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        patchJson: JSON.stringify(input.patch),
        manifestJson: JSON.stringify(input.manifest),
        promptsJson: input.prompts ? JSON.stringify(input.prompts) : null,
        policyJson: input.policy ? JSON.stringify(input.policy) : null,
        createdAt: now,
        updatedAt: now
      });
    this.appendEvent("evolve.variant.created", { variantId: id, skillId: input.skillId, mutationType: input.mutationType, sourceType: input.sourceType });
    return this.getVariant(id)!;
  }

  listVariantsForSkill(skillId: string, includeArchived = false): SkillVariantRecord[] {
    const rows = includeArchived
      ? this.database.db.prepare("SELECT * FROM skill_variants WHERE skillId = ? ORDER BY updatedAt DESC").all(skillId)
      : this.database.db.prepare("SELECT * FROM skill_variants WHERE skillId = ? AND state != 'archived' ORDER BY updatedAt DESC").all(skillId);
    return (rows as Record<string, unknown>[]).map(parseVariant);
  }

  listVariants(limit = 100): SkillVariantRecord[] {
    return (this.database.db.prepare("SELECT * FROM skill_variants WHERE state != 'archived' ORDER BY updatedAt DESC LIMIT ?").all(limit) as Record<string, unknown>[]).map(parseVariant);
  }

  getVariant(variantId: string): SkillVariantRecord | null {
    const row = this.database.db.prepare("SELECT * FROM skill_variants WHERE id = ?").get(variantId) as Record<string, unknown> | undefined;
    return row ? parseVariant(row) : null;
  }

  updateState(variantId: string, nextState: VariantState, options: { variantVersion?: string | null } = {}): SkillVariantRecord {
    const current = this.getVariant(variantId);
    if (!current) {
      throw new Error(`Variant not found: ${variantId}`);
    }
    if (!allowedTransitions[current.state].includes(nextState)) {
      throw new Error(`Invalid variant transition: ${current.state} -> ${nextState}`);
    }
    const now = new Date().toISOString();
    this.database.db
      .prepare("UPDATE skill_variants SET state = @state, variantVersion = COALESCE(@variantVersion, variantVersion), updatedAt = @updatedAt, archivedAt = @archivedAt WHERE id = @id")
      .run({
        id: variantId,
        state: nextState,
        variantVersion: options.variantVersion ?? null,
        updatedAt: now,
        archivedAt: nextState === "archived" ? now : null
      });
    this.appendEvent(nextState === "rejected" ? "evolve.variant.rejected" : nextState === "archived" ? "evolve.variant.archived" : "evolve.variant.stateChanged", {
      variantId,
      skillId: current.skillId,
      fromState: current.state,
      toState: nextState
    });
    return this.getVariant(variantId)!;
  }

  markStable(variantId: string, variantVersion: string): SkillVariantRecord {
    const current = this.getVariant(variantId);
    if (!current) {
      throw new Error(`Variant not found: ${variantId}`);
    }
    if (current.state !== "canary") {
      throw new Error("Only canary variants can become stable.");
    }
    const now = new Date().toISOString();
    this.database.db
      .prepare("UPDATE skill_variants SET state = 'stable', variantVersion = @variantVersion, updatedAt = @updatedAt WHERE id = @id")
      .run({ id: variantId, variantVersion, updatedAt: now });
    this.appendEvent("evolve.variant.stateChanged", { variantId, skillId: current.skillId, fromState: current.state, toState: "stable", variantVersion });
    return this.getVariant(variantId)!;
  }

  archive(variantId: string): SkillVariantRecord {
    return this.updateState(variantId, "archived");
  }

  private appendEvent(type: string, data: Record<string, unknown>): void {
    const sessionId = "session_evolution";
    const runId = String(data.variantId ?? createId("evolve"));
    this.database.appendEvent({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId,
      type: type as never,
      data: {
        runId,
        ...data
      }
    });
  }
}
