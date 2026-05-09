import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_TENANT_ID, type SecretReferenceRecord } from "./types.js";
import { createId, nowIso, parseJson } from "./internal.js";

type SecretReferenceRow = Omit<SecretReferenceRecord, "metadata"> & {
  metadataJson: string;
};

export class SecretReferenceStore {
  constructor(private readonly database: SquidDatabase) {}

  upsert(input: { tenantId?: string; name: string; provider: string; path: string; metadata?: Record<string, unknown>; rotated?: boolean }): SecretReferenceRecord {
    const tenantId = input.tenantId ?? DEFAULT_TENANT_ID;
    const now = nowIso();
    const existing = this.get(input.name, tenantId);
    const id = existing?.id ?? createId("secret_ref");
    const version = input.rotated ? String(Number(existing?.version ?? "0") + 1) : existing?.version ?? "1";
    this.database.db
      .prepare(
        `INSERT INTO secret_references (id, tenantId, name, provider, path, version, metadataJson, createdAt, updatedAt, rotatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenantId, name) DO UPDATE SET provider = excluded.provider, path = excluded.path,
          version = excluded.version, metadataJson = excluded.metadataJson, updatedAt = excluded.updatedAt, rotatedAt = excluded.rotatedAt`
      )
      .run(id, tenantId, input.name, input.provider, input.path, version, JSON.stringify(input.metadata ?? existing?.metadata ?? {}), existing?.createdAt ?? now, now, input.rotated ? now : existing?.rotatedAt ?? null);
    return this.get(input.name, tenantId)!;
  }

  get(nameOrId: string, tenantId = DEFAULT_TENANT_ID): SecretReferenceRecord | null {
    const row = this.database.db
      .prepare(`SELECT * FROM secret_references WHERE tenantId = ? AND (name = ? OR id = ?) AND archivedAt IS NULL LIMIT 1`)
      .get(tenantId, nameOrId, nameOrId) as SecretReferenceRow | undefined;
    return row ? mapSecretReference(row) : null;
  }

  list(tenantId = DEFAULT_TENANT_ID): SecretReferenceRecord[] {
    const rows = this.database.db.prepare(`SELECT * FROM secret_references WHERE tenantId = ? AND archivedAt IS NULL ORDER BY name ASC`).all(tenantId) as SecretReferenceRow[];
    return rows.map(mapSecretReference);
  }
}

function mapSecretReference(row: SecretReferenceRow): SecretReferenceRecord {
  return {
    ...row,
    metadata: parseJson(row.metadataJson, {})
  };
}
