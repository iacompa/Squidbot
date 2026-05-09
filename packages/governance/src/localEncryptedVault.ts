import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_TENANT_ID, type SecretReferenceRecord } from "./types.js";
import { nowIso } from "./internal.js";
import { SecretReferenceStore } from "./secretReferences.js";

export class LocalEncryptedVault {
  private readonly references: SecretReferenceStore;
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(private readonly database: SquidDatabase, masterKey?: string) {
    this.references = new SecretReferenceStore(database);
    const seed = masterKey ?? process.env.SQUIDBOT_LOCAL_SECRET_KEY ?? "squidbot-local-dev-master-key";
    this.key = createHash("sha256").update(seed).digest();
    this.keyId = createHash("sha256").update(`key:${seed}`).digest("hex").slice(0, 16);
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
