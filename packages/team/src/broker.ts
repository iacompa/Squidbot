import { createId } from "@squidbot/core";
import type { AgentRoleRecord, TeamManifest, TeamRiskLevel, TeamSubtask, TeamSubtaskStatus } from "./types.js";

export type SubtaskDraft = {
  id: string;
  teamRunId: string;
  parentSubtaskId: string | null;
  assignedRoleId: string | null;
  title: string;
  description: string;
  status: TeamSubtaskStatus;
  priority: number;
  riskLevel: TeamRiskLevel;
  requiredCapabilities: string[];
  requiredTools: string[];
  dependsOn: string[];
  result: null;
  createdAt: string;
  updatedAt: string;
  startedAt: null;
  completedAt: null;
};

export class TaskBroker {
  decompose(input: { teamRunId: string; task: string; team: TeamManifest }): SubtaskDraft[] {
    const task = input.task.toLowerCase();
    const drafts: SubtaskDraft[] = [];
    const inspect = this.createDraft(input.teamRunId, {
      title: "Inspect workspace evidence",
      description: "Inspect relevant repository files, tests, docs, and memory context before implementation.",
      assignedRoleId: "researcher",
      requiredCapabilities: ["research", "readFiles"],
      requiredTools: ["workspace.readFile", "workspace.searchFiles"],
      priority: 10
    });
    drafts.push(inspect);

    const unsupportedTool = task.match(/\b(?:nonexistent tool|missing tool|use the tool)\s+([a-z0-9_.-]+)/i)?.[1] ?? (/\bquantumcodefixer\b/i.test(task) ? "quantumCodeFixer" : null);
    if (unsupportedTool) {
      drafts.push(
        this.createDraft(input.teamRunId, {
          title: `Attempt unsupported tool ${unsupportedTool}`,
          description: `The task requested ${unsupportedTool}, which is not available in the governed team tool registry.`,
          assignedRoleId: "implementer",
          requiredCapabilities: ["patch"],
          requiredTools: [unsupportedTool],
          dependsOn: [inspect.id],
          priority: 20,
          riskLevel: "medium"
        })
      );
      return drafts;
    }

    if (/\b(conflicting facts|contradictory facts|contradiction|contradictory memory)\b/.test(task)) {
      const positiveFact = this.createDraft(input.teamRunId, {
        title: "Record positive memory fact",
        description: "Record the first asserted calculator fact so the conflict detector can compare it with later evidence.",
        assignedRoleId: "researcher",
        requiredCapabilities: ["research", "readFiles"],
        requiredTools: ["workspace.readFile"],
        dependsOn: [inspect.id],
        priority: 20
      });
      const contradictoryFact = this.createDraft(input.teamRunId, {
        title: "Record contradictory memory fact",
        description: "Record the contradictory calculator fact against the same memory target.",
        assignedRoleId: "researcher",
        requiredCapabilities: ["research", "readFiles"],
        requiredTools: ["workspace.readFile"],
        dependsOn: [inspect.id],
        priority: 25
      });
      const review = this.createDraft(input.teamRunId, {
        title: "Review memory contradiction",
        description: "Review the contradictory memory facts and block silent overwrite.",
        assignedRoleId: "reviewer",
        requiredCapabilities: ["review"],
        requiredTools: ["team.blackboard.read"],
        dependsOn: [positiveFact.id, contradictoryFact.id],
        priority: 35
      });
      drafts.push(positiveFact, contradictoryFact, review);
      return drafts;
    }

    if (/\bresearcher\b/.test(task) && /\b(edit|write|patch|modify|fix)\b/.test(task)) {
      drafts.push(
        this.createDraft(input.teamRunId, {
          title: "Block researcher write request",
          description: "The parent task asks a read-only researcher to modify workspace state; verify permission scoping blocks it.",
          assignedRoleId: "researcher",
          requiredCapabilities: ["research"],
          requiredTools: ["workspace.createPatch"],
          dependsOn: [inspect.id],
          priority: 15,
          riskLevel: "medium"
        })
      );
      return drafts;
    }

    if (/(two alternative fixes|alternative fixes|abs\(a - b\)|abs\(a-b\))/.test(task)) {
      const canonicalPatch = this.createDraft(input.teamRunId, {
        title: "Propose canonical add patch",
        description: "Propose the evidence-backed calculator fix.",
        assignedRoleId: "implementer",
        requiredCapabilities: ["patch"],
        requiredTools: ["workspace.createPatch", "sandbox.applyPatch"],
        dependsOn: [inspect.id],
        priority: 20,
        riskLevel: "medium"
      });
      const alternativePatch = this.createDraft(input.teamRunId, {
        title: "Propose alternative conflicting patch",
        description: "Propose the requested alternative calculator patch so conflict detection can compare overlapping edits.",
        assignedRoleId: "implementer",
        requiredCapabilities: ["patch"],
        requiredTools: ["workspace.createPatch", "sandbox.applyPatch"],
        dependsOn: [inspect.id],
        priority: 25,
        riskLevel: "medium"
      });
      const review = this.createDraft(input.teamRunId, {
        title: "Review conflicting patch proposals",
        description: "Review overlapping calculator patches and decide which one is supported by tests.",
        assignedRoleId: "reviewer",
        requiredCapabilities: ["review"],
        requiredTools: ["team.blackboard.read"],
        dependsOn: [canonicalPatch.id, alternativePatch.id],
        priority: 40
      });
      drafts.push(canonicalPatch, alternativePatch, review);
      return drafts;
    }

    if (/\b(github|gitlab|jira|pr|pull request|ticket)\b/.test(task)) {
      const patch = this.createDraft(input.teamRunId, {
        title: "Propose implementation patch",
        description: "Use the evidence to propose a minimal sandbox-staged patch.",
        assignedRoleId: "implementer",
        requiredCapabilities: ["patch"],
        requiredTools: ["workspace.createPatch", "sandbox.applyPatch"],
        dependsOn: [inspect.id],
        priority: 20,
        riskLevel: "medium"
      });
      const test = this.createDraft(input.teamRunId, {
        title: "Verify patch in sandbox",
        description: "Apply the proposed patch in an isolated sandbox and run verification commands.",
        assignedRoleId: "tester",
        requiredCapabilities: ["test", "sandbox"],
        requiredTools: ["sandbox.runCommand", "test.run"],
        dependsOn: [patch.id],
        priority: 30,
        riskLevel: "medium"
      });
      const release = this.createDraft(input.teamRunId, {
        title: "Draft developer workflow updates",
        description: "Prepare PR, issue, or CI connector actions in fixture or approval-gated mode.",
        assignedRoleId: "releaseCoordinator",
        requiredCapabilities: ["developerConnectors"],
        requiredTools: ["connector.github.openDraftPullRequest", "connector.jira.updateIssue"],
        dependsOn: [test.id],
        priority: 40,
        riskLevel: "high"
      });
      const review = this.createDraft(input.teamRunId, {
        title: "Review patch, test, and release risk",
        description: "Review all proposed changes and connector actions for correctness and risk.",
        assignedRoleId: "reviewer",
        requiredCapabilities: ["review", "risk"],
        requiredTools: ["team.blackboard.read"],
        dependsOn: [release.id],
        priority: 50
      });
      drafts.push(patch, test, release, review);
      return drafts;
    }

    if (task.includes("fix") || task.includes("bug") || task.includes("code") || task.includes("test") || task.includes("verify")) {
      const patch = this.createDraft(input.teamRunId, {
        title: "Propose implementation patch",
        description: "Use the evidence to propose a minimal sandbox-staged patch.",
        assignedRoleId: "implementer",
        requiredCapabilities: ["patch"],
        requiredTools: ["workspace.createPatch", "sandbox.applyPatch"],
        dependsOn: [inspect.id],
        priority: 20,
        riskLevel: "medium"
      });
      const test = this.createDraft(input.teamRunId, {
        title: "Verify patch in sandbox",
        description: "Apply the proposed patch in an isolated sandbox and run verification commands.",
        assignedRoleId: "tester",
        requiredCapabilities: ["test", "sandbox"],
        requiredTools: ["sandbox.runCommand", "test.run"],
        dependsOn: [patch.id],
        priority: 30,
        riskLevel: "medium"
      });
      const asksNotToPromote = /\b(do not promote|don't promote|no promote|not promote)\b/.test(task);
      const promote = !asksNotToPromote && /\b(promote|apply|real workspace|without asking|immediately)\b/.test(task)
        ? this.createDraft(input.teamRunId, {
            title: "Request real workspace promotion",
            description: "Attempting to promote sandboxed changes to the real workspace must be approval-gated.",
            assignedRoleId: "implementer",
            requiredCapabilities: ["patch"],
            requiredTools: ["sandbox.promote"],
            dependsOn: [test.id],
            priority: 40,
            riskLevel: "high"
          })
        : null;
      const review = this.createDraft(input.teamRunId, {
        title: "Review proposed work",
        description: "Review evidence, patch, and test results before coordinator synthesis.",
        assignedRoleId: "reviewer",
        requiredCapabilities: ["review"],
        requiredTools: ["team.blackboard.read"],
        dependsOn: [promote?.id ?? test.id],
        priority: promote ? 50 : 40
      });
      drafts.push(patch, test, ...(promote ? [promote] : []), review);
      return drafts;
    }

    drafts.push(
      this.createDraft(input.teamRunId, {
        title: "Request clarification",
        description: "The task is ambiguous or unsupported by deterministic team routing.",
        assignedRoleId: "coordinator",
        requiredCapabilities: ["handoff"],
        requiredTools: ["team.handoff.request"],
        dependsOn: [inspect.id],
        priority: 20,
        riskLevel: "low"
      })
    );
    return drafts;
  }

  assignSubtask(input: { subtask: TeamSubtask; roles: AgentRoleRecord[]; workload?: Record<string, number> }): string {
    if (input.subtask.assignedRoleId && input.roles.some((role) => role.id === input.subtask.assignedRoleId)) {
      return input.subtask.assignedRoleId;
    }
    const candidates = input.roles.filter((role) => {
      const capabilities = new Set(role.manifest.capabilities);
      return input.subtask.requiredCapabilities.every((capability) => capabilities.has(capability));
    });
    if (candidates.length === 0) {
      throw new Error(`No role can satisfy subtask capabilities: ${input.subtask.requiredCapabilities.join(", ")}`);
    }
    candidates.sort((left, right) => (input.workload?.[left.id] ?? 0) - (input.workload?.[right.id] ?? 0));
    return candidates[0].id;
  }

  readySubtasks(subtasks: TeamSubtask[]): TeamSubtask[] {
    const completed = new Set(subtasks.filter((subtask) => subtask.status === "completed").map((subtask) => subtask.id));
    return subtasks.filter((subtask) => subtask.status === "queued" && subtask.dependsOn.every((dependency) => completed.has(dependency)));
  }

  private createDraft(
    teamRunId: string,
    input: {
      title: string;
      description: string;
      assignedRoleId: string;
      requiredCapabilities: string[];
      requiredTools: string[];
      dependsOn?: string[];
      priority: number;
      riskLevel?: TeamRiskLevel;
    }
  ): SubtaskDraft {
    const now = new Date().toISOString();
    return {
      id: createId("team_subtask"),
      teamRunId,
      parentSubtaskId: null,
      assignedRoleId: input.assignedRoleId,
      title: input.title,
      description: input.description,
      status: "queued",
      priority: input.priority,
      riskLevel: input.riskLevel ?? "low",
      requiredCapabilities: input.requiredCapabilities,
      requiredTools: input.requiredTools,
      dependsOn: input.dependsOn ?? [],
      result: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null
    };
  }
}
