import type { SquidDatabase } from "@squidbot/db";
import type { AgentEvent } from "./types.js";

export class EventLog {
  constructor(private readonly database: SquidDatabase) {}

  append(event: AgentEvent): void {
    this.database.appendEvent({
      id: event.id,
      timestamp: event.timestamp,
      sessionId: event.sessionId,
      type: event.type,
      data: {
        runId: event.runId,
        ...event.data
      }
    });
  }
}
