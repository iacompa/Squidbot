import fs from "node:fs";
import type { SquidDatabase } from "@squidbot/db";
import { defaultRoleManifests } from "./defaultRoles.js";
import { validateRoleManifest } from "./roleManifest.js";
import { TeamStore } from "./teamStore.js";
import type { AgentRoleManifest, AgentRoleRecord } from "./types.js";

export class RoleRegistry {
  private readonly store: TeamStore;

  constructor(database: SquidDatabase) {
    this.store = new TeamStore(database);
  }

  install(manifestInput: AgentRoleManifest): AgentRoleRecord {
    return this.store.saveRole(validateRoleManifest(manifestInput));
  }

  installFromFile(filePath: string): AgentRoleRecord {
    return this.install(JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentRoleManifest);
  }

  installDefaults(): AgentRoleRecord[] {
    return defaultRoleManifests.map((manifest) => this.install(manifest));
  }

  list(options: { includeArchived?: boolean } = {}): AgentRoleRecord[] {
    return this.store.listRoles(options);
  }

  get(roleId: string): AgentRoleRecord | null {
    return this.store.getRole(roleId);
  }

  archive(roleId: string): AgentRoleRecord {
    return this.store.archiveRole(roleId);
  }
}

export function createDefaultRoleRegistry(database: SquidDatabase): RoleRegistry {
  const registry = new RoleRegistry(database);
  registry.installDefaults();
  return registry;
}
