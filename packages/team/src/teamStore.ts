import type { SquidDatabase } from "@squidbot/db";
import { createId } from "@squidbot/core";
import { validateRoleManifest, validateTeamManifest } from "./roleManifest.js";
import type {
  AgentMessage,
  AgentMessageType,
  AgentRoleManifest,
  AgentRoleRecord,
  BlackboardEntry,
  BlackboardEntryType,
  HumanHandoff,
  TeamConflict,
  TeamConflictStatus,
  TeamConflictType,
  TeamManifest,
  TeamRecord,
  TeamRiskLevel,
  TeamRun,
  TeamRunStatus,
  TeamSensitivity,
  TeamSubtask,
  TeamSubtaskStatus
} from "./types.js";

type RoleRow = {
  id: string;
  name: string;
  description: string;
  manifestJson: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type TeamRow = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  manifestJson: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

type TeamRunRow = {
  id: string;
  teamId: string;
  parentRunId: string | null;
  task: string;
  status: TeamRunStatus;
  coordinatorRoleId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  finalResultJson: string | null;
};

type SubtaskRow = {
  id: string;
  teamRunId: string;
  parentSubtaskId: string | null;
  assignedRoleId: string | null;
  title: string;
  description: string;
  status: TeamSubtaskStatus;
  priority: number;
  riskLevel: TeamRiskLevel;
  requiredCapabilitiesJson: string;
  requiredToolsJson: string;
  dependsOnJson: string;
  resultJson: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

type BlackboardRow = {
  id: string;
  teamRunId: string;
  subtaskId: string | null;
  authorRoleId: string | null;
  type: BlackboardEntryType;
  title: string;
  body: string;
  dataJson: string;
  confidence: number;
  importance: number;
  sensitivity: TeamSensitivity;
  sourceEventId: string | null;
  sourceRunId: string | null;
  sourceMemoryNodeId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type MessageRow = {
  id: string;
  teamRunId: string;
  fromRoleId: string | null;
  toRoleId: string | null;
  messageType: AgentMessageType;
  content: string;
  dataJson: string;
  createdAt: string;
};

type ConflictRow = {
  id: string;
  teamRunId: string;
  type: TeamConflictType;
  severity: TeamRiskLevel;
  status: TeamConflictStatus;
  description: string;
  involvedEntryIdsJson: string;
  involvedRoleIdsJson: string;
  resolutionJson: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type HandoffRow = {
  id: string;
  teamRunId: string;
  subtaskId: string | null;
  requestedByRoleId: string | null;
  reason: string;
  question: string;
  optionsJson: string;
  status: "open" | "answered" | "canceled";
  responseText: string | null;
  responseJson: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

export class TeamStore {
  constructor(readonly database: SquidDatabase) {}

  saveRole(manifestInput: AgentRoleManifest): AgentRoleRecord {
    const manifest = validateRoleManifest(manifestInput);
    const now = new Date().toISOString();
    const createdAt = manifest.createdAt ?? now;
    const updatedAt = manifest.updatedAt ?? now;
    this.database.db
      .prepare(
        `INSERT INTO agent_roles (id, name, description, manifestJson, createdAt, updatedAt, archivedAt)
         VALUES (@id, @name, @description, @manifestJson, @createdAt, @updatedAt, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           manifestJson = excluded.manifestJson,
           updatedAt = excluded.updatedAt,
           archivedAt = NULL`
      )
      .run({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        manifestJson: JSON.stringify({ ...manifest, createdAt, updatedAt }),
        createdAt,
        updatedAt
      });
    const role = this.getRole(manifest.id);
    if (!role) {
      throw new Error(`Role was not saved: ${manifest.id}`);
    }
    return role;
  }

  getRole(roleId: string): AgentRoleRecord | null {
    const row = this.database.db.prepare("SELECT * FROM agent_roles WHERE id = ?").get(roleId) as RoleRow | undefined;
    return row ? parseRole(row) : null;
  }

  listRoles(options: { includeArchived?: boolean } = {}): AgentRoleRecord[] {
    const rows = this.database.db
      .prepare(
        `SELECT * FROM agent_roles
         ${options.includeArchived ? "" : "WHERE archivedAt IS NULL"}
         ORDER BY name ASC`
      )
      .all() as RoleRow[];
    return rows.map(parseRole);
  }

  archiveRole(roleId: string): AgentRoleRecord {
    const role = this.getRole(roleId);
    if (!role) {
      throw new Error(`Role not found: ${roleId}`);
    }
    this.database.db.prepare("UPDATE agent_roles SET archivedAt = @archivedAt, updatedAt = @archivedAt WHERE id = @id").run({
      id: roleId,
      archivedAt: new Date().toISOString()
    });
    return this.getRole(roleId) ?? role;
  }

  createTeam(manifestInput: TeamManifest): TeamRecord {
    const knownRoleIds = this.listRoles().map((role) => role.id);
    const manifest = validateTeamManifest(manifestInput, knownRoleIds);
    const now = new Date().toISOString();
    this.database.db
      .prepare(
        `INSERT INTO teams (id, name, description, status, manifestJson, createdAt, updatedAt, archivedAt)
         VALUES (@id, @name, @description, 'active', @manifestJson, @createdAt, @updatedAt, NULL)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           status = 'active',
           manifestJson = excluded.manifestJson,
           updatedAt = excluded.updatedAt,
           archivedAt = NULL`
      )
      .run({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        manifestJson: JSON.stringify(manifest),
        createdAt: now,
        updatedAt: now
      });
    const team = this.getTeam(manifest.id);
    if (!team) {
      throw new Error(`Team was not saved: ${manifest.id}`);
    }
    return team;
  }

  getTeam(teamId: string): TeamRecord | null {
    const row = this.database.db.prepare("SELECT * FROM teams WHERE id = ?").get(teamId) as TeamRow | undefined;
    return row ? parseTeam(row) : null;
  }

  listTeams(options: { includeArchived?: boolean } = {}): TeamRecord[] {
    const rows = this.database.db
      .prepare(
        `SELECT * FROM teams
         ${options.includeArchived ? "" : "WHERE status = 'active'"}
         ORDER BY updatedAt DESC`
      )
      .all() as TeamRow[];
    return rows.map(parseTeam);
  }

  archiveTeam(teamId: string): TeamRecord {
    const team = this.getTeam(teamId);
    if (!team) {
      throw new Error(`Team not found: ${teamId}`);
    }
    this.database.db
      .prepare("UPDATE teams SET status = 'archived', archivedAt = @now, updatedAt = @now WHERE id = @id")
      .run({ id: teamId, now: new Date().toISOString() });
    return this.getTeam(teamId) ?? team;
  }

  createTeamRun(input: { teamId: string; task: string; coordinatorRoleId?: string; parentRunId?: string | null }): TeamRun {
    const now = new Date().toISOString();
    const id = createId("team_run");
    this.database.db
      .prepare(
        `INSERT INTO team_runs (
          id, teamId, parentRunId, task, status, coordinatorRoleId, startedAt, completedAt, createdAt, updatedAt, summary, finalResultJson
        )
        VALUES (@id, @teamId, @parentRunId, @task, 'queued', @coordinatorRoleId, NULL, NULL, @createdAt, @updatedAt, NULL, NULL)`
      )
      .run({
        id,
        teamId: input.teamId,
        parentRunId: input.parentRunId ?? null,
        task: input.task,
        coordinatorRoleId: input.coordinatorRoleId ?? null,
        createdAt: now,
        updatedAt: now
      });
    const run = this.getTeamRun(id);
    if (!run) {
      throw new Error(`Team run was not created: ${id}`);
    }
    return run;
  }

  getTeamRun(teamRunId: string): TeamRun | null {
    const row = this.database.db.prepare("SELECT * FROM team_runs WHERE id = ?").get(teamRunId) as TeamRunRow | undefined;
    return row ? parseRun(row) : null;
  }

  listTeamRuns(teamId?: string, limit = 50): TeamRun[] {
    const rows = teamId
      ? (this.database.db
          .prepare("SELECT * FROM team_runs WHERE teamId = ? ORDER BY createdAt DESC LIMIT ?")
          .all(teamId, limit) as TeamRunRow[])
      : (this.database.db.prepare("SELECT * FROM team_runs ORDER BY createdAt DESC LIMIT ?").all(limit) as TeamRunRow[]);
    return rows.map(parseRun);
  }

  updateTeamRun(teamRunId: string, update: Partial<Pick<TeamRun, "status" | "summary" | "finalResult" | "startedAt" | "completedAt">>): TeamRun {
    const existing = this.getTeamRun(teamRunId);
    if (!existing) {
      throw new Error(`Team run not found: ${teamRunId}`);
    }
    const next = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString()
    };
    this.database.db
      .prepare(
        `UPDATE team_runs
         SET status = @status,
             summary = @summary,
             finalResultJson = @finalResultJson,
             startedAt = @startedAt,
             completedAt = @completedAt,
             updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: teamRunId,
        status: next.status,
        summary: next.summary,
        finalResultJson: next.finalResult ? JSON.stringify(next.finalResult) : null,
        startedAt: next.startedAt,
        completedAt: next.completedAt,
        updatedAt: next.updatedAt
      });
    return this.getTeamRun(teamRunId) ?? next;
  }

  createSubtask(input: {
    id?: string;
    teamRunId: string;
    title: string;
    description: string;
    assignedRoleId?: string | null;
    priority?: number;
    riskLevel?: TeamRiskLevel;
    requiredCapabilities?: string[];
    requiredTools?: string[];
    dependsOn?: string[];
    parentSubtaskId?: string | null;
  }): TeamSubtask {
    const now = new Date().toISOString();
    const id = input.id ?? createId("team_subtask");
    this.database.db
      .prepare(
        `INSERT INTO team_subtasks (
          id, teamRunId, parentSubtaskId, assignedRoleId, title, description, status, priority, riskLevel,
          requiredCapabilitiesJson, requiredToolsJson, dependsOnJson, resultJson, createdAt, updatedAt, startedAt, completedAt
        )
        VALUES (
          @id, @teamRunId, @parentSubtaskId, @assignedRoleId, @title, @description, 'queued', @priority, @riskLevel,
          @requiredCapabilitiesJson, @requiredToolsJson, @dependsOnJson, NULL, @createdAt, @updatedAt, NULL, NULL
        )`
      )
      .run({
        id,
        teamRunId: input.teamRunId,
        parentSubtaskId: input.parentSubtaskId ?? null,
        assignedRoleId: input.assignedRoleId ?? null,
        title: input.title,
        description: input.description,
        priority: input.priority ?? 50,
        riskLevel: input.riskLevel ?? "low",
        requiredCapabilitiesJson: JSON.stringify(input.requiredCapabilities ?? []),
        requiredToolsJson: JSON.stringify(input.requiredTools ?? []),
        dependsOnJson: JSON.stringify(input.dependsOn ?? []),
        createdAt: now,
        updatedAt: now
      });
    const subtask = this.getSubtask(id);
    if (!subtask) {
      throw new Error(`Subtask was not created: ${id}`);
    }
    return subtask;
  }

  getSubtask(subtaskId: string): TeamSubtask | null {
    const row = this.database.db.prepare("SELECT * FROM team_subtasks WHERE id = ?").get(subtaskId) as SubtaskRow | undefined;
    return row ? parseSubtask(row) : null;
  }

  listSubtasks(teamRunId: string): TeamSubtask[] {
    const rows = this.database.db
      .prepare("SELECT * FROM team_subtasks WHERE teamRunId = ? ORDER BY priority ASC, createdAt ASC")
      .all(teamRunId) as SubtaskRow[];
    return rows.map(parseSubtask);
  }

  updateSubtask(subtaskId: string, update: Partial<Pick<TeamSubtask, "status" | "assignedRoleId" | "result" | "startedAt" | "completedAt">>): TeamSubtask {
    const existing = this.getSubtask(subtaskId);
    if (!existing) {
      throw new Error(`Subtask not found: ${subtaskId}`);
    }
    const next = {
      ...existing,
      ...update,
      updatedAt: new Date().toISOString()
    };
    this.database.db
      .prepare(
        `UPDATE team_subtasks
         SET status = @status,
             assignedRoleId = @assignedRoleId,
             resultJson = @resultJson,
             startedAt = @startedAt,
             completedAt = @completedAt,
             updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: subtaskId,
        status: next.status,
        assignedRoleId: next.assignedRoleId,
        resultJson: next.result ? JSON.stringify(next.result) : null,
        startedAt: next.startedAt,
        completedAt: next.completedAt,
        updatedAt: next.updatedAt
      });
    return this.getSubtask(subtaskId) ?? next;
  }

  createBlackboardEntry(input: {
    teamRunId: string;
    subtaskId?: string | null;
    authorRoleId?: string | null;
    type: BlackboardEntryType;
    title: string;
    body: string;
    data?: unknown;
    confidence?: number;
    importance?: number;
    sensitivity?: TeamSensitivity;
    sourceEventId?: string | null;
    sourceRunId?: string | null;
    sourceMemoryNodeId?: string | null;
  }): BlackboardEntry {
    const now = new Date().toISOString();
    const id = createId("blackboard");
    this.database.db
      .prepare(
        `INSERT INTO blackboard_entries (
          id, teamRunId, subtaskId, authorRoleId, type, title, body, dataJson, confidence, importance,
          sensitivity, sourceEventId, sourceRunId, sourceMemoryNodeId, createdAt, updatedAt, deletedAt
        )
        VALUES (
          @id, @teamRunId, @subtaskId, @authorRoleId, @type, @title, @body, @dataJson, @confidence, @importance,
          @sensitivity, @sourceEventId, @sourceRunId, @sourceMemoryNodeId, @createdAt, @updatedAt, NULL
        )`
      )
      .run({
        id,
        teamRunId: input.teamRunId,
        subtaskId: input.subtaskId ?? null,
        authorRoleId: input.authorRoleId ?? null,
        type: input.type,
        title: input.title,
        body: input.body,
        dataJson: JSON.stringify(input.data ?? {}),
        confidence: input.confidence ?? 0.5,
        importance: input.importance ?? 0.5,
        sensitivity: input.sensitivity ?? "public",
        sourceEventId: input.sourceEventId ?? null,
        sourceRunId: input.sourceRunId ?? null,
        sourceMemoryNodeId: input.sourceMemoryNodeId ?? null,
        createdAt: now,
        updatedAt: now
      });
    const entry = this.getBlackboardEntry(id);
    if (!entry) {
      throw new Error(`Blackboard entry was not created: ${id}`);
    }
    return entry;
  }

  getBlackboardEntry(entryId: string): BlackboardEntry | null {
    const row = this.database.db.prepare("SELECT * FROM blackboard_entries WHERE id = ?").get(entryId) as BlackboardRow | undefined;
    return row ? parseBlackboard(row) : null;
  }

  listBlackboardEntries(options: { teamRunId: string; type?: BlackboardEntryType; subtaskId?: string; includeDeleted?: boolean }): BlackboardEntry[] {
    const clauses = ["teamRunId = @teamRunId"];
    const params: Record<string, unknown> = { teamRunId: options.teamRunId };
    if (options.type) {
      clauses.push("type = @type");
      params.type = options.type;
    }
    if (options.subtaskId) {
      clauses.push("subtaskId = @subtaskId");
      params.subtaskId = options.subtaskId;
    }
    if (!options.includeDeleted) {
      clauses.push("deletedAt IS NULL");
    }
    const rows = this.database.db
      .prepare(`SELECT * FROM blackboard_entries WHERE ${clauses.join(" AND ")} ORDER BY createdAt ASC`)
      .all(params) as BlackboardRow[];
    return rows.map(parseBlackboard);
  }

  updateBlackboardEntry(entryId: string, update: Partial<Pick<BlackboardEntry, "title" | "body" | "data" | "confidence" | "importance" | "sensitivity">>): BlackboardEntry {
    const existing = this.getBlackboardEntry(entryId);
    if (!existing) {
      throw new Error(`Blackboard entry not found: ${entryId}`);
    }
    const next = { ...existing, ...update, updatedAt: new Date().toISOString() };
    this.database.db
      .prepare(
        `UPDATE blackboard_entries
         SET title = @title,
             body = @body,
             dataJson = @dataJson,
             confidence = @confidence,
             importance = @importance,
             sensitivity = @sensitivity,
             updatedAt = @updatedAt
         WHERE id = @id`
      )
      .run({
        id: entryId,
        title: next.title,
        body: next.body,
        dataJson: JSON.stringify(next.data ?? {}),
        confidence: next.confidence,
        importance: next.importance,
        sensitivity: next.sensitivity,
        updatedAt: next.updatedAt
      });
    return this.getBlackboardEntry(entryId) ?? next;
  }

  deleteBlackboardEntry(entryId: string): BlackboardEntry {
    const existing = this.getBlackboardEntry(entryId);
    if (!existing) {
      throw new Error(`Blackboard entry not found: ${entryId}`);
    }
    this.database.db.prepare("UPDATE blackboard_entries SET deletedAt = @now, updatedAt = @now WHERE id = @id").run({
      id: entryId,
      now: new Date().toISOString()
    });
    return this.getBlackboardEntry(entryId) ?? existing;
  }

  createMessage(input: {
    teamRunId: string;
    fromRoleId?: string | null;
    toRoleId?: string | null;
    messageType: AgentMessageType;
    content: string;
    data?: unknown;
  }): AgentMessage {
    if (!this.getTeamRun(input.teamRunId)) {
      throw new Error(`Team run not found: ${input.teamRunId}`);
    }
    const now = new Date().toISOString();
    const id = createId("team_msg");
    this.database.db
      .prepare(
        `INSERT INTO agent_messages (id, teamRunId, fromRoleId, toRoleId, messageType, content, dataJson, createdAt)
         VALUES (@id, @teamRunId, @fromRoleId, @toRoleId, @messageType, @content, @dataJson, @createdAt)`
      )
      .run({
        id,
        teamRunId: input.teamRunId,
        fromRoleId: input.fromRoleId ?? null,
        toRoleId: input.toRoleId ?? null,
        messageType: input.messageType,
        content: input.content,
        dataJson: JSON.stringify(input.data ?? {}),
        createdAt: now
      });
    const message = this.getMessage(id);
    if (!message) {
      throw new Error(`Message was not created: ${id}`);
    }
    return message;
  }

  getMessage(messageId: string): AgentMessage | null {
    const row = this.database.db.prepare("SELECT * FROM agent_messages WHERE id = ?").get(messageId) as MessageRow | undefined;
    return row ? parseMessage(row) : null;
  }

  listMessages(teamRunId: string): AgentMessage[] {
    const rows = this.database.db.prepare("SELECT * FROM agent_messages WHERE teamRunId = ? ORDER BY createdAt ASC").all(teamRunId) as MessageRow[];
    return rows.map(parseMessage);
  }

  createConflict(input: {
    teamRunId: string;
    type: TeamConflictType;
    severity: TeamRiskLevel;
    description: string;
    involvedEntryIds?: string[];
    involvedRoleIds?: string[];
    status?: TeamConflictStatus;
    resolution?: unknown;
  }): TeamConflict {
    const now = new Date().toISOString();
    const id = createId("team_conflict");
    this.database.db
      .prepare(
        `INSERT INTO team_conflicts (
          id, teamRunId, type, severity, status, description, involvedEntryIdsJson, involvedRoleIdsJson, resolutionJson, createdAt, resolvedAt
        )
        VALUES (
          @id, @teamRunId, @type, @severity, @status, @description, @involvedEntryIdsJson, @involvedRoleIdsJson, @resolutionJson, @createdAt, NULL
        )`
      )
      .run({
        id,
        teamRunId: input.teamRunId,
        type: input.type,
        severity: input.severity,
        status: input.status ?? "open",
        description: input.description,
        involvedEntryIdsJson: JSON.stringify(input.involvedEntryIds ?? []),
        involvedRoleIdsJson: JSON.stringify(input.involvedRoleIds ?? []),
        resolutionJson: input.resolution ? JSON.stringify(input.resolution) : null,
        createdAt: now
      });
    const conflict = this.getConflict(id);
    if (!conflict) {
      throw new Error(`Conflict was not created: ${id}`);
    }
    return conflict;
  }

  getConflict(conflictId: string): TeamConflict | null {
    const row = this.database.db.prepare("SELECT * FROM team_conflicts WHERE id = ?").get(conflictId) as ConflictRow | undefined;
    return row ? parseConflict(row) : null;
  }

  listConflicts(teamRunId: string, status?: TeamConflictStatus | "all"): TeamConflict[] {
    const rows =
      status && status !== "all"
        ? (this.database.db
            .prepare("SELECT * FROM team_conflicts WHERE teamRunId = ? AND status = ? ORDER BY createdAt ASC")
            .all(teamRunId, status) as ConflictRow[])
        : (this.database.db.prepare("SELECT * FROM team_conflicts WHERE teamRunId = ? ORDER BY createdAt ASC").all(teamRunId) as ConflictRow[]);
    return rows.map(parseConflict);
  }

  resolveConflict(conflictId: string, resolution: unknown, status: "resolved" | "dismissed" = "resolved"): TeamConflict {
    const existing = this.getConflict(conflictId);
    if (!existing) {
      throw new Error(`Conflict not found: ${conflictId}`);
    }
    this.database.db
      .prepare("UPDATE team_conflicts SET status = @status, resolutionJson = @resolutionJson, resolvedAt = @resolvedAt WHERE id = @id")
      .run({
        id: conflictId,
        status,
        resolutionJson: JSON.stringify(resolution ?? {}),
        resolvedAt: new Date().toISOString()
      });
    return this.getConflict(conflictId) ?? existing;
  }

  createHandoff(input: {
    teamRunId: string;
    subtaskId?: string | null;
    requestedByRoleId?: string | null;
    reason: string;
    question: string;
    options?: string[];
  }): HumanHandoff {
    const now = new Date().toISOString();
    const id = createId("handoff");
    this.database.db
      .prepare(
        `INSERT INTO human_handoffs (
          id, teamRunId, subtaskId, requestedByRoleId, reason, question, optionsJson, status, responseText, responseJson, createdAt, resolvedAt
        )
        VALUES (
          @id, @teamRunId, @subtaskId, @requestedByRoleId, @reason, @question, @optionsJson, 'open', NULL, NULL, @createdAt, NULL
        )`
      )
      .run({
        id,
        teamRunId: input.teamRunId,
        subtaskId: input.subtaskId ?? null,
        requestedByRoleId: input.requestedByRoleId ?? null,
        reason: input.reason,
        question: input.question,
        optionsJson: JSON.stringify(input.options ?? []),
        createdAt: now
      });
    const handoff = this.getHandoff(id);
    if (!handoff) {
      throw new Error(`Handoff was not created: ${id}`);
    }
    return handoff;
  }

  getHandoff(handoffId: string): HumanHandoff | null {
    const row = this.database.db.prepare("SELECT * FROM human_handoffs WHERE id = ?").get(handoffId) as HandoffRow | undefined;
    return row ? parseHandoff(row) : null;
  }

  listHandoffs(options: { teamRunId?: string; status?: "open" | "answered" | "canceled" | "all" } = {}): HumanHandoff[] {
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (options.teamRunId) {
      clauses.push("teamRunId = @teamRunId");
      params.teamRunId = options.teamRunId;
    }
    if (options.status && options.status !== "all") {
      clauses.push("status = @status");
      params.status = options.status;
    } else if (!options.status) {
      clauses.push("status = 'open'");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database.db.prepare(`SELECT * FROM human_handoffs ${where} ORDER BY createdAt ASC`).all(params) as HandoffRow[];
    return rows.map(parseHandoff);
  }

  answerHandoff(handoffId: string, responseText: string, response?: unknown): HumanHandoff {
    const existing = this.getHandoff(handoffId);
    if (!existing) {
      throw new Error(`Handoff not found: ${handoffId}`);
    }
    const resolvedAt = new Date().toISOString();
    this.database.db
      .prepare(
        `UPDATE human_handoffs
         SET status = 'answered',
             responseText = @responseText,
             responseJson = @responseJson,
             resolvedAt = @resolvedAt
         WHERE id = @id`
      )
      .run({
        id: handoffId,
        responseText,
        responseJson: JSON.stringify(response ?? {}),
        resolvedAt
      });
    return this.getHandoff(handoffId) ?? existing;
  }

  cancelHandoff(handoffId: string): HumanHandoff {
    const existing = this.getHandoff(handoffId);
    if (!existing) {
      throw new Error(`Handoff not found: ${handoffId}`);
    }
    this.database.db
      .prepare("UPDATE human_handoffs SET status = 'canceled', resolvedAt = @resolvedAt WHERE id = @id")
      .run({ id: handoffId, resolvedAt: new Date().toISOString() });
    return this.getHandoff(handoffId) ?? existing;
  }
}

function parseRole(row: RoleRow): AgentRoleRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    manifest: validateRoleManifest(JSON.parse(row.manifestJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt
  };
}

function parseTeam(row: TeamRow): TeamRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    manifest: validateTeamManifest(JSON.parse(row.manifestJson)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt
  };
}

function parseRun(row: TeamRunRow): TeamRun {
  return {
    id: row.id,
    teamId: row.teamId,
    parentRunId: row.parentRunId,
    task: row.task,
    status: row.status,
    coordinatorRoleId: row.coordinatorRoleId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    summary: row.summary,
    finalResult: row.finalResultJson ? JSON.parse(row.finalResultJson) : null
  };
}

function parseSubtask(row: SubtaskRow): TeamSubtask {
  return {
    id: row.id,
    teamRunId: row.teamRunId,
    parentSubtaskId: row.parentSubtaskId,
    assignedRoleId: row.assignedRoleId,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    riskLevel: row.riskLevel,
    requiredCapabilities: parseArray(row.requiredCapabilitiesJson),
    requiredTools: parseArray(row.requiredToolsJson),
    dependsOn: parseArray(row.dependsOnJson),
    result: row.resultJson ? JSON.parse(row.resultJson) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt
  };
}

function parseBlackboard(row: BlackboardRow): BlackboardEntry {
  return {
    id: row.id,
    teamRunId: row.teamRunId,
    subtaskId: row.subtaskId,
    authorRoleId: row.authorRoleId,
    type: row.type,
    title: row.title,
    body: row.body,
    data: JSON.parse(row.dataJson || "{}"),
    confidence: row.confidence,
    importance: row.importance,
    sensitivity: row.sensitivity,
    sourceEventId: row.sourceEventId,
    sourceRunId: row.sourceRunId,
    sourceMemoryNodeId: row.sourceMemoryNodeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt
  };
}

function parseMessage(row: MessageRow): AgentMessage {
  return {
    id: row.id,
    teamRunId: row.teamRunId,
    fromRoleId: row.fromRoleId,
    toRoleId: row.toRoleId,
    messageType: row.messageType,
    content: row.content,
    data: JSON.parse(row.dataJson || "{}"),
    createdAt: row.createdAt
  };
}

function parseConflict(row: ConflictRow): TeamConflict {
  return {
    id: row.id,
    teamRunId: row.teamRunId,
    type: row.type,
    severity: row.severity,
    status: row.status,
    description: row.description,
    involvedEntryIds: parseArray(row.involvedEntryIdsJson),
    involvedRoleIds: parseArray(row.involvedRoleIdsJson),
    resolution: row.resolutionJson ? JSON.parse(row.resolutionJson) : null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt
  };
}

function parseHandoff(row: HandoffRow): HumanHandoff {
  return {
    id: row.id,
    teamRunId: row.teamRunId,
    subtaskId: row.subtaskId,
    requestedByRoleId: row.requestedByRoleId,
    reason: row.reason,
    question: row.question,
    options: parseArray(row.optionsJson),
    status: row.status,
    responseText: row.responseText,
    response: row.responseJson ? JSON.parse(row.responseJson) : null,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt
  };
}

function parseArray(value: string): string[] {
  const parsed = JSON.parse(value || "[]");
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}
