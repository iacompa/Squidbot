import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.js";

export type StoredEvent = {
  id: string;
  timestamp: string;
  session_id: string;
  type: string;
  data: string;
};

export type EventInput = {
  id: string;
  timestamp: string;
  sessionId: string;
  type: string;
  data: unknown;
};

export type TraceInput = {
  id: string;
  sessionId: string;
  events: unknown;
  createdAt: string;
};

export type StoredTrace = {
  id: string;
  session_id: string;
  events: string;
  created_at: string;
};

export type ReflectionInput = {
  id: string;
  sessionId: string;
  runId: string;
  task: string;
  summary: string;
  outcome: string;
  successFactors: unknown[];
  failureModes: unknown[];
  missingTools: unknown[];
  missingPermissions: unknown[];
  missingContext: unknown[];
  reusablePatterns: unknown[];
  memoryCandidates: unknown[];
  failureTaxonomy?: unknown[];
  affordanceIds?: unknown[];
  createdAt: string;
};

export type StoredReflection = {
  id: string;
  session_id: string;
  run_id: string;
  task: string;
  summary: string;
  outcome: string;
  success_factors: string;
  failure_modes: string;
  missing_tools: string;
  missing_permissions: string;
  missing_context: string;
  reusable_patterns: string;
  memory_candidates: string;
  failure_taxonomy?: string;
  affordance_ids?: string;
  created_at: string;
};

export type ReflectionRecord = {
  id: string;
  sessionId: string;
  runId: string;
  task: string;
  summary: string;
  outcome: string;
  successFactors: unknown[];
  failureModes: unknown[];
  missingTools: unknown[];
  missingPermissions: unknown[];
  missingContext: unknown[];
  reusablePatterns: unknown[];
  memoryCandidates: unknown[];
  failureTaxonomy: unknown[];
  affordanceIds: unknown[];
  createdAt: string;
};

export type MemoryInput = {
  id: string;
  type: string;
  title: string;
  body: string;
  sourceRunId: string;
  sourceReflectionId?: string | null;
  sourceEventId?: string | null;
  confidence: number;
  importance: number;
  createdAt: string;
  approvedAt?: string | null;
  archivedAt?: string | null;
};

export type StoredMemory = {
  id: string;
  type: string;
  title: string;
  body: string;
  source_run_id: string;
  source_reflection_id: string | null;
  source_event_id: string | null;
  confidence: number;
  importance: number;
  created_at: string;
  approved_at: string | null;
  archived_at: string | null;
};

export type MemoryRecord = {
  id: string;
  type: string;
  title: string;
  body: string;
  sourceRunId: string;
  sourceReflectionId: string | null;
  sourceEventId: string | null;
  confidence: number;
  importance: number;
  createdAt: string;
  approvedAt: string | null;
  archivedAt: string | null;
};

export type ConnectorInput = {
  id: string;
  name: string;
  manifest: unknown;
  createdAt: string;
};

export type StoredConnector = {
  id: string;
  name: string;
  manifest: string;
  created_at: string;
};

export type ConnectorRecord = {
  id: string;
  name: string;
  manifest: unknown;
  createdAt: string;
};

export type McpServerRiskLevel = "low" | "medium" | "high" | "critical";

export type StoredMcpServer = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  argsJson: string;
  envJson: string;
  riskLevel: McpServerRiskLevel;
  enabled: number;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type McpServerRecord = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
  riskLevel: McpServerRiskLevel;
  enabled: boolean;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type McpServerInput = Omit<McpServerRecord, "lastConnectedAt" | "lastError"> & {
  lastConnectedAt?: string | null;
  lastError?: string | null;
};

export type StoredModelUsage = {
  id: string;
  provider: string;
  usage_date: string;
  tokens: number;
  cost: number;
  updated_at: string;
};

export type ModelUsageRecord = {
  id: string;
  provider: string;
  usageDate: string;
  tokens: number;
  cost: number;
  updatedAt: string;
};

export type AffordanceGapType =
  | "missingTool"
  | "missingSkill"
  | "missingPermission"
  | "missingConnector"
  | "incorrectAssumption"
  | "environmentError"
  | "missingContext";

export type AffordanceGapSeverity = "low" | "medium" | "high";
export type AffordanceGapStatus = "open" | "resolved" | "wontfix";

export type AffordanceGapInput = {
  id: string;
  runId: string;
  reflectionId?: string | null;
  type: AffordanceGapType;
  name: string;
  severity: AffordanceGapSeverity;
  description: string;
  context?: unknown;
  status?: AffordanceGapStatus;
  createdAt: string;
  resolvedAt?: string | null;
};

export type StoredAffordanceGap = {
  id: string;
  runId: string;
  reflectionId: string | null;
  type: AffordanceGapType;
  name: string;
  severity: AffordanceGapSeverity;
  description: string;
  context: string;
  status: AffordanceGapStatus;
  createdAt: string;
  resolvedAt: string | null;
};

export type AffordanceGapRecord = {
  id: string;
  runId: string;
  reflectionId: string | null;
  type: AffordanceGapType;
  name: string;
  severity: AffordanceGapSeverity;
  description: string;
  context: unknown;
  status: AffordanceGapStatus;
  createdAt: string;
  resolvedAt: string | null;
};

export type SandboxStatus = "active" | "promoted" | "rejected" | "destroyed" | "failed";
export type SandboxNetworkPolicy = "allow" | "deny" | "custom";

