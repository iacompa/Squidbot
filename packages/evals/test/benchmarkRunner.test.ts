import { afterEach, describe, expect, it } from "vitest";
import { cleanupTempRoots, datasetRoot, installEvalSkill, tempDb, tempRoot } from "./helpers.js";
import { BenchmarkRunner, DatasetRegistry, MutationProposer } from "../src/index.js";

afterEach(cleanupTempRoots);

describe("BenchmarkRunner integration", () => {
  it("runs a local coding benchmark for a skill and stores leaderboard evidence", async () => {
    const db = tempDb();
    const skillsRoot = tempRoot("squidbot-evals-skills-");
    installEvalSkill(db, skillsRoot);
    const dataset = new DatasetRegistry(db).install(datasetRoot());
    const runner = new BenchmarkRunner(db, { skillsRoot });

    const baseline = await runner.run({ datasetId: dataset.id, skillId: "skill_eval_fix_add", version: "0.1.0" });
    expect(baseline.evalRun.status).toBe("completed");
    expect(baseline.evalRun.metrics?.taskCount).toBe(1);
    expect(baseline.taskResults[0]?.traceId).toBeTruthy();

    const variant = new MutationProposer(db, { skillsRoot }).propose({ skillId: "skill_eval_fix_add", fromEval: baseline.evalRun.id });
    const candidate = await runner.run({ datasetId: dataset.id, variantId: variant.id });
    expect(candidate.evalRun.status).toBe("completed");
    expect(candidate.evalRun.metrics?.compositeScore ?? 0).toBeGreaterThanOrEqual(baseline.evalRun.metrics?.compositeScore ?? 0);
    expect(() => new DatasetRegistry(db).install(datasetRoot())).not.toThrow();
    expect(new DatasetRegistry(db).list()).toHaveLength(1);
    db.close();
  });
});
