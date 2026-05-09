import fs from "node:fs";
import path from "node:path";
import type { SquidDatabase } from "@squidbot/db";
import { buildTrace, createId, type AgentEvent, type Trace } from "@squidbot/core";
import { MemoryGraphStore } from "@squidbot/memory";
import { SandboxManager } from "@squidbot/sandbox";
import { TaskBroker } from "./broker.js";
import { ConflictDetector } from "./conflictDetector.js";
import { defaultTeamManifest } from "./defaultRoles.js";
import { HandoffManager } from "./handoff.js";
import { checkRoleToolPermission } from "./permissions.js";
import { createDefaultRoleRegistry } from "./roleRegistry.js";
import { createTeamSynthesis } from "./synthesis.js";
import { TeamStore } from "./teamStore.js";
import type { AgentRoleRecord, BlackboardEntry, TeamManifest, TeamRecord, TeamRun, TeamRunResult, TeamSubtask } from "./types.js";

export class TeamCoordinator {
  private readonly store: TeamStore;
  private readonly broker: TaskBroker;
  private readonly conflicts: ConflictDetector;
  private readonly handoffs: HandoffManager;
  private readonly sandbox: SandboxManager;

  constructor(
    private readonly database: SquidDatabase,
    options: {
      sandbox?: SandboxManager;
    } = {}
  ) {
    this.store = new TeamStore(database);
    this.broker = new TaskBroker();
    this.conflicts = new ConflictDetector(database);
    this.handoffs = new HandoffManager(database);
    this.sandbox = options.sandbox ?? new SandboxManager();
  }

  ensureDefaultSetup(): TeamRecord {
    createDefaultRoleRegistry(this.database);
    return this.store.createTeam(defaultTeamManifest);
  }

  createTeam(manifest: TeamManifest): TeamRecord {
    createDefaultRoleRegistry(this.database);
    const team = this.store.createTeam(manifest);
    this.appendStandaloneEvent("team.created", {
      teamId: team.id,
      teamName: team.name,
      roles: team.manifest.roles
    });
    return team;
  }

  listTeams(): TeamRecord[] {
    createDefaultRoleRegistry(this.database);
    if (this.store.listTeams().length === 0) {
      this.ensureDefaultSetup();
    }
    return this.store.listTeams();
  }

  getTeam(teamId: string): TeamRecord | null {
    return this.store.getTeam(teamId);
  }

  getTeamRun(teamRunId: string): TeamRun | null {
    return this.store.getTeamRun(teamRunId);
  }

  listTeamRuns(teamId?: string, limit = 50): TeamRun[] {
    return this.store.listTeamRuns(teamId, limit);
  }

  pauseTeamRun(teamRunId: string): void {
    this.store.updateTeamRun(teamRunId, { status: "waiting_for_human" });
  }

  resumeTeamRun(teamRunId: string): void {
    this.store.updateTeamRun(teamRunId, { status: "running" });
  }

  cancelTeamRun(teamRunId: string): void {
    const run = this.store.updateTeamRun(teamRunId, { status: "canceled", completedAt: new Date().toISOString() });
    this.appendTeamRunEvent(run, "team.run.canceled", { teamRunId });
  }

