import { ConnectorRegistry, installDeveloperWorkflowConnectors, registerConnectorTools } from "@squidbot/connectors";
import type { JobRecord, JobRunRecord, JobScheduleKind, JobStatus, JobType, SquidDatabase } from "@squidbot/db";
import {
  AgentRuntime,
  buildTrace,
  createId,
  type AgentEvent,
  type JsonObject,
  registerTerminalTools,
  registerTestTools,
  registerWorkspaceTools,
  ToolRegistry
} from "@squidbot/core";
import { installDeveloperWorkflowSkills, normalizeSkillId, SkillService } from "@squidbot/skills";

export type ParsedSchedule = {
  input: string;
  normalized: string;
  kind: JobScheduleKind;
  nextRunAt: string | null;
};

export type CreateJobRequest = {
  id?: string;
  name: string;
  type: JobType;
  refId: string;
  version?: string | null;
  schedule: string;
  workspacePath?: string | null;
  testCommand?: string | null;
  testMode?: boolean;
  now?: Date;
};

export type SchedulerOptions = {
  skillsRoot?: string;
  workspacePath?: string | null;
  now?: () => Date;
  maxConcurrentJobs?: number;
};

export type JobDetail = {
  job: JobRecord;
  runs: JobRunRecord[];
  schedule: ParsedSchedule;
};

export type JobExecutionResult = {
  job: JobRecord;
  run: JobRunRecord;
};

type CronSchedule = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
};

const dayNames = new Map([
  ["sun", 0],
  ["sunday", 0],
  ["mon", 1],
  ["monday", 1],
  ["tue", 2],
  ["tues", 2],
  ["tuesday", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["thu", 4],
  ["thur", 4],
  ["thurs", 4],
  ["thursday", 4],
  ["fri", 5],
  ["friday", 5],
  ["sat", 6],
  ["saturday", 6]
]);

const monthNames = new Map([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12]
]);

export class Scheduler {
  private readonly database: SquidDatabase;
  private readonly skillsRoot?: string;
  private readonly workspacePath: string | null;
  private readonly now: () => Date;
  private readonly maxConcurrentJobs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(database: SquidDatabase, options: SchedulerOptions = {}) {
    this.database = database;
    this.skillsRoot = options.skillsRoot;
    this.workspacePath = options.workspacePath ?? null;
    this.now = options.now ?? (() => new Date());
    this.maxConcurrentJobs = Math.max(1, Math.floor(options.maxConcurrentJobs ?? 1));
  }

  createJob(request: CreateJobRequest): JobRecord {
    const now = request.now ?? this.now();
    const parsed = parseSchedule(request.schedule, now);
    const name = request.name.trim();
    if (!name) {
      throw new Error("Job name is required.");
    }
    if (request.type !== "skill" && request.type !== "task") {
      throw new Error("Job type must be skill or task.");
    }
    const refId = request.type === "skill" ? this.resolveSkillRefId(request.refId, request.version ?? undefined) : this.resolveTaskRefId(request.refId);
    const createdAt = now.toISOString();
    const job = this.database.insertJob({
      id: request.id ?? createId("job"),
      name,
      type: request.type,
      refId,
      version: request.version ?? null,
      schedule: request.schedule,
      scheduleKind: parsed.kind,
      nextRunAt: parsed.nextRunAt,
      status: parsed.nextRunAt ? "active" : "completed",
      lastOutcome: "never",
      workspacePath: request.workspacePath ?? null,
      testCommand: request.testCommand ?? null,
      testMode: request.testMode === true,
      createdAt,
      updatedAt: createdAt
    });
    this.appendSchedulerEvent("job.created", {
      runId: `run_${job.id}`,
      jobId: job.id,
      name: job.name,
      type: job.type,
      refId: job.refId,
      version: job.version,
      schedule: job.schedule,
      scheduleKind: job.scheduleKind,
      nextRunAt: job.nextRunAt
    });
    return job;
  }

  listJobs(options: { status?: JobStatus | "all"; limit?: number } = {}): JobRecord[] {
    return this.database.listJobs(options);
  }

  getJob(jobId: string): JobRecord | null {
    return this.database.getJob(jobId);
  }

  showJob(jobId: string): JobDetail {
    const job = this.requireJob(jobId);
    return {
      job,
      runs: this.database.listJobRuns(job.id),
      schedule: {
        ...parseSchedule(job.schedule, this.now()),
        kind: job.scheduleKind,
        nextRunAt: job.nextRunAt
      }
    };
  }

  pauseJob(jobId: string): JobRecord {
    const job = this.database.updateJob(jobId, { status: "paused" });
    this.appendSchedulerEvent("job.paused", {
      runId: `run_${job.id}`,
      jobId: job.id
    });
    return job;
  }

