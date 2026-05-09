import type { SquidDatabase } from "@squidbot/db";
import { TeamStore } from "./teamStore.js";
import type { HumanHandoff } from "./types.js";

export class HandoffManager {
  private readonly store: TeamStore;

  constructor(database: SquidDatabase) {
    this.store = new TeamStore(database);
  }

  requestHandoff(input: {
    teamRunId: string;
    subtaskId?: string | null;
    requestedByRoleId?: string | null;
    reason: string;
    question: string;
    options?: string[];
  }): HumanHandoff {
    const handoff = this.store.createHandoff(input);
    this.store.updateTeamRun(input.teamRunId, { status: "waiting_for_human" });
    if (input.subtaskId) {
      this.store.updateSubtask(input.subtaskId, { status: "waiting_for_human" });
    }
    return handoff;
  }

  answerHandoff(handoffId: string, responseText: string, response?: unknown): HumanHandoff {
    const handoff = this.store.answerHandoff(handoffId, responseText, response);
    this.store.createBlackboardEntry({
      teamRunId: handoff.teamRunId,
      subtaskId: handoff.subtaskId,
      authorRoleId: "human",
      type: "answer",
      title: "Human handoff response",
      body: responseText,
      data: response ?? {},
      confidence: 1,
      importance: 0.9,
      sensitivity: "restricted"
    });
    if (this.store.listHandoffs({ teamRunId: handoff.teamRunId, status: "open" }).length === 0) {
      this.store.updateTeamRun(handoff.teamRunId, { status: "running" });
    }
    return handoff;
  }

  cancelHandoff(handoffId: string): HumanHandoff {
    return this.store.cancelHandoff(handoffId);
  }

  listOpen(): HumanHandoff[] {
    return this.store.listHandoffs({ status: "open" });
  }
}