export type SandboxInput = {
  id: string;
  sessionId?: string | null;
  runId?: string | null;
  workspacePath: string;
  sandboxPath: string;
  backend?: "local" | string;
  status?: SandboxStatus;
  resourceLimits?: unknown;
  networkPolicy?: SandboxNetworkPolicy;
  diff?: string;
  testResults?: unknown[];
  approvalId?: string | null;
  createdAt: string;
  updatedAt?: string;
  promotedAt?: string | null;
  destroyedAt?: string | null;
  lastError?: string | null;
};

export type SandboxUpdate = Partial<
  Pick<SandboxInput, "status" | "diff" | "testResults" | "approvalId" | "promotedAt" | "destroyedAt" | "lastError">
> & {
  updatedAt?: string;
};

export type StoredSandbox = {
  id: string;
  sessionId: string | null;
  runId: string | null;
  workspacePath: string;
  sandboxPath: string;
  backend: "local" | string;
  status: SandboxStatus;
  resourceLimits: string;
  networkPolicy: SandboxNetworkPolicy;
  diff: string;
  testResults: string;
  approvalId: string | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  destroyedAt: string | null;
  lastError: string | null;
};

export type SandboxRecord = {
  id: string;
  sessionId: string | null;
  runId: string | null;
  workspacePath: string;
  sandboxPath: string;
  backend: "local" | string;
  status: SandboxStatus;
  resourceLimits: unknown;
  networkPolicy: SandboxNetworkPolicy;
  diff: string;
  testResults: unknown[];
  approvalId: string | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  destroyedAt: string | null;
  lastError: string | null;
};

export type JobType = "skill" | "task";
export type JobScheduleKind = "recurring" | "oneOff";
export type JobStatus = "active" | "paused" | "running" | "completed";
export type JobLastOutcome = "success" | "failure" | "running" | "never";

export type JobInput = {
  id: string;
  name: string;
  type: JobType;
  refId: string;
  version?: string | null;
  schedule: string;
  scheduleKind: JobScheduleKind;
  nextRunAt?: string | null;
  status?: JobStatus;
  lastOutcome?: JobLastOutcome;
  workspacePath?: string | null;
  testCommand?: string | null;
  testMode?: boolean;
  createdAt: string;
  updatedAt?: string;
  lastRunAt?: string | null;
};

export type JobUpdate = Partial<
  Pick<JobInput, "name" | "version" | "schedule" | "scheduleKind" | "nextRunAt" | "status" | "lastOutcome" | "workspacePath" | "testCommand" | "testMode" | "lastRunAt">
> & {
  updatedAt?: string;
};

export type StoredJob = {
  id: string;
  name: string;
  type: JobType;
  refId: string;
  version: string | null;
  schedule: string;
  scheduleKind: JobScheduleKind;
  nextRunAt: string | null;
  status: JobStatus;
  lastOutcome: JobLastOutcome;
  workspacePath: string | null;
  testCommand: string | null;
  testMode: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
};

export type JobRecord = {
  id: string;
  name: string;
  type: JobType;
  refId: string;
  version: string | null;
  schedule: string;
  scheduleKind: JobScheduleKind;
  nextRunAt: string | null;
  status: JobStatus;
  lastOutcome: JobLastOutcome;
  workspacePath: string | null;
  testCommand: string | null;
  testMode: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
};

export type JobRunInput = {
  id: string;
  jobId: string;
  runId?: string | null;
  traceId?: string | null;
  outcome: "success" | "failure" | "running";
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number;
  summary?: string | null;
  error?: string | null;
};

export type StoredJobRun = {
  id: string;
  jobId: string;
  runId: string | null;
  traceId: string | null;
  outcome: "success" | "failure" | "running";
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  summary: string | null;
  error: string | null;
};

export type JobRunRecord = {
  id: string;
  jobId: string;
  runId: string | null;
  traceId: string | null;
  outcome: "success" | "failure" | "running";
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  summary: string | null;
  error: string | null;
};

export type BlueprintStatus = "draft" | "pilot" | "stable" | "archived";

export type BlueprintInput = {
  slug: string;
  name: string;
  manifest_json: string;
  status: BlueprintStatus;
  current_version: string;
};

