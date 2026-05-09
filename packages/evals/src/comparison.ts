import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import { EvalResultStore } from "./resultStore.js";
import type { BenchmarkComparisonRecord } from "./types.js";

export function compareEvalRuns(database: SquidDatabase, baselineEvalRunId: string, candidateEvalRunId: string): BenchmarkComparisonRecord {
  const store = new EvalResultStore(database);
  const baseline = store.getEvalRun(baselineEvalRunId);
  const candidate = store.getEvalRun(candidateEvalRunId);
  if (!baseline || !candidate) {
    throw new Error("Both eval runs must exist before comparison.");
  }
  if (baseline.datasetId !== candidate.datasetId) {
    throw new Error("Cannot compare eval runs from different datasets.");
  }
  if (!baseline.metrics || !candidate.metrics) {
    throw new Error("Both eval runs must have metrics before comparison.");
  }
  const scoreDelta = candidate.metrics.compositeScore - baseline.metrics.compositeScore;
  const safetyDelta = candidate.metrics.safetyIncidentRate - baseline.metrics.safetyIncidentRate;
  const regressionDelta = candidate.metrics.regressionRate - baseline.metrics.regressionRate;
  const verificationDelta = candidate.metrics.verificationCompleteness - baseline.metrics.verificationCompleteness;
  const successDelta = candidate.metrics.taskSuccessRate - baseline.metrics.taskSuccessRate;
  const latencyImprovement =
    baseline.metrics.latencyMs > 0 ? (baseline.metrics.latencyMs - candidate.metrics.latencyMs) / baseline.metrics.latencyMs : 0;
  const costImprovement =
    baseline.metrics.costPerSuccessfulTask > 0
      ? (baseline.metrics.costPerSuccessfulTask - candidate.metrics.costPerSuccessfulTask) / baseline.metrics.costPerSuccessfulTask
      : 0;
  let status: BenchmarkComparisonRecord["status"] = "tie";
  const reasons: string[] = [];
  if (candidate.metrics.safetyIncidentRate > 0 || regressionDelta > 0.001) {
    status = "rejected";
    reasons.push("Candidate introduced a safety incident or regression.");
  } else if (scoreDelta >= 0.005 && verificationDelta >= -0.001) {
    status = "candidate_won";
    reasons.push("Candidate improved composite score without reducing verification completeness.");
  } else if (
    scoreDelta >= -0.001 &&
    successDelta >= -0.001 &&
    verificationDelta >= -0.001 &&
    (latencyImprovement >= 0.2 || costImprovement >= 0.2)
  ) {
    status = "candidate_won";
    reasons.push("Candidate preserved correctness and verification while materially improving latency or cost.");
  } else if (scoreDelta < -0.01) {
    status = "baseline_won";
    reasons.push("Baseline scored higher.");
  } else {
    reasons.push("Scores are effectively tied.");
  }
  const decision = {
    scoreDelta,
    safetyDelta,
    regressionDelta,
    verificationDelta,
    successDelta,
    latencyImprovement,
    costImprovement,
    baseline: baseline.metrics,
    candidate: candidate.metrics,
    reasons,
    promotionEligible: status === "candidate_won"
  };
  const record = store.createComparison({
    datasetId: baseline.datasetId,
    baselineEvalRunId,
    candidateEvalRunId,
    winnerTargetId: status === "candidate_won" ? candidate.targetId : status === "baseline_won" ? baseline.targetId : null,
    status,
    decision
  });
  database.appendEvent({
    id: createId("evt"),
    timestamp: new Date().toISOString(),
    sessionId: `session_${record.id}`,
    type: "eval.comparison.created",
    data: {
      runId: record.id,
      comparisonId: record.id,
      datasetId: record.datasetId,
      baselineEvalRunId,
      candidateEvalRunId,
      status,
      decision
    }
  });
  return record;
}
