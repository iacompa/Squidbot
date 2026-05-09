import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import type {
  BenchmarkComparisonRecord,
  CanaryStateRecord,
  EvalDatasetManifest,
  EvalDatasetRecord,
  EvalRunMetrics,
  EvalRunRecord,
  EvalTaskRecord,
  EvalTaskResultRecord,
  LeaderboardEntryRecord,
  SkillVariantRecord,
  StaticCheckResult
} from "./types.js";

type Row = Record<string, unknown>;

export class EvalResultStore {
  constructor(readonly database: SquidDatabase) {}

  upsertDataset(input: { manifest: EvalDatasetManifest; sourcePath?: string | null }): EvalDatasetRecord {
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT INTO eval_datasets (id, name, domain, version, description, manifestJson, sourcePath, status, createdAt, updatedAt, archivedAt)
         VALUES (@id, @name, @domain, @version, @description, @manifestJson, @sourcePath, 'active', @createdAt, @updatedAt, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           domain = excluded.domain,
           version = excluded.version,
           description = excluded.description,
           manifestJson = excluded.manifestJson,
           sourcePath = excluded.sourcePath,
           status = 'active',
           updatedAt = excluded.updatedAt,
           archivedAt = NULL`
      )
      .run({
        id: input.manifest.id,
        name: input.manifest.name,
        domain: input.manifest.domain,
        version: input.manifest.version,
        description: input.manifest.description,
        manifestJson: JSON.stringify(input.manifest),
        sourcePath: input.sourcePath ?? null,
        createdAt: now,
        updatedAt: now
      });
    const taskIds = input.manifest.tasks.map((task) => task.id);
    const staleTasks = this.database.db.prepare("SELECT id FROM eval_tasks WHERE datasetId = ?").all(input.manifest.id) as Array<{ id: string }>;
    for (const stale of staleTasks) {
      if (taskIds.includes(stale.id)) {
        continue;
      }
      this.database.db
        .prepare(
          `DELETE FROM eval_tasks
           WHERE id = @id
             AND NOT EXISTS (
               SELECT 1 FROM eval_task_results WHERE evalTaskId = @id
             )`
        )
        .run({ id: stale.id });
    }
    for (const task of input.manifest.tasks) {
      this.database.db
        .prepare(
          `INSERT INTO eval_tasks (id, datasetId, name, domain, taskJson, fixturePath, expectedJson, createdAt, updatedAt)
           VALUES (@id, @datasetId, @name, @domain, @taskJson, @fixturePath, @expectedJson, @createdAt, @updatedAt)
           ON CONFLICT(id) DO UPDATE SET
             datasetId = excluded.datasetId,
             name = excluded.name,
             domain = excluded.domain,
             taskJson = excluded.taskJson,
             fixturePath = excluded.fixturePath,
             expectedJson = excluded.expectedJson,
             updatedAt = excluded.updatedAt`
        )
        .run({
          id: task.id,
          datasetId: input.manifest.id,
          name: task.name,
          domain: input.manifest.domain,
          taskJson: JSON.stringify(task),
          fixturePath: task.fixture.workspacePath ?? null,
          expectedJson: JSON.stringify(task.expected),
          createdAt: now,
          updatedAt: now
        });
    }
    return this.getDataset(input.manifest.id)!;
  }

  listDatasets(): EvalDatasetRecord[] {
    return (this.database.db.prepare("SELECT * FROM eval_datasets WHERE status = 'active' ORDER BY domain, name").all() as Row[]).map(parseDataset);
  }

  getDataset(datasetId: string): EvalDatasetRecord | null {
    const row = this.database.db.prepare("SELECT * FROM eval_datasets WHERE id = ?").get(datasetId) as Row | undefined;
    return row ? parseDataset(row) : null;
  }

  listTasks(datasetId: string): EvalTaskRecord[] {
    return (this.database.db.prepare("SELECT * FROM eval_tasks WHERE datasetId = ? ORDER BY id").all(datasetId) as Row[]).map(parseTask);
  }

  createEvalRun(input: {
    datasetId: string;
    targetType: string;
    targetId: string;
    baselineTargetId?: string | null;
    mode?: string;
  }): EvalRunRecord {
    const now = new Date().toISOString();
    const id = createId("eval_run");
    this.database.db
      .prepare(
        `INSERT INTO eval_runs (id, datasetId, targetType, targetId, baselineTargetId, status, mode, startedAt, completedAt, summaryJson, metricsJson, reportJson, createdAt, updatedAt)
         VALUES (@id, @datasetId, @targetType, @targetId, @baselineTargetId, 'queued', @mode, NULL, NULL, NULL, NULL, NULL, @createdAt, @updatedAt)`
      )
      .run({
        id,
        datasetId: input.datasetId,
        targetType: input.targetType,
        targetId: input.targetId,
        baselineTargetId: input.baselineTargetId ?? null,
        mode: input.mode ?? "offline",
        createdAt: now,
        updatedAt: now
      });
    return this.getEvalRun(id)!;
  }

  updateEvalRun(evalRunId: string, update: Partial<Pick<EvalRunRecord, "status" | "startedAt" | "completedAt" | "summary" | "metrics" | "report">>): EvalRunRecord {
    const current = this.getEvalRun(evalRunId);
    if (!current) {
      throw new Error(`Evaluation run not found: ${evalRunId}`);
    }
    const next = { ...current, ...update, updatedAt: new Date().toISOString() };
    this.database.db
      .prepare(
        `UPDATE eval_runs
         SET status = @status,
             startedAt = @startedAt,
             completedAt = @completedAt,
             summaryJson = @summaryJson,
             metricsJson = @metricsJson,
             reportJson = @reportJson,
             updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: evalRunId,
        status: next.status,
        startedAt: next.startedAt,
        completedAt: next.completedAt,
        summaryJson: next.summary ? JSON.stringify(next.summary) : null,
        metricsJson: next.metrics ? JSON.stringify(next.metrics) : null,
        reportJson: next.report ? JSON.stringify(next.report) : null,
        updatedAt: next.updatedAt
      });
    return this.getEvalRun(evalRunId)!;
  }

  getEvalRun(evalRunId: string): EvalRunRecord | null {
    const row = this.database.db.prepare("SELECT * FROM eval_runs WHERE id = ?").get(evalRunId) as Row | undefined;
    return row ? parseEvalRun(row) : null;
  }

  listEvalRuns(limit = 50): EvalRunRecord[] {
    return (this.database.db.prepare("SELECT * FROM eval_runs ORDER BY createdAt DESC LIMIT ?").all(limit) as Row[]).map(parseEvalRun);
  }

  createTaskResult(input: {
    evalRunId: string;
    evalTaskId: string;
    status: string;
    score: number;
    metrics: unknown;
    traceId?: string | null;
    runId?: string | null;
    sandboxId?: string | null;
    error?: unknown;
    output?: unknown;
    startedAt?: string | null;
    completedAt?: string | null;
  }): EvalTaskResultRecord {
    const now = new Date().toISOString();
    const id = createId("eval_task_result");
    this.database.db
      .prepare(
        `INSERT INTO eval_task_results (id, evalRunId, evalTaskId, status, score, metricsJson, traceId, runId, sandboxId, errorJson, outputJson, startedAt, completedAt, createdAt, updatedAt)
         VALUES (@id, @evalRunId, @evalTaskId, @status, @score, @metricsJson, @traceId, @runId, @sandboxId, @errorJson, @outputJson, @startedAt, @completedAt, @createdAt, @updatedAt)`
      )
      .run({
        id,
        evalRunId: input.evalRunId,
        evalTaskId: input.evalTaskId,
        status: input.status,
        score: input.score,
        metricsJson: JSON.stringify(input.metrics),
        traceId: input.traceId ?? null,
        runId: input.runId ?? null,
        sandboxId: input.sandboxId ?? null,
        errorJson: input.error ? JSON.stringify(input.error) : null,
        outputJson: input.output ? JSON.stringify(input.output) : null,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        createdAt: now,
        updatedAt: now
      });
    return this.getTaskResult(id)!;
  }

  getTaskResult(id: string): EvalTaskResultRecord | null {
    const row = this.database.db.prepare("SELECT * FROM eval_task_results WHERE id = ?").get(id) as Row | undefined;
    return row ? parseTaskResult(row) : null;
  }

  listTaskResults(evalRunId: string): EvalTaskResultRecord[] {
    return (this.database.db.prepare("SELECT * FROM eval_task_results WHERE evalRunId = ? ORDER BY createdAt").all(evalRunId) as Row[]).map(parseTaskResult);
  }

  saveStaticCheck(variantId: string, result: StaticCheckResult): StaticCheckResult {
    this.database.db
      .prepare("INSERT INTO variant_static_checks (id, variantId, status, checksJson, createdAt) VALUES (@id, @variantId, @status, @checksJson, @createdAt)")
      .run({
        id: createId("variant_check"),
        variantId,
        status: result.status,
        checksJson: JSON.stringify(result.checks),
        createdAt: new Date().toISOString()
      });
    return result;
  }

  latestStaticCheck(variantId: string): StaticCheckResult | null {
    const row = this.database.db
      .prepare("SELECT * FROM variant_static_checks WHERE variantId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(variantId) as Row | undefined;
    return row ? { status: row.status as StaticCheckResult["status"], checks: JSON.parse(String(row.checksJson)) as StaticCheckResult["checks"] } : null;
  }

  createComparison(input: Omit<BenchmarkComparisonRecord, "id" | "createdAt">): BenchmarkComparisonRecord {
    const id = createId("eval_comparison");
    const createdAt = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT INTO benchmark_comparisons (id, datasetId, baselineEvalRunId, candidateEvalRunId, winnerTargetId, status, decisionJson, createdAt)
         VALUES (@id, @datasetId, @baselineEvalRunId, @candidateEvalRunId, @winnerTargetId, @status, @decisionJson, @createdAt)`
      )
      .run({ ...input, id, decisionJson: JSON.stringify(input.decision), createdAt });
    return this.getComparison(id)!;
  }

  getComparison(id: string): BenchmarkComparisonRecord | null {
    const row = this.database.db.prepare("SELECT * FROM benchmark_comparisons WHERE id = ?").get(id) as Row | undefined;
    return row ? parseComparison(row) : null;
  }

  listComparisonsForRun(evalRunId: string): BenchmarkComparisonRecord[] {
    return (
      this.database.db
        .prepare("SELECT * FROM benchmark_comparisons WHERE baselineEvalRunId = ? OR candidateEvalRunId = ? ORDER BY createdAt DESC")
        .all(evalRunId, evalRunId) as Row[]
    ).map(parseComparison);
  }

  createCanary(input: Omit<CanaryStateRecord, "id" | "createdAt" | "updatedAt">): CanaryStateRecord {
    const now = new Date().toISOString();
    const id = createId("canary");
    this.database.db
      .prepare(
        `INSERT INTO canary_states (id, variantId, skillId, status, scopeJson, thresholdsJson, metricsJson, startedAt, completedAt, createdAt, updatedAt)
         VALUES (@id, @variantId, @skillId, @status, @scopeJson, @thresholdsJson, @metricsJson, @startedAt, @completedAt, @createdAt, @updatedAt)`
      )
      .run({
        id,
        variantId: input.variantId,
        skillId: input.skillId,
        status: input.status,
        scopeJson: JSON.stringify(input.scope),
        thresholdsJson: JSON.stringify(input.thresholds),
        metricsJson: input.metrics ? JSON.stringify(input.metrics) : null,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        createdAt: now,
        updatedAt: now
      });
    return this.getCanary(id)!;
  }

  updateCanary(id: string, update: Partial<Pick<CanaryStateRecord, "status" | "metrics" | "startedAt" | "completedAt">>): CanaryStateRecord {
    const current = this.getCanary(id);
    if (!current) {
      throw new Error(`Canary state not found: ${id}`);
    }
    const next = { ...current, ...update, updatedAt: new Date().toISOString() };
    this.database.db
      .prepare(
        `UPDATE canary_states
         SET status = @status, metricsJson = @metricsJson, startedAt = @startedAt, completedAt = @completedAt, updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run({
        id,
        status: next.status,
        metricsJson: next.metrics ? JSON.stringify(next.metrics) : null,
        startedAt: next.startedAt,
        completedAt: next.completedAt,
        updatedAt: next.updatedAt
      });
    return this.getCanary(id)!;
  }

  getCanary(id: string): CanaryStateRecord | null {
    const row = this.database.db.prepare("SELECT * FROM canary_states WHERE id = ?").get(id) as Row | undefined;
    return row ? parseCanary(row) : null;
  }

  getCanaryForVariant(variantId: string): CanaryStateRecord | null {
    const row = this.database.db
      .prepare("SELECT * FROM canary_states WHERE variantId = ? ORDER BY createdAt DESC LIMIT 1")
      .get(variantId) as Row | undefined;
    return row ? parseCanary(row) : null;
  }

  upsertLeaderboard(input: Omit<LeaderboardEntryRecord, "id" | "rank" | "createdAt">): LeaderboardEntryRecord {
    const id = createId("leaderboard");
    const createdAt = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT INTO leaderboard_entries (id, datasetId, targetType, targetId, evalRunId, compositeScore, metricsJson, rank, createdAt)
         VALUES (@id, @datasetId, @targetType, @targetId, @evalRunId, @compositeScore, @metricsJson, NULL, @createdAt)`
      )
      .run({
        id,
        datasetId: input.datasetId,
        targetType: input.targetType,
        targetId: input.targetId,
        evalRunId: input.evalRunId,
        compositeScore: input.compositeScore,
        metricsJson: JSON.stringify(input.metrics),
        createdAt
      });
    this.recomputeLeaderboard(input.datasetId);
    return this.getLeaderboardEntry(id)!;
  }

  listLeaderboard(options: { datasetId?: string; domain?: string; limit?: number }): LeaderboardEntryRecord[] {
    const limit = options.limit ?? 50;
    if (options.datasetId) {
      return (this.database.db.prepare("SELECT * FROM leaderboard_entries WHERE datasetId = ? ORDER BY rank, compositeScore DESC LIMIT ?").all(options.datasetId, limit) as Row[]).map(parseLeaderboard);
    }
    if (options.domain) {
      return (
        this.database.db
          .prepare(
            `SELECT le.*
             FROM leaderboard_entries le
             JOIN eval_datasets d ON d.id = le.datasetId
             WHERE d.domain = ?
             ORDER BY le.compositeScore DESC
             LIMIT ?`
          )
          .all(options.domain, limit) as Row[]
      ).map(parseLeaderboard);
    }
    return (this.database.db.prepare("SELECT * FROM leaderboard_entries ORDER BY compositeScore DESC LIMIT ?").all(limit) as Row[]).map(parseLeaderboard);
  }

  private getLeaderboardEntry(id: string): LeaderboardEntryRecord | null {
    const row = this.database.db.prepare("SELECT * FROM leaderboard_entries WHERE id = ?").get(id) as Row | undefined;
    return row ? parseLeaderboard(row) : null;
  }

  private recomputeLeaderboard(datasetId: string): void {
    const rows = this.database.db
      .prepare("SELECT id FROM leaderboard_entries WHERE datasetId = ? ORDER BY compositeScore DESC, createdAt ASC")
      .all(datasetId) as Array<{ id: string }>;
    const update = this.database.db.prepare("UPDATE leaderboard_entries SET rank = ? WHERE id = ?");
    rows.forEach((row, index) => update.run(index + 1, row.id));
  }
}

function parseDataset(row: Row): EvalDatasetRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    domain: row.domain as EvalDatasetRecord["domain"],
    version: String(row.version),
    description: nullableString(row.description),
    manifest: JSON.parse(String(row.manifestJson)),
    sourcePath: nullableString(row.sourcePath),
    status: row.status as EvalDatasetRecord["status"],
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    archivedAt: nullableString(row.archivedAt)
  };
}

function parseTask(row: Row): EvalTaskRecord {
  return {
    id: String(row.id),
    datasetId: String(row.datasetId),
    name: String(row.name),
    domain: row.domain as EvalTaskRecord["domain"],
    task: JSON.parse(String(row.taskJson)),
    fixturePath: nullableString(row.fixturePath),
    expected: row.expectedJson ? JSON.parse(String(row.expectedJson)) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function parseEvalRun(row: Row): EvalRunRecord {
  return {
    id: String(row.id),
    datasetId: String(row.datasetId),
    targetType: row.targetType as EvalRunRecord["targetType"],
    targetId: String(row.targetId),
    baselineTargetId: nullableString(row.baselineTargetId),
    status: row.status as EvalRunRecord["status"],
    mode: row.mode as EvalRunRecord["mode"],
    startedAt: nullableString(row.startedAt),
    completedAt: nullableString(row.completedAt),
    summary: row.summaryJson ? JSON.parse(String(row.summaryJson)) : null,
    metrics: row.metricsJson ? JSON.parse(String(row.metricsJson)) : null,
    report: row.reportJson ? JSON.parse(String(row.reportJson)) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function parseTaskResult(row: Row): EvalTaskResultRecord {
  return {
    id: String(row.id),
    evalRunId: String(row.evalRunId),
    evalTaskId: String(row.evalTaskId),
    status: row.status as EvalTaskResultRecord["status"],
    score: Number(row.score),
    metrics: JSON.parse(String(row.metricsJson)),
    traceId: nullableString(row.traceId),
    runId: nullableString(row.runId),
    sandboxId: nullableString(row.sandboxId),
    error: row.errorJson ? JSON.parse(String(row.errorJson)) : null,
    output: row.outputJson ? JSON.parse(String(row.outputJson)) : null,
    startedAt: nullableString(row.startedAt),
    completedAt: nullableString(row.completedAt),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

export function parseVariant(row: Row): SkillVariantRecord {
  return {
    id: String(row.id),
    skillId: String(row.skillId),
    baseVersion: String(row.baseVersion),
    variantVersion: nullableString(row.variantVersion),
    state: row.state as SkillVariantRecord["state"],
    name: String(row.name),
    description: nullableString(row.description),
    mutationType: row.mutationType as SkillVariantRecord["mutationType"],
    sourceType: row.sourceType as SkillVariantRecord["sourceType"],
    sourceId: nullableString(row.sourceId),
    patch: JSON.parse(String(row.patchJson)),
    manifest: JSON.parse(String(row.manifestJson)),
    prompts: row.promptsJson ? JSON.parse(String(row.promptsJson)) : null,
    policy: row.policyJson ? JSON.parse(String(row.policyJson)) : null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
    archivedAt: nullableString(row.archivedAt)
  };
}

function parseComparison(row: Row): BenchmarkComparisonRecord {
  return {
    id: String(row.id),
    datasetId: String(row.datasetId),
    baselineEvalRunId: String(row.baselineEvalRunId),
    candidateEvalRunId: String(row.candidateEvalRunId),
    winnerTargetId: nullableString(row.winnerTargetId),
    status: row.status as BenchmarkComparisonRecord["status"],
    decision: JSON.parse(String(row.decisionJson)),
    createdAt: String(row.createdAt)
  };
}

function parseCanary(row: Row): CanaryStateRecord {
  return {
    id: String(row.id),
    variantId: String(row.variantId),
    skillId: String(row.skillId),
    status: row.status as CanaryStateRecord["status"],
    scope: JSON.parse(String(row.scopeJson)),
    thresholds: JSON.parse(String(row.thresholdsJson)),
    metrics: row.metricsJson ? JSON.parse(String(row.metricsJson)) : null,
    startedAt: nullableString(row.startedAt),
    completedAt: nullableString(row.completedAt),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function parseLeaderboard(row: Row): LeaderboardEntryRecord {
  return {
    id: String(row.id),
    datasetId: String(row.datasetId),
    targetType: row.targetType as LeaderboardEntryRecord["targetType"],
    targetId: String(row.targetId),
    evalRunId: String(row.evalRunId),
    compositeScore: Number(row.compositeScore),
    metrics: JSON.parse(String(row.metricsJson)),
    rank: row.rank === null || row.rank === undefined ? null : Number(row.rank),
    createdAt: String(row.createdAt)
  };
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}