  resumeJob(jobId: string): JobRecord {
    const job = this.requireJob(jobId);
    if (job.status === "completed" && job.scheduleKind === "oneOff") {
      throw new Error(`One-off job is already completed: ${job.id}`);
    }
    const parsed = parseSchedule(job.schedule, this.now());
    const updated = this.database.updateJob(job.id, {
      status: parsed.nextRunAt ? "active" : "completed",
      nextRunAt: parsed.nextRunAt,
      scheduleKind: parsed.kind
    });
    this.appendSchedulerEvent("job.resumed", {
      runId: `run_${job.id}`,
      jobId: job.id,
      nextRunAt: updated.nextRunAt
    });
    return updated;
  }

  removeJob(jobId: string): JobRecord {
    const job = this.database.deleteJob(jobId);
    this.appendSchedulerEvent("job.removed", {
      runId: `run_${job.id}`,
      jobId: job.id,
      name: job.name
    });
    return job;
  }

  async runNow(jobId: string): Promise<JobExecutionResult> {
    const job = this.requireJob(jobId);
    return this.executeJob(job, { forced: true });
  }

  async runDueJobs(now = this.now()): Promise<JobExecutionResult[]> {
    const dueJobs = this.database.listDueJobs(now.toISOString(), this.maxConcurrentJobs);
    const results: JobExecutionResult[] = [];
    for (const job of dueJobs) {
      results.push(await this.executeJob(job, { forced: false, scheduledTime: job.nextRunAt ?? now.toISOString() }));
    }
    return results;
  }

