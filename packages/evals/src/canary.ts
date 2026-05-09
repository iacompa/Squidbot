import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import { compareEvalRuns } from "./comparison.js";
import { EvalResultStore } from "./resultStore.js";
import { SkillVariantStore } from "./skillVariantStore.js";
import type { CanaryStateRecord } from "./types.js";

export function createCanaryForVariant(database: SquidDatabase, variantId: string, datasetId: string): CanaryStateRecord {
  const store = new EvalResultStore(database);
  const variants = new SkillVariantStore(database);
  const variant = variants.getVariant(variantId);
  if (!variant) {
    throw new Error(`Variant not found: ${variantId}`);
  }
  const latestCandidate = findLatestEvalRun(database, datasetId, variantId);
  const latestBaseline = findLatestEvalRun(database, datasetId, `${variant.skillId}@${variant.baseVersion}`);
  if (!latestCandidate || !latestBaseline) {
    throw new Error("Canary requires baseline and candidate evaluation runs.");
  }
  const comparison = compareEvalRuns(database, latestBaseline.id, latestCandidate.id);
  if (comparison.status !== "candidate_won") {
    throw new Error(`Variant is not canary eligible: comparison ${comparison.status}`);
  }
  if (variant.state === "benchmarking") {
    variants.updateState(variant.id, "canary");
  }
  const thresholds = {
    minCompositeScore: 0.8,
    maxRegressionRate: 0,
    maxSafetyIncidents: 0,
    maxCostIncreasePercent: 0,
    minVerificationCompleteness: 0.75
  };
  const metrics = latestCandidate.metrics ?? {};
  const passed = Number(latestCandidate.metrics?.compositeScore ?? 0) >= thresholds.minCompositeScore && Number(latestCandidate.metrics?.safetyIncidentRate ?? 1) <= thresholds.maxSafetyIncidents;
  const canary = store.createCanary({
    variantId: variant.id,
    skillId: variant.skillId,
    status: passed ? "passed" : "failed",
    scope: {
      mode: "selectedDataset",
      datasetId,
      maxRuns: 5
    },
    thresholds,
    metrics,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString()
  });
  database.appendEvent({
    id: createId("evt"),
    timestamp: new Date().toISOString(),
    sessionId: `session_${canary.id}`,
    type: passed ? "evolve.canary.completed" : "evolve.canary.failed",
    data: {
      runId: canary.id,
      canaryId: canary.id,
      variantId,
      skillId: variant.skillId,
      status: canary.status,
      metrics
    }
  });
  return canary;
}

function findLatestEvalRun(database: SquidDatabase, datasetId: string, targetId: string): { id: string; metrics: Record<string, unknown> | null } | null {
  const row = database.db
    .prepare(
      `SELECT id, metricsJson
       FROM eval_runs
       WHERE datasetId = ? AND targetId = ? AND status = 'completed'
       ORDER BY completedAt DESC
       LIMIT 1`
    )
    .get(datasetId, targetId) as { id: string; metricsJson: string | null } | undefined;
  return row ? { id: row.id, metrics: row.metricsJson ? JSON.parse(row.metricsJson) : null } : null;
}
