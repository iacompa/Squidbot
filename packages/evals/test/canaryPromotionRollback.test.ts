import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, datasetManifest, installEvalSkill, tempDb, tempRoot } from "./helpers.js";
import { createCanaryForVariant, EvalResultStore, promoteVariant, rollbackEvolution, SkillVariantStore } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("Canary, promotion, and rollback", () => {
  it("requires benchmark evidence before stable promotion and supports rollback", () => {
    const db = tempDb();
    const skillsRoot = tempRoot("squidbot-evals-skills-");
    installEvalSkill(db, skillsRoot);
    const store = new EvalResultStore(db);
    store.upsertDataset({ manifest: datasetManifest() as never });
    const variants = new SkillVariantStore(db);
    const variant = variants.createVariant({
      skillId: "skill_eval_fix_add",
      baseVersion: "0.1.0",
      state: "benchmarking",
      name: "Verification variant",
      mutationType: "additional_verification",
      sourceType: "user",
      patch: { requiredTools: ["workspace.createPatch"], policy: { requireSandbox: true, allowPaid: false }, expectedMetricImpact: { verificationCompleteness: 0.1 } },
      manifest: { requiredTools: ["workspace.createPatch"] },
      policy: { requireSandbox: true, allowPaid: false, connectorWritesRequireApproval: true }
    });
    const baseline = store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVersion", targetId: "skill_eval_fix_add@0.1.0" }).id,
      { status: "completed", metrics: metrics(0.72, 0.7) }
    );
    store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVariant", targetId: variant.id }).id,
      { status: "completed", metrics: metrics(0.88, 0.92) }
    );

    const canary = createCanaryForVariant(db, variant.id, "test-calculator-bugfix");
    expect(canary.status).toBe("passed");
    const promoted = promoteVariant(db, variant.id, { skillsRoot });
    expect(promoted.variant.state).toBe("stable");
    expect(promoted.version).toBeTruthy();
    expect(rollbackEvolution(db, "skill_eval_fix_add", "0.1.0", { skillsRoot }).currentVersion).toBe("0.1.0");
    expect(store.listComparisonsForRun(baseline.id)).toHaveLength(1);
    db.close();
  });
});

function metrics(compositeScore: number, verificationCompleteness: number) {
  return {
    compositeScore,
    taskSuccessRate: 1,
    verificationCompleteness,
    toolErrorRate: 0,
    costPerSuccessfulTask: 0,
    latencyMs: 100,
    humanApprovalBurden: 0,
    safetyIncidentRate: 0,
    traceCompleteness: 1,
    testPassRate: 1,
    regressionRate: 0,
    taskCount: 1,
    passedTaskCount: 1
  };
}
