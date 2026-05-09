-- Canonical SQLite schema reference. Runtime migrations in migrations.ts are the source of execution truth.

CREATE TABLE IF NOT EXISTS affordance_gaps (
  id TEXT PRIMARY KEY,
  runId TEXT NOT NULL,
  reflectionId TEXT,
  type TEXT NOT NULL CHECK(type IN (
    'missingTool',
    'missingSkill',
    'missingPermission',
    'missingConnector',
    'incorrectAssumption',
    'environmentError',
    'missingContext'
  )),
  name TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK(severity IN ('low', 'medium', 'high')),
  description TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'wontfix')),
  createdAt TEXT NOT NULL,
  resolvedAt TEXT
);

CREATE TABLE IF NOT EXISTS sandboxes (
  id TEXT PRIMARY KEY,
  sessionId TEXT,
  runId TEXT,
  workspacePath TEXT NOT NULL,
  sandboxPath TEXT NOT NULL,
  backend TEXT NOT NULL DEFAULT 'local',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'promoted', 'rejected', 'destroyed', 'failed')),
  resourceLimits TEXT NOT NULL DEFAULT '{}',
  networkPolicy TEXT NOT NULL DEFAULT 'deny' CHECK(networkPolicy IN ('allow', 'deny', 'custom')),
  diff TEXT NOT NULL DEFAULT '',
  testResults TEXT NOT NULL DEFAULT '[]',
  approvalId TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  promotedAt TEXT,
  destroyedAt TEXT,
  lastError TEXT
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currentVersion TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'archived')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  archivedAt TEXT
);

CREATE TABLE IF NOT EXISTS skill_versions (
  id TEXT PRIMARY KEY,
  skillId TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'approved', 'archived')),
  manifest TEXT NOT NULL,
  prompts TEXT NOT NULL DEFAULT '{}',
  testFixtures TEXT NOT NULL DEFAULT '[]',
  packagePath TEXT,
  evaluation TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  promotedAt TEXT,
  archivedAt TEXT,
  UNIQUE(skillId, version),
  FOREIGN KEY(skillId) REFERENCES skills(id)
);

CREATE TABLE IF NOT EXISTS skill_evaluations (
  id TEXT PRIMARY KEY,
  skillId TEXT NOT NULL,
  version TEXT NOT NULL,
  result TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(skillId) REFERENCES skills(id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('skill', 'task')),
  refId TEXT NOT NULL,
  version TEXT,
  schedule TEXT NOT NULL,
  scheduleKind TEXT NOT NULL DEFAULT 'recurring' CHECK(scheduleKind IN ('recurring', 'oneOff')),
  nextRunAt TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'running', 'completed')),
  lastOutcome TEXT NOT NULL DEFAULT 'never' CHECK(lastOutcome IN ('success', 'failure', 'running', 'never')),
  workspacePath TEXT,
  testCommand TEXT,
  testMode INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  lastRunAt TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_next_run
  ON jobs (status, nextRunAt);

CREATE INDEX IF NOT EXISTS idx_jobs_type_ref
  ON jobs (type, refId);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  jobId TEXT NOT NULL,
  runId TEXT,
  traceId TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('success', 'failure', 'running')),
  startedAt TEXT NOT NULL,
  completedAt TEXT,
  durationMs INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  error TEXT,
  FOREIGN KEY(jobId) REFERENCES jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job_started
  ON job_runs (jobId, startedAt);

CREATE TABLE IF NOT EXISTS eval_datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  manifestJson TEXT NOT NULL,
  sourcePath TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  archivedAt TEXT
);

CREATE TABLE IF NOT EXISTS eval_tasks (
  id TEXT PRIMARY KEY,
  datasetId TEXT NOT NULL,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  taskJson TEXT NOT NULL,
  fixturePath TEXT,
  expectedJson TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (datasetId) REFERENCES eval_datasets(id)
);

CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  datasetId TEXT NOT NULL,
  targetType TEXT NOT NULL CHECK(targetType IN ('skillVersion', 'skillVariant', 'team', 'workflow', 'modelRoute')),
  targetId TEXT NOT NULL,
  baselineTargetId TEXT,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'completed', 'failed', 'canceled')),
  mode TEXT NOT NULL CHECK(mode IN ('offline', 'local', 'byok-disabled')),
  startedAt TEXT,
  completedAt TEXT,
  summaryJson TEXT,
  metricsJson TEXT,
  reportJson TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (datasetId) REFERENCES eval_datasets(id)
);

CREATE TABLE IF NOT EXISTS eval_task_results (
  id TEXT PRIMARY KEY,
  evalRunId TEXT NOT NULL,
  evalTaskId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('passed', 'failed', 'skipped', 'error')),
  score REAL NOT NULL DEFAULT 0,
  metricsJson TEXT NOT NULL,
  traceId TEXT,
  runId TEXT,
  sandboxId TEXT,
  errorJson TEXT,
  outputJson TEXT,
  startedAt TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (evalRunId) REFERENCES eval_runs(id),
  FOREIGN KEY (evalTaskId) REFERENCES eval_tasks(id)
);

CREATE TABLE IF NOT EXISTS skill_variants (
  id TEXT PRIMARY KEY,
  skillId TEXT NOT NULL,
  baseVersion TEXT NOT NULL,
  variantVersion TEXT,
  state TEXT NOT NULL CHECK(state IN ('draft', 'generated', 'sandbox_testing', 'benchmarking', 'canary', 'stable', 'rejected', 'archived')),
  name TEXT NOT NULL,
  description TEXT,
  mutationType TEXT NOT NULL,
  sourceType TEXT NOT NULL CHECK(sourceType IN ('user', 'reflection', 'affordanceGap', 'evalFailure', 'manual')),
  sourceId TEXT,
  patchJson TEXT NOT NULL,
  manifestJson TEXT NOT NULL,
  promptsJson TEXT,
  policyJson TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  archivedAt TEXT
);

CREATE TABLE IF NOT EXISTS variant_static_checks (
  id TEXT PRIMARY KEY,
  variantId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('passed', 'failed')),
  checksJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (variantId) REFERENCES skill_variants(id)
);

CREATE TABLE IF NOT EXISTS benchmark_comparisons (
  id TEXT PRIMARY KEY,
  datasetId TEXT NOT NULL,
  baselineEvalRunId TEXT NOT NULL,
  candidateEvalRunId TEXT NOT NULL,
  winnerTargetId TEXT,
  status TEXT NOT NULL CHECK(status IN ('candidate_won', 'baseline_won', 'tie', 'rejected')),
  decisionJson TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (datasetId) REFERENCES eval_datasets(id)
);

CREATE TABLE IF NOT EXISTS canary_states (
  id TEXT PRIMARY KEY,
  variantId TEXT NOT NULL,
  skillId TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'passed', 'failed', 'promoted', 'rolled_back')),
  scopeJson TEXT NOT NULL,
  thresholdsJson TEXT NOT NULL,
  metricsJson TEXT,
  startedAt TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (variantId) REFERENCES skill_variants(id)
);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id TEXT PRIMARY KEY,
  datasetId TEXT NOT NULL,
  targetType TEXT NOT NULL CHECK(targetType IN ('skillVersion', 'skillVariant', 'team', 'workflow', 'modelRoute')),
  targetId TEXT NOT NULL,
  evalRunId TEXT NOT NULL,
  compositeScore REAL NOT NULL,
  metricsJson TEXT NOT NULL,
  rank INTEGER,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (datasetId) REFERENCES eval_datasets(id),
  FOREIGN KEY (evalRunId) REFERENCES eval_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset_target
  ON eval_runs (datasetId, targetId);

CREATE INDEX IF NOT EXISTS idx_eval_task_results_run_task
  ON eval_task_results (evalRunId, evalTaskId);

CREATE INDEX IF NOT EXISTS idx_skill_variants_skill_state
  ON skill_variants (skillId, state);

CREATE INDEX IF NOT EXISTS idx_canary_states_skill_status
  ON canary_states (skillId, status);

CREATE INDEX IF NOT EXISTS idx_leaderboard_dataset_score
  ON leaderboard_entries (datasetId, compositeScore);