  start(intervalMs = 60_000): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.runDueJobs().catch((error: unknown) => {
        this.appendSchedulerEvent("error", {
          runId: "run_scheduler",
          message: error instanceof Error ? error.message : "Scheduler tick failed."
        });
      });
    }, Math.max(1000, intervalMs));
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async executeJob(job: JobRecord, options: { forced: boolean; scheduledTime?: string }): Promise<JobExecutionResult> {
    const startedAt = this.now();
    const startedStatus = job.status;
    const jobRunId = createId("job_run");
    this.database.updateJob(job.id, {
      status: "running",
      lastOutcome: "running"
    });

    try {
      const result = await this.runJobPayload(job, startedAt, options.scheduledTime ?? startedAt.toISOString());
      const success = result.toolResults.every((toolResult) => toolResult.ok) && !result.finalSummary.includes("Failed tool calls:");
      const completedAt = this.now();
      const next = this.nextJobState(job, completedAt, startedStatus, options.forced);
      const updatedJob = this.database.updateJob(job.id, {
        status: next.status,
        lastOutcome: success ? "success" : "failure",
        nextRunAt: next.nextRunAt,
        lastRunAt: completedAt.toISOString()
      });
      const run = this.database.insertJobRun({
        id: jobRunId,
        jobId: job.id,
        runId: result.runId,
        traceId: result.trace.id,
        outcome: success ? "success" : "failure",
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        summary: result.finalSummary,
        error: success ? null : result.finalSummary
      });
      this.appendRunEvent(result.sessionId, result.runId, success ? "job.completed" : "job.failed", {
        jobId: job.id,
        jobRunId,
        outcome: success ? "success" : "failure",
        durationMs: run.durationMs,
        nextRunAt: updatedJob.nextRunAt,
        summary: result.finalSummary
      });
      return { job: updatedJob, run };
    } catch (error) {
      const completedAt = this.now();
      const message = error instanceof Error ? error.message : "Job failed.";
      const runId = createId("run");
      const sessionId = `session_job_${job.id}`;
      const next = this.nextJobState(job, completedAt, startedStatus, options.forced);
      const updatedJob = this.database.updateJob(job.id, {
        status: next.status,
        lastOutcome: "failure",
        nextRunAt: next.nextRunAt,
        lastRunAt: completedAt.toISOString()
      });
      this.appendRunEvent(sessionId, runId, "job.run", {
        jobId: job.id,
        type: job.type,
        refId: job.refId,
        version: job.version,
        schedule: job.schedule,
        scheduledTime: options.scheduledTime ?? startedAt.toISOString(),
        forced: options.forced
      });
      this.appendRunEvent(sessionId, runId, "job.failed", {
        jobId: job.id,
        jobRunId,
        outcome: "failure",
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        nextRunAt: updatedJob.nextRunAt,
        error: message
      });
      const trace = this.refreshTraceForSession(sessionId);
      const run = this.database.insertJobRun({
        id: jobRunId,
        jobId: job.id,
        runId,
        traceId: trace?.id ?? null,
        outcome: "failure",
        startedAt: startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        durationMs: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        summary: null,
        error: message
      });
      return { job: updatedJob, run };
    }
  }

  private async runJobPayload(job: JobRecord, startedAt: Date, scheduledTime: string) {
    const sessionId = `session_job_${job.id}_${startedAt.getTime().toString(36)}`;
    if (job.type === "skill") {
      const service = this.createSkillService();
      const plan = service.prepareRun(job.refId, job.version ?? undefined);
      const workspacePath = job.workspacePath ?? plan.version.testFixtures[0]?.repoPath ?? this.workspacePath;
      if (!workspacePath) {
        throw new Error(`Job requires a workspace path: ${job.id}`);
      }
      const runtime = this.createRuntime(workspacePath, sessionId);
      const result = await runtime.runTask(plan.task, {
        testCommand: job.testCommand ?? plan.testCommand,
        skillCall: {
          skillId: job.refId,
          version: plan.version.version,
          testMode: job.testMode
        },
        job: {
          jobId: job.id,
          name: job.name,
          type: job.type,
          refId: job.refId,
          version: plan.version.version,
          schedule: job.schedule,
          scheduledTime
        }
      });
      service.appendSkillRunEvent({
        runId: result.runId,
        skillId: job.refId,
        version: plan.version.version,
        workspacePath,
        testMode: job.testMode,
        traceId: result.trace.id,
        jobId: job.id
      });
      return result;
    }

    const workspacePath = job.workspacePath ?? this.workspacePath;
    if (!workspacePath) {
      throw new Error(`Job requires a workspace path: ${job.id}`);
    }
    const runtime = this.createRuntime(workspacePath, sessionId);
    return runtime.runTask(job.refId, {
      testCommand: job.testCommand ?? undefined,
      job: {
        jobId: job.id,
        name: job.name,
        type: job.type,
        refId: job.refId,
        schedule: job.schedule,
        scheduledTime
      }
    });
  }

  private nextJobState(job: JobRecord, from: Date, startedStatus: JobStatus, forced: boolean): { status: JobStatus; nextRunAt: string | null } {
    if (job.scheduleKind === "oneOff") {
      return {
        status: forced && startedStatus === "paused" ? "paused" : "completed",
        nextRunAt: null
      };
    }
    const nextRunAt = parseSchedule(job.schedule, from).nextRunAt;
    return {
      status: forced && startedStatus === "paused" ? "paused" : "active",
      nextRunAt
    };
  }

  private createRuntime(workspacePath: string, sessionId: string): AgentRuntime {
    const toolRegistry = new ToolRegistry();
    registerWorkspaceTools(toolRegistry);
    registerTerminalTools(toolRegistry);
    registerTestTools(toolRegistry);
    const connectorRegistry = new ConnectorRegistry(this.database);
    installDeveloperWorkflowConnectors(connectorRegistry);
    registerConnectorTools(toolRegistry, connectorRegistry);
    return new AgentRuntime({ database: this.database, workspacePath, sessionId, toolRegistry });
  }

  private createSkillService(): SkillService {
    const service = new SkillService(this.database, {
      skillsRoot: this.skillsRoot,
      sessionId: "session_scheduler_skills"
    });
    installDeveloperWorkflowSkills(service);
    return service;
  }

  private resolveTaskRefId(refId: string): string {
    const trimmed = refId.trim();
    if (!trimmed) {
      throw new Error("Task string is required.");
    }
    return trimmed;
  }

  private resolveSkillRefId(refId: string, version?: string | null): string {
    const trimmed = refId.trim();
    if (!trimmed) {
      throw new Error("Skill ID is required.");
    }
    const service = this.createSkillService();
    let skillId: string | null = service.getSkill(trimmed) ? trimmed : null;
    const normalized = normalizeSkillId(trimmed);
    if (!skillId && service.getSkill(normalized)) {
      skillId = normalized;
    }
    if (!skillId) {
      throw new Error(`Skill not found: ${trimmed}`);
    }
    if (version && !service.getVersion(skillId, version)) {
      throw new Error(`Skill version not found: ${skillId}@${version}`);
    }
    return skillId;
  }

  private requireJob(jobId: string): JobRecord {
    const job = this.database.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return job;
  }

  private appendSchedulerEvent(type: AgentEvent["type"], data: JsonObject): void {
    this.database.appendEvent({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId: "session_scheduler",
      type,
      data
    });
    this.refreshTraceForSession("session_scheduler");
  }

  private appendRunEvent(sessionId: string, runId: string, type: AgentEvent["type"], data: JsonObject): void {
    this.database.appendEvent({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId,
      type,
      data: {
        runId,
        ...data
      }
    });
    this.refreshTraceForSession(sessionId);
  }

  private refreshTraceForSession(sessionId: string) {
    const events = this.database.listEvents(sessionId).map((event) => {
      const data = JSON.parse(event.data) as JsonObject;
      return {
        id: event.id,
        timestamp: event.timestamp,
        sessionId: event.session_id,
        runId: typeof data.runId === "string" ? data.runId : `run_${sessionId}`,
        type: event.type as AgentEvent["type"],
        data
      } satisfies AgentEvent;
    });
    if (events.length === 0) {
      return null;
    }
    const trace = buildTrace(events);
    this.database.saveTrace({
      id: trace.id,
      sessionId,
      events: trace,
      createdAt: trace.createdAt
    });
    return trace;
  }
}

