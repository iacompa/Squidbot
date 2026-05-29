import type { SquidDatabase } from "@squidbot/db";
import { BenchmarkRunner } from "./benchmarkRunner.js";
import { createCanaryForVariant } from "./canary.js";
import { compareEvalRuns } from "./comparison.js";
import { MutationProposer } from "./mutationProposer.js";
import { SkillVariantStore } from "./skillVariantStore.js";
import { runStaticChecks } from "./staticChecks.js";
import type { CanaryStateRecord, SkillVariantRecord, StaticCheckResult } from "./types.js";

/**
 * AUTONOMY LOOP (R2) — SquidBot's "self-improving + auditable" thesis.
 *
 * Triggered by a reflection / affordance gap / eval failure, it:
 *   1. proposes a skill variant (MutationProposer),
 *   2. runs static safety checks (zero-spend, sandbox-required, no raw secrets,
 *      no policy-bypass) — a failing check rejects the variant outright,
 *   3. benchmarks the baseline AND the candidate, then compares them,
 *   4. opens a CANARY only when the candidate strictly beats the baseline.
 *
 * It NEVER auto-promotes a variant to `stable` — promotion stays canary/operator
 * gated. That is the explicit anti-goal from the reference docs: "never allow
 * self-improvement without eval + rollback / never auto-promote untested drift."
 * Every step is emitted for the audit trail.
 */

export type AutonomyEventType =
  | "evolve.variant.created"
  | "evolve.staticCheck.completed"
  | "evolve.variant.rejected"
  | "eval.run.completed"
  | "evolve.canary.started";

export type AutonomyEmit = (type: AutonomyEventType, data: Record<string, unknown>) => void;

export type ImprovementCycleOptions = {
  skillId: string;
  datasetId: string;
  skillsRoot?: string;
  fromReflection?: string;
  fromGap?: string;
  fromEval?: string;
  instruction?: string;
  emitEvent?: AutonomyEmit;
};

export type ImprovementOutcome = "rejected-static-checks" | "rejected-no-improvement" | "canary";

export type ImprovementCycleResult = {
  outcome: ImprovementOutcome;
  variant: SkillVariantRecord;
  staticChecks: StaticCheckResult;
  baselineScore?: number;
  candidateScore?: number;
  comparison?: string;
  canary?: CanaryStateRecord;
  reason: string;
  /** INVARIANT: the autonomy loop never auto-promotes a variant to `stable`. */
  promotedToStable: false;
};

export async function runImprovementCycle(
  database: SquidDatabase,
  options: ImprovementCycleOptions
): Promise<ImprovementCycleResult> {
  const emit = options.emitEvent ?? (() => undefined);
  const skillsRoot = options.skillsRoot;
  const store = new SkillVariantStore(database);
  const proposer = new MutationProposer(database, skillsRoot ? { skillsRoot } : {});

  // 1. Propose a variant from the trigger (reflection / gap / eval / instruction).
  const variant = proposer.propose({
    skillId: options.skillId,
    fromReflection: options.fromReflection,
    fromGap: options.fromGap,
    fromEval: options.fromEval,
    instruction: options.instruction
  });
  emit("evolve.variant.created", {
    variantId: variant.id,
    skillId: variant.skillId,
    sourceType: variant.sourceType,
    sourceId: variant.sourceId,
    mutationType: variant.mutationType
  });

  // 2. Static safety gate.
  const staticChecks = runStaticChecks(variant);
  emit("evolve.staticCheck.completed", { variantId: variant.id, status: staticChecks.status });
  if (staticChecks.status !== "passed") {
    const rejected = store.updateState(variant.id, "rejected");
    emit("evolve.variant.rejected", {
      variantId: variant.id,
      reason: "static-checks",
      failedChecks: staticChecks.checks.filter((check) => !check.passed).map((check) => check.id)
    });
    return {
      outcome: "rejected-static-checks",
      variant: rejected,
      staticChecks,
      reason: "Variant failed static safety checks.",
      promotedToStable: false
    };
  }

  // 3. Benchmark the baseline (current stable) and the candidate, then compare.
  store.updateState(variant.id, "benchmarking");
  const runner = new BenchmarkRunner(database, skillsRoot ? { skillsRoot } : {});
  const baseline = await runner.run({ datasetId: options.datasetId, skillId: options.skillId, version: variant.baseVersion });
  const candidate = await runner.run({ datasetId: options.datasetId, variantId: variant.id });
  const baselineScore = baseline.evalRun.metrics?.compositeScore ?? 0;
  const candidateScore = candidate.evalRun.metrics?.compositeScore ?? 0;
  const comparison = compareEvalRuns(database, baseline.evalRun.id, candidate.evalRun.id);
  emit("eval.run.completed", {
    variantId: variant.id,
    baselineRunId: baseline.evalRun.id,
    candidateRunId: candidate.evalRun.id,
    baselineScore,
    candidateScore,
    comparison: comparison.status
  });

  // 4. Eval gate — only a strict win opens a canary; never auto-promote to stable.
  if (comparison.status !== "candidate_won") {
    const rejected = store.updateState(variant.id, "rejected");
    emit("evolve.variant.rejected", {
      variantId: variant.id,
      reason: "no-improvement",
      comparison: comparison.status,
      baselineScore,
      candidateScore
    });
    return {
      outcome: "rejected-no-improvement",
      variant: rejected,
      staticChecks,
      baselineScore,
      candidateScore,
      comparison: comparison.status,
      reason: `Variant did not beat the baseline (comparison: ${comparison.status}).`,
      promotedToStable: false
    };
  }

  const canary = createCanaryForVariant(database, variant.id, options.datasetId);
  emit("evolve.canary.started", { variantId: variant.id, canaryId: canary.id, baselineScore, candidateScore });
  return {
    outcome: "canary",
    variant: store.getVariant(variant.id) ?? variant,
    staticChecks,
    baselineScore,
    candidateScore,
    comparison: comparison.status,
    canary,
    reason: "Passed static checks and beat the baseline; opened a canary for gated rollout. Promotion to stable remains canary/operator-gated.",
    promotedToStable: false
  };
}
