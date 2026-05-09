import type { SquidDatabase } from "@squidbot/db";
import { DEFAULT_TENANT_ID, type LineageEdgeRecord } from "./types.js";
import { createId, nowIso, parseJson } from "./internal.js";

type LineageRow = Omit<LineageEdgeRecord, "metadata"> & {
  metadataJson: string;
};

export class LineageRecorder {
  constructor(private readonly database: SquidDatabase) {}

  record(input: {
    tenantId?: string;
    sourceType: string;
    sourceId: string;
    targetType: string;
    targetId: string;
    relationship: string;
    dataClassification?: string;
    metadata?: Record<string, unknown>;
  }): LineageEdgeRecord {
    const id = createId("lineage");
    const now = nowIso();
    this.database.db
      .prepare(
        `INSERT INTO data_lineage_edges (id, tenantId, sourceType, sourceId, targetType, targetId, relationship, dataClassification, metadataJson, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.tenantId ?? DEFAULT_TENANT_ID, input.sourceType, input.sourceId, input.targetType, input.targetId, input.relationship, input.dataClassification ?? "internal", JSON.stringify(input.metadata ?? {}), now);
    return this.get(id)!;
  }

  listForRun(runId: string, tenantId = DEFAULT_TENANT_ID): LineageEdgeRecord[] {
    const rows = this.database.db
      .prepare(
        `SELECT * FROM data_lineage_edges
         WHERE tenantId = ? AND (sourceId = ? OR targetId = ? OR json_extract(metadataJson, '$.runId') = ?)
         ORDER BY createdAt ASC`
      )
      .all(tenantId, runId, runId, runId) as LineageRow[];
    return rows.map(mapLineage);
  }

  get(id: string): LineageEdgeRecord | null {
    const row = this.database.db.prepare(`SELECT * FROM data_lineage_edges WHERE id = ?`).get(id) as LineageRow | undefined;
    return row ? mapLineage(row) : null;
  }
}

function mapLineage(row: LineageRow): LineageEdgeRecord {
  return {
    ...row,
    metadata: parseJson(row.metadataJson, {})
  };
}