  async runTeamTask(input: {
    teamId: string;
    workspacePath?: string;
    task: string;
    mode?: "dry-run" | "sandbox" | "approved-write";
    maxAgents?: number;
  }): Promise<TeamRunResult> {
    const team = this.store.getTeam(input.teamId);
    if (!team) {
      throw new Error(`Team not found: ${input.teamId}`);
    }
    const workspacePath = input.workspacePath ? path.resolve(input.workspacePath) : undefined;
    if (workspacePath && !fs.existsSync(workspacePath)) {
      throw new Error(`Workspace not found: ${workspacePath}`);
    }

    const run = this.store.createTeamRun({
      teamId: team.id,
      task: input.task,
      coordinatorRoleId: team.manifest.coordinatorRoleId
    });
    const events: AgentEvent[] = [];
    const emit = (type: AgentEvent["type"], data: Record<string, unknown>): string => {
      const event = this.createTeamEvent(run, type, data);
      events.push(event);
      this.database.appendEvent({
        id: event.id,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        type: event.type,
        data: event.data
      });
      return event.id;
    };

    const startedAt = new Date().toISOString();
    this.store.updateTeamRun(run.id, { status: "running", startedAt });
    emit("team.run.started", {
      teamRunId: run.id,
      teamId: team.id,
      task: input.task,
      workspacePath,
      mode: input.mode ?? "sandbox"
    });
    const referencedSkill = this.findReferencedSkill(input.task);
    if (referencedSkill) {
      emit("skill.call", {
        teamRunId: run.id,
        skillId: referencedSkill.id,
        version: referencedSkill.currentVersion,
        workspacePath,
        testMode: true,
        mode: "team-reference"
      });
      const skillEntry = this.store.createBlackboardEntry({
        teamRunId: run.id,
        authorRoleId: team.manifest.coordinatorRoleId,
        type: "plan",
        title: "Existing skill selected",
        body: `Coordinator selected ${referencedSkill.name} (${referencedSkill.id}@${referencedSkill.currentVersion}) as the reusable skill reference for this team run. Role agents still verify evidence, patch, and tests independently.`,
        data: referencedSkill,
        confidence: 0.8,
        importance: 0.7
      });
      emit("team.blackboard.entry", {
        teamRunId: run.id,
        entryId: skillEntry.id,
        entryType: skillEntry.type,
        authorRoleId: skillEntry.authorRoleId
      });
    }

    let synthesisTraceId = "";
    try {
      const roles = this.loadRoles(team);
      const drafts = this.broker.decompose({
        teamRunId: run.id,
        task: input.task,
        team: team.manifest
      });
      const subtasks = drafts.map((draft) =>
        this.store.createSubtask({
          id: draft.id,
          teamRunId: run.id,
          title: draft.title,
          description: draft.description,
          assignedRoleId: draft.assignedRoleId,
          priority: draft.priority,
          riskLevel: draft.riskLevel,
          requiredCapabilities: draft.requiredCapabilities,
          requiredTools: draft.requiredTools,
          dependsOn: draft.dependsOn,
          parentSubtaskId: draft.parentSubtaskId
        })
      );
      emit("team.task.decomposed", {
        teamRunId: run.id,
        subtaskCount: subtasks.length,
        subtasks: subtasks.map((subtask) => ({
          id: subtask.id,
          title: subtask.title,
          roleId: subtask.assignedRoleId,
          dependsOn: subtask.dependsOn
        }))
      });
      for (const subtask of subtasks) {
        emit("team.subtask.created", {
          teamRunId: run.id,
          subtaskId: subtask.id,
          title: subtask.title,
          assignedRoleId: subtask.assignedRoleId,
          riskLevel: subtask.riskLevel
        });
      }

      let remaining = true;
      while (remaining) {
        remaining = false;
        const current = this.store.listSubtasks(run.id);
        for (const subtask of this.broker.readySubtasks(current)) {
          remaining = true;
          const roleId = this.broker.assignSubtask({
            subtask,
            roles,
            workload: countWorkload(this.store.listSubtasks(run.id))
          });
          const role = roles.find((item) => item.id === roleId);
          if (!role) {
            throw new Error(`Role not found for subtask: ${roleId}`);
          }
          await this.executeSubtask({ runId: run.id, team, subtask, role, workspacePath, emit });
        }
      }

      const detected = this.conflicts.detect(run.id);
      for (const conflict of detected) {
        emit("team.conflict.detected", {
          teamRunId: run.id,
          conflictId: conflict.id,
          conflictType: conflict.type,
          severity: conflict.severity,
          description: conflict.description
        });
      }

      const entriesBeforeSynthesis = this.store.listBlackboardEntries({ teamRunId: run.id });
      const conflicts = this.store.listConflicts(run.id, "all");
      if (conflicts.some((conflict) => conflict.status === "open" && conflict.severity === "high")) {
        const handoff = this.handoffs.requestHandoff({
          teamRunId: run.id,
          requestedByRoleId: "coordinator",
          reason: "High-severity team conflict",
          question: "A high-severity team conflict needs resolution before completion.",
          options: ["approve", "reject", "revise"]
        });
        emit("team.handoff.requested", {
          teamRunId: run.id,
          handoffId: handoff.id,
          question: handoff.question
        });
      }

      const memoryNodeIds = this.persistMemoryCandidates(run.id, entriesBeforeSynthesis);
      const synthesis = createTeamSynthesis({
        teamRunId: run.id,
        entries: this.store.listBlackboardEntries({ teamRunId: run.id }),
        conflicts: this.store.listConflicts(run.id, "all"),
        memoryNodeIds
      });
      const synthesisEntry = this.store.createBlackboardEntry({
        teamRunId: run.id,
        authorRoleId: "coordinator",
        type: "finalSynthesis",
        title: "Coordinator synthesis",
        body: synthesis.finalAnswer,
        data: synthesis,
        confidence: synthesis.status === "completed" ? 0.85 : 0.65,
        importance: 0.9
      });
      emit("team.blackboard.entry", {
        teamRunId: run.id,
        entryId: synthesisEntry.id,
        entryType: synthesisEntry.type,
        authorRoleId: synthesisEntry.authorRoleId
      });
      emit("team.synthesis.created", {
        teamRunId: run.id,
        status: synthesis.status,
        finalAnswer: synthesis.finalAnswer,
        blockerCount: synthesis.blockers.length,
        riskCount: synthesis.risks.length
      });

      const completedAt = new Date().toISOString();
      const finalRun = this.store.updateTeamRun(run.id, {
        status: synthesis.status === "blocked" ? "waiting_for_human" : "completed",
        completedAt: synthesis.status === "blocked" ? null : completedAt,
        summary: synthesis.finalAnswer,
        finalResult: synthesis
      });
      emit(synthesis.status === "blocked" ? "team.run.failed" : "team.run.completed", {
        teamRunId: run.id,
        status: finalRun.status,
        subtaskCount: this.store.listSubtasks(run.id).length,
        completedCount: this.store.listSubtasks(run.id).filter((subtask) => subtask.status === "completed").length,
        conflictCount: this.store.listConflicts(run.id, "all").length,
        handoffCount: this.store.listHandoffs({ teamRunId: run.id, status: "all" }).length,
        rolesUsed: [...new Set(this.store.listSubtasks(run.id).map((subtask) => subtask.assignedRoleId).filter(Boolean))]
      });
      const reflection = this.saveReflection(run, finalRun.status, synthesis.finalAnswer);
      emit("reflection.created", reflection);
      const trace = this.saveTrace(events);
      synthesisTraceId = trace.id;
      const synthesisWithTrace = {
        ...synthesis,
        traceIds: [trace.id]
      };
      this.store.updateBlackboardEntry(synthesisEntry.id, {
        data: synthesisWithTrace
      });
      const runWithTrace = this.store.updateTeamRun(run.id, {
        finalResult: synthesisWithTrace
      });
      return {
        team,
        run: runWithTrace,
        subtasks: this.store.listSubtasks(run.id),
        blackboardEntries: this.store.listBlackboardEntries({ teamRunId: run.id }),
        conflicts: this.store.listConflicts(run.id, "all"),
        handoffs: this.store.listHandoffs({ teamRunId: run.id, status: "all" }),
        synthesis: synthesisWithTrace,
        traceId: synthesisTraceId
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = this.store.updateTeamRun(run.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        summary: message
      });
      emit("team.run.failed", {
        teamRunId: run.id,
        error: message
      });
      const reflection = this.saveReflection(run, failed.status, message);
      emit("reflection.created", reflection);
      const trace = this.saveTrace(events);
      return {
        team,
        run: failed,
        subtasks: this.store.listSubtasks(run.id),
        blackboardEntries: this.store.listBlackboardEntries({ teamRunId: run.id }),
        conflicts: this.store.listConflicts(run.id, "all"),
        handoffs: this.store.listHandoffs({ teamRunId: run.id, status: "all" }),
        synthesis: {
          teamRunId: run.id,
          status: "failed",
          finalAnswer: message,
          roleSummaries: [],
          decisions: [],
          risks: [message],
          blockers: [message],
          traceIds: [trace.id],
          memoryNodeIds: []
        },
        traceId: trace.id
      };
    }
  }

