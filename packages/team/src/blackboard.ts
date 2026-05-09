import type { SquidDatabase } from "@squidbot/db";
import { TeamStore } from "./teamStore.js";
import type { BlackboardEntry, BlackboardEntryType, TeamSensitivity } from "./types.js";

export class BlackboardStore {
  private readonly store: TeamStore;

  constructor(database: SquidDatabase) {
    this.store = new TeamStore(database);
  }

  createEntry(input: {
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
    return this.store.createBlackboardEntry(input);
  }

  updateEntry(entryId: string, update: Partial<Pick<BlackboardEntry, "title" | "body" | "data" | "confidence" | "importance" | "sensitivity">>): BlackboardEntry {
    return this.store.updateBlackboardEntry(entryId, update);
  }

  deleteEntry(entryId: string): BlackboardEntry {
    return this.store.deleteBlackboardEntry(entryId);
  }

  listByTeamRun(teamRunId: string): BlackboardEntry[] {
    return this.store.listBlackboardEntries({ teamRunId });
  }

  listByType(teamRunId: string, type: BlackboardEntryType): BlackboardEntry[] {
    return this.store.listBlackboardEntries({ teamRunId, type });
  }

  listBySubtask(teamRunId: string, subtaskId: string): BlackboardEntry[] {
    return this.store.listBlackboardEntries({ teamRunId, subtaskId });
  }

  search(teamRunId: string, query: string): BlackboardEntry[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return this.listByTeamRun(teamRunId);
    }
    return this.listByTeamRun(teamRunId).filter((entry) => `${entry.title}\n${entry.body}\n${JSON.stringify(entry.data)}`.toLowerCase().includes(normalized));
  }

  createConflictEntry(input: {
    teamRunId: string;
    conflictId: string;
    title: string;
    body: string;
    involvedEntryIds: string[];
  }): BlackboardEntry {
    return this.createEntry({
      teamRunId: input.teamRunId,
      type: "conflict",
      title: input.title,
      body: input.body,
      data: {
        conflictId: input.conflictId,
        involvedEntryIds: input.involvedEntryIds
      },
      confidence: 0.8,
      importance: 0.8,
      sensitivity: "restricted"
    });
  }
}
