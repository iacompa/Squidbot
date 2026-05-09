import type { SquidDatabase } from "@squidbot/db";
import { TeamStore } from "./teamStore.js";
import type { AgentMessage, AgentMessageType } from "./types.js";

export class MessageBus {
  private readonly store: TeamStore;

  constructor(database: SquidDatabase) {
    this.store = new TeamStore(database);
  }

  send(input: {
    teamRunId: string;
    fromRoleId?: string | null;
    toRoleId?: string | null;
    messageType: AgentMessageType;
    content: string;
    data?: unknown;
  }): AgentMessage {
    return this.store.createMessage(input);
  }

  list(teamRunId: string): AgentMessage[] {
    return this.store.listMessages(teamRunId);
  }
}