  private async executeSubtask(input: {
    runId: string;
    team: TeamRecord;
    subtask: TeamSubtask;
    role: AgentRoleRecord;
    workspacePath?: string;
    emit: (type: AgentEvent["type"], data: Record<string, unknown>) => string;
  }): Promise<void> {
    const startedAt = new Date().toISOString();
    this.store.updateSubtask(input.subtask.id, {
      status: "running",
      assignedRoleId: input.role.id,
      startedAt
    });
    input.emit("team.subtask.assigned", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      assignedRoleId: input.role.id
    });
    input.emit("team.subtask.started", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id
    });
    input.emit("team.agent.started", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      roleId: input.role.id,
      allowedTools: input.role.manifest.allowedTools
    });
    const eventId = input.emit("team.agent.message", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      roleId: input.role.id,
      messageType: "status",
      content: `${input.role.name} started ${input.subtask.title}.`
    });
    this.store.createMessage({
      teamRunId: input.runId,
      fromRoleId: input.role.id,
      toRoleId: "coordinator",
      messageType: "status",
      content: `${input.role.name} started ${input.subtask.title}.`,
      data: { subtaskId: input.subtask.id, sourceEventId: eventId }
    });

    const deniedRequiredTools = input.subtask.requiredTools
      .map((toolName) => ({
        toolName,
        permission: checkRoleToolPermission({
          role: input.role.manifest,
          team: input.team.manifest,
          toolName,
          riskLevel: input.subtask.riskLevel,
          realConnectorWrite: false
        })
      }))
      .filter((item) => !item.permission.allowed);
    if (deniedRequiredTools.length > 0) {
      for (const denied of deniedRequiredTools) {
        this.recordDenied(input, denied.toolName, denied.permission.reason);
      }
      const needsHandoff = deniedRequiredTools.some((denied) => denied.toolName === "sandbox.promote") && input.team.manifest.defaultPolicy.requireHumanForHighRisk;
      if (needsHandoff) {
        const handoff = this.handoffs.requestHandoff({
          teamRunId: input.runId,
          subtaskId: input.subtask.id,
          requestedByRoleId: input.role.id,
          reason: "Real workspace promotion requires approval",
          question: "Approve promotion of sandboxed team changes to the real workspace?",
          options: ["approve", "reject", "revise"]
        });
        this.store.createBlackboardEntry({
          teamRunId: input.runId,
          subtaskId: input.subtask.id,
          authorRoleId: input.role.id,
          type: "handoff",
          title: "Promotion approval required",
          body: handoff.question,
          data: { handoffId: handoff.id },
          confidence: 0.9,
          importance: 0.9
        });
        input.emit("team.handoff.requested", {
          teamRunId: input.runId,
          subtaskId: input.subtask.id,
          handoffId: handoff.id,
          question: handoff.question
        });
      }
      this.store.updateSubtask(input.subtask.id, {
        status: needsHandoff ? "waiting_for_human" : "blocked",
        completedAt: new Date().toISOString(),
        result: {
          deniedTools: deniedRequiredTools.map((denied) => denied.toolName)
        }
      });
      input.emit("team.subtask.failed", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        roleId: input.role.id,
        status: needsHandoff ? "waiting_for_human" : "blocked",
        deniedTools: deniedRequiredTools.map((denied) => denied.toolName)
      });
      input.emit("team.agent.failed", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        roleId: input.role.id,
        deniedTools: deniedRequiredTools.map((denied) => denied.toolName)
      });
      return;
    }

    try {
      if (input.role.id === "researcher") {
        await this.runResearcher(input);
      } else if (input.role.id === "implementer") {
        await this.runImplementer(input);
      } else if (input.role.id === "tester") {
        await this.runTester(input);
      } else if (input.role.id === "reviewer") {
        await this.runReviewer(input);
      } else if (input.role.id === "releaseCoordinator") {
        await this.runReleaseCoordinator(input);
      } else {
        this.store.createBlackboardEntry({
          teamRunId: input.runId,
          subtaskId: input.subtask.id,
          authorRoleId: input.role.id,
          type: "summary",
          title: `${input.role.name} completed deterministic step`,
          body: `${input.role.name} had no specialized deterministic executor for this subtask.`,
          data: { roleId: input.role.id },
          confidence: 0.6
        });
      }
      const completed = this.store.updateSubtask(input.subtask.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        result: { roleId: input.role.id, completed: true }
      });
      input.emit("team.subtask.completed", {
        teamRunId: input.runId,
        subtaskId: completed.id,
        roleId: input.role.id
      });
      input.emit("team.agent.completed", {
        teamRunId: input.runId,
        subtaskId: completed.id,
        roleId: input.role.id
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.store.updateSubtask(input.subtask.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        result: { error: message }
      });
      input.emit("team.subtask.failed", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        roleId: input.role.id,
        error: message
      });
      input.emit("team.agent.failed", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        roleId: input.role.id,
        error: message
      });
      throw error;
    }
  }

  private async runResearcher(input: ExecutorInput): Promise<void> {
    const permission = checkRoleToolPermission({
      role: input.role.manifest,
      team: input.team.manifest,
      toolName: "workspace.readFile",
      riskLevel: "low"
    });
    if (!permission.allowed) {
      this.recordDenied(input, "workspace.readFile", permission.reason);
      return;
    }
    if (/positive memory fact/i.test(input.subtask.title) || /contradictory memory fact/i.test(input.subtask.title)) {
      const contradictory = /contradictory memory fact/i.test(input.subtask.title);
      const entry = this.store.createBlackboardEntry({
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        authorRoleId: input.role.id,
        type: "evidence",
        title: contradictory ? "Contradictory calculator memory fact" : "Positive calculator memory fact",
        body: contradictory
          ? "This contradicts the paired claim: calculator add subtracts instead of adding."
          : "Calculator add is correct.",
        data: {
          memoryNodeId: "memory_node_calculator_add_claim",
          claim: contradictory ? "calculator add subtracts instead of adding" : "calculator add is correct"
        },
        confidence: contradictory ? 0.9 : 0.55,
        importance: 0.8
      });
      input.emit("team.blackboard.entry", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        entryId: entry.id,
        entryType: entry.type,
        authorRoleId: input.role.id
      });
      return;
    }
    const workspace = requireWorkspace(input.workspacePath);
    const fileSummaries = ["test_calculator.py", "calculator.py", "README.md"]
      .filter((file) => fs.existsSync(path.join(workspace, file)))
      .map((file) => {
        const content = fs.readFileSync(path.join(workspace, file), "utf8");
        return {
          file,
          firstLines: content.split(/\r?\n/).slice(0, 8)
        };
      });
    const entry = this.store.createBlackboardEntry({
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      authorRoleId: input.role.id,
      type: "evidence",
      title: "Workspace evidence",
      body:
        fileSummaries.length > 0
          ? `Read ${fileSummaries.map((summary) => summary.file).join(", ")}. The calculator fixture expects add(2, 3) to equal 5.`
          : "No recognized calculator fixture files were found.",
      data: { files: fileSummaries },
      confidence: 0.85,
      importance: 0.75
    });
    input.emit("team.blackboard.entry", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      entryId: entry.id,
      entryType: entry.type,
      authorRoleId: input.role.id
    });
  }

  private async runImplementer(input: ExecutorInput): Promise<void> {
    const permission = checkRoleToolPermission({
      role: input.role.manifest,
      team: input.team.manifest,
      toolName: "workspace.createPatch",
      riskLevel: "medium"
    });
    if (!permission.allowed) {
      this.recordDenied(input, "workspace.createPatch", permission.reason);
      return;
    }
    const workspace = requireWorkspace(input.workspacePath);
    const calculatorPath = path.join(workspace, "calculator.py");
    if (!fs.existsSync(calculatorPath)) {
      const entry = this.store.createBlackboardEntry({
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        authorRoleId: input.role.id,
        type: "blocker",
        title: "Missing calculator implementation",
        body: "calculator.py was not found, so a patch cannot be proposed.",
        data: { path: calculatorPath },
        confidence: 0.9,
        importance: 0.8
      });
      input.emit("team.blackboard.entry", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        entryId: entry.id,
        entryType: entry.type,
        authorRoleId: input.role.id
      });
      return;
    }
    const content = fs.readFileSync(calculatorPath, "utf8");
    const patch =
      content.includes("return a - b") && content.includes("def add")
        ? /alternative conflicting patch/i.test(input.subtask.title)
          ? "--- a/calculator.py\n+++ b/calculator.py\n@@\n def add(a, b):\n-    return a - b\n+    return abs(a - b)\n"
          : "--- a/calculator.py\n+++ b/calculator.py\n@@\n def add(a, b):\n-    return a - b\n+    return a + b\n"
        : "";
    const entry = this.store.createBlackboardEntry({
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      authorRoleId: input.role.id,
      type: patch ? "patch" : "decision",
      title: patch ? "Fix add implementation" : "No calculator patch needed",
      body: patch || "The add implementation does not contain the known subtraction bug.",
      data: {
        permission,
        files: patch ? ["calculator.py"] : []
      },
      confidence: patch ? 0.9 : 0.7,
      importance: patch ? 0.85 : 0.5
    });
    input.emit("team.blackboard.entry", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      entryId: entry.id,
      entryType: entry.type,
      authorRoleId: input.role.id
    });
  }

  private async runTester(input: ExecutorInput): Promise<void> {
    const permission = checkRoleToolPermission({
      role: input.role.manifest,
      team: input.team.manifest,
      toolName: "sandbox.runCommand",
      riskLevel: "medium"
    });
    if (!permission.allowed) {
      this.recordDenied(input, "sandbox.runCommand", permission.reason);
      return;
    }
    const workspace = requireWorkspace(input.workspacePath);
    const patchEntry = this.store.listBlackboardEntries({ teamRunId: input.runId, type: "patch" }).at(-1);
    if (!patchEntry?.body.trim()) {
      const entry = this.store.createBlackboardEntry({
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        authorRoleId: input.role.id,
        type: "testResult",
        title: "No sandbox test needed",
        body: "No patch was available for sandbox verification.",
        data: {},
        confidence: 0.6
      });
      input.emit("team.blackboard.entry", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        entryId: entry.id,
        entryType: entry.type,
        authorRoleId: input.role.id
      });
      return;
    }
    const sandbox = await this.sandbox.create(workspace, { networkPolicy: input.role.manifest.sandboxPolicy.networkPolicy });
    const sandboxRecord = this.database.insertSandbox({
      id: sandbox.id,
      sessionId: `session_${input.runId}`,
      runId: input.runId,
      workspacePath: sandbox.originalWorkspacePath,
      sandboxPath: sandbox.path,
      backend: sandbox.backend,
      status: "active",
      resourceLimits: sandbox.resourceLimits,
      networkPolicy: sandbox.networkPolicy,
      createdAt: sandbox.createdAt
    });
    input.emit("sandbox.created", {
      teamRunId: input.runId,
      sandboxId: sandbox.id,
      workspacePath: sandbox.originalWorkspacePath,
      sandboxPath: sandbox.path,
      limits: sandbox.resourceLimits,
      networkPolicy: sandbox.networkPolicy
    });
    await this.sandbox.applyPatch(sandbox, patchEntry.body);
    const testCommand = fs.existsSync(path.join(sandbox.path, "calculator.py"))
      ? {
          command: process.platform === "win32" ? "python" : "python3",
          args: ["-c", "from calculator import add, subtract; assert add(2, 3) == 5; assert subtract(5, 3) == 2"]
        }
      : {
          command: "node",
          args: ["--version"]
        };
    const result = await this.sandbox.runCommand(sandbox, testCommand.command, testCommand.args, { timeoutMs: input.role.manifest.sandboxPolicy.maxRuntimeMs ?? 30_000 });
    const diff = await this.sandbox.diff(sandbox);
    this.database.appendSandboxTestResult(sandbox.id, result);
    this.database.updateSandbox(sandbox.id, { diff, status: "destroyed", destroyedAt: new Date().toISOString() });
    input.emit("sandbox.command", {
      teamRunId: input.runId,
      sandboxId: sandbox.id,
      command: testCommand.command,
      args: testCommand.args,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      blockedByPolicy: result.blockedByPolicy === true
    });
    input.emit("sandbox.diff", {
      teamRunId: input.runId,
      sandboxId: sandbox.id,
      diffLength: diff.length,
      fileCount: [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].length
    });
    input.emit("sandbox.approvalRequested", {
      teamRunId: input.runId,
      sandboxId: sandbox.id,
      diffLength: diff.length,
      approvalRequired: diff.trim().length > 0,
      realWorkspaceModified: false
    });
    await this.sandbox.destroy(sandbox);
    input.emit("sandbox.destroyed", {
      teamRunId: input.runId,
      sandboxId: sandbox.id,
      reason: "team dry-run complete"
    });
    const entry = this.store.createBlackboardEntry({
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      authorRoleId: input.role.id,
      type: "testResult",
      title: result.exitCode === 0 ? "Sandbox verification passed" : "Sandbox verification failed",
      body: result.exitCode === 0 ? "Sandbox verification passed; the real workspace was not modified." : `Sandbox verification failed with exit ${result.exitCode}.`,
      data: {
        sandboxId: sandboxRecord.id,
        command: testCommand,
        result,
        diff
      },
      confidence: result.exitCode === 0 ? 0.9 : 0.7,
      importance: 0.85
    });
    input.emit("team.blackboard.entry", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      entryId: entry.id,
      entryType: entry.type,
      authorRoleId: input.role.id
    });
  }

  private async runReviewer(input: ExecutorInput): Promise<void> {
    const tests = this.store.listBlackboardEntries({ teamRunId: input.runId, type: "testResult" });
    const patches = this.store.listBlackboardEntries({ teamRunId: input.runId, type: "patch" });
    const passed = tests.some((entry) => /passed/i.test(entry.title) || /passed/i.test(entry.body));
    const entry = this.store.createBlackboardEntry({
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      authorRoleId: input.role.id,
      type: "decision",
      title: passed ? "Review accepted sandboxed patch" : "Review blocked pending verification",
      body: passed
        ? `Ready for human approval if promotion is desired. Reviewed ${patches.length} patch entries and sandbox test output.`
        : "Patch cannot be treated as verified until sandbox tests pass.",
      data: {
        patchEntryIds: patches.map((patch) => patch.id),
        testEntryIds: tests.map((test) => test.id)
      },
      confidence: passed ? 0.85 : 0.75,
      importance: 0.8
    });
    input.emit("team.blackboard.entry", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      entryId: entry.id,
      entryType: entry.type,
      authorRoleId: input.role.id
    });
  }

  private async runReleaseCoordinator(input: ExecutorInput): Promise<void> {
    const fixtureResponse = {
      id: "pr_fixture_calculator_add",
      title: "Draft: Fix calculator add implementation",
      branch: "squidbot/fix-calculator-add",
      base: "main",
      status: "draft",
      url: "https://example.local/github/fixture/pr_fixture_calculator_add",
      summary: "Fixture-only draft PR summary for the calculator add fix. No real connector write was performed."
    };
    input.emit("connector.call", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      connectorName: "github",
      operationName: "openDraftPullRequest",
      mode: "fixture",
      costOwner: "free",
      dataClassifications: ["public"],
      policy: {
        allowed: true,
        requiresApproval: true,
        reason: "Developer workflow write is prepared in fixture mode and requires approval before any real connector write."
      }
    });
    input.emit("connector.fixture", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      connectorName: "github",
      operationName: "openDraftPullRequest",
      fixture: true,
      response: fixtureResponse
    });
    input.emit("connector.prDrafted", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      connectorName: "github",
      operationName: "openDraftPullRequest",
      action: "openDraftPullRequest",
      mode: "fixture",
      prId: fixtureResponse.id,
      branch: fixtureResponse.branch,
      baseBranch: fixtureResponse.base,
      diffSummary: fixtureResponse.summary,
      approved: false
    });
    const draftEntry = this.store.createBlackboardEntry({
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      authorRoleId: input.role.id,
      type: "summary",
      title: "Fixture draft PR prepared",
      body: fixtureResponse.summary,
      data: fixtureResponse,
      confidence: 0.82,
      importance: 0.7
    });
    input.emit("team.blackboard.entry", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      entryId: draftEntry.id,
      entryType: draftEntry.type,
      authorRoleId: input.role.id
    });
    const permission = checkRoleToolPermission({
      role: input.role.manifest,
      team: input.team.manifest,
      toolName: "connector.github.openDraftPullRequest",
      riskLevel: "high",
      realConnectorWrite: true
    });
    if (!permission.allowed || permission.requiresApproval) {
      const entry = this.store.createBlackboardEntry({
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        authorRoleId: input.role.id,
        type: "handoff",
        title: "Draft PR requires approval",
        body: permission.allowed ? permission.reason : `Denied: ${permission.reason}`,
        data: {
          toolName: "connector.github.openDraftPullRequest",
          permission
        },
        confidence: 0.9,
        importance: 0.85,
        sensitivity: "restricted"
      });
      input.emit("team.blackboard.entry", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        entryId: entry.id,
        entryType: entry.type,
        authorRoleId: input.role.id
      });
      const handoff = this.handoffs.requestHandoff({
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        requestedByRoleId: input.role.id,
        reason: "High-risk connector write",
        question: "Approve a fixture/real draft PR connector action for this team run?",
        options: ["approve fixture only", "reject", "revise"]
      });
      input.emit("team.handoff.requested", {
        teamRunId: input.runId,
        subtaskId: input.subtask.id,
        handoffId: handoff.id,
        question: handoff.question
      });
    }
  }

  private recordDenied(input: ExecutorInput, toolName: string, reason: string): void {
    input.emit("team.agent.toolDenied", {
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      roleId: input.role.id,
      toolName,
      reason
    });
    this.store.createBlackboardEntry({
      teamRunId: input.runId,
      subtaskId: input.subtask.id,
      authorRoleId: input.role.id,
      type: "blocker",
      title: `Tool denied: ${toolName}`,
      body: reason,
      data: { toolName },
      confidence: 0.9,
      importance: 0.8
    });
    const gapType = toolName.includes(".") ? "missingPermission" : "missingTool";
    const gapDescription =
      gapType === "missingTool"
        ? `Required team tool is not registered or available: ${toolName}. ${reason}`
        : reason;
    const gap = this.database.insertAffordanceGap({
      id: createId("gap"),
      runId: input.runId,
      type: gapType,
      name: toolName,
      severity: "medium",
      description: gapDescription,
      context: {
        teamRunId: input.runId,
        roleId: input.role.id,
        subtaskId: input.subtask.id
      },
      createdAt: new Date().toISOString()
    });
    input.emit("affordance.gap", {
      teamRunId: input.runId,
      gapId: gap.id,
      type: gap.type,
      name: gap.name,
      severity: gap.severity,
      description: gap.description,
      sourceRunId: input.runId,
      context: gap.context
    });
  }

  private loadRoles(team: TeamRecord): AgentRoleRecord[] {
    const roles = team.manifest.roles.map((roleId) => {
      const role = this.store.getRole(roleId);
      if (!role) {
        throw new Error(`Team role not installed: ${roleId}`);
      }
      return role;
    });
    return roles;
  }

  private findReferencedSkill(task: string): { id: string; name: string; currentVersion: string } | null {
    if (!/\bskill\b/i.test(task)) {
      return null;
    }
    try {
      const row = this.database.db
        .prepare(
          `SELECT id, name, currentVersion
           FROM skills
           WHERE status = 'approved'
             AND (
               lower(id) LIKE '%fix%add%bug%'
               OR lower(name) LIKE '%fix%add%bug%'
               OR lower(name) LIKE '%calculator%'
             )
           ORDER BY updatedAt DESC
           LIMIT 1`
        )
        .get() as { id: string; name: string; currentVersion: string } | undefined;
      return row ?? null;
    } catch {
      return null;
    }
  }

  private persistMemoryCandidates(teamRunId: string, entries: BlackboardEntry[]): string[] {
    const memory = new MemoryGraphStore(this.database);
    const important = entries.filter((entry) => (entry.type === "evidence" || entry.type === "decision" || entry.type === "risk") && entry.importance >= 0.75);
    const nodeIds: string[] = [];
    for (const entry of important.slice(0, 5)) {
      try {
        const node = memory.createNode({
          type: entry.type === "decision" ? "decision" : entry.type === "risk" ? "risk" : "fact",
          title: `Team ${entry.type}: ${entry.title}`,
          body: entry.body,
          confidence: entry.confidence,
          importance: entry.importance,
          sensitivity: entry.sensitivity
        });
        nodeIds.push(node.id);
        this.store.updateBlackboardEntry(entry.id, {
          data: {
            ...(entry.data && typeof entry.data === "object" ? (entry.data as Record<string, unknown>) : {}),
            memoryNodeId: node.id,
            teamRunId
          }
        });
      } catch {
        // Memory graph validation can reject some relationships; blackboard persistence remains authoritative.
      }
    }
    return nodeIds;
  }

  private saveReflection(
    run: TeamRun,
    status: string,
    summary: string
  ): {
    reflectionId: string;
    task: string;
    summary: string;
    outcome: string;
    successFactors: string[];
    failureModes: string[];
    missingTools: string[];
    missingPermissions: string[];
    missingContext: string[];
    reusablePatterns: string[];
    failureTaxonomy: string[];
    affordanceIds: string[];
    memoryCandidates: [];
  } {
    const gaps = this.database.listAffordanceGaps({ runId: run.id, status: "all", limit: 100 });
    const failureTaxonomy =
      status === "completed"
        ? gaps.map((gap) => gap.type)
        : [...new Set([...gaps.map((gap) => gap.type), "missingPermission"])];
    const reflection = {
      reflectionId: createId("reflection"),
      task: run.task,
      summary: `Team run ${run.id}: ${summary}`,
      outcome: status === "completed" ? "succeeded: team run completed with synthesis." : `partially_succeeded: team run ended with status ${status}.`,
      successFactors: ["Role-scoped subtasks were persisted.", "Blackboard entries captured evidence and outcomes."],
      failureModes: status === "completed" ? [] : ["Team run requires human review or hit a blocker."],
      missingTools: gaps.filter((gap) => gap.type === "missingTool").map((gap) => gap.name),
      missingPermissions: gaps.filter((gap) => gap.type === "missingPermission").map((gap) => gap.name),
      missingContext: [],
      reusablePatterns: ["Use scoped roles and sandbox verification before coordinator synthesis."],
      failureTaxonomy,
      affordanceIds: gaps.map((gap) => gap.id),
      memoryCandidates: [] as []
    };
    this.database.saveReflection({
      id: reflection.reflectionId,
      sessionId: `session_${run.id}`,
      runId: run.id,
      task: reflection.task,
      summary: reflection.summary,
      outcome: reflection.outcome,
      successFactors: reflection.successFactors,
      failureModes: reflection.failureModes,
      missingTools: reflection.missingTools,
      missingPermissions: reflection.missingPermissions,
      missingContext: reflection.missingContext,
      reusablePatterns: reflection.reusablePatterns,
      memoryCandidates: reflection.memoryCandidates,
      failureTaxonomy: reflection.failureTaxonomy,
      affordanceIds: reflection.affordanceIds,
      createdAt: new Date().toISOString()
    });
    return reflection;
  }

  private createTeamEvent(run: TeamRun, type: AgentEvent["type"], data: Record<string, unknown>): AgentEvent {
    return {
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId: `session_${run.id}`,
      runId: run.id,
      type,
      data: {
        runId: run.id,
        teamRunId: run.id,
        teamId: run.teamId,
        ...data
      }
    };
  }

  private appendTeamRunEvent(run: TeamRun, type: AgentEvent["type"], data: Record<string, unknown>): void {
    const event = this.createTeamEvent(run, type, data);
    this.database.appendEvent({
      id: event.id,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      type: event.type,
      data: event.data
    });
    this.saveTrace(
      this.database.listEvents(event.sessionId).map((stored) => {
        const dataJson = JSON.parse(stored.data) as Record<string, unknown>;
        return {
          id: stored.id,
          timestamp: stored.timestamp,
          sessionId: stored.session_id,
          runId: typeof dataJson.runId === "string" ? dataJson.runId : run.id,
          type: stored.type as AgentEvent["type"],
          data: dataJson
        };
      })
    );
  }

  private appendStandaloneEvent(type: AgentEvent["type"], data: Record<string, unknown>): void {
    const sessionId = "session_team_admin";
    const runId = String(data.teamId ?? createId("team_admin"));
    const event: AgentEvent = {
      id: createId("evt"),
      timestamp: new Date().toISOString(),
      sessionId,
      runId,
      type,
      data: {
        runId,
        ...data
      }
    };
    this.database.appendEvent({
      id: event.id,
      timestamp: event.timestamp,
      sessionId,
      type,
      data: event.data
    });
    const trace = buildTrace([event]);
    this.database.saveTrace({
      id: trace.id,
      sessionId,
      events: trace,
      createdAt: trace.createdAt
    });
  }

  private saveTrace(events: AgentEvent[]): Trace {
    const trace = buildTrace(events);
    this.database.saveTrace({
      id: trace.id,
      sessionId: trace.sessionId,
      events: trace,
      createdAt: trace.createdAt
    });
    return trace;
  }
}

type ExecutorInput = {
  runId: string;
  team: TeamRecord;
  subtask: TeamSubtask;
  role: AgentRoleRecord;
  workspacePath?: string;
  emit: (type: AgentEvent["type"], data: Record<string, unknown>) => string;
};

function requireWorkspace(workspacePath: string | undefined): string {
  if (!workspacePath) {
    throw new Error("Team task requires a workspace path for this subtask.");
  }
  return workspacePath;
}

function countWorkload(subtasks: TeamSubtask[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const subtask of subtasks) {
    if (subtask.assignedRoleId && (subtask.status === "assigned" || subtask.status === "running")) {
      counts[subtask.assignedRoleId] = (counts[subtask.assignedRoleId] ?? 0) + 1;
    }
  }
  return counts;
}
