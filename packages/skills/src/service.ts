import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SquidDatabase } from "@squidbot/db";
import { buildTrace, createId, parseStoredTrace, type AgentEvent, type JsonObject, type Trace } from "@squidbot/core";
import { MemoryGraphStore } from "@squidbot/memory";
import { nextMinorVersion, normalizeSkillId, validateSkillManifest, type SkillManifest, type SkillStatus, type SkillTestFixture } from "./manifest.js";
import type { EvaluationResult } from "./types.js";

export type SkillRecord = {
  id: string;
  name: string;
  currentVersion: string;
  status: SkillStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type SkillVersionRecord = {
  id: string;
  skillId: string;
  version: string;
  status: SkillStatus;
  manifest: SkillManifest;
  prompts: Record<string, string>;
  testFixtures: SkillTestFixture[];
  packagePath: string | null;
  evaluation: EvaluationResult | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  archivedAt: string | null;
};

export type SkillEvaluationRecord = {
  id: string;
  skillId: string;
  version: string;
  result: EvaluationResult;
  createdAt: string;
};

export type CreateSkillFromRunRequest = {
  runId: string;
  name: string;
  description: string;
  author?: string;
};

export type SkillRunPlan = {
  skill: SkillRecord;
  version: SkillVersionRecord;
  task: string;
  testCommand?: string;
};

type StoredSkillRow = {
  id: string;
  name: string;
  currentVersion: string;
  status: SkillStatus;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type StoredSkillVersionRow = {
  id: string;
  skillId: string;
  version: string;
  status: SkillStatus;
  manifest: string;
  prompts: string;
  testFixtures: string;
  packagePath: string | null;
  evaluation: string | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  archivedAt: string | null;
};

type StoredSkillEvaluationRow = {
  id: string;
  skillId: string;
  version: string;
  result: string;
  createdAt: string;
};

export class SkillService {
  private readonly database: SquidDatabase;
  private readonly skillsRoot: string;
  private readonly sessionId: string;

  constructor(database: SquidDatabase, options: { skillsRoot?: string; sessionId?: string } = {}) {
    this.database = database;
    this.skillsRoot = options.skillsRoot ?? path.join(path.dirname(database.filePath), "skills");
    this.sessionId = options.sessionId ?? "session_skills";
  }

  createFromRun(request: CreateSkillFromRunRequest): { skill: SkillRecord; version: SkillVersionRecord; trace: Trace | null } {
    const trace = parseStoredTrace(this.database.getTraceByRunId(request.runId));
    if (!trace) {
      throw new Error(`Trace not found for run: ${request.runId}`);
    }

    const now = new Date().toISOString();
    const skillId = uniqueSkillId(this.database, normalizeSkillId(request.name));
    const packagePath = path.join(this.skillsRoot, skillId, "0.1.0");
    const requiredTools = extractRequiredTools(trace);
    const prompts = extractPrompts(trace);
    const task = extractTask(trace);
    const testCommand = extractTestCommand(trace);
    const workspacePath = extractWorkspacePath(trace);
    const sandboxDiff = extractSandboxDiff(this.database, request.runId);
    const fixture: SkillTestFixture = {
      id: "fixture_original_run",
      name: "Original run replay",
      task,
      testCommand,
      repoPath: workspacePath ? path.join(packagePath, "tests", "fixture_original_run", "repo") : undefined,
      expectedDiff: sandboxDiff || undefined
    };

    const manifest = validateSkillManifest({
      id: skillId,
      name: request.name,
      version: "0.1.0",
      description: request.description,
      requiredTools,
      prompts,
      testFixtures: [fixture],
      permissions: Object.fromEntries(requiredTools.map((tool) => [tool, { riskLevel: tool === "test.run" || tool.startsWith("sandbox.") ? "medium" : "low" }])),
      createdAt: now,
      updatedAt: now,
      author: request.author ?? os.userInfo().username,
      tags: inferTags(task)
    });

    writeSkillPackage(packagePath, manifest, prompts, [fixture], workspacePath);
    const version = this.saveVersion(manifest, {
      status: "draft",
      packagePath
    });
    const skill = this.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill was not created: ${skillId}`);
    }
    this.persistSkillMemoryGraph(skill, version, trace);
    this.appendSkillEvent("skill.created", {
      runId: request.runId,
      skillId,
      version: manifest.version,
      name: manifest.name,
      requiredTools,
      packagePath
    });

    return { skill, version, trace };
  }

  saveVersion(
    manifestInput: SkillManifest,
    options: {
      status?: SkillStatus;
      packagePath?: string | null;
      evaluation?: EvaluationResult | null;
    } = {}
  ): SkillVersionRecord {
    const manifest = validateSkillManifest(manifestInput);
    const now = new Date().toISOString();
    const status = options.status ?? "draft";
    const existingSkill = this.getSkill(manifest.id);
    const createdAt = existingSkill?.createdAt ?? manifest.createdAt ?? now;
    this.database.db
      .prepare(
        `INSERT INTO skills (id, name, currentVersion, status, createdAt, updatedAt, archivedAt)
         VALUES (@id, @name, @currentVersion, @status, @createdAt, @updatedAt, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           currentVersion = CASE
             WHEN skills.status = 'archived' THEN excluded.currentVersion
             ELSE skills.currentVersion
           END,
           status = CASE
             WHEN skills.status = 'archived' THEN excluded.status
             ELSE skills.status
           END,
           updatedAt = excluded.updatedAt,
           archivedAt = NULL`
      )
      .run({
        id: manifest.id,
        name: manifest.name,
        currentVersion: manifest.version,
        status,
        createdAt,
        updatedAt: now
      });

    this.database.db
      .prepare(
        `INSERT INTO skill_versions (
          id,
          skillId,
          version,
          status,
          manifest,
          prompts,
          testFixtures,
          packagePath,
          evaluation,
          createdAt,
          updatedAt,
          promotedAt,
          archivedAt
        )
        VALUES (
          @id,
          @skillId,
          @version,
          @status,
          @manifest,
          @prompts,
          @testFixtures,
          @packagePath,
          @evaluation,
          @createdAt,
          @updatedAt,
          @promotedAt,
          @archivedAt
        )
        ON CONFLICT(skillId, version) DO UPDATE SET
          status = excluded.status,
          manifest = excluded.manifest,
          prompts = excluded.prompts,
          testFixtures = excluded.testFixtures,
          packagePath = excluded.packagePath,
          evaluation = excluded.evaluation,
          updatedAt = excluded.updatedAt,
          archivedAt = excluded.archivedAt`
      )
      .run({
        id: skillVersionId(manifest.id, manifest.version),
        skillId: manifest.id,
        version: manifest.version,
        status,
        manifest: JSON.stringify(manifest),
        prompts: JSON.stringify(manifest.prompts),
        testFixtures: JSON.stringify(manifest.testFixtures),
        packagePath: options.packagePath ?? null,
        evaluation: options.evaluation ? JSON.stringify(options.evaluation) : null,
        createdAt: existingVersionCreatedAt(this.database, manifest.id, manifest.version) ?? now,
        updatedAt: now,
        promotedAt: status === "approved" ? now : null,
        archivedAt: status === "archived" ? now : null
      });

    const version = this.getVersion(manifest.id, manifest.version);
    if (!version) {
      throw new Error(`Skill version was not saved: ${manifest.id}@${manifest.version}`);
    }
    return version;
  }

  listSkills(limit = 100): SkillRecord[] {
    const rows = this.database.db
      .prepare(
        `SELECT *
         FROM skills
         ORDER BY
           CASE status WHEN 'approved' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
           updatedAt DESC
         LIMIT ?`
      )
      .all(limit) as StoredSkillRow[];
    return rows.map(parseSkillRow);
  }

  getSkill(skillId: string): SkillRecord | null {
    const row = this.database.db.prepare("SELECT * FROM skills WHERE id = ?").get(skillId) as StoredSkillRow | undefined;
    return row ? parseSkillRow(row) : null;
  }

  listVersions(skillId: string): SkillVersionRecord[] {
    const rows = this.database.db
      .prepare(
        `SELECT *
         FROM skill_versions
         WHERE skillId = ?
         ORDER BY createdAt DESC`
      )
      .all(skillId) as StoredSkillVersionRow[];
    return rows.map(parseSkillVersionRow);
  }

  getVersion(skillId: string, version?: string): SkillVersionRecord | null {
    const targetVersion = version ?? this.getSkill(skillId)?.currentVersion;
    if (!targetVersion) {
      return null;
    }
    const row = this.database.db
      .prepare("SELECT * FROM skill_versions WHERE skillId = ? AND version = ?")
      .get(skillId, targetVersion) as StoredSkillVersionRow | undefined;
    return row ? parseSkillVersionRow(row) : null;
  }

  prepareRun(skillId: string, version?: string): SkillRunPlan {
    const skill = this.getSkill(skillId);
    const skillVersion = this.getVersion(skillId, version);
    if (!skill || !skillVersion) {
      throw new Error(`Skill not found: ${skillId}${version ? `@${version}` : ""}`);
    }
    const fixture = skillVersion.testFixtures[0];
    if (!fixture) {
      throw new Error(`Skill has no runnable fixture: ${skillId}@${skillVersion.version}`);
    }
    return {
      skill,
      version: skillVersion,
      task: fixture.task,
      testCommand: fixture.testCommand
    };
  }

  recordEvaluation(result: EvaluationResult): SkillEvaluationRecord {
    const now = result.createdAt ?? new Date().toISOString();
    const id = result.id ?? createId("skill_eval");
    const normalized = {
      ...result,
      id,
      createdAt: now
    };
    this.database.db
      .prepare(
        `INSERT INTO skill_evaluations (id, skillId, version, result, createdAt)
         VALUES (@id, @skillId, @version, @result, @createdAt)`
      )
      .run({
        id,
        skillId: result.skillId,
        version: result.version,
        result: JSON.stringify(normalized),
        createdAt: now
      });

    this.database.db
      .prepare(
        `UPDATE skill_versions
         SET evaluation = @evaluation,
             updatedAt = @updatedAt
         WHERE skillId = @skillId
           AND version = @version`
      )
      .run({
        skillId: result.skillId,
        version: result.version,
        evaluation: JSON.stringify(normalized),
        updatedAt: now
      });

    this.appendSkillEvent("skill.evaluated", {
      runId: `run_${id}`,
      skillId: result.skillId,
      version: result.version,
      evaluationId: id,
      pass: normalized.pass,
      metrics: normalized.metrics
    });

    const row = this.database.db.prepare("SELECT * FROM skill_evaluations WHERE id = ?").get(id) as StoredSkillEvaluationRow;
    return parseSkillEvaluationRow(row);
  }

  listEvaluations(skillId: string, version?: string): SkillEvaluationRecord[] {
    const rows = version
      ? (this.database.db
          .prepare(
            `SELECT *
             FROM skill_evaluations
             WHERE skillId = ?
               AND version = ?
             ORDER BY createdAt DESC`
          )
          .all(skillId, version) as StoredSkillEvaluationRow[])
      : (this.database.db
          .prepare(
            `SELECT *
             FROM skill_evaluations
             WHERE skillId = ?
             ORDER BY createdAt DESC`
          )
          .all(skillId) as StoredSkillEvaluationRow[]);
    return rows.map(parseSkillEvaluationRow);
  }

  promote(skillId: string, version: string, options: { evaluation?: EvaluationResult; override?: boolean } = {}): SkillVersionRecord {
    const skillVersion = this.getVersion(skillId, version);
    if (!skillVersion) {
      throw new Error(`Skill version not found: ${skillId}@${version}`);
    }
    const evaluation = options.evaluation ?? skillVersion.evaluation;
    if (!options.override && (!evaluation || !evaluation.pass || evaluation.metrics.successRate < 0.8)) {
      throw new Error("Skill promotion blocked: evaluation must pass with success rate >= 80%.");
    }
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        `UPDATE skills
         SET currentVersion = @version,
             status = 'approved',
             updatedAt = @now,
             archivedAt = NULL
         WHERE id = @skillId`
      )
      .run({ skillId, version, now });
    this.database.db
      .prepare(
        `UPDATE skill_versions
         SET status = CASE WHEN version = @version THEN 'approved' ELSE status END,
             promotedAt = CASE WHEN version = @version THEN @now ELSE promotedAt END,
             evaluation = CASE WHEN version = @version AND @evaluation IS NOT NULL THEN @evaluation ELSE evaluation END,
             updatedAt = @now
         WHERE skillId = @skillId`
      )
      .run({
        skillId,
        version,
        now,
        evaluation: evaluation ? JSON.stringify(evaluation) : null
      });
    this.appendSkillEvent("skill.promoted", {
      runId: `run_skill_${skillId}`,
      skillId,
      version,
      evaluationId: evaluation?.id ?? null,
      successRate: evaluation?.metrics.successRate ?? null,
      override: options.override === true
    });
    const promoted = this.getVersion(skillId, version);
    if (!promoted) {
      throw new Error(`Promoted skill version not found: ${skillId}@${version}`);
    }
    return promoted;
  }

  rollback(skillId: string, toVersion: string): SkillRecord {
    const skillVersion = this.getVersion(skillId, toVersion);
    if (!skillVersion || skillVersion.status === "archived") {
      throw new Error(`Rollback target is not available: ${skillId}@${toVersion}`);
    }
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        `UPDATE skills
         SET currentVersion = @version,
             updatedAt = @now,
             archivedAt = NULL
         WHERE id = @skillId`
      )
      .run({ skillId, version: toVersion, now });
    this.appendSkillEvent("skill.rolledBack", {
      runId: `run_skill_${skillId}`,
      skillId,
      version: toVersion
    });
    const skill = this.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill not found after rollback: ${skillId}`);
    }
    return skill;
  }

  archive(skillId: string, version?: string): SkillRecord | SkillVersionRecord {
    const now = new Date().toISOString();
    if (version) {
      this.database.db
        .prepare(
          `UPDATE skill_versions
           SET status = 'archived',
               archivedAt = @now,
               updatedAt = @now
           WHERE skillId = @skillId
             AND version = @version`
        )
        .run({ skillId, version, now });
      this.appendSkillEvent("skill.deleted", {
        runId: `run_skill_${skillId}`,
        skillId,
        version
      });
      const archived = this.getVersion(skillId, version);
      if (!archived) {
        throw new Error(`Skill version not found: ${skillId}@${version}`);
      }
      return archived;
    }

    this.database.db
      .prepare(
        `UPDATE skills
         SET status = 'archived',
             archivedAt = @now,
             updatedAt = @now
         WHERE id = @skillId`
      )
      .run({ skillId, now });
    this.database.db
      .prepare(
        `UPDATE skill_versions
         SET status = 'archived',
             archivedAt = @now,
             updatedAt = @now
         WHERE skillId = @skillId`
      )
      .run({ skillId, now });
    this.appendSkillEvent("skill.deleted", {
      runId: `run_skill_${skillId}`,
      skillId
    });
    const skill = this.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    return skill;
  }

  compare(skillId: string, fromVersion: string, toVersion: string): Record<string, unknown> {
    const from = this.getVersion(skillId, fromVersion);
    const to = this.getVersion(skillId, toVersion);
    if (!from || !to) {
      throw new Error(`Both versions must exist for comparison: ${skillId}@${fromVersion} -> ${toVersion}`);
    }
    return {
      skillId,
      from: fromVersion,
      to: toVersion,
      changes: diffRecords(from.manifest, to.manifest)
    };
  }

  bumpVersion(skillId: string): SkillVersionRecord {
    const current = this.getVersion(skillId);
    if (!current) {
      throw new Error(`Skill not found: ${skillId}`);
    }
    const nextManifest = bumpManifestVersion(current.manifest);
    const packagePath = this.prepareBumpedPackage(current, nextManifest);
    const manifest = packagePath
      ? validateSkillManifest({
          ...nextManifest,
          testFixtures: retargetFixtureRepoPaths(nextManifest.testFixtures, packagePath)
        })
      : nextManifest;
    return this.saveVersion(manifest, {
      status: "draft",
      packagePath
    });
  }

  appendSkillRunEvent(data: JsonObject): void {
    this.appendSkillEvent("skill.run", data);
  }

  private prepareBumpedPackage(current: SkillVersionRecord, nextManifest: SkillManifest): string | null {
    const packagePath = current.packagePath
      ? path.join(path.dirname(current.packagePath), nextManifest.version)
      : path.join(this.skillsRoot, current.skillId, nextManifest.version);

    if (current.packagePath && fs.existsSync(current.packagePath) && path.resolve(current.packagePath) !== path.resolve(packagePath)) {
      fs.rmSync(packagePath, { recursive: true, force: true });
      fs.cpSync(current.packagePath, packagePath, { recursive: true });
    }

    const manifest = validateSkillManifest({
      ...nextManifest,
      testFixtures: retargetFixtureRepoPaths(nextManifest.testFixtures, packagePath)
    });
    writeSkillPackage(packagePath, manifest, manifest.prompts, manifest.testFixtures);
    return packagePath;
  }

  private appendSkillEvent(type: AgentEvent["type"], data: JsonObject): void {
    this.database.appendEvent({
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      type,
      data
    });
    refreshTraceForSession(this.database, this.sessionId);
  }

  private persistSkillMemoryGraph(skill: SkillRecord, version: SkillVersionRecord, trace: Trace): void {
    const store = new MemoryGraphStore(this.database);
    const now = new Date().toISOString();
    const skillNode = store.createNode({
      id: skillGraphNodeId(skill.id),
      type: "skill",
      title: skill.name,
      body: `${version.manifest.description}\n\nCurrent version: ${skill.currentVersion}`,
      confidence: 0.8,
      importance: 0.7,
      createdAt: now
    });
    const taskRunId = trace.runId;
    const taskNode = store.getNode(taskGraphNodeId(taskRunId), { includeArchived: true });
    if (taskNode) {
      store.createEdge({ fromNodeId: skillNode.id, toNodeId: taskNode.id, type: "depends_on" });
    }
    const reflectionId = trace.steps.find((step) => step.type === "reflection.created")?.detail.reflectionId;
    if (typeof reflectionId === "string") {
      const reflectionNode = store.getNode(reflectionGraphNodeId(reflectionId), { includeArchived: true });
      if (reflectionNode) {
        store.createEdge({ fromNodeId: skillNode.id, toNodeId: reflectionNode.id, type: "caused_by" });
      }
    }
  }
}

export function writeSkillPackage(
  packagePath: string,
  manifest: SkillManifest,
  prompts: Record<string, string>,
  fixtures: SkillTestFixture[],
  sourceWorkspacePath?: string
): void {
  fs.mkdirSync(path.join(packagePath, "prompts"), { recursive: true });
  fs.mkdirSync(path.join(packagePath, "tests"), { recursive: true });
  fs.writeFileSync(path.join(packagePath, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  for (const [name, prompt] of Object.entries(prompts)) {
    fs.writeFileSync(path.join(packagePath, "prompts", `${safeFileName(name)}.md`), `${prompt.trim()}\n`, "utf8");
  }
  for (const fixture of fixtures) {
    const fixturePath = path.join(packagePath, "tests", safeFileName(fixture.id));
    fs.mkdirSync(fixturePath, { recursive: true });
    fs.writeFileSync(path.join(fixturePath, "task.txt"), `${fixture.task}\n`, "utf8");
    fs.writeFileSync(path.join(fixturePath, "expected_result.json"), `${JSON.stringify(fixture.expectedResult ?? {}, null, 2)}\n`, "utf8");
    if (fixture.expectedDiff) {
      fs.writeFileSync(path.join(fixturePath, "expected_diff.patch"), fixture.expectedDiff, "utf8");
    }
    if (sourceWorkspacePath && fs.existsSync(sourceWorkspacePath)) {
      copyDirectoryFiltered(sourceWorkspacePath, path.join(fixturePath, "repo"));
      fixture.repoPath = path.join(fixturePath, "repo");
    }
  }
}

export function skillGraphNodeId(skillId: string): string {
  return `memory_node_skill_${safeId(skillId)}`;
}

function parseSkillRow(row: StoredSkillRow): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    currentVersion: row.currentVersion,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt
  };
}

function parseSkillVersionRow(row: StoredSkillVersionRow): SkillVersionRecord {
  return {
    id: row.id,
    skillId: row.skillId,
    version: row.version,
    status: row.status,
    manifest: validateSkillManifest(JSON.parse(row.manifest)),
    prompts: JSON.parse(row.prompts) as Record<string, string>,
    testFixtures: JSON.parse(row.testFixtures) as SkillTestFixture[],
    packagePath: row.packagePath,
    evaluation: row.evaluation ? (JSON.parse(row.evaluation) as EvaluationResult) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    promotedAt: row.promotedAt,
    archivedAt: row.archivedAt
  };
}

function parseSkillEvaluationRow(row: StoredSkillEvaluationRow): SkillEvaluationRecord {
  return {
    id: row.id,
    skillId: row.skillId,
    version: row.version,
    result: JSON.parse(row.result) as EvaluationResult,
    createdAt: row.createdAt
  };
}

function extractRequiredTools(trace: Trace): string[] {
  const tools = new Set<string>();
  for (const step of trace.steps) {
    const toolName = step.detail.toolName;
    if (typeof toolName === "string") {
      tools.add(toolName);
    }
    const plan = step.detail.plan as { actions?: Array<{ toolName?: string }> } | undefined;
    for (const action of plan?.actions ?? []) {
      if (typeof action.toolName === "string") {
        tools.add(action.toolName);
      }
    }
  }
  return [...tools].sort();
}

function extractPrompts(trace: Trace): Record<string, string> {
  const planStep = trace.steps.find((step) => step.type === "plan.generated");
  const responseStep = trace.steps.find((step) => step.type === "model.response");
  const task = extractTask(trace);
  return {
    planningPrompt: `Plan a safe SquidBot run for this task:\n${task}`,
    codingPrompt: planStep ? JSON.stringify(planStep.detail.plan ?? planStep.detail, null, 2) : `Execute the task safely:\n${task}`,
    reviewPrompt: responseStep ? String(responseStep.detail.content ?? "Review tool outputs and produce a concise result.") : "Review tool outputs and produce a concise result."
  };
}

function extractTask(trace: Trace): string {
  const step = trace.steps.find((item) => item.type === "user.task" || item.type === "user.message");
  return String(step?.detail.task ?? step?.detail.content ?? `Replay run ${trace.runId}`);
}

function extractTestCommand(trace: Trace): string | undefined {
  const userTask = trace.steps.find((step) => step.type === "user.task");
  return typeof userTask?.detail.testCommand === "string" && userTask.detail.testCommand ? userTask.detail.testCommand : undefined;
}

function extractWorkspacePath(trace: Trace): string | undefined {
  const session = trace.steps.find((step) => step.type === "session.started");
  return typeof session?.detail.workspacePath === "string" ? session.detail.workspacePath : undefined;
}

function extractSandboxDiff(database: SquidDatabase, runId: string): string {
  return database.listSandboxes({ status: "all", limit: 100 }).find((sandbox) => sandbox.runId === runId && sandbox.diff.trim())?.diff ?? "";
}

function inferTags(task: string): string[] {
  const tags = new Set<string>();
  if (/bug|fix|test/i.test(task)) {
    tags.add("debugging");
  }
  if (/connector|api|sales|petstore/i.test(task)) {
    tags.add("connector");
  }
  return [...tags];
}

function uniqueSkillId(database: SquidDatabase, baseId: string): string {
  let candidate = baseId;
  let suffix = 2;
  while (database.db.prepare("SELECT id FROM skills WHERE id = ?").get(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function existingVersionCreatedAt(database: SquidDatabase, skillId: string, version: string): string | null {
  const row = database.db
    .prepare("SELECT createdAt FROM skill_versions WHERE skillId = ? AND version = ?")
    .get(skillId, version) as { createdAt: string } | undefined;
  return row?.createdAt ?? null;
}

function skillVersionId(skillId: string, version: string): string {
  return `skill_version_${safeId(skillId)}_${safeId(version)}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function taskGraphNodeId(runId: string): string {
  return `memory_node_task_${safeId(runId)}`;
}

function reflectionGraphNodeId(reflectionId: string): string {
  return `memory_node_reflection_${safeId(reflectionId)}`;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_") || "item";
}

function retargetFixtureRepoPaths(fixtures: SkillTestFixture[], packagePath: string): SkillTestFixture[] {
  return fixtures.map((fixture) => ({
    ...fixture,
    repoPath: fixture.repoPath ? path.join(packagePath, "tests", safeFileName(fixture.id), "repo") : undefined
  }));
}

function copyDirectoryFiltered(source: string, destination: string): void {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "out" || entry.name === "dist") {
      continue;
    }
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryFiltered(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function diffRecords(from: unknown, to: unknown): Record<string, unknown> {
  const fromRecord = from && typeof from === "object" ? (from as Record<string, unknown>) : {};
  const toRecord = to && typeof to === "object" ? (to as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(fromRecord), ...Object.keys(toRecord)])].sort();
  const changes: Record<string, unknown> = {};
  for (const key of keys) {
    const left = JSON.stringify(fromRecord[key]);
    const right = JSON.stringify(toRecord[key]);
    if (left !== right) {
      changes[key] = {
        from: fromRecord[key],
        to: toRecord[key]
      };
    }
  }
  return changes;
}

function refreshTraceForSession(database: SquidDatabase, sessionId: string): void {
  const events = database.listEvents(sessionId).map((event) => {
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
    return;
  }
  const trace = buildTrace(events);
  database.saveTrace({
    id: trace.id,
    sessionId,
    events: trace,
    createdAt: trace.createdAt
  });
}

export function bumpManifestVersion(manifest: SkillManifest): SkillManifest {
  const now = new Date().toISOString();
  return {
    ...manifest,
    version: nextMinorVersion(manifest.version),
    updatedAt: now
  };
}
