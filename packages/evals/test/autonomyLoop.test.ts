import { afterEach, describe, expect, it } from "vitest";
import { saveReflection } from "@squidbot/core";
import { cleanupTempRoots, datasetRoot, installEvalSkill, tempDb, tempRoot } from "./helpers.js";
import { DatasetRegistry, runImprovementCycle, SkillVariantStore } from "../src/index.js";

afterEach(cleanupTempRoots);

function seedFailingReflection(db: ReturnType<typeof tempDb>): string {
  const id = "reflection_autonomy_test_1";
  saveReflection(db, {
    id,
    sessionId: "session_autonomy",
    runId: "run_autonomy",
    task: "Fix calculator add function",
    summary: "The add function still subtracts; verification was incomplete.",
    outcome: "Tests failed because the patch was not verified in a sandbox before reporting success.",
    successFactors: [],
    failureModes: ["tests failed", "verification incomplete"],
    missingTools: [],
    missingPermissions: [],
    missingContext: ["expected post-patch test verification"],
    reusablePatterns: ["always run fixture tests in sandbox before claiming success"],
    memoryCandidates: [],
    failureTaxonomy: [],
    affordanceIds: [],
    createdAt: "2026-05-29T00:00:00.000Z"
  });
  return id;
}

describe("autonomy loop — reflection-triggered, eval-gated, audited self-improvement", () => {
  it("proposes a variant from a reflection, gates it on eval, and NEVER auto-promotes to stable", async () => {
    const db = tempDb();
    const skillsRoot = tempRoot("squidbot-autonomy-skills-");
    installEvalSkill(db, skillsRoot);
    const dataset = new DatasetRegistry(db).install(datasetRoot());
    const reflectionId = seedFailingReflection(db);

    const events: Array<{ type: string; data: Record<string, unknown> }> = [];
    const result = await runImprovementCycle(db, {
      skillId: "skill_eval_fix_add",
      datasetId: dataset.id,
      skillsRoot,
      fromReflection: reflectionId,
      emitEvent: (type, data) => events.push({ type, data })
    });

    // 1. Triggered BY the reflection (self-improving from reflection).
    expect(result.variant.sourceType).toBe("reflection");
    expect(result.variant.sourceId).toBe(reflectionId);

    // 2. Safety gate ran and passed (proposer generates zero-spend, sandboxed variants).
    expect(result.staticChecks.status).toBe("passed");

    // 3. Eval-gated: benchmarks ran before any promotion decision.
    expect(events.map((event) => event.type)).toContain("eval.run.completed");

    // 4. THE invariant — the loop never auto-promotes untested drift to stable.
    expect(result.promotedToStable).toBe(false);
    const stored = new SkillVariantStore(db).getVariant(result.variant.id);
    expect(stored?.state).not.toBe("stable");

    // 5. The outcome is one of the two gated terminal states, with matching state.
    expect(["canary", "rejected-no-improvement"]).toContain(result.outcome);
    if (result.outcome === "canary") {
      expect(stored?.state).toBe("canary");
    } else {
      expect(stored?.state).toBe("rejected");
    }

    // 6. Every phase is audited.
    const types = events.map((event) => event.type);
    expect(types).toContain("evolve.variant.created");
    expect(types).toContain("evolve.staticCheck.completed");

    db.close();
  });
});