export type StoredBlueprint = {
  id: string;
  slug: string;
  name: string;
  manifest_json: string;
  status: string;
  current_version: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredBlueprintVersion = {
  id: string;
  blueprint_id: string;
  version: string;
  manifest_json: string;
  createdAt: string;
  createdBy: string;
};

export class SquidDatabase {
  readonly db: Database.Database;
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new Database(filePath, { timeout: 5_000 });
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    runMigrations(this.db);
  }

  close(): void {
    this.db.close();
  }

  appendEvent(event: EventInput): void {
    this.db
      .prepare(
        `INSERT INTO events (id, timestamp, session_id, type, data)
         VALUES (@id, @timestamp, @sessionId, @type, @data)`
      )
      .run({
        ...event,
        data: JSON.stringify(event.data)
      });
  }

  listEvents(sessionId?: string): StoredEvent[] {
    if (sessionId) {
      return this.db
        .prepare(
          `SELECT id, timestamp, session_id, type, data
           FROM events
           WHERE session_id = ?
           ORDER BY timestamp ASC`
        )
        .all(sessionId) as StoredEvent[];
    }

    return this.db
      .prepare(
        `SELECT id, timestamp, session_id, type, data
         FROM events
         ORDER BY timestamp ASC`
      )
      .all() as StoredEvent[];
  }

  saveTrace(trace: TraceInput): void {
    this.db
      .prepare(
        `INSERT INTO traces (id, session_id, events, created_at)
         VALUES (@id, @sessionId, @events, @createdAt)`
      )
      .run({
        ...trace,
        events: JSON.stringify(trace.events)
      });
  }

  getLatestTrace(): StoredTrace | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, events, created_at
         FROM traces
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get() as StoredTrace | undefined;

    return row ?? null;
  }

  listTraces(limit = 20, offset = 0): StoredTrace[] {
    return this.db
      .prepare(
        `SELECT id, session_id, events, created_at
         FROM traces
         ORDER BY created_at DESC
         LIMIT ?
         OFFSET ?`
      )
      .all(limit, offset) as StoredTrace[];
  }

  getTraceByRunId(runId: string): StoredTrace | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, events, created_at
         FROM traces
         WHERE json_extract(events, '$.runId') = ?
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(runId) as StoredTrace | undefined;

    return row ?? null;
  }

  getSetting<T = unknown>(key: string): T | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;

    return row ? (JSON.parse(row.value) as T) : null;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (id, key, value)
         VALUES (@id, @key, @value)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run({
        id: `setting_${key}`,
        key,
        value: JSON.stringify(value)
      });
  }

  deleteSetting(key: string): void {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  getAllSettings(): Record<string, unknown> {
    const rows = this.db.prepare("SELECT key, value FROM settings ORDER BY key").all() as Array<{
      key: string;
      value: string;
    }>;

    return Object.fromEntries(rows.map((row) => [row.key, JSON.parse(row.value)]));
  }

  saveReflection(reflection: ReflectionInput): void {
    this.db
      .prepare(
        `INSERT INTO reflections (
          id,
          session_id,
          run_id,
          task,
          summary,
          outcome,
          success_factors,
          failure_modes,
          missing_tools,
          missing_permissions,
          missing_context,
          reusable_patterns,
          memory_candidates,
          failure_taxonomy,
          affordance_ids,
          created_at
        )
        VALUES (
          @id,
          @sessionId,
          @runId,
          @task,
          @summary,
          @outcome,
          @successFactors,
          @failureModes,
          @missingTools,
          @missingPermissions,
          @missingContext,
          @reusablePatterns,
          @memoryCandidates,
          @failureTaxonomy,
          @affordanceIds,
          @createdAt
        )`
      )
      .run({
        ...reflection,
        successFactors: JSON.stringify(reflection.successFactors),
        failureModes: JSON.stringify(reflection.failureModes),
        missingTools: JSON.stringify(reflection.missingTools),
        missingPermissions: JSON.stringify(reflection.missingPermissions),
        missingContext: JSON.stringify(reflection.missingContext),
        reusablePatterns: JSON.stringify(reflection.reusablePatterns),
        memoryCandidates: JSON.stringify(reflection.memoryCandidates),
        failureTaxonomy: JSON.stringify(reflection.failureTaxonomy ?? []),
        affordanceIds: JSON.stringify(reflection.affordanceIds ?? [])
      });
  }

  listReflections(limit = 10): ReflectionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM reflections
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as StoredReflection[];

    return rows.map(parseReflection);
  }

  getReflection(id: string): ReflectionRecord | null {
    const row = this.db.prepare("SELECT * FROM reflections WHERE id = ?").get(id) as StoredReflection | undefined;
    return row ? parseReflection(row) : null;
  }

  updateReflectionMemoryCandidates(reflectionId: string, memoryCandidates: unknown[]): void {
    this.db
      .prepare("UPDATE reflections SET memory_candidates = @memoryCandidates WHERE id = @reflectionId")
      .run({
        reflectionId,
        memoryCandidates: JSON.stringify(memoryCandidates)
      });
  }

  updateReflectionAffordances(reflectionId: string, failureTaxonomy: unknown[], affordanceIds: unknown[]): void {
    this.db
      .prepare(
        `UPDATE reflections
         SET failure_taxonomy = @failureTaxonomy,
             affordance_ids = @affordanceIds
         WHERE id = @reflectionId`
      )
      .run({
        reflectionId,
        failureTaxonomy: JSON.stringify(failureTaxonomy),
        affordanceIds: JSON.stringify(affordanceIds)
      });
  }

  insertAffordanceGap(gap: AffordanceGapInput): AffordanceGapRecord {
    this.db
      .prepare(
        `INSERT INTO affordance_gaps (
          id,
          runId,
          reflectionId,
          type,
          name,
          severity,
          description,
          context,
          status,
          createdAt,
          resolvedAt
        )
        VALUES (
          @id,
          @runId,
          @reflectionId,
          @type,
          @name,
          @severity,
          @description,
          @context,
          @status,
          @createdAt,
          @resolvedAt
        )
        ON CONFLICT(id) DO UPDATE SET
          reflectionId = excluded.reflectionId,
          type = excluded.type,
          name = excluded.name,
          severity = excluded.severity,
          description = excluded.description,
          context = excluded.context,
          status = excluded.status,
          resolvedAt = excluded.resolvedAt`
      )
      .run({
        ...gap,
        reflectionId: gap.reflectionId ?? null,
        context: JSON.stringify(gap.context ?? {}),
        status: gap.status ?? "open",
        resolvedAt: gap.resolvedAt ?? null
      });

    const inserted = this.getAffordanceGap(gap.id);
    if (!inserted) {
      throw new Error(`Affordance gap was not inserted: ${gap.id}`);
    }

    return inserted;
  }

  getAffordanceGap(gapId: string): AffordanceGapRecord | null {
    const row = this.db.prepare("SELECT * FROM affordance_gaps WHERE id = ?").get(gapId) as StoredAffordanceGap | undefined;
    return row ? parseAffordanceGap(row) : null;
  }

  listAffordanceGaps(options: { status?: AffordanceGapStatus | "all"; runId?: string; reflectionId?: string; limit?: number } = {}): AffordanceGapRecord[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {
      limit: options.limit ?? 100
    };

    if (options.status && options.status !== "all") {
      clauses.push("status = @status");
      params.status = options.status;
    } else if (!options.status) {
      clauses.push("status = 'open'");
    }

    if (options.runId) {
      clauses.push("runId = @runId");
      params.runId = options.runId;
    }

    if (options.reflectionId) {
      clauses.push("reflectionId = @reflectionId");
      params.reflectionId = options.reflectionId;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT *
         FROM affordance_gaps
         ${where}
         ORDER BY
           CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           createdAt DESC
         LIMIT @limit`
      )
      .all(params) as StoredAffordanceGap[];

    return rows.map(parseAffordanceGap);
  }

  listAffordanceGapsForReflection(reflectionId: string): AffordanceGapRecord[] {
    return this.listAffordanceGaps({ reflectionId, status: "all", limit: 100 });
  }

  resolveAffordanceGap(gapId: string, status: AffordanceGapStatus = "resolved"): AffordanceGapRecord {
    if (status === "open") {
      throw new Error("Use resolveAffordanceGap only for resolved or wontfix statuses.");
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE affordance_gaps
         SET status = @status,
             resolvedAt = @resolvedAt
         WHERE id = @gapId`
      )
      .run({ gapId, status, resolvedAt: now });

    const gap = this.getAffordanceGap(gapId);
    if (!gap) {
      throw new Error(`Affordance gap not found: ${gapId}`);
    }

    return gap;
  }

  insertSandbox(sandbox: SandboxInput): SandboxRecord {
    const updatedAt = sandbox.updatedAt ?? sandbox.createdAt;
    this.db
      .prepare(
        `INSERT INTO sandboxes (
          id,
          sessionId,
          runId,
          workspacePath,
          sandboxPath,
          backend,
          status,
          resourceLimits,
          networkPolicy,
          diff,
          testResults,
          approvalId,
          createdAt,
          updatedAt,
          promotedAt,
          destroyedAt,
          lastError
        )
        VALUES (
          @id,
          @sessionId,
          @runId,
          @workspacePath,
          @sandboxPath,
          @backend,
          @status,
          @resourceLimits,
          @networkPolicy,
          @diff,
          @testResults,
          @approvalId,
          @createdAt,
          @updatedAt,
          @promotedAt,
          @destroyedAt,
          @lastError
        )
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          diff = excluded.diff,
          testResults = excluded.testResults,
          approvalId = excluded.approvalId,
          updatedAt = excluded.updatedAt,
          promotedAt = excluded.promotedAt,
          destroyedAt = excluded.destroyedAt,
          lastError = excluded.lastError`
      )
      .run({
        ...sandbox,
        sessionId: sandbox.sessionId ?? null,
        runId: sandbox.runId ?? null,
        backend: sandbox.backend ?? "local",
        status: sandbox.status ?? "active",
        resourceLimits: JSON.stringify(sandbox.resourceLimits ?? {}),
        networkPolicy: sandbox.networkPolicy ?? "deny",
        diff: sandbox.diff ?? "",
        testResults: JSON.stringify(sandbox.testResults ?? []),
        approvalId: sandbox.approvalId ?? null,
        updatedAt,
        promotedAt: sandbox.promotedAt ?? null,
        destroyedAt: sandbox.destroyedAt ?? null,
        lastError: sandbox.lastError ?? null
      });

    const inserted = this.getSandbox(sandbox.id);
    if (!inserted) {
      throw new Error(`Sandbox was not inserted: ${sandbox.id}`);
    }
    return inserted;
  }

  updateSandbox(sandboxId: string, update: SandboxUpdate): SandboxRecord {
    const existing = this.getSandbox(sandboxId);
    if (!existing) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const next = {
      ...existing,
      ...update,
      updatedAt: update.updatedAt ?? new Date().toISOString(),
      testResults: update.testResults ?? existing.testResults
    };
    this.db
      .prepare(
        `UPDATE sandboxes
         SET status = @status,
             diff = @diff,
             testResults = @testResults,
             approvalId = @approvalId,
             updatedAt = @updatedAt,
             promotedAt = @promotedAt,
             destroyedAt = @destroyedAt,
             lastError = @lastError
         WHERE id = @id`
      )
      .run({
        id: sandboxId,
        status: next.status,
        diff: next.diff,
        testResults: JSON.stringify(next.testResults ?? []),
        approvalId: next.approvalId ?? null,
        updatedAt: next.updatedAt,
        promotedAt: next.promotedAt ?? null,
        destroyedAt: next.destroyedAt ?? null,
        lastError: next.lastError ?? null
      });

    const updated = this.getSandbox(sandboxId);
    if (!updated) {
      throw new Error(`Sandbox not found after update: ${sandboxId}`);
    }
    return updated;
  }

  appendSandboxTestResult(sandboxId: string, result: unknown): SandboxRecord {
    const existing = this.getSandbox(sandboxId);
    if (!existing) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    this.db
      .prepare(
        `UPDATE sandboxes
         SET testResults = json_insert(
               CASE WHEN json_valid(testResults) THEN testResults ELSE '[]' END,
               '$[#]',
               json(@result)
             ),
             updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: sandboxId,
        result: JSON.stringify(result),
        updatedAt: new Date().toISOString()
      });

    const updated = this.getSandbox(sandboxId);
    if (!updated) {
      throw new Error(`Sandbox not found after appending test result: ${sandboxId}`);
    }
    return updated;
  }

  getSandbox(sandboxId: string): SandboxRecord | null {
    const row = this.db.prepare("SELECT * FROM sandboxes WHERE id = ?").get(sandboxId) as StoredSandbox | undefined;
    return row ? parseSandbox(row) : null;
  }

  listSandboxes(options: { status?: SandboxStatus | "all"; limit?: number } = {}): SandboxRecord[] {
    const params: Record<string, unknown> = {
      limit: options.limit ?? 100
    };
    const where = options.status && options.status !== "all" ? "WHERE status = @status" : "";
    if (options.status && options.status !== "all") {
      params.status = options.status;
    }

    const rows = this.db
      .prepare(
        `SELECT *
         FROM sandboxes
         ${where}
         ORDER BY createdAt DESC
         LIMIT @limit`
      )
      .all(params) as StoredSandbox[];

    return rows.map(parseSandbox);
  }

  insertJob(job: JobInput): JobRecord {
    const updatedAt = job.updatedAt ?? job.createdAt;
    this.db
      .prepare(
        `INSERT INTO jobs (
          id,
          name,
          type,
          refId,
          version,
          schedule,
          scheduleKind,
          nextRunAt,
          status,
          lastOutcome,
          workspacePath,
          testCommand,
          testMode,
          createdAt,
          updatedAt,
          lastRunAt
        )
        VALUES (
          @id,
          @name,
          @type,
          @refId,
          @version,
          @schedule,
          @scheduleKind,
          @nextRunAt,
          @status,
          @lastOutcome,
          @workspacePath,
          @testCommand,
          @testMode,
          @createdAt,
          @updatedAt,
          @lastRunAt
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          refId = excluded.refId,
          version = excluded.version,
          schedule = excluded.schedule,
          scheduleKind = excluded.scheduleKind,
          nextRunAt = excluded.nextRunAt,
          status = excluded.status,
          lastOutcome = excluded.lastOutcome,
          workspacePath = excluded.workspacePath,
          testCommand = excluded.testCommand,
          testMode = excluded.testMode,
          updatedAt = excluded.updatedAt,
          lastRunAt = excluded.lastRunAt`
      )
      .run({
        ...job,
        version: job.version ?? null,
        nextRunAt: job.nextRunAt ?? null,
        status: job.status ?? "active",
        lastOutcome: job.lastOutcome ?? "never",
        workspacePath: job.workspacePath ?? null,
        testCommand: job.testCommand ?? null,
        testMode: job.testMode === true ? 1 : 0,
        updatedAt,
        lastRunAt: job.lastRunAt ?? null
      });

    const inserted = this.getJob(job.id);
    if (!inserted) {
      throw new Error(`Job was not inserted: ${job.id}`);
    }
    return inserted;
  }

  getJob(jobId: string): JobRecord | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as StoredJob | undefined;
    return row ? parseJob(row) : null;
  }

  listJobs(options: { status?: JobStatus | "all"; limit?: number } = {}): JobRecord[] {
    const params: Record<string, unknown> = {
      limit: options.limit ?? 100
    };
    const where = options.status && options.status !== "all" ? "WHERE status = @status" : "";
    if (options.status && options.status !== "all") {
      params.status = options.status;
    }

    const rows = this.db
      .prepare(
        `SELECT *
         FROM jobs
         ${where}
         ORDER BY
           CASE status WHEN 'running' THEN 0 WHEN 'active' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
           COALESCE(nextRunAt, updatedAt) ASC
         LIMIT @limit`
      )
      .all(params) as StoredJob[];

    return rows.map(parseJob);
  }

  listDueJobs(nowIso: string, limit = 10): JobRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM jobs
         WHERE status = 'active'
           AND nextRunAt IS NOT NULL
           AND nextRunAt <= @nowIso
         ORDER BY nextRunAt ASC
         LIMIT @limit`
      )
      .all({ nowIso, limit }) as StoredJob[];

    return rows.map(parseJob);
  }

  claimJobForRun(jobId: string, options: { forced?: boolean } = {}): JobRecord | null {
    const now = new Date().toISOString();
    const result = options.forced
      ? this.db
          .prepare(
            `UPDATE jobs
             SET status = 'running', lastOutcome = 'running', updatedAt = @updatedAt
             WHERE id = @id AND status IN ('active', 'paused', 'completed')`
          )
          .run({ id: jobId, updatedAt: now })
      : this.db
          .prepare(
            `UPDATE jobs
             SET status = 'running', lastOutcome = 'running', updatedAt = @updatedAt
             WHERE id = @id AND status = 'active'`
          )
          .run({ id: jobId, updatedAt: now });
    if (result.changes === 0) {
      return null;
    }
    return this.getJob(jobId);
  }

  updateJob(jobId: string, update: JobUpdate): JobRecord {
    const existing = this.getJob(jobId);
    if (!existing) {
      throw new Error(`Job not found: ${jobId}`);
    }
    const next = {
      ...existing,
      ...update,
      updatedAt: update.updatedAt ?? new Date().toISOString()
    };
    this.db
      .prepare(
        `UPDATE jobs
         SET name = @name,
             version = @version,
             schedule = @schedule,
             scheduleKind = @scheduleKind,
             nextRunAt = @nextRunAt,
             status = @status,
             lastOutcome = @lastOutcome,
             workspacePath = @workspacePath,
             testCommand = @testCommand,
             testMode = @testMode,
             updatedAt = @updatedAt,
             lastRunAt = @lastRunAt
         WHERE id = @id`
      )
      .run({
        ...next,
        id: jobId,
        testMode: next.testMode ? 1 : 0
      });
    const updated = this.getJob(jobId);
    if (!updated) {
      throw new Error(`Job not found after update: ${jobId}`);
    }
    return updated;
  }

  deleteJob(jobId: string): JobRecord {
    const existing = this.getJob(jobId);
    if (!existing) {
      throw new Error(`Job not found: ${jobId}`);
    }
    this.db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
    return existing;
  }

  insertJobRun(run: JobRunInput): JobRunRecord {
    this.db
      .prepare(
        `INSERT INTO job_runs (
          id,
          jobId,
          runId,
          traceId,
          outcome,
          startedAt,
          completedAt,
          durationMs,
          summary,
          error
        )
        VALUES (
          @id,
          @jobId,
          @runId,
          @traceId,
          @outcome,
          @startedAt,
          @completedAt,
          @durationMs,
          @summary,
          @error
        )
        ON CONFLICT(id) DO UPDATE SET
          runId = excluded.runId,
          traceId = excluded.traceId,
          outcome = excluded.outcome,
          completedAt = excluded.completedAt,
          durationMs = excluded.durationMs,
          summary = excluded.summary,
          error = excluded.error`
      )
      .run({
        ...run,
        runId: run.runId ?? null,
        traceId: run.traceId ?? null,
        completedAt: run.completedAt ?? null,
        durationMs: run.durationMs ?? 0,
        summary: run.summary ?? null,
        error: run.error ?? null
      });

    const inserted = this.getJobRun(run.id);
    if (!inserted) {
      throw new Error(`Job run was not inserted: ${run.id}`);
    }
    return inserted;
  }

  getJobRun(runId: string): JobRunRecord | null {
    const row = this.db.prepare("SELECT * FROM job_runs WHERE id = ?").get(runId) as StoredJobRun | undefined;
    return row ? parseJobRun(row) : null;
  }

  listJobRuns(jobId: string, limit = 50): JobRunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM job_runs
         WHERE jobId = ?
         ORDER BY startedAt DESC
         LIMIT ?`
      )
      .all(jobId, limit) as StoredJobRun[];
    return rows.map(parseJobRun);
  }

  insertMemory(memory: MemoryInput): MemoryRecord {
    this.db
      .prepare(
        `INSERT INTO memories (
          id,
          type,
          title,
          body,
          source_run_id,
          source_reflection_id,
          source_event_id,
          confidence,
          importance,
          created_at,
          approved_at,
          archived_at
        )
        VALUES (
          @id,
          @type,
          @title,
          @body,
          @sourceRunId,
          @sourceReflectionId,
          @sourceEventId,
          @confidence,
          @importance,
          @createdAt,
          @approvedAt,
          @archivedAt
        )`
      )
      .run({
        ...memory,
        sourceReflectionId: memory.sourceReflectionId ?? null,
        sourceEventId: memory.sourceEventId ?? null,
        approvedAt: memory.approvedAt ?? null,
        archivedAt: memory.archivedAt ?? null
      });

    const inserted = this.getMemory(memory.id);
    if (!inserted) {
      throw new Error(`Memory was not inserted: ${memory.id}`);
    }

    return inserted;
  }

  listApprovedMemories(limit = 50): MemoryRecord[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM memories
         WHERE approved_at IS NOT NULL
           AND archived_at IS NULL
         ORDER BY approved_at DESC, created_at DESC
         LIMIT ?`
      )
      .all(limit) as StoredMemory[];

    return rows.map(parseMemory);
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.db.prepare("SELECT * FROM memories WHERE id = ?").get(id) as StoredMemory | undefined;
    return row ? parseMemory(row) : null;
  }

  saveConnector(connector: ConnectorInput): ConnectorRecord {
    this.db
      .prepare(
        `INSERT INTO connectors (id, name, manifest, created_at)
         VALUES (@id, @name, @manifest, @createdAt)
         ON CONFLICT(name) DO UPDATE SET
           manifest = excluded.manifest,
           created_at = excluded.created_at`
      )
      .run({
        ...connector,
        manifest: JSON.stringify(connector.manifest)
      });

    const saved = this.getConnector(connector.name);
    if (!saved) {
      throw new Error(`Connector was not saved: ${connector.name}`);
    }

    return saved;
  }

  listConnectors(): ConnectorRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, manifest, created_at
         FROM connectors
         ORDER BY name ASC`
      )
      .all() as StoredConnector[];

    return rows.map(parseConnector);
  }

  getConnector(name: string): ConnectorRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, name, manifest, created_at
         FROM connectors
         WHERE name = ?`
      )
      .get(name) as StoredConnector | undefined;

    return row ? parseConnector(row) : null;
  }

  saveMcpServer(input: McpServerInput): McpServerRecord {
    this.db
      .prepare(
        `INSERT INTO mcp_servers
         (id, name, transport, command, argsJson, envJson, riskLevel, enabled, lastConnectedAt, lastError, createdAt, updatedAt)
         VALUES (@id, @name, @transport, @command, @argsJson, @envJson, @riskLevel, @enabled, @lastConnectedAt, @lastError, @createdAt, @updatedAt)
         ON CONFLICT(name) DO UPDATE SET
           command = excluded.command,
           argsJson = excluded.argsJson,
           envJson = excluded.envJson,
           riskLevel = excluded.riskLevel,
           enabled = excluded.enabled,
           lastConnectedAt = excluded.lastConnectedAt,
           lastError = excluded.lastError,
           updatedAt = excluded.updatedAt`
      )
      .run({
        id: input.id,
        name: input.name,
        transport: input.transport,
        command: input.command,
        argsJson: JSON.stringify(input.args),
        envJson: JSON.stringify(input.env),
        riskLevel: input.riskLevel,
        enabled: input.enabled ? 1 : 0,
        lastConnectedAt: input.lastConnectedAt ?? null,
        lastError: input.lastError ?? null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt
      });

    const saved = this.getMcpServer(input.name);
    if (!saved) {
      throw new Error(`MCP server was not saved: ${input.name}`);
    }
    return saved;
  }

  listMcpServers(): McpServerRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM mcp_servers ORDER BY name ASC")
      .all() as StoredMcpServer[];
    return rows.map(parseMcpServer);
  }

  getMcpServer(name: string): McpServerRecord | null {
    const row = this.db
      .prepare("SELECT * FROM mcp_servers WHERE name = ?")
      .get(name) as StoredMcpServer | undefined;
    return row ? parseMcpServer(row) : null;
  }

  updateMcpServer(
    name: string,
    updates: Partial<Pick<McpServerInput, "enabled" | "lastConnectedAt" | "lastError" | "command" | "args" | "env" | "riskLevel">>
  ): void {
    const existing = this.getMcpServer(name);
    if (!existing) {
      throw new Error(`MCP server not found: ${name}`);
    }
    this.saveMcpServer({
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString()
    });
  }

  deleteMcpServer(name: string): void {
    this.db.prepare("DELETE FROM mcp_servers WHERE name = ?").run(name);
  }

  getModelUsage(provider: string, usageDate: string): ModelUsageRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, provider, usage_date, tokens, cost, updated_at
         FROM model_usage
         WHERE provider = ?
           AND usage_date = ?`
      )
      .get(provider, usageDate) as StoredModelUsage | undefined;

    return row ? parseModelUsage(row) : null;
  }

  addModelUsage(provider: string, usageDate: string, tokens: number, cost: number): ModelUsageRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO model_usage (id, provider, usage_date, tokens, cost, updated_at)
         VALUES (@id, @provider, @usageDate, @tokens, @cost, @updatedAt)
         ON CONFLICT(provider, usage_date) DO UPDATE SET
           tokens = model_usage.tokens + excluded.tokens,
           cost = model_usage.cost + excluded.cost,
           updated_at = excluded.updated_at`
      )
      .run({
        id: `model_usage_${provider}_${usageDate}`,
        provider,
        usageDate,
        tokens,
        cost,
        updatedAt: now
      });

    const usage = this.getModelUsage(provider, usageDate);
    if (!usage) {
      throw new Error(`Model usage was not recorded: ${provider} ${usageDate}`);
    }

    return usage;
  }

  listModelUsage(limit = 30): ModelUsageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, provider, usage_date, tokens, cost, updated_at
         FROM model_usage
         ORDER BY usage_date DESC, provider ASC
         LIMIT ?`
      )
      .all(limit) as StoredModelUsage[];

    return rows.map(parseModelUsage);
  }

  // === Blueprints ===
  // AI Studio v1 — Phase 2 of vs-openclaw-hermes roadmap.
  // saveBlueprint() upserts the identity row and appends a version atomically.
  // Callers may invoke saveBlueprint repeatedly with the same current_version
  // to persist edits without bumping the manifest's semver — the UNIQUE
  // constraint on (blueprint_id, version) in blueprint_versions is swallowed
  // silently in that case.

  saveBlueprint(input: BlueprintInput, actor: string): string {
    const existing = this.db
      .prepare("SELECT id, createdAt FROM blueprints WHERE slug = ?")
      .get(input.slug) as { id: string; createdAt: string } | undefined;

    const id = existing?.id ?? randomUUID();
    const now = new Date().toISOString();
    const createdAt = existing?.createdAt ?? now;

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO blueprints (id, slug, name, manifest_json, status, current_version, createdAt, updatedAt)
           VALUES (@id, @slug, @name, @manifest_json, @status, @current_version, @createdAt, @updatedAt)
           ON CONFLICT(slug) DO UPDATE SET
             name = excluded.name,
             manifest_json = excluded.manifest_json,
             status = excluded.status,
             current_version = excluded.current_version,
             updatedAt = excluded.updatedAt`
        )
        .run({
          id,
          slug: input.slug,
          name: input.name,
          manifest_json: input.manifest_json,
          status: input.status,
          current_version: input.current_version,
          createdAt,
          updatedAt: now
        });

      try {
        // Always append a version row. If the caller saved without bumping
        // current_version, UNIQUE (blueprint_id, version) will throw — we
        // swallow that specific error so "save without bumping version" works.
        this.db
          .prepare(
            `INSERT INTO blueprint_versions (id, blueprint_id, version, manifest_json, createdAt, createdBy)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(randomUUID(), id, input.current_version, input.manifest_json, now, actor);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // SQLITE_CONSTRAINT_UNIQUE — same (blueprint_id, version) already saved.
        if (!/UNIQUE/i.test(message)) {
          throw error;
        }
      }
    });
    tx();
    return id;
  }

  getBlueprint(slug: string): StoredBlueprint | null {
    const row = this.db
      .prepare("SELECT * FROM blueprints WHERE slug = ?")
      .get(slug) as StoredBlueprint | undefined;
    return row ?? null;
  }

  getBlueprintById(id: string): StoredBlueprint | null {
    const row = this.db
      .prepare("SELECT * FROM blueprints WHERE id = ?")
      .get(id) as StoredBlueprint | undefined;
    return row ?? null;
  }

  listBlueprints(): StoredBlueprint[] {
    // rowid is a deterministic tiebreaker when two rows share createdAt (ms precision).
    return this.db
      .prepare("SELECT * FROM blueprints ORDER BY createdAt DESC, rowid DESC")
      .all() as StoredBlueprint[];
  }

  deleteBlueprint(id: string): void {
    this.db.prepare("DELETE FROM blueprints WHERE id = ?").run(id);
  }

  listBlueprintVersions(blueprintId: string): StoredBlueprintVersion[] {
    return this.db
      .prepare(
        `SELECT * FROM blueprint_versions
         WHERE blueprint_id = ?
         ORDER BY createdAt ASC`
      )
      .all(blueprintId) as StoredBlueprintVersion[];
  }
}

export function initializeDatabase(filePath: string): SquidDatabase {
  return new SquidDatabase(filePath);
}

function parseJsonArray(value: string): unknown[] {
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

function parseReflection(row: StoredReflection): ReflectionRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    task: row.task,
    summary: row.summary,
    outcome: row.outcome,
    successFactors: parseJsonArray(row.success_factors),
    failureModes: parseJsonArray(row.failure_modes),
    missingTools: parseJsonArray(row.missing_tools),
    missingPermissions: parseJsonArray(row.missing_permissions),
    missingContext: parseJsonArray(row.missing_context),
    reusablePatterns: parseJsonArray(row.reusable_patterns),
    memoryCandidates: parseJsonArray(row.memory_candidates),
    failureTaxonomy: parseJsonArray(row.failure_taxonomy ?? "[]"),
    affordanceIds: parseJsonArray(row.affordance_ids ?? "[]"),
    createdAt: row.created_at
  };
}

function parseMemory(row: StoredMemory): MemoryRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    sourceRunId: row.source_run_id,
    sourceReflectionId: row.source_reflection_id,
    sourceEventId: row.source_event_id,
    confidence: row.confidence,
    importance: row.importance,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    archivedAt: row.archived_at
  };
}

function parseConnector(row: StoredConnector): ConnectorRecord {
  return {
    id: row.id,
    name: row.name,
    manifest: JSON.parse(row.manifest) as unknown,
    createdAt: row.created_at
  };
}

function parseMcpServer(row: StoredMcpServer): McpServerRecord {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: JSON.parse(row.argsJson) as string[],
    env: JSON.parse(row.envJson) as Record<string, string>,
    riskLevel: row.riskLevel,
    enabled: row.enabled === 1,
    lastConnectedAt: row.lastConnectedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parseModelUsage(row: StoredModelUsage): ModelUsageRecord {
  return {
    id: row.id,
    provider: row.provider,
    usageDate: row.usage_date,
    tokens: row.tokens,
    cost: row.cost,
    updatedAt: row.updated_at
  };
}

function parseAffordanceGap(row: StoredAffordanceGap): AffordanceGapRecord {
  return {
    id: row.id,
    runId: row.runId,
    reflectionId: row.reflectionId,
    type: row.type,
    name: row.name,
    severity: row.severity,
    description: row.description,
    context: JSON.parse(row.context) as unknown,
    status: row.status,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt
  };
}

function parseSandbox(row: StoredSandbox): SandboxRecord {
  const parsedTestResults = JSON.parse(row.testResults) as unknown;
  return {
    id: row.id,
    sessionId: row.sessionId,
    runId: row.runId,
    workspacePath: row.workspacePath,
    sandboxPath: row.sandboxPath,
    backend: row.backend,
    status: row.status,
    resourceLimits: JSON.parse(row.resourceLimits) as unknown,
    networkPolicy: row.networkPolicy,
    diff: row.diff,
    testResults: Array.isArray(parsedTestResults) ? parsedTestResults : [],
    approvalId: row.approvalId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    promotedAt: row.promotedAt,
    destroyedAt: row.destroyedAt,
    lastError: row.lastError
  };
}

function parseJob(row: StoredJob): JobRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    refId: row.refId,
    version: row.version,
    schedule: row.schedule,
    scheduleKind: row.scheduleKind,
    nextRunAt: row.nextRunAt,
    status: row.status,
    lastOutcome: row.lastOutcome,
    workspacePath: row.workspacePath,
    testCommand: row.testCommand,
    testMode: row.testMode === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastRunAt: row.lastRunAt
  };
}

function parseJobRun(row: StoredJobRun): JobRunRecord {
  return {
    id: row.id,
    jobId: row.jobId,
    runId: row.runId,
    traceId: row.traceId,
    outcome: row.outcome,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    durationMs: row.durationMs,
    summary: row.summary,
    error: row.error
  };
}