export function parseSchedule(schedule: string, from = new Date()): ParsedSchedule {
  const input = schedule.trim();
  if (!input) {
    throw new Error("Schedule is required.");
  }
  const natural = parseNaturalSchedule(input, from);
  if (natural) {
    return natural;
  }
  const cron = parseCronExpression(input);
  const next = nextCronDate(cron, from);
  return {
    input,
    normalized: input,
    kind: "recurring",
    nextRunAt: next.toISOString()
  };
}

export function computeNextRunAt(schedule: string, from = new Date()): string | null {
  return parseSchedule(schedule, from).nextRunAt;
}

function parseNaturalSchedule(input: string, from: Date): ParsedSchedule | null {
  const lower = input.toLowerCase().replace(/\s+/g, " ").trim();
  const rawDate = parseRawDateSchedule(input, from);
  if (rawDate) {
    return rawDate;
  }

  const oneOff = /^(?:once\s+)?at\s+(.+)$/.exec(lower) ?? /^once at\s+(.+)$/.exec(lower);
  if (oneOff) {
    const date = new Date(oneOff[1]);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Unsupported one-off schedule: ${input}`);
    }
    return {
      input,
      normalized: `at ${date.toISOString()}`,
      kind: "oneOff",
      nextRunAt: date.getTime() > from.getTime() ? date.toISOString() : null
    };
  }

  const inMinutes = /^in\s+(\d+)\s+minutes?$/.exec(lower);
  if (inMinutes) {
    const date = new Date(from.getTime() + Number(inMinutes[1]) * 60_000);
    return {
      input,
      normalized: `at ${date.toISOString()}`,
      kind: "oneOff",
      nextRunAt: date.toISOString()
    };
  }

  if (lower === "every minute") {
    return cronNatural(input, "* * * * *", from);
  }

  const everyMinutes = /^every\s+(\d+)\s+minutes?$/.exec(lower);
  if (everyMinutes) {
    const minutes = Number(everyMinutes[1]);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 59) {
      throw new Error(`Minute interval must be between 1 and 59: ${input}`);
    }
    return cronNatural(input, `*/${minutes} * * * *`, from);
  }

  if (lower === "hourly" || lower === "every hour") {
    return cronNatural(input, "0 * * * *", from);
  }

  const everyHours = /^every\s+(\d+)\s+hours?$/.exec(lower);
  if (everyHours) {
    const hours = Number(everyHours[1]);
    if (!Number.isInteger(hours) || hours < 1 || hours > 23) {
      throw new Error(`Hour interval must be between 1 and 23: ${input}`);
    }
    return cronNatural(input, `0 */${hours} * * *`, from);
  }

  const daily = /^(?:daily|every day)\s+at\s+(.+)$/.exec(lower);
  if (daily) {
    const time = parseClock(daily[1], input);
    return cronNatural(input, `${time.minute} ${time.hour} * * *`, from);
  }

  const weekday = /^every\s+weekday\s+at\s+(.+)$/.exec(lower);
  if (weekday) {
    const time = parseClock(weekday[1], input);
    return cronNatural(input, `${time.minute} ${time.hour} * * 1-5`, from);
  }

  const day = /^(?:every|on)\s+([a-z]+)\s+at\s+(.+)$/.exec(lower);
  if (day) {
    const dayOfWeek = dayNames.get(day[1]);
    if (dayOfWeek === undefined) {
      throw new Error(`Unsupported day of week in schedule: ${input}`);
    }
    const time = parseClock(day[2], input);
    return cronNatural(input, `${time.minute} ${time.hour} * * ${dayOfWeek}`, from);
  }

  if (/^[a-z\s]+$/.test(lower) && lower.includes("every")) {
    throw new Error(`Unsupported natural-language schedule: ${input}`);
  }
  return null;
}

function parseRawDateSchedule(input: string, from: Date): ParsedSchedule | null {
  if (/\s/.test(input.trim()) || /^\d+\s+\d+/.test(input.trim())) {
    return null;
  }
  const dateLike = /^\d{4}-\d{2}-\d{2}(?:[tT]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(input.trim());
  if (!dateLike) {
    return null;
  }
  const date = new Date(input.trim());
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Unsupported one-off schedule: ${input}`);
  }
  return {
    input,
    normalized: `at ${date.toISOString()}`,
    kind: "oneOff",
    nextRunAt: date.getTime() > from.getTime() ? date.toISOString() : null
  };
}

