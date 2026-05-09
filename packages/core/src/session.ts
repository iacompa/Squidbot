import { createId } from "./types.js";

export type AgentSession = {
  id: string;
  workspacePath: string;
  createdAt: string;
};

export function createSession(workspacePath: string, id = createId("session")): AgentSession {
  return {
    id,
    workspacePath,
    createdAt: new Date().toISOString()
  };
}
