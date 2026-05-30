import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, datasetManifest, installEvalSkill, tempDb, tempRoot } from "./helpers.js";
import { createCanaryForVariant, EvalResultStore, SkillVariantStore } from "../src/index.js";
import type { EvalRunMetrics } from "../src/types.js";

afterEach(cleanupTempRoots);

describe("Canary threshold gate", () => {
  it("fails the canary when verificationCompleteness is below the declared minimum even if the candidate won the comparison", () => {
    const db = tempDb();
    const skillsRoot = tempRoot("squidbot-evals-skills-");
    installEvalSkill(db, skillsRoot);
    const store = new EvalResultStore(db);
    store.upsertDataset({ manifest: datasetManifest() as never });
    const variant = createBenchmarkingVariant(db);

    // Baseline and candidate both have low verification completeness (< minVerificationCompleteness = 0.75),
    // but the candidate improves composite score enough to win the comparison gate.
    store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVersion", targetId: "skill_eval_fix_add@0.1.0" }).id,
      { status: "completed", metrics: metrics({ compositeScore: 0.72, verificationCompleteness: 0.2 }) }
    );
    store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVariant", targetId: variant.id }).id,
      { status: "completed", metrics: metrics({ compositeScore: 0.9, verificationCompleteness: 0.3 }) }
    );

    const canary = createCanaryForVariant(db, variant.id, "test-calculator-bugfix");
    expect(canary.status).toBe("failed");
    db.close();
  });

  it("fails the canary when cost increases beyond maxCostIncreasePercent even if the candidate won the comparison", () => {
    const db = tempDb();
    const skillsRoot = tempRoot("squidbot-evals-skills-");
    installEvalSkill(db, skillsRoot);
    const store = new EvalResultStore(db);
    store.upsertDataset({ manifest: datasetManifest() as never });
    const variant = createBenchmarkingVariant(db);

    // Candidate wins on score and keeps verification high, but its cost per successful task is higher
    // than the baseline (maxCostIncreasePercent = 0).
    store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVersion", targetId: "skill_eval_fix_add@0.1.0" }).id,
      { status: "completed", metrics: metrics({ compositeScore: 0.72, verificationCompleteness: 0.9, costPerSuccessfulTask: 1 }) }
    );
    store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVariant", targetId: variant.id }).id,
      { status: "completed", metrics: metrics({ compositeScore: 0.9, verificationCompleteness: 0.92, costPerSuccessfulTask: 2 }) }
    );

    const canary = createCanaryForVariant(db, variant.id, "test-calculator-bugfix");
    expect(canary.status).toBe("failed");
    db.close();
  });

  it("passes the canary when every declared threshold is satisfied", () => {
    const db = tempDb();
    const skillsRoot = tempRoot("squidbot-evals-skills-");
    installEvalSkill(db, skillsRoot);
    const store = new EvalResultStore(db);
    store.upsertDataset({ manifest: datasetManifest() as never });
    const variant = createBenchmarkingVariant(db);

    store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVersion", targetId: "skill_eval_fix_add@0.1.0" }).id,
      { status: "completed", metrics: metrics({ compositeScore: 0.72, verificationCompleteness: 0.7 }) }
    );
    store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVariant", targetId: variant.id }).id,
      { status: "completed", metrics: metrics({ compositeScore: 0.9, verificationCompleteness: 0.92 }) }
    );

    const canary = createCanaryForVariant(db, variant.id, "test-calculator-bugfix");
    expect(canary.status).toBe("passed");
    db.close();
  });
});

function createBenchmarkingVariant(db: ReturnType<typeof tempDb>) {
  const variants = new SkillVariantStore(db);
  return variants.createVariant({
    skillId: "skill_eval_fix_add",
    baseVersion: "0.1.0",
    state: "benchmarking",
    name: "Verification variant",
    mutationType: "additional_verification",
    sourceType: "user",
    patch: { requiredTools: ["workspace.createPatch"], policy: { requireSandbox: true, allowPaid: false } },
    manifest: { requiredTools: ["workspace.createPatch"] },
    policy: { requireSandbox: true, allowPaid: false, connectorWritesRequireApproval: true }
  });
}

function metrics(overrides: Partial<EvalRunMetrics>): EvalRunMetrics {
  return {
    compositeScore: 0.9,
    taskSuccessRate: 1,
    verificationCompleteness: 0.92,
    toolErrorRate: 0,
    costPerSuccessfulTask: 0,
    latencyMs: 100,
    humanApprovalBurden: 0,
    safetyIncidentRate: 0,
    traceCompleteness: 1,
    testPassRate: 1,
    regressionRate: 0,
    taskCount: 1,
    passedTaskCount: 1,
    ...overrides
  };
}
