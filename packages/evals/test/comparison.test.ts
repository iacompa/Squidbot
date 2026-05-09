import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, datasetManifest, tempDb } from "./helpers.js";
import { compareEvalRuns, EvalResultStore } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("Benchmark comparison", () => {
  it("selects a safer higher-scoring candidate and rejects regressions", () => {
    const db = tempDb();
    const store = new EvalResultStore(db);
    store.upsertDataset({ manifest: datasetManifest() as never });
    const baseline = store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVersion", targetId: "skill_eval_fix_add@0.1.0" }).id,
      {
        status: "completed",
        metrics: {
          compositeScore: 0.72,
          taskSuccessRate: 1,
          verificationCompleteness: 0.7,
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
        }
      }
    );
    const candidate = store.updateEvalRun(
      store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVariant", targetId: "variant_good" }).id,
      {
        status: "completed",
        metrics: {
          ...baseline.metrics!,
          compositeScore: 0.86,
          verificationCompleteness: 0.9
        }
      }
    );
    expect(compareEvalRuns(db, baseline.id, candidate.id).status).toBe("candidate_won");

    const regressed = store.updateEvalRun(store.createEvalRun({ datasetId: "test-calculator-bugfix", targetType: "skillVariant", targetId: "variant_bad" }).id, {
      status: "completed",
      metrics: { ...candidate.metrics!, safetyIncidentRate: 1, regressionRate: 1 }
    });
    expect(compareEvalRuns(db, baseline.id, regressed.id).status).toBe("rejected");
    db.close();
  });
});