function cronNatural(input: string, cron: string, from: Date): ParsedSchedule {
  return {
    input,
    normalized: cron,
    kind: "recurring",
    nextRunAt: nextCronDate(parseCronExpression(cron), from).toISOString()
  };
}

function parseClock(value: string, original: string): { hour: number; minute: number } {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Unsupported time in schedule: ${original}`);
  }
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridian = match[3];
  if (meridian === "am" && hour === 12) {
    hour = 0;
  } else if (meridian === "pm" && hour < 12) {
    hour += 12;
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error(`Invalid time in schedule: ${original}`);
  }
  return { hour, minute };
}

function parseCronExpression(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: ${expression}`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const parsedDayOfMonth = parseCronField(dayOfMonth, 1, 31);
  const parsedDayOfWeek = parseCronField(dayOfWeek, 0, 7, dayNames, true);
  return {
    minute: parseCronField(minute, 0, 59).values,
    hour: parseCronField(hour, 0, 23).values,
    dayOfMonth: parsedDayOfMonth.values,
    month: parseCronField(month, 1, 12, monthNames).values,
    dayOfWeek: new Set([...parsedDayOfWeek.values].map((value) => (value === 7 ? 0 : value))),
    dayOfMonthRestricted: parsedDayOfMonth.restricted,
    dayOfWeekRestricted: parsedDayOfWeek.restricted
  };
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  names: Map<string, number> = new Map(),
  allowSevenAsSunday = false
): { values: Set<number>; restricted: boolean } {
  const values = new Set<number>();
  const parts = field.split(",");
  for (const rawPart of parts) {
    if (!rawPart) {
      throw new Error(`Invalid cron field: ${field}`);
    }
    const [rangePart, stepPart] = rawPart.split("/");
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) {
      throw new Error(`Invalid cron step: ${rawPart}`);
    }
    const [start, end] = rangeBounds(rangePart, min, max, names, allowSevenAsSunday);
    if (start > end) {
      throw new Error(`Invalid cron range: ${rawPart}`);
    }
    for (let value = start; value <= end; value += step) {
      if (value < min || value > max) {
        throw new Error(`Cron value out of range: ${rawPart}`);
      }
      values.add(value);
    }
  }
  if (values.size === 0) {
    throw new Error(`Invalid cron field: ${field}`);
  }
  return { values, restricted: field !== "*" };
}

function rangeBounds(field: string, min: number, max: number, names: Map<string, number>, allowSevenAsSunday: boolean): [number, number] {
  if (field === "*") {
    return [min, max];
  }
  if (field.includes("-")) {
    const [left, right] = field.split("-");
    return [parseCronAtom(left, min, max, names, allowSevenAsSunday), parseCronAtom(right, min, max, names, allowSevenAsSunday)];
  }
  const value = parseCronAtom(field, min, max, names, allowSevenAsSunday);
  return [value, value];
}

function parseCronAtom(value: string, min: number, max: number, names: Map<string, number>, allowSevenAsSunday: boolean): number {
  const named = names.get(value.toLowerCase());
  const parsed = named ?? Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max || (!allowSevenAsSunday && parsed === 7 && max === 7)) {
    throw new Error(`Cron value out of range: ${value}`);
  }
  return parsed;
}

function nextCronDate(cron: CronSchedule, from: Date): Date {
  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);
  const maxIterations = 60 * 24 * 366 * 5;
  for (let index = 0; index < maxIterations; index += 1) {
    if (matchesCron(cron, candidate)) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  throw new Error("Unable to compute next run within five years.");
}

function matchesCron(cron: CronSchedule, date: Date): boolean {
  if (!cron.minute.has(date.getMinutes()) || !cron.hour.has(date.getHours()) || !cron.month.has(date.getMonth() + 1)) {
    return false;
  }
  const domMatch = cron.dayOfMonth.has(date.getDate());
  const dowMatch = cron.dayOfWeek.has(date.getDay());
  if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) {
    return domMatch || dowMatch;
  }
  return domMatch && dowMatch;
}
