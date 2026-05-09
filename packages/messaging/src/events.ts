import { buildTrace, createId, type AgentEvent, type JsonObject } from "@squidbot/core";
import type { SquidDatabase } from "@squidbot/db";

export function appendMessagingEvent(database: SquidDatabase, type: string, data: JsonObject, sessionId = "session_messaging"): void {
  database.appendEvent({
    id: createId("evt"),
    timestamp: new Date().toISOString(),
    sessionId,
    type,
    data: {
      runId: typeof data.runId === "string" ? data.runId : `run_${sessionId}`,
      ...data
    }
  });
  refreshTraceForSession(database, sessionId);
}

export function refreshTraceForSession(database: SquidDatabase, sessionId: string): void {
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
