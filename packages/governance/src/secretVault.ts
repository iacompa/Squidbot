import type { SquidDatabase } from "@squidbot/db";
import { LocalEncryptedVault } from "./localEncryptedVault.js";

export class SecretVault extends LocalEncryptedVault {
  constructor(database: SquidDatabase, masterKey?: string) {
    super(database, masterKey);
  }

  providers(): Array<{ id: string; status: "available" | "fixture" | "optional"; description: string }> {
    return [
      { id: "localEncrypted", status: "available", description: "Default local AES-256-GCM encrypted vault." },
      { id: "hashicorpVault", status: "optional", description: "Optional external Vault reference adapter; not required for tests." },
      { id: "env", status: "available", description: "Environment variable reference adapter; values are never printed." },
      { id: "n8nExternal", status: "fixture", description: "n8n external secret reference placeholder." }
    ];
  }
}
