import type { SquidDatabase } from "@squidbot/db";
import { BlackboardStore } from "./blackboard.js";
import { TeamStore } from "./teamStore.js";
import type { BlackboardEntry, TeamConflict } from "./types.js";

export class ConflictDetector {
  private readonly store: TeamStore;
  private readonly blackboard: BlackboardStore;

  constructor(database: SquidDatabase) {
    this.store = new TeamStore(database);
    this.blackboard = new BlackboardStore(database);
  }

  detect(teamRunId: string): TeamConflict[] {
    const entries = this.store.listBlackboardEntries({ teamRunId });
    const existingDescriptions = new Set(this.store.listConflicts(teamRunId, "all").map((conflict) => conflict.description));
    const conflicts: TeamConflict[] = [];

    for (const conflict of [...this.detectPatchConflicts(entries), ...this.detectDecisionConflicts(entries), ...this.detectMemoryConflicts(entries)]) {
      if (existingDescriptions.has(conflict.description)) {
        continue;
      }
      const row = this.store.createConflict({
        teamRunId,
        type: conflict.type,
        severity: conflict.severity,
        description: conflict.description,
        involvedEntryIds: conflict.involvedEntryIds,
        involvedRoleIds: conflict.involvedRoleIds
      });
      this.blackboard.createConflictEntry({
        teamRunId,
        conflictId: row.id,
        title: conflict.description,
        body: conflict.description,
        involvedEntryIds: conflict.involvedEntryIds
      });
      conflicts.push(row);
    }

    return conflicts;
  }

  resolveLowSeverity(teamRunId: string): TeamConflict[] {
    const conflicts = this.store.listConflicts(teamRunId, "open").filter((conflict) => conflict.severity === "low");
    return conflicts.map((conflict) =>
      this.store.resolveConflict(conflict.id, {
        method: "deterministic",
        rule: "prefer higher confidence or newer sourced entry"
      })
    );
  }

  private detectPatchConflicts(entries: BlackboardEntry[]): Array<{
    type: "patchConflict";
    severity: "medium";
    description: string;
    involvedEntryIds: string[];
    involvedRoleIds: string[];
  }> {
    const patches = entries.filter((entry) => entry.type === "patch");
    const conflicts = [];
    for (let leftIndex = 0; leftIndex < patches.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < patches.length; rightIndex += 1) {
        const left = patches[leftIndex];
        const right = patches[rightIndex];
        const overlap = [...patchFiles(left.body)].filter((file) => patchFiles(right.body).has(file));
        if (overlap.length > 0 && left.body !== right.body) {
          conflicts.push({
            type: "patchConflict" as const,
            severity: "medium" as const,
            description: `Patch conflict: entries modify overlapping files (${overlap.join(", ")}).`,
            involvedEntryIds: [left.id, right.id],
            involvedRoleIds: [left.authorRoleId, right.authorRoleId].filter((role): role is string => Boolean(role))
          });
        }
      }
    }
    return conflicts;
  }

  private detectDecisionConflicts(entries: BlackboardEntry[]): Array<{
    type: "decisionConflict";
    severity: "high";
    description: string;
    involvedEntryIds: string[];
    involvedRoleIds: string[];
  }> {
    const decisions = entries.filter((entry) => entry.type === "decision");
    const ready = decisions.filter((entry) => /ready|approve|accepted/i.test(entry.body));
    const reject = decisions.filter((entry) => /reject|block|failed/i.test(entry.body));
    if (ready.length === 0 || reject.length === 0) {
      return [];
    }
    const involved = [...ready, ...reject];
    return [
      {
        type: "decisionConflict",
        severity: "high",
        description: "Decision conflict: one role accepted work while another blocked or rejected it.",
        involvedEntryIds: involved.map((entry) => entry.id),
        involvedRoleIds: involved.map((entry) => entry.authorRoleId).filter((role): role is string => Boolean(role))
      }
    ];
  }

  private detectMemoryConflicts(entries: BlackboardEntry[]): Array<{
    type: "memoryConflict";
    severity: "high";
    description: string;
    involvedEntryIds: string[];
    involvedRoleIds: string[];
  }> {
    const byNode = new Map<string, BlackboardEntry[]>();
    for (const entry of entries) {
      const data = entry.data && typeof entry.data === "object" ? (entry.data as Record<string, unknown>) : {};
      const nodeId = typeof data.memoryNodeId === "string" ? data.memoryNodeId : entry.sourceMemoryNodeId ?? undefined;
      if (!nodeId) {
        continue;
      }
      byNode.set(nodeId, [...(byNode.get(nodeId) ?? []), entry]);
    }
    const conflicts = [];
    for (const [nodeId, nodeEntries] of byNode) {
      const hasContradiction = nodeEntries.some((entry) => /contradict|not true|opposite/i.test(entry.body));
      if (nodeEntries.length > 1 && hasContradiction) {
        conflicts.push({
          type: "memoryConflict" as const,
          severity: "high" as const,
          description: `Memory conflict: contradictory updates target ${nodeId}.`,
          involvedEntryIds: nodeEntries.map((entry) => entry.id),
          involvedRoleIds: nodeEntries.map((entry) => entry.authorRoleId).filter((role): role is string => Boolean(role))
        });
      }
    }
    return conflicts;
  }
}

function patchFiles(patch: string): Set<string> {
  return new Set([...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]));
}
