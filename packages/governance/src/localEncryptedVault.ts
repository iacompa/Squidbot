import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_TENANT_ID, type SecretReferenceRecord } from "./types.js";
import { nowIso } from "./internal.js";
import { SecretReferenceStore } from "./secretReferences.js";

const VAULT_KEY_SETTING = "vault.localMasterKey";

export type VaultKeySource = "explicit" | "env" | "generated" | "setting";

export type VaultKeyStatus = {
  hasKey: true;
  source: VaultKeySource;
  keyId: string;
} | {
  hasKey: false;
  source: "missing";
};

function deriveKey(seed: string): { key: Buffer; keyId: string } {
  return {
    key: createHash("sha256").update(seed).digest(),
    keyId: createHash("sha256").update(`key:${seed}`).digest("hex").slice(0, 16)
  };
}

function generateFreshSeed(): string {
  return randomBytes(32).toString("base64");
}

export class LocalEncryptedVault {
  private readonly references: SecretReferenceStore;
  private readonly key: Buffer;
  private readonly keyId: string;
  private readonly keySource: VaultKeySource;

  constructor(private readonly database: SquidDatabase, masterKey?: string) {
    this.references = new SecretReferenceStore(database);

    // Source precedence:
    // 1. Explicit constructor arg (tests pass a stable string)
    // 2. SQUIDBOT_LOCAL_SECRET_KEY env var (production deployments inject this)
    // 3. Previously generated key stored in settings (persistent on this machine)
    // 4. Freshly generated random key (persisted to settings for next boot)
    //
    // We NEVER fall back to a hardcoded string default — that would mean
    // every fresh install on every machine shares the same encryption key,
    // which is no better than plaintext.
    let seed: string;
    if (masterKey) {
      seed = masterKey;
      this.keySource = "explicit";
    } else if (process.env.SQUIDBOT_LOCAL_SECRET_KEY) {
      seed = process.env.SQUIDBOT_LOCAL_SECRET_KEY;
      this.keySource = "env";
    } else {
      const existing = this.database.getSetting<string>(VAULT_KEY_SETTING);
      if (existing && existing.length > 0) {
        seed = existing;
        this.keySource = "setting";
      } else {
        seed = generateFreshSeed();
        this.database.setSetting(VAULT_KEY_SETTING, seed);
        this.keySource = "generated";
      }
    }

    const derived = deriveKey(seed);
    this.key = derived.key;
    this.keyId = derived.keyId;
  }

  /** Returns the source and id of the active vault master key (never the seed itself). */
  keyStatus(): VaultKeyStatus {
    return { hasKey: true, source: this.keySource, keyId: this.keyId };
  }

  setSecret(name: string, value: string, options: { tenantId?: string; rotate?: boolean } = {}): SecretReferenceRecord {
    const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
    const now = nowIso();
    const reference = this.references.upsert({
      tenantId,
      name,
      provider: "localEncrypted",
      path: `local://${tenantId}/${name}`,
      metadata: { keyId: this.keyId, algorithm: "aes-256-gcm" },
      rotated: options.rotate
    });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    this.database.db
      .prepare(
        `INSERT INTO local_encrypted_secrets (id, tenantId, secretReferenceId, ciphertext, iv, authTag, algorithm, keyId, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'aes-256-gcm', ?, ?, ?)
         ON CONFLICT(secretReferenceId) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv,
          authTag = excluded.authTag, keyId = excluded.keyId, updatedAt = excluded.updatedAt`
      )
      .run(`encrypted_${reference.id}`, tenantId, reference.id, ciphertext.toString("base64"), iv.toString("base64"), authTag.toString("base64"), this.keyId, now, now);
    return reference;
  }

  getSecret(nameOrId: string, options: { tenantId?: string; reveal?: boolean } = {}): { reference: SecretReferenceRecord; value: string } | { reference: SecretReferenceRecord; value: "[REDACTED]" } {
    const tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
    const reference = this.references.get(nameOrId, tenantId);
    if (!reference) {
      throw new Error(`Secret reference not found: ${nameOrId}`);
    }
    if (!options.reveal) {
      return { reference, value: "[REDACTED]" };
    }
    const row = this.database.db.prepare(`SELECT * FROM local_encrypted_secrets WHERE secretReferenceId = ?`).get(reference.id) as
      | { ciphertext: string; iv: string; authTag: string }
      | undefined;
    if (!row) {
      throw new Error(`Encrypted secret not found for reference: ${reference.name}`);
    }
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(row.iv, "base64"));
    decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
    return { reference, value: plaintext };
  }

  listSecrets(tenantId = DEFAULT_TENANT_ID): SecretReferenceRecord[] {
    return this.references.list(tenantId);
  }
}
